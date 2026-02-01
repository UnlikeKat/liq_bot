import { createPublicClient, http, parseAbiItem, formatUnits, PublicClient, getAddress } from 'viem';
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

const AAVE_ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: 'price', type: 'uint256' }],
        stateMutability: 'view'
    },
    {
        type: 'function',
        name: 'getAssetsPrices',
        inputs: [{ name: 'assets', type: 'address[]' }],
        outputs: [{ name: 'prices', type: 'uint256[]' }],
        stateMutability: 'view'
    }
] as const;


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


                    // Skip zombie positions: no collateral = no profit opportunity
                    // Skip dust positions: debt < $20 is rarely profitable
                    const debtUSD = Number(formatUnits(totalDebtBase, 8));
                    if (debtUSD < (CONFIG.BOT as any).MIN_PROFITABLE_DEBT_USD) return;

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
async function batchUpdateHealthFactorsGeneric(addresses: string[], client: any, metric: 'PREMIUM' | 'WSS') {
    if (addresses.length === 0) return;

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

        results.forEach((res: any, index: number) => {
            if (res.status === 'success' && res.result) {
                const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = res.result;
                const addr = addresses[index];

                const debtUSD = Number(formatUnits(totalDebtBase, 8));
                const collateralUSD = Number(formatUnits(totalCollateralBase, 8));
                const hf = Number(formatUnits(healthFactor, 18));

                if (debtUSD < (CONFIG.BOT as any).MIN_PROFITABLE_DEBT_USD) {
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
            if (debtUSD >= (CONFIG.BOT as any).MIN_PROFITABLE_DEBT_USD && !safeUsers.includes(addr)) {
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
    startGasMonitor(); // ⛽ Start Background Gas Monitor
    // startBatcher(); // Re-enabled if needed, but currently executor handles its own queue
    dashboard.logEvent('👀 Watcher: Listening for Aave V3 events...');

    // Price updates listener (Trigger for immediate check)
    const unwatch = publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex)'),
        onLogs: async (logs: any) => {
            const txHash = logs[0]?.transactionHash;
            dashboard.logEvent(`📡 RPC: Detected ${logs.length} Price/Reserve updates`, 'Market');

            // 🚀 OPTIMIZATION: 3-Tier Strategy (User Configured)
            // 1. Top 23 -> Alchemy Premium (1s latency, high reliability)
            // 2. Rank 24-100 -> DRPC WSS (1s latency, lower cost)
            // 3. Rank 101+ -> Background Scanner (5s latency)

            const sortedTargets = Array.from(killList)
                .map(addr => healthFactorCache.get(addr))
                .filter(p => p !== undefined)
                .sort((a, b) => Number(a!.healthFactor) - Number(b!.healthFactor)) as UserPosition[];

            // Tier 1: Top 23 (Alchemy Limit)
            const tier1 = sortedTargets.slice(0, 23).map(u => u.address);
            if (tier1.length > 0) {
                await batchUpdateHealthFactorsGeneric(tier1, premiumClient, 'PREMIUM');
            }

            // Tier 2: Rank 24-100 (DRPC / WSS)
            const tier2 = sortedTargets.slice(23, 100).map(u => u.address);
            if (tier2.length > 0) {
                // Fire and forget / Parallel execution for Tier 2 to not block Tier 1 next tick
                batchUpdateHealthFactorsGeneric(tier2, wssClient, 'WSS').catch(console.error);
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
                    if (!args.collateralAsset || !args.debtAsset) {
                        console.warn('⚠️ Log missing asset data', args);
                        continue;
                    }

                    // Normalize addresses to Checksum format for Map lookup
                    const collateralAddr = getAddress(String(args.collateralAsset));
                    const debtAddr = getAddress(String(args.debtAsset));

                    const collateralDecimals = CONFIG.TOKEN_DECIMALS[collateralAddr] || 18;
                    const debtDecimals = CONFIG.TOKEN_DECIMALS[debtAddr] || (['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'].includes(debtAddr) ? 6 : 18);

                    const liquidatedCollateralNum = Number(formatUnits(args.liquidatedCollateralAmount, collateralDecimals));
                    const debtToCoverNum = Number(formatUnits(args.debtToCover, debtDecimals));
                    const gasCostETH = Number(formatUnits(BigInt(totalGasCost), 18));

                    // 🔍 ORACLE INTEGRATION: Time-Travel Pricing
                    // Fetch EXACT prices at the moment of liquidation (Historical Block)
                    const wethAddr = CONFIG.TOKENS.WETH as `0x${string}`;
                    const assetsToFetch = [collateralAddr, debtAddr, wethAddr];

                    // Use multicall for efficiency (3 calls in 1)
                    // Note: getAssetsPrices is safer if available, but getAssetPrice is standard v3
                    // We'll use individual calls via multicall to be safe with standard ABI
                    const priceResults = await publicClient.multicall({
                        contracts: assetsToFetch.map(asset => ({
                            address: CONFIG.AAVE_ORACLE as `0x${string}`,
                            abi: AAVE_ORACLE_ABI,
                            functionName: 'getAssetPrice',
                            args: [asset],
                        })),
                        blockNumber: log.blockNumber // 🕰️ TIME TRAVEL
                    });

                    // Extract Prices (Base Currency usually USD 8 decimals on Aave v3)
                    const collateralPrice = priceResults[0].status === 'success' ? Number(formatUnits(priceResults[0].result as bigint, 8)) : 0;
                    const debtPrice = priceResults[1].status === 'success' ? Number(formatUnits(priceResults[1].result as bigint, 8)) : 0;
                    const wethPrice = priceResults[2].status === 'success' ? Number(formatUnits(priceResults[2].result as bigint, 8)) : 0;

                    if (collateralPrice === 0 || debtPrice === 0) {
                        console.warn(`⚠️ Oracle failed to fetch prices for ${args.collateralAsset} / ${args.debtAsset}`);
                    }

                    // 🧮 PRECISE CALCULATION
                    const collatValueUSD = liquidatedCollateralNum * collateralPrice;
                    const debtValueUSD = debtToCoverNum * debtPrice;
                    const gasCostUSD = gasCostETH * wethPrice;

                    const estimatedProfitUSD = collatValueUSD - debtValueUSD - gasCostUSD;

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
                        estimatedProfit: estimatedProfitUSD.toString(),
                        profitUSD: estimatedProfitUSD
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

                // Add Timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('WSS Timeout')), 5000));

                try {
                    await Promise.race([
                        batchUpdateHealthFactorsGeneric(batch, wssClient, 'WSS'),
                        timeoutPromise
                    ]);
                } catch (e: any) {
                    if (e.message === 'WSS Timeout') {
                        console.warn('⚠️ Background Scanner Timeout - Skipping batch');
                        // Force socket reconnect logic if possible or just skip
                    } else {
                        console.error('Background batch error:', e);
                    }
                }

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

/**
 * ⛽ GAS MONITOR: Updates Dynamic Gas Price every 3s
 * Ensures we are always paying slightly above market to clear instantly.
 */
export async function startGasMonitor() {
    console.log('⛽ Starting Gas Monitor (Every 3s)...');

    const updateGas = async () => {
        try {
            const block = await publicClient.getBlock();
            const baseFee = block.baseFeePerGas;

            if (baseFee) {
                // Strategy: BaseFee * Multiplier (Aggressive buffer for volatility)
                // This ensures we are virtually immune to "pending stuck" unless block fills 100% instantly
                const aggressiveFee = (baseFee * (CONFIG.BOT as any).GAS_MULTIPLIER) / 100n;

                // Safety Cap
                const MAX_CAP = (CONFIG.BOT as any).MAX_GAS_PRICE_GWEI * 1_000_000_000n; // Convert Gwei to Wei

                if (aggressiveFee > MAX_CAP) {
                    CONFIG.BOT.DYNAMIC_GAS_PRICE = MAX_CAP;
                    // console.warn('⚠️ Gas Cap Hit!');
                } else {
                    CONFIG.BOT.DYNAMIC_GAS_PRICE = aggressiveFee;
                }

                // console.log(`⛽ Gas Updated: ${(Number(aggressiveFee) / 1e9).toFixed(4)} Gwei (Base: ${(Number(baseFee)/1e9).toFixed(4)})`);
            }
        } catch (e) {
            console.error('Gas Monitor Failed:', e);
        }
    };

    // Initial Run
    await updateGas();

    // Loop
    setInterval(updateGas, 3000);
}
