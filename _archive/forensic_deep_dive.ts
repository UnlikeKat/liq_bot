import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { CONFIG, premiumClient } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIGURATION ---
const HISTORY_FILE = path.resolve('data/liquidation_history.json');

// --- ABIs ---
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

interface LiquidationRecord {
    txHash: string;
    blockNumber: number;
    user: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: string;
    liquidatedCollateral: string;
    profitUSD: number;
}

// Memory cache for fetched symbols
const DYNAMIC_SYMBOLS: Record<string, string> = {};
const TOKEN_MAP: Record<string, string> = {};

// Initialize Token Map
for (const [key, val] of Object.entries(CONFIG.TOKENS)) {
    TOKEN_MAP[val.toLowerCase()] = key;
}

async function getSymbol(addr: string) {
    const lower = addr.toLowerCase();
    if (TOKEN_MAP[lower]) return TOKEN_MAP[lower];
    if (DYNAMIC_SYMBOLS[lower]) return DYNAMIC_SYMBOLS[lower];

    try {
        const symbol = await premiumClient.readContract({
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

async function runDeepAudit() {
    console.log(`🕵️ FORENSIC DEEP DIVE: Analyzing 90-day history...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history: LiquidationRecord[] = JSON.parse(rawData);

    console.log(`📊 Loaded ${history.length} historical liquidations.`);

    let exactMatches = 0;
    let analyzed = 0;
    let missingTokens = new Set<string>();

    // Process in chunks to avoid overwhelming RPC or Logs
    // We'll process ALL of them, but maybe print every 50 to keep output clean

    // Shuffle or select recent? User said "just use that list".
    // We will analyze ALL.

    console.log(`Start processing... (This may take a few minutes)`);

    for (const [index, record] of history.entries()) {
        const { user, collateralAsset, debtAsset, blockNumber, txHash } = record;

        // Skip if incomplete data
        if (!collateralAsset || !debtAsset) continue;

        analyzed++;

        // Check if winner used tokens we don't know
        const isCollateralKnown = Object.values(CONFIG.TOKENS).some(t => t.toLowerCase() === collateralAsset.toLowerCase());
        const isDebtKnown = Object.values(CONFIG.TOKENS).some(t => t.toLowerCase() === debtAsset.toLowerCase());

        if (!isCollateralKnown) missingTokens.add(collateralAsset);
        if (!isDebtKnown) missingTokens.add(debtAsset);

        // Progress Log
        if (index % 50 === 0) console.log(`   Processing ${index}/${history.length}... Stats: ${exactMatches}/${analyzed} (${((exactMatches / analyzed) * 100).toFixed(1)}%)`);

        try {
            // --- BOT LOGIC SIMULATION ---
            // State at `blockNumber - 1` (Before liquidation)
            const blockTag = { blockNumber: BigInt(blockNumber - 1) };

            // 2. Multicall: Get Decimals, Price, and User Data for ALL tokens
            const calls = [];
            // We iterate ONLY our known tokens to simulate what the bot WOULD see
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

            const results = await premiumClient.multicall({ contracts: calls as any, blockNumber: blockTag.blockNumber }).catch(() => null);

            let bestCollateral = { address: '', valueUSD: 0 };
            let bestDebt = { address: '', valueUSD: 0 };

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

                        if (collValue > bestCollateral.valueUSD) {
                            bestCollateral = { address: tokenAddr, valueUSD: collValue };
                        }
                        if (debtValue > bestDebt.valueUSD) {
                            bestDebt = { address: tokenAddr, valueUSD: debtValue };
                        }
                    }
                }
            }

            // Comparison
            const botCollateral = bestCollateral.address.toLowerCase();
            const botDebt = bestDebt.address.toLowerCase();
            const actualCollateral = collateralAsset.toLowerCase();
            const actualDebt = debtAsset.toLowerCase();

            if (botCollateral === actualCollateral && botDebt === actualDebt) {
                exactMatches++;
            } else {
                // If mismatch, we can log details. 
                // But for 2000 records, let's only log UNIQUE mismatch types or just Summary.
                // Or maybe log first 10 mismatches.
                // console.log(`   ❌ Mismatch at ${blockNumber}: Bot ${botCollateral}/${botDebt} vs Winner ${actualCollateral}/${actualDebt}`);
            }

        } catch (error) {
            console.error(`Error processing tx ${txHash}:`, error);
        }
    }

    console.log(`\n==================================================`);
    console.log(`🎯 DEEP AUDIT RESULT: ${exactMatches}/${analyzed} Matches`);
    console.log(`🏆 Logic Accuracy Score: ${((exactMatches / analyzed) * 100).toFixed(1)}%`);

    if (missingTokens.size > 0) {
        console.log(`\n🚨 DETECTED MISSING TOKENS (${missingTokens.size}):`);
        for (const addr of missingTokens) {
            const sym = await getSymbol(addr);
            console.log(`   - ${sym}: ${addr}`);
        }
    } else {
        console.log(`\n✅ No missing tokens detected in registry.`);
    }

    console.log(`==================================================\n`);
}

runDeepAudit().catch(console.error);
