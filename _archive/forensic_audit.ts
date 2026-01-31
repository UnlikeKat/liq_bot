import { createPublicClient, http, parseAbiItem, formatUnits, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { CONFIG, publicClient, premiumClient } from '../bot/config.js'; // Use publicClient from config
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIGURATION ---
// We need a specific block range to scan. Let's look at the last 2 days (~100k blocks).
const LOOKBACK_BLOCKS = 100000n;
const AAVE_POOL_ABI = [
    {
        type: 'event',
        name: 'LiquidationCall',
        inputs: [
            { indexed: true, name: 'collateralAsset', type: 'address' },
            { indexed: true, name: 'debtAsset', type: 'address' },
            { indexed: true, name: 'user', type: 'address' },
            { indexed: false, name: 'debtToCover', type: 'uint256' },
            { indexed: false, name: 'liquidatedCollateralAmount', type: 'uint256' },
            { indexed: false, name: 'liquidator', type: 'address' },
            { indexed: false, name: 'receiveAToken', type: 'bool' }
        ]
    }
] as const;

const ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

const DATA_PROVIDER_ABI = [
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

// Note: Removed local client definition to use imported publicClient

// Helper to resolve symbol
const TOKEN_MAP: Record<string, string> = {};
for (const [key, val] of Object.entries(CONFIG.TOKENS)) {
    TOKEN_MAP[val.toLowerCase()] = key;
}

// Memory cache for fetched symbols
const DYNAMIC_SYMBOLS: Record<string, string> = {};

async function getSymbol(addr: string) {
    const lower = addr.toLowerCase();
    if (TOKEN_MAP[lower]) return TOKEN_MAP[lower];
    if (DYNAMIC_SYMBOLS[lower]) return DYNAMIC_SYMBOLS[lower];

    try {
        const symbol = await publicClient.readContract({
            address: addr as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol'
        });
        DYNAMIC_SYMBOLS[lower] = symbol;
        return symbol;
    } catch {
        return addr.slice(0, 8);
    }
}

// Helper to fetch logs in chunks
async function fetchLogsInChunks(fromBlock: bigint, toBlock: bigint) {
    const CHUNK_SIZE = 1000n; // Reduced to 1000 for public node reliability
    const allLogs = [];

    for (let i = fromBlock; i < toBlock; i += CHUNK_SIZE) {
        const chunkTo = (i + CHUNK_SIZE > toBlock) ? toBlock : i + CHUNK_SIZE;
        console.log(`   ⏳ Fetching logs ${i} -> ${chunkTo}...`);

        try {
            const logs = await publicClient.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'),
                fromBlock: i,
                toBlock: chunkTo
            });
            allLogs.push(...logs);
            await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit pause (500ms for public)
        } catch (e: any) {
            console.error(`   ❌ Error fetching chunk ${i}:`, e?.message || e);
        }
    }
    return allLogs;
}

async function runForensics() {
    console.log(`🕵️ FORENSIC AUDIT: Scanning last ${LOOKBACK_BLOCKS} blocks for liquidations...`);
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock - LOOKBACK_BLOCKS;

    const logs = await fetchLogsInChunks(fromBlock, currentBlock);

    console.log(`📊 Found ${logs.length} liquidation events.`);

    // Group by User to see if multiple assets were involved
    const liquidationsByUser: Record<string, typeof logs> = {};
    for (const log of logs) {
        const user = log.args.user!.toLowerCase();
        if (!liquidationsByUser[user]) liquidationsByUser[user] = [];
        liquidationsByUser[user].push(log);
    }

    console.log(`🔍 Analyzing unique user strategies...\n`);

    let exactMatches = 0;
    let analyzed = 0;

    for (const user of Object.keys(liquidationsByUser)) {
        const events = liquidationsByUser[user];
        // We analyze the FIRST liquidation in the sequence as that's what the bot would have seen first
        const firstEvent = events[0];
        const { collateralAsset, debtAsset, debtToCover, liquidatedCollateralAmount } = firstEvent.args;

        if (!collateralAsset || !debtAsset) continue;

        analyzed++;

        console.log(`--------------------------------------------------`);
        console.log(`👤 Target: ${user}`);
        console.log(`   Tx: ${firstEvent.transactionHash}`);
        const collSym = await getSymbol(collateralAsset);
        const debtSym = await getSymbol(debtAsset);
        console.log(`   Winner Used: ${collSym} (Collateral) / ${debtSym} (Debt)`);
        console.log(`   Debt Covered: ${formatUnits(debtToCover!, 6)} (Assuming USDC/6 for easy read)`); // Rough format

        // --- OUR LOGIC REPLICATION --- 
        // We will try to calculate what OUR bot would have chosen.
        // NOTE: We are checking CURRENT state, not historical. 
        // This is a limitation, but usually heavy bags don't change type completely.
        // Ideally we'd use `blockNumber: firstEvent.blockNumber - 1n` but reliable archive nodes are expensive/rare on free tier.
        // We will assume the user's asset PREFERENCES match current state or try to infer from partial history.
        // Actually, we can check balances at that block if the node supports it. Alchemy usually does for recent history.

        try {
            const blockTag = { blockNumber: firstEvent.blockNumber - 1n }; // The state BEFORE liquidation

            // 1. Check all supported tokens for this user at that block
            const supportedTokens = Object.values(CONFIG.TOKENS);
            let bestCollateral = { address: '', value: 0n };
            let bestDebt = { address: '', value: 0n };

            // We iterate our known tokens to see if we would have picked them.
            // This verifies if our "registry" is complete enough to catch this.
            // 2. Multicall: Get Decimals, Price, and User Data for ALL tokens
            const calls = [];
            for (const ticketSym of Object.keys(CONFIG.TOKENS)) {
                const tokenAddr = CONFIG.TOKENS[ticketSym as keyof typeof CONFIG.TOKENS] as `0x${string}`;

                // Decimals
                calls.push({ address: tokenAddr, abi: erc20Abi, functionName: 'decimals' });
                // Price
                calls.push({ address: CONFIG.AAVE_ORACLE as `0x${string}`, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [tokenAddr] });
                // User Data
                calls.push({
                    address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
                    abi: DATA_PROVIDER_ABI,
                    functionName: 'getUserReserveData',
                    args: [tokenAddr, user as `0x${string}`]
                });
            }

            // Note: forensic audit uses premiumClient for read aggregation
            const results = await premiumClient.multicall({ contracts: calls as any, blockNumber: blockTag.blockNumber }).catch(() => null);

            if (results) {
                const tokenKeys = Object.keys(CONFIG.TOKENS);
                for (let i = 0; i < tokenKeys.length; i++) {
                    const tokenAddr = CONFIG.TOKENS[tokenKeys[i] as keyof typeof CONFIG.TOKENS];
                    const resDecimals = results[i * 3];
                    const resPrice = results[i * 3 + 1];
                    const resData = results[i * 3 + 2];

                    if (resDecimals.status === 'success' && resPrice.status === 'success' && resData.status === 'success') {
                        const decimals = resDecimals.result as number;
                        const price8Dec = resPrice.result as bigint;
                        const data = resData.result as any[];

                        const aBalance = data[0] as bigint;
                        const vDebt = data[2] as bigint;

                        // Calculate Value in USD
                        const priceUSD = Number(formatUnits(price8Dec, 8));
                        const collValue = Number(formatUnits(aBalance, decimals)) * priceUSD;
                        const debtValue = Number(formatUnits(vDebt, decimals)) * priceUSD;

                        if (collValue > bestCollateral.value) {
                            // Store Value in "value" field for comparison logic (rename field conceptualy to valueUSD)
                            // But original script used BigInt for value. We need to adapt.
                            // Let's change the struct to store address only, or just update logic.
                            bestCollateral = { address: tokenAddr, value: BigInt(Math.floor(collValue * 1e8)) }; // Hack: Store as BigInt scaled
                        }
                        if (debtValue > bestDebt.value) {
                            bestDebt = { address: tokenAddr, value: BigInt(Math.floor(debtValue * 1e8)) };
                        }
                    }
                }
            }

            const botCollSym = await getSymbol(bestCollateral.address);
            const botDebtSym = await getSymbol(bestDebt.address);
            console.log(`   🤖 Bot Choice: ${botCollSym} (Collateral) / ${botDebtSym} (Debt)`);

            // VERIFICATION
            const botCollateral = bestCollateral.address.toLowerCase();
            const botDebt = bestDebt.address.toLowerCase();
            const actualCollateral = collateralAsset.toLowerCase();
            const actualDebt = debtAsset.toLowerCase();

            if (botCollateral === actualCollateral && botDebt === actualDebt) {
                console.log(`   ✅ MATCH: Our logic selected the exact same pair.`);
                exactMatches++;
            } else {
                console.log(`   ❌ MISMATCH:`);
                if (botCollateral !== actualCollateral) console.log(`      Collateral: Bot ${await getSymbol(bestCollateral.address)} vs Winner ${await getSymbol(actualCollateral)}`);
                if (botDebt !== actualDebt) console.log(`      Debt: Bot ${await getSymbol(bestDebt.address)} vs Winner ${await getSymbol(actualDebt)}`);

                // Diagnosis
                if (!TOKEN_MAP[actualCollateral]) console.log(`      ⚠️  Reason: Winner used ${actualCollateral} which is NOT in our registry!`);
                else console.log(`      ⚠️  Reason: Logic weight difference (Highest Balance vs standard pair)`);
            }

        } catch (e: any) {
            console.log(`   ⚠️ Failed to replicate state: ${(e?.message || String(e)).slice(0, 100)}`);
        }
    }

    console.log(`\n==================================================`);
    console.log(`🎯 FORENSIC RESULT: ${exactMatches}/${analyzed} Matches`);
    const score = (exactMatches / analyzed) * 100;
    console.log(`🏆 Logic Accuracy Score: ${score.toFixed(1)}%`);
    if (score < 100) console.log(`suggestion: Add missing tokens to bot/config.ts if 'NOT in our registry' seen.`);
}

runForensics().catch(console.error);
