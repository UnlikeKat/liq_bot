console.log('🔹 INIT: executor.ts');
import {
    formatUnits,
    parseUnits,
    formatEther
} from 'viem';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG, premiumClient } from './config.js';
import { UserPosition, LiquidationTarget } from './interfaces.js';
import { dashboard } from './logger.js';
import { bridge } from './server.js';
import { LiquidityMonitor } from './liquidityMonitor.js';

const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);

// Premium Wallet Client for fast execution
const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(CONFIG.RPC_URL_PREMIUM),
});

// Flash Liquidator ABI
const FLASH_LIQUIDATOR_ABI = [
    {
        type: 'function',
        name: 'executeLiquidation',
        inputs: [
            { name: 'collateralAsset', type: 'address' },
            { name: 'debtAsset', type: 'address' },
            { name: 'user', type: 'address' },
            { name: 'debtToCover', type: 'uint256' },
            { name: 'source', type: 'uint8' },
            { name: 'flashPool', type: 'address' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    }
] as const;

// Aave Pool ABI (for analyzing user positions)
const AAVE_POOL_ABI = [
    {
        type: 'function',
        name: 'getUserConfiguration',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

// ERC20 ABI
const ERC20_ABI = [
    {
        type: 'function',
        name: 'balanceOf',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view'
    },
    {
        type: 'function',
        name: 'decimals',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
        stateMutability: 'view'
    }
] as const;

// Aave Protocol Data Provider ABI
const DATA_PROVIDER_ABI = [
    {
        type: 'function',
        name: 'getAllReservesTokens',
        inputs: [],
        outputs: [
            {
                name: '',
                type: 'tuple[]',
                components: [
                    { name: 'symbol', type: 'string' },
                    { name: 'tokenAddress', type: 'address' }
                ]
            }
        ],
        stateMutability: 'view'
    },
    {
        type: 'function',
        name: 'getUserReserveData',
        inputs: [
            { name: 'asset', type: 'address' },
            { name: 'user', type: 'address' }
        ],
        outputs: [
            { name: 'currentATokenBalance', type: 'uint256' },
            { name: 'currentStableDebt', type: 'uint256' },
            { name: 'currentVariableDebt', type: 'uint256' },
            { name: 'principalStableDebt', type: 'uint256' },
            { name: 'scaledVariableDebt', type: 'uint256' },
            { name: 'stableBorrowRate', type: 'uint256' },
            { name: 'liquidityRate', type: 'uint256' },
            { name: 'stableRateLastUpdated', type: 'uint40' },
            { name: 'usageAsCollateralEnabled', type: 'bool' }
        ],
        stateMutability: 'view'
    }
] as const;

/**
 * Dynamically finds the best Collateral/Debt pair for a user
 */
// Oracle ABI
const ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

// Token cache to avoid redundant RPC calls
let tokensCache: any[] | null = null;
let lastTokenRefresh = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Dynamically finds the best Collateral/Debt pair for a user
 * Selection is based on USD Value (Balance * Price)
 */
// Update signature
export async function findBestLiquidationPair(user: string, debug: boolean = false): Promise<{
    collateral: string,
    debt: string,
    debtDecimals: number,
    debtPrice: bigint,
    collateralDecimals: number,
    debtPrice: bigint,
    collateralDecimals: number,
    collateralPrice: bigint
} | null> {
    try {
        // 1. Get all supported tokens (cached)
        if (!tokensCache || Date.now() - lastTokenRefresh > CACHE_DURATION) {
            tokensCache = await premiumClient.readContract({
                address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
                abi: DATA_PROVIDER_ABI,
                functionName: 'getAllReservesTokens',
            }) as any[];
            lastTokenRefresh = Date.now();
        }

        const tokens = tokensCache!;

        // 2. Multicall: Get Decimals, Price, and User Data for ALL tokens
        // This is highly efficient (1 RPC call for 3N requests)
        const calls = [];
        for (const token of tokens) {
            const tAddr = token.tokenAddress as `0x${string}`;

            // Decimals
            calls.push({ address: tAddr, abi: ERC20_ABI, functionName: 'decimals' });

            // Price (Oracle 8 decimals)
            calls.push({ address: CONFIG.AAVE_ORACLE as `0x${string}`, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [tAddr] });

            // User Reserve Data
            calls.push({
                address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
                abi: DATA_PROVIDER_ABI,
                functionName: 'getUserReserveData',
                args: [tAddr, user as `0x${string}`]
            });
        }

        const results = await premiumClient.multicall({ contracts: calls as any });

        let maxCollateral = { address: '', valueUSD: 0, decimals: 18, price: 0n };
        let maxDebt = { address: '', valueUSD: 0, decimals: 18, price: 0n };

        // Process results in chunks of 3
        for (let i = 0; i < tokens.length; i++) {
            const tokenAddr = tokens[i].tokenAddress;
            const resDecimals = results[i * 3];
            const resPrice = results[i * 3 + 1];
            const resData = results[i * 3 + 2];

            if (resDecimals.status === 'success' && resPrice.status === 'success' && resData.status === 'success') {
                const decimals = resDecimals.result as number;
                const price8Dec = resPrice.result as bigint; // Price in USD (8 decimals)
                const data = resData.result as any[]; // [aBalance, ..., vDebt, ...]

                const aBalance = data[0] as bigint;
                const vDebt = data[2] as bigint;
                const isCollateral = data[8] as boolean; // usageAsCollateralEnabled

                // Calculate Value in USD
                const priceUSD = Number(formatUnits(price8Dec, 8));
                const collValue = Number(formatUnits(aBalance, decimals)) * priceUSD;
                const debtValue = Number(formatUnits(vDebt, decimals)) * priceUSD;

                if (isCollateral && collValue > maxCollateral.valueUSD) {
                    maxCollateral = { address: tokenAddr, valueUSD: collValue, decimals, price: price8Dec };
                }

                if (debtValue > maxDebt.valueUSD) {
                    maxDebt = { address: tokenAddr, valueUSD: debtValue, decimals, price: price8Dec };
                }
            }
        }

        if (!maxCollateral.address || !maxDebt.address) {
            if (debug) {
                dashboard.logSniper(false, `❌ FAILURE DETAILS for ${user.slice(0, 8)}`);
                dashboard.logSniper(false, `   Tokens Scanned: ${tokens.length}`);
                dashboard.logSniper(false, `   Max Col: $${maxCollateral.valueUSD.toFixed(2)} (${maxCollateral.address})`);
                dashboard.logSniper(false, `   Max Debt: $${maxDebt.valueUSD.toFixed(2)} (${maxDebt.address})`);
            }
            return null;
        }

        console.log(`   🔎 Found best pair for ${user.slice(0, 8)}: Collateral ${maxCollateral.address.slice(0, 6)} ($${maxCollateral.valueUSD.toFixed(2)}) / Debt ${maxDebt.address.slice(0, 6)} ($${maxDebt.valueUSD.toFixed(2)})`);

        return {
            collateral: maxCollateral.address,
            debt: maxDebt.address,
            debtDecimals: maxDebt.decimals,
            debtPrice: maxDebt.price,
            collateralDecimals: maxCollateral.decimals,
            collateralPrice: maxCollateral.price
        };

    } catch (e) {
        console.error(`   ❌ Failed to find assets for ${user}:`, e);
        return null;
    }
}

/**
 * Analyzes a user position to determine the best liquidation strategy
 * In production, this should query user's collateral and debt details
 */
// Update signature
export async function analyzeLiquidation(position: UserPosition, skipProfitCheck = false, debug: boolean = false): Promise<LiquidationTarget | null> {
    // Simplified: In production, you need to:
    // 1. Get user's collateral assets (via getUserConfiguration + reserve list)
    // 2. Get user's debt assets
    // 3. Calculate optimal collateral/debt pair
    // 4. Estimate profitability considering liquidation bonus and swap costs

    // For now, we'll use WETH as collateral and USDC as debt (most common)
    // const collateralAsset = CONFIG.TOKENS.WETH;
    // const debtAsset = CONFIG.TOKENS.USDC;

    // 🔥 DYANMIC ASSET SELECTION
    const bestPair = await findBestLiquidationPair(position.address, debug);
    if (!bestPair) {
        console.log(`   ⚠️ Could not identify assets for ${position.address}`);
        return null;
    }
    const { collateral: collateralAsset, debt: debtAsset } = bestPair;

    // 🔥 LIVE EXECUTION MODE (Filters Removed for Verification)
    // First, calculate key metrics
    let closeFactor = 0.5; // Default 50%
    const hf = Number(formatUnits(position.healthFactor, 18));
    const totalDebtUSD = Number(formatUnits(position.totalDebtBase, 8)); // Base uses 8 decimals for reference currency (USD)

    console.log(`   🌪️  Universal Robustness Target Identified ($${totalDebtUSD.toFixed(2)} Debt)`);

    // Dynamic Close Factor Logic (Standard Aave V3)
    // Most liquidations allow 50% (0.5).
    // Close factor is 100% (1.0) ONLY IF Health Factor < 0.95
    if (hf < 0.95) {
        closeFactor = 1.0;
        console.log(`   ℹ️  Health Factor < 0.95: Targeting 100% debt coverage.`);
    } else {
        closeFactor = 0.5;
        console.log(`   ℹ️  Standard Liquidation: Targeting 50% debt coverage.`);
    }

    // Calculate liquidatable amount
    // totalDebtBase is in Aave Reference Currency (USD, 8 decimals)
    // maxLiquidationUSD is the amount of debt we want to cover in USD (8 decimals)
    const maxLiquidationUSD = position.totalDebtBase * BigInt(closeFactor * 100) / 100n;

    // Convert from USD (8 decimals) to the Asset's native units
    // Formula: (AmountUSD / priceUSD) * 10^(AssetDecimals)
    // Both AmountUSD and priceUSD have 8 decimals, so they cancel out.
    // Result = (maxLiquidationUSD * 10^debtDecimals) / debtPrice
    const debtToCover = (maxLiquidationUSD * BigInt(10 ** bestPair.debtDecimals)) / bestPair.debtPrice;

    console.log(`   🎯 Cover Details: Asset ${bestPair.debt.slice(0, 6)} | Amount: ${formatUnits(debtToCover, bestPair.debtDecimals)} (Native) | Price: $${formatUnits(bestPair.debtPrice, 8)}`);

    // Determine Flash Source from Monitor (Dynamic)
    let flashSource = LiquidityMonitor.getSource(debtAsset);

    // Fee Calculation based on source (Approximate for Profit Estimation)
    let flashFeeBps = 0n;
    if (flashSource.source === 1) flashFeeBps = 5n; // Uniswap 0.05%
    if (flashSource.source === 2) flashFeeBps = 9n; // Aave 0.09%

    const liquidationBonusUSD = (maxLiquidationUSD * 5n) / 100n; // 5% bonus
    const gasInUSD = parseUnits('0.01', 8);

    const expectedProfitUSD = liquidationBonusUSD - gasInUSD; // Simplified

    const skipProfitFilter = true;
    const expectedProfit = expectedProfitUSD;

    if (!skipProfitFilter && expectedProfitUSD < parseUnits('1', 8)) {
        return null;
    }

    return {
        user: position.address,
        collateralAsset,
        debtAsset,
        debtToCover,
        expectedProfit,
        healthFactor: Number(formatUnits(position.healthFactor, 18)),
        flashSource
    };
}

/**
 * Executes a liquidation transaction
 */
// Update signature to match
export async function executeLiquidation(target: LiquidationTarget, force: boolean = false): Promise<boolean> {
    const debtLabel = target.debtAsset.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase() ? "USDC" :
        target.debtAsset.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase() ? "WETH" : "ASSET";

    dashboard.logSniper(true, `🎯 TARGETING: ${target.user.slice(0, 8)} | Debt: ${Number(formatUnits(target.debtToCover, 6)).toFixed(4)} ${debtLabel} | Src: ${target.flashSource?.source}`);

    dashboard.logSniper(true, `🎯 TARGETING: ${target.user.slice(0, 8)} | Debt: ${Number(formatUnits(target.debtToCover, 6)).toFixed(4)} ${debtLabel} | Src: ${target.flashSource?.source}`);

    try {
        // ⛽ GAS STRATEGY
        let adjustedGasPrice = parseUnits((CONFIG.BOT as any).FIXED_GAS_PRICE_GWEI.toString(), 9);

        // Dynamic Gas Check (Background Monitor)
        const dynamicPrice = (CONFIG.BOT as any).DYNAMIC_GAS_PRICE || 0n;

        if (force) {
            // 💪 MSG: User wants "Dynamic Gas" immediately
            const currentGas = await premiumClient.getGasPrice();
            adjustedGasPrice = (currentGas * 150n) / 100n; // 1.5x Multiplier
            console.log(`   ⛽ FORCE GAS: Using Real-Time Network Price: ${Number(formatUnits(adjustedGasPrice, 9)).toFixed(4)} Gwei`);
        } else if (dynamicPrice > 0n) {
            adjustedGasPrice = dynamicPrice;
            console.log(`   ⛽ Using Dynamic Gas (Monitor): ${Number(formatUnits(dynamicPrice, 9)).toFixed(4)} Gwei`);
        }

        const source = target.flashSource?.source || 0;
        const pool = target.flashSource?.pool || '0x0000000000000000000000000000000000000000';

        // ⚡ INSTANT EXECUTION (Simulation Removed per User Request)
        // We trust the LiquidityMonitor has verified the pool exists and has funds.
        dashboard.logEvent(`🚀 Executing Tx (No Sim) for ${target.user.slice(0, 8)} | Src: ${target.flashSource?.label || source}`);

        if (CONFIG.BOT.SIMULATE_ONLY) {
            console.log('   🛑 SIMULATION MODE: Skipping actual writeContract call.');
            dashboard.logSniper(true, `🧪 SIMULATION SKIPPED (Monitor Verified): ${target.user.slice(0, 8)} | Profit: $${Number(formatUnits(target.expectedProfit, 6)).toFixed(2)}`);
            return true;
        }

        // Send actual transaction (Premium Wallet)
        console.log('   📤 Sending transaction...');

        const hash = await walletClient.writeContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [
                target.collateralAsset as `0x${string}`,
                target.debtAsset as `0x${string}`,
                target.user as `0x${string}`,
                target.debtToCover,
                source,
                pool as `0x${string}`
            ],
            gasPrice: adjustedGasPrice,
        });

        // 🚀 UI FEEDBACK: Show Link IMMEDIATELY
        console.log(`   Transaction hash: ${hash}`);
        dashboard.logSniper(true, `🚀 SENT FORCE TX | Target: ${target.user.slice(0, 8)} | Tx: ${hash}`);

        console.log('   ⏳ Waiting for confirmation (Premium)...\n');

        const receipt = await premiumClient.waitForTransactionReceipt({ hash });

        if (receipt.status === 'success') {
            const profit = Number(formatUnits(target.expectedProfit, 6));
            bridge.updateStats({
                totalAttempts: bridge['currentState'].stats.totalAttempts + 1,
                successCount: bridge['currentState'].stats.successCount + 1,
                totalProfitUSD: bridge['currentState'].stats.totalProfitUSD + profit
            });
            dashboard.logSniper(true, `💰 SUCCESS! | Target: ${target.user.slice(0, 8)} | Profit: ${profit.toFixed(2)} USDC | Tx: ${hash}`);
            return true;
        } else {
            bridge.updateStats({
                totalAttempts: bridge['currentState'].stats.totalAttempts + 1,
                failedCount: bridge['currentState'].stats.failedCount + 1
            });
            dashboard.logSniper(false, `💀 REVERTED | Tx: ${hash}`);
            return false;
        }

    } catch (error: any) {
        console.error(`   ❌ Simulation Error for ${target.user}:`, error);
        const errorMessage = error.shortMessage || error.message || 'Unknown Error';
        dashboard.logSniper(false, `🚫 ABORT: ${target.user.slice(0, 8)} | ${errorMessage}`);
        return false;
    }
}

const batchQueue: Map<string, LiquidationTarget[]> = new Map(); // Grouped by debtAsset
const batchState: Map<string, { blocked: boolean, lastSize: number, executing: boolean }> = new Map(); // Track failures
let batchTimeout: NodeJS.Timeout | null = null;

/**
 * Adds a target to the batch queue and processes if threshold met
 */
/**
 * Adds a target to the batch queue and processes if threshold met
 */
export async function addToBatchQueue(target: LiquidationTarget) {
    const debtAsset = target.debtAsset.toLowerCase();

    // Map address to symbol for clear logging
    let symbol = 'ASSET';
    Object.entries(CONFIG.TOKENS).forEach(([key, val]) => {
        if (val.toLowerCase() === debtAsset) symbol = key;
    });

    // Init Queue
    if (!batchQueue.has(debtAsset)) {
        batchQueue.set(debtAsset, []);
        batchState.set(debtAsset, { blocked: false, lastSize: 0, executing: false });
    }

    const queue = batchQueue.get(debtAsset)!;
    const state = batchState.get(debtAsset)!;

    // Avoid duplicates in queue
    if (!queue.find(t => t.user === target.user)) {
        queue.push(target);
        dashboard.logSniper(true, `📦 BATCH QUEUE: Added ${target.user.slice(0, 8)} to ${symbol} (Size: ${queue.length})`);

        // ✨ SMART RETRY LOGIC: 
        // If we were blocked (failed previously), strictly wait until size increases.
        // Since we just added a new item, size HAS increased. 
        if (state.blocked) {
            console.log(`   🔓 Batch Queue Unblocked for ${symbol} (Size increased to ${queue.length}). Retrying...`);
            state.blocked = false;
        }
    }

    // Process conditions
    // 1. Queue is large enough (>= 5)
    // 2. We are NOT blocked by a previous failure
    // 3. We are NOT currently executing a batch (Lock)
    if (queue.length >= 5 && !state.blocked && !state.executing) {
        await processBatch(debtAsset);
    } else if (!batchTimeout && !state.blocked && !state.executing) {
        // Only set timeout trigger if not blocked and not executing
        batchTimeout = setTimeout(() => {
            batchQueue.forEach((_, asset) => {
                const s = batchState.get(asset);
                if (s && !s.blocked && !s.executing) processBatch(asset);
            });
            batchTimeout = null;
        }, 30000); // 30 seconds max wait for batch
    }
}


/**
 * Executes a batch of liquidations
 */
async function processBatch(debtAsset: string) {
    const queue = batchQueue.get(debtAsset);
    const state = batchState.get(debtAsset);

    // Safety & Locking
    if (!queue || queue.length === 0) return;
    if (state?.blocked) return;
    if (state?.executing) return;

    // 🔒 LOCK
    if (state) state.executing = true;

    // Snapshot items to process
    const targetsToProcess = [...queue];
    const totalProfit = targetsToProcess.reduce((sum, t) => sum + t.expectedProfit, 0n);
    const totalProfitUSD = Number(formatUnits(totalProfit, 6)); // Assuming USDC/6 decimals for profit logic

    console.log(`\n🚀 EXECUTING BATCH for ${debtAsset.slice(0, 8)} (${targetsToProcess.length} targets) | Est. Profit: $${totalProfitUSD.toFixed(2)}`);

    try {
        const collateralAssets = targetsToProcess.map(t => t.collateralAsset as `0x${string}`);
        const debtAssets = targetsToProcess.map(t => t.debtAsset as `0x${string}`);
        const users = targetsToProcess.map(t => t.user as `0x${string}`);
        const debtsToCover = targetsToProcess.map(t => t.debtToCover);

        // Simulation
        await premiumClient.simulateContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI_BATCH,
            functionName: 'executeBatch',
            args: [collateralAssets, debtAssets, users, debtsToCover],
            account
        });

        if (CONFIG.BOT.SIMULATE_ONLY) {
            dashboard.logSniper(true, `🧪 BATCH SIM SUCCESS | ${targetsToProcess.length} targets`);
            // Cleanup & Unlock
            removeExecutedItems(queue, targetsToProcess);
            if (state) state.executing = false;
            return;
        }

        // Real Execution
        const hash = await walletClient.writeContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI_BATCH,
            functionName: 'executeBatch',
            args: [collateralAssets, debtAssets, users, debtsToCover],
            gasPrice: parseUnits((CONFIG.BOT as any).FIXED_GAS_PRICE_GWEI.toString(), 9)
        });

        dashboard.logSniper(true, `🔥 BATCH EXECUTED | Tx: ${hash} | Profit: $${totalProfitUSD.toFixed(2)}`);

        // ✅ Success: Clear Executed Items Only
        removeExecutedItems(queue, targetsToProcess);

        // Reset State
        if (state) {
            state.blocked = false;
            state.executing = false; // UNLOCK
        }

    } catch (error: any) {
        const msg = error.shortMessage || error.message || 'Unknown Error';
        dashboard.logSniper(false, `❌ BATCH ABORT | ${msg}`);

        // 🛑 Failure:
        // 1. Block the queue (Pause retry until new item comes)
        // 2. Unlock Execution (So we are ready for the unblock trigger)
        if (state) {
            state.blocked = true;
            state.executing = false; // UNLOCK
            state.lastSize = queue.length; // Record size to check for increase later
            console.log(`   ⏳ Batch Logic: Paused until new position added (Current: ${queue.length})`);
        }
    }
}

function removeExecutedItems(queue: LiquidationTarget[], executed: LiquidationTarget[]) {
    // Safely remove items that were included in the batch
    for (const t of executed) {
        const idx = queue.findIndex(q => q.user === t.user);
        if (idx !== -1) queue.splice(idx, 1);
    }
}

// ABI Definition for Batch (Inline or const)
const FLASH_LIQUIDATOR_ABI_BATCH = [
    {
        name: 'executeBatch',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'collateralAssets', type: 'address[]' },
            { name: 'debtAssets', type: 'address[]' },
            { name: 'users', type: 'address[]' },
            { name: 'debtsToCover', type: 'uint256[]' }
        ]
    }
] as const;

/**
 * Checks if a position should be liquidated and executes if profitable
 */
export async function checkAndExecute(position: UserPosition, force: boolean = false): Promise<void> {
    const hf = Number(formatUnits(position.healthFactor, 18));

    // Only liquidate if HF < 1.0 OR Forced
    if (!force && hf >= CONFIG.BOT.LIQUIDATION_THRESHOLD) {
        return;
    }

    if (force) {
        console.log(`💪 FORCE SNIPE ENABLED: Bypassing Health Factor Check (HF: ${hf.toFixed(4)})`);
    }

    // 🛑 SPAM PREVENTION: Check if already in batch queue
    // We scan all queues to see if this user is waiting
    for (const [asset, queue] of batchQueue.entries()) {
        if (queue.find(t => t.user === position.address)) {
            // User is already queued 
            return;
        }
    }

    // Analyze liquidation opportunity
    // Pass force as debug flag
    const target = await analyzeLiquidation(position, false, force);

    if (!target) {
        if (force) dashboard.logSniper(false, `❌ FORCE FAILED: No assets found for ${position.address.slice(0, 8)}`);
        return;
    }

    const debtUSD = Number(formatUnits(position.totalDebtBase, 8));

    // Decide whether to batch or execute single
    // FORCE bypasses batch queue
    if (!force && debtUSD < 15.0) {
        await addToBatchQueue(target);
    } else {
        await executeLiquidation(target, force);
    }
}
