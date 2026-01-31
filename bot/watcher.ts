import { createPublicClient, http, parseAbiItem, formatUnits, PublicClient } from 'viem';
import { base } from 'viem/chains';
import { CONFIG, publicClient, premiumClient, wssClient } from './config.js';
import { UserPosition } from './interfaces.js';
import { BatchExecutor } from './batchExecutor.js';
import { bridge } from './server.js';
import { checkAndExecute } from './executor.js';
import { dashboard } from './logger.js';

// Internal State
export const healthFactorCache = new Map<string, UserPosition>();
export const killList = new Set<string>();

// Queue for batching
export const liquidationQueue: UserPosition[] = [];

/**
 * 🧹 BATCHER PROCESS: Groups queued opportunities and executes them
 * Runs every 1 second to bundle dust or snipe fast.
 */
export function startBatcher() {
    console.log('🧹 Starting Batch Executor (1s loop)...');
    setInterval(async () => {
        if (liquidationQueue.length === 0) return;

        // 1. Drain Queue (Atomic-ish)
        // copy and clear to avoid double processing
        const candidates = [...liquidationQueue];
        liquidationQueue.length = 0;

        // 2. Group & Execute
        try {
            const batches = await BatchExecutor.groupCandidates(candidates);

            for (const batch of batches) {
                await BatchExecutor.executeBatch(batch);
            }
        } catch (e) {
            console.error('Batcher failed:', e);
        }

    }, 1000);
}

// ... (Modify checkAndExecute calls below)

// In batchUpdateHealthFactorsGeneric (Around line 199)
// if (hf < CONFIG.BOT.LIQUIDATION_THRESHOLD && hf > 0) {
//     dashboard.logEvent(`🚨 OPPORTUNITY: ${addr.slice(0, 8)} (HF: ${hf.toFixed(4)})`, 'Market');
//     // checkAndExecute(position)... REPLACE WITH:
//     liquidationQueue.push(position);
// }

// In updateHealthFactorCache (Around line 239)
// if (hf < CONFIG.BOT.LIQUIDATION_THRESHOLD && hf > 0) {
//     dashboard.logEvent(`🚨 OPPORTUNITY: ${userAddress.slice(0, 8)} (HF: ${hf.toFixed(4)})`, 'Market');
//     // checkAndExecute(position)... REPLACE WITH:
//     liquidationQueue.push(position);
// }

// And call startBatcher() inside startWatcher() logic or export it.


const AAVE_POOL_ABI = [
    {
        type: 'function',
        name: 'getUserAccountData',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ],
        stateMutability: 'view'
    }
] as const;

/**
 * Fetches health factor for a specific user
 */
export async function fetchHealthFactor(userAddress: string): Promise<UserPosition | null> {
    bridge.recordPremiumRpc(); // Single user lookup uses premium client
    try {
        const accountData = await premiumClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [userAddress as `0x${string}`],
        });

        const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = accountData;

        const position: UserPosition = {
            address: userAddress,
            healthFactor,
            totalCollateralBase,
            totalDebtBase,
            availableBorrowsBase,
            lastUpdate: Date.now(),
        };

        return position;
    } catch (error) {
        console.error(`Error fetching health factor for ${userAddress}:`, error);
        return null;
    }
}

// Tiered RPC Thresholds
const PROMOTION_HF = 1.5;  // Move safe -> killList
const DEMOTION_HF = 2.0;   // Move killList -> safe

/**
 * Updates a batch of health factors using BASIC RPC (for initial load & safe users)
 */
export async function batchUpdateHealthFactorsBasic(addresses: string[], categorize: boolean = false): Promise<{ critical: string[], safe: string[] }> {
    if (addresses.length === 0) return { critical: [], safe: [] };

    const BATCH_SIZE = 100;
    const MIN_DEBT_USD = 0.000001; // Effectively > 0
    const criticalUsers: string[] = [];
    const safeUsers: string[] = [];

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        bridge.recordBasicRpc(); // Batch update uses public client

        try {
            const results = await publicClient.multicall({
                contracts: batch.map(addr => ({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: AAVE_POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [addr as `0x${string}`]
                })),
                allowFailure: true
            });

            results.forEach((res, index) => {
                if (res.status === 'success' && res.result) {
                    const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = res.result;
                    const addr = batch[index].toLowerCase();

                    // Skip users with no debt or debt below minimum threshold
                    const debtUSD = Number(formatUnits(totalDebtBase, 8)); // Debt in 8 decimals
                    if (debtUSD < MIN_DEBT_USD) return;

                    // Skip zombie positions: no collateral = no profit opportunity
                    const collateralUSD = Number(formatUnits(totalCollateralBase, 8));
                    if (collateralUSD < MIN_DEBT_USD) return;

                    const position: UserPosition = {
                        address: addr,
                        healthFactor,
                        totalCollateralBase,
                        totalDebtBase,
                        availableBorrowsBase,
                        lastUpdate: Date.now(),
                    };

                    healthFactorCache.set(addr, position);

                    const hf = Number(formatUnits(healthFactor, 18));

                    if (categorize) {
                        // Only track positions with actual health factors (HF > 0 means collateral exists)
                        if (hf > 0 && hf < PROMOTION_HF) {
                            criticalUsers.push(addr);
                            killList.add(addr);
                        } else if (hf >= PROMOTION_HF) {
                            safeUsers.push(addr);
                        }
                    }

                    if (hf < CONFIG.BOT.LIQUIDATION_THRESHOLD && hf > 0) {
                        dashboard.logEvent(`🚨 OPPORTUNITY: ${addr.slice(0, 8)} (HF: ${hf.toFixed(4)})`, 'Market');
                    }
                }
            });

        } catch (e) {
            console.error('Batch update (Basic RPC) failed:', e);
        }
    }

    dashboard.updateKillList(Array.from(healthFactorCache.values()));
    return { critical: criticalUsers, safe: safeUsers };
}

/**
 * Updates health factors using specific client and records appropriate metrics
 */
async function batchUpdateHealthFactorsGeneric(addresses: string[], client: PublicClient, metric: 'PREMIUM' | 'WSS') {
    if (addresses.length === 0) return;

    const MIN_DEBT_USD = 0.000001;
    const toDemote: string[] = [];

    // Multicall
    try {
        if (metric === 'PREMIUM') bridge.recordPremiumRpc();
        if (metric === 'WSS') bridge.recordBasicRpc(); // WSS (Background) maps to Basic metrics

        const results = await client.multicall({
            contracts: addresses.map(addr => ({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                abi: AAVE_POOL_ABI,
                functionName: 'getUserAccountData',
                args: [addr as `0x${string}`]
            })),
            allowFailure: true
        });

        results.forEach((res, index) => {
            if (res.status === 'success' && res.result) {
                const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = res.result;
                const addr = addresses[index];

                const debtUSD = Number(formatUnits(totalDebtBase, 8));
                const collateralUSD = Number(formatUnits(totalCollateralBase, 8));
                const hf = Number(formatUnits(healthFactor, 18));

                if (debtUSD < MIN_DEBT_USD || collateralUSD < MIN_DEBT_USD) {
                    toDemote.push(addr);
                    healthFactorCache.delete(addr);
                    return;
                }

                const position: UserPosition = {
                    address: addr,
                    healthFactor,
                    totalCollateralBase,
                    totalDebtBase,
                    availableBorrowsBase,
                    lastUpdate: Date.now(),
                };

                healthFactorCache.set(addr, position);

                if (hf > DEMOTION_HF) {
                    toDemote.push(addr);
                }

                if (hf < CONFIG.BOT.LIQUIDATION_THRESHOLD && hf > 0) {
                    // ⚡ UNFILTERED EXECUTION: Route everything to checkAndExecute
                    checkAndExecute(position).catch(e => console.error(`Exec error for ${addr}:`, e));
                }
            }
        });

    } catch (e) {
        console.error(`Batch update (${metric}) failed:`, e);
    }

    // Process demotions
    if (toDemote.length > 0) {
        const { getSafeUsers, persistLists } = await import('./auditor.js');
        const safeUsers = getSafeUsers();
        toDemote.forEach(addr => {
            killList.delete(addr);
            const debtUSD = Number(formatUnits(healthFactorCache.get(addr)?.totalDebtBase || 0n, 8));
            if (debtUSD >= MIN_DEBT_USD && !safeUsers.includes(addr)) {
                safeUsers.push(addr);
            }
        });
        persistLists(safeUsers);
        dashboard.logEvent(`⬇️ DEMOTED/REMOVED ${toDemote.length} users`, 'System');
    }

    dashboard.updateKillList(Array.from(healthFactorCache.values()));
}

/**
 * Updates the health factor cache for tracked users
 */
async function updateHealthFactorCache(userAddress: string) {
    const position = await fetchHealthFactor(userAddress);
    if (position) {
        healthFactorCache.set(userAddress, position);

        const hf = Number(formatUnits(position.healthFactor, 18));
        dashboard.updateKillList(Array.from(healthFactorCache.values()));

        if (hf < CONFIG.BOT.LIQUIDATION_THRESHOLD && hf > 0) {
            // ⚡ UNFILTERED EXECUTION: Route everything to checkAndExecute
            checkAndExecute(position).catch(e => console.error(`Exec error for ${userAddress}:`, e));
        }
    }
}

/**
 * Starts watching for ReserveDataUpdated events from Aave V3
 */
export async function startWatcher() {
    const { appendRecords } = await import('./storage/liquidation_history.js');
    // startBatcher(); // Re-enabled if needed, but currently executor handles its own queue
    dashboard.logEvent('👀 Watcher: Listening for Aave V3 events...');

    // Price updates listener (Trigger for immediate check)
    const unwatch = publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex)'),
        onLogs: async (logs: any) => {
            const txHash = logs[0]?.transactionHash;
            dashboard.logEvent(`📡 RPC: Detected ${logs.length} Price/Reserve updates`, 'Market');

            // 🚀 OPTIMIZATION: Only update Top 24 candidates on Premium RPC
            // All other users will be caught by the Background Scanner (WSS) 10s loop.
            const sortedTargets = Array.from(killList)
                .map(addr => healthFactorCache.get(addr))
                .filter(p => p !== undefined)
                .sort((a, b) => Number(a!.healthFactor) - Number(b!.healthFactor)) as UserPosition[];

            const top24 = sortedTargets.slice(0, 24).map(u => u.address);

            if (top24.length > 0) {
                // Batch Update (1 Call) instead of Loop (24 Calls)
                await batchUpdateHealthFactorsGeneric(top24, premiumClient, 'PREMIUM');
            }
        },
    });

    // Liquidation Event Listener
    publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'),
        onLogs: async (logs: any) => {
            for (const log of logs) {
                try {
                    const receipt = await premiumClient.getTransactionReceipt({ hash: log.transactionHash });
                    const tx = await premiumClient.getTransaction({ hash: log.transactionHash });
                    const block = await publicClient.getBlock({ blockNumber: log.blockNumber });

                    const args = log.args as any;
                    const gasUsed = receipt.gasUsed.toString();
                    const gasPrice = tx.gasPrice?.toString() || '0';
                    const totalGasCost = (receipt.gasUsed * (tx.gasPrice || 0n)).toString();

                    const liquidatedCollateralNum = Number(formatUnits(args.liquidatedCollateralAmount, 8));
                    const debtToCoverNum = Number(formatUnits(args.debtToCover, 8));
                    const gasCostETH = Number(formatUnits(BigInt(totalGasCost), 18));
                    const profitUSD = liquidatedCollateralNum - debtToCoverNum - gasCostETH;

                    const record = {
                        txHash: log.transactionHash,
                        blockNumber: Number(log.blockNumber),
                        timestamp: Number(block.timestamp),
                        user: args.user,
                        collateralAsset: args.collateralAsset,
                        debtAsset: args.debtAsset,
                        debtToCover: args.debtToCover.toString(),
                        liquidatedCollateral: args.liquidatedCollateralAmount.toString(),
                        liquidator: args.liquidator,
                        receiveAToken: args.receiveAToken,
                        gasUsed,
                        gasPrice,
                        totalGasCost,
                        estimatedProfit: profitUSD.toString(),
                        profitUSD
                    };

                    await appendRecords([record]);
                    bridge.broadcast('NEW_LIQUIDATION', record);
                } catch (error) {
                    console.error('❌ Failed to process liquidation event:', error);
                }
            }
        }
    });

    dashboard.logEvent('✅ Watcher: Active (Premium RPC)', 'System');
    return unwatch;
}

/**
 * ⚡ PRIORITY SCANNER: Scans TOP 25 targets every 1 second
 * Uses PREMIUM RPC (Alchemy) for max speed and reliability.
 */
export async function startPriorityScanner() {
    console.log('🚀 Starting Priority Scanner (Top 24 @ 1s)...');
    setInterval(async () => {
        if (killList.size === 0) return;

        // 1. Convert Map to Array & Sort by Health Factor (Ascending)
        const sortedTargets = Array.from(killList)
            .map(addr => healthFactorCache.get(addr))
            .filter(p => p !== undefined)
            .sort((a, b) => Number(a!.healthFactor) - Number(b!.healthFactor)) as UserPosition[];

        // 2. Filter for HIGH VALUE targets only (No Dust)
        // Alchemy Limit: 25 req/min (~1 every 2.4s). We confirm 23 slots.
        const MIN_VALUE_USD = 15.0; // Matches Batch Executor limit
        const premiumTargets = sortedTargets.filter(p => {
            const debtUSD = Number(formatUnits(p.totalDebtBase, 8));
            return debtUSD >= MIN_VALUE_USD;
        });

        // 3. Take Top 23 (Leaving 2 slots for Execution/Gas checks)
        const top23 = premiumTargets.slice(0, 23).map(u => u.address);

        if (top23.length > 0) {
            await batchUpdateHealthFactorsGeneric(top23, premiumClient, 'PREMIUM');
        }
    }, 1000); // 1 Second (User Confirmed 25 req/s limit)
}

/**
 * 🐢 BACKGROUND SCANNER: Scans REMAINING targets every 10 seconds
 * Uses WSS RPC (DRPC) or Secondary to save costs/limits.
 */
export async function startBackgroundScanner() {
    console.log('🐢 Starting Background Scanner (Rest @ 10s)...');
    setInterval(async () => {
        if (killList.size === 0) return;

        // 1. Get ordered list exactly like Priority Scanner
        const sortedTargets = Array.from(killList)
            .map(addr => healthFactorCache.get(addr))
            .filter(p => p !== undefined)
            .sort((a, b) => Number(a!.healthFactor) - Number(b!.healthFactor)) as UserPosition[];

        // 2. Identify priority targets to SKIP (Top 23 > $15)
        const MIN_VALUE_USD = 15.0;
        const premiumTargets = sortedTargets.filter(p => Number(formatUnits(p.totalDebtBase, 8)) >= MIN_VALUE_USD).slice(0, 23);
        const premiumAddrs = new Set(premiumTargets.map(u => u.address));

        // 3. Process EVERYTHING ELSE (Dust + Rank > 23)
        const backgroundTargets = sortedTargets
            .filter(u => !premiumAddrs.has(u.address))
            .map(u => u.address);

        if (backgroundTargets.length > 0) {
            // Use 100 batch size for background (DRPC is usually looser)
            const BATCH_SIZE = 100;
            for (let i = 0; i < backgroundTargets.length; i += BATCH_SIZE) {
                const batch = backgroundTargets.slice(i, i + BATCH_SIZE);
                await batchUpdateHealthFactorsGeneric(batch, wssClient, 'WSS');
                await new Promise(r => setTimeout(r, 200)); // Slight throttle
            }
        }
    }, 5000); // 5 Seconds (Faster background scan)
}

/**
 * Periodic refresh of SAFE users using Basic RPC
 */
export async function periodicBasicRefresh() {
    setInterval(async () => {
        const { getSafeUsers, persistLists } = await import('./auditor.js');
        const safeUsers = getSafeUsers();

        if (safeUsers.length === 0) return;

        // ... (Existing basic refresh logic) ...
        // Redelivered for brevity, checking basic refresh implementation from previous file content
        // Using the original logic essentially
        const BATCH_SIZE = 100;
        const MIN_DEBT_USD = 0.000001; // Effectively > 0
        const toPromote: string[] = [];
        const toRemove: string[] = [];

        for (let i = 0; i < safeUsers.length; i += BATCH_SIZE) {
            const batch = safeUsers.slice(i, i + BATCH_SIZE);
            bridge.recordBasicRpc();

            try {
                const results = await publicClient.multicall({
                    contracts: batch.map(addr => ({
                        address: CONFIG.AAVE_POOL as `0x${string}`,
                        abi: AAVE_POOL_ABI,
                        functionName: 'getUserAccountData',
                        args: [addr as `0x${string}`]
                    })),
                    allowFailure: true
                });

                results.forEach((res, index) => {
                    if (res.status === 'success' && res.result) {
                        const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = res.result;
                        const addr = batch[index].toLowerCase();
                        const debtUSD = Number(formatUnits(totalDebtBase, 8));
                        const collateralUSD = Number(formatUnits(totalCollateralBase, 8));

                        if (debtUSD < MIN_DEBT_USD || collateralUSD < MIN_DEBT_USD) {
                            toRemove.push(addr);
                            healthFactorCache.delete(addr);
                            return;
                        }

                        const position: UserPosition = {
                            address: addr,
                            healthFactor,
                            totalCollateralBase,
                            totalDebtBase,
                            availableBorrowsBase,
                            lastUpdate: Date.now(),
                        };
                        healthFactorCache.set(addr, position);
                        const hf = Number(formatUnits(healthFactor, 18));

                        if (hf > 0 && hf < PROMOTION_HF) {
                            toPromote.push(addr);
                        }
                    }
                });

            } catch (e) {
                console.error('Periodic basic refresh failed:', e);
            }
        }

        // Logic for promotion/demotion persistence...
        if (toRemove.length > 0) dashboard.logEvent(`🗑️ REMOVED ${toRemove.length} users`, 'System');
        if (toPromote.length > 0) {
            toPromote.forEach(addr => killList.add(addr));
            dashboard.logEvent(`⬆️ PROMOTED ${toPromote.length} users`, 'System');
        }
        if (toRemove.length > 0 || toPromote.length > 0) {
            const updatedSafe = safeUsers.filter(u => !toRemove.includes(u) && !toPromote.includes(u));
            persistLists(updatedSafe);
        }

        dashboard.updateKillList(Array.from(healthFactorCache.values()));
    }, 300000);
}
