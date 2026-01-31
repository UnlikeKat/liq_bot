import * as fs from 'fs';
import * as path from 'path';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

// --- CONFIGURATION ---
const MY_LATENCY = 3;    // Blocks
const GAS_COST_USD = 0.50;

// --- RPC POOL (Load Balancer) ---
const RPC_LIST = [
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://1rpc.io/base',
    'https://base.meowrpc.com'
];

const clients = RPC_LIST.map(url => createPublicClient({
    chain: base,
    transport: http(url, { retryCount: 2, timeout: 5000 }),
}));

// Round-robin index
let clientIndex = 0;
function getNextClient() {
    const client = clients[clientIndex];
    clientIndex = (clientIndex + 1) % clients.length;
    return client;
}

// Shared ABI
const POOL_ABI = [
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

// --- STATE ---
let stats = {
    found: 0,
    wins: 0,
    totalProfit: 0
};

async function getHealthFactor(user: string, blockNumber: bigint) {
    try {
        const client = getNextClient();
        const data = await client.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: POOL_ABI,
            functionName: 'getUserAccountData',
            args: [user as `0x${string}`],
            blockNumber
        });
        return {
            hf: Number(formatUnits(data[5], 18)),
            debtBase: Number(formatUnits(data[1], 8))
        };
    } catch (e) {
        return null;
    }
}

async function analyzeLiquidations() {
    console.log(`\n🕰️  PREPARING TIME MACHINE (30-DAY STREAMING EDITION)...`);

    // 1. DATA LOADING
    const DATA_FILE = path.join(process.cwd(), 'data', 'liquidations_30d.json');
    let events = [];

    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            events = JSON.parse(raw);
            console.log(`   ✅ Loaded ${events.length} historical events from disk.`);
        } else {
            console.log(`   ❌ Data file missing: ${DATA_FILE}`);
            return;
        }
    } catch (e) {
        console.log(`   ❌ Error reading data file.`);
        return;
    }

    if (events.length === 0) return;

    stats.found = events.length;

    console.log(`\n   ✅ Analyzing ${events.length} Races (Latency: ${MY_LATENCY} blocks)...`);
    console.log(`   Using 5-RPC Round Robin. Updates will appear every 10 events.\n`);
    console.log(`   ${"BLOCK".padEnd(9)} | ${"USER".padEnd(42)} | ${"WINDOW".padEnd(8)} | ${"RESULT".padEnd(8)} | ${"STRATEGY".padEnd(10)} | PROFIT`);
    console.log('   '.padEnd(100, '-'));

    // 2. ANALYSIS LOOP (BATCHED)
    let processed = 0;
    const BATCH_SIZE = 5; // Conservative batch for 5 RPCs

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (event) => {
            const user = event.user.id || event.user;
            const execBlock = BigInt(event.blockNumber);

            // 3. BACKTRACKING (Robust)
            let zeroHourBlock: bigint | null = null;
            const history: { i: number, block: bigint, data: any }[] = [];

            // Execute checks with individual retry
            await Promise.all(
                Array.from({ length: 30 }, (_, k) => k + 1).map(async (j) => {
                    const checkBlock = execBlock - BigInt(j);
                    let attempts = 0;
                    while (attempts < 3) {
                        try {
                            const data = await getHealthFactor(user, checkBlock);
                            if (data) {
                                history.push({ i: j, block: checkBlock, data });
                                break;
                            }
                        } catch (e) {
                            // Retry
                        }
                        attempts++;
                        await new Promise(r => setTimeout(r, 500)); // Backoff
                    }
                })
            );

            history.sort((a, b) => a.i - b.i);

            for (const h of history) {
                if (h.data && h.data.hf >= 1.0) {
                    zeroHourBlock = h.block + 1n;
                    break;
                }
            }
            // If we have history but never found healthy, assumes old insolvency
            if (!zeroHourBlock && history.length > 0) zeroHourBlock = execBlock - 30n;

            processed++;
            // LOGGING HEARTBEAT
            if (processed % 10 === 0) {
                const percent = ((processed / events.length) * 100).toFixed(1);
                console.log(`   [Progress] Processed ${processed}/${events.length} (${percent}%)`);
            }

            if (!zeroHourBlock) return;

            // 4. THE RACE
            const window = Number(execBlock - zeroHourBlock);
            const iWin = window > MY_LATENCY;

            let resultStr = iWin ? '✅ WIN' : '❌ LOSS';
            let profitStr = '$0.00';
            let strategyStr = '-';

            // 5. PROFIT CALCULATION
            if (iWin) {
                stats.wins++;
                const myBlock = zeroHourBlock + BigInt(MY_LATENCY);
                const myData = await getHealthFactor(user, myBlock);

                if (myData) {
                    let closeFactor = 0.5;
                    if (myData.hf < 0.95 || myData.debtBase < 2000) {
                        closeFactor = 1.0;
                        strategyStr = '100% MAX';
                    } else {
                        strategyStr = '50% STD';
                    }

                    const debtCovered = myData.debtBase * closeFactor;
                    const bonus = debtCovered * 0.05;
                    const profit = bonus - GAS_COST_USD;

                    if (profit > 0) {
                        stats.totalProfit += profit;
                        profitStr = `$${profit.toFixed(2)}`;
                    } else {
                        profitStr = `$0.00 (Gas)`;
                    }
                }
            }
            // Only log processed item details if it's a WIN or significant to keep log clean? 
            // Or log everything so user sees it moving? User wants to see it moving.
            // console.log(`   ${execBlock.toString().padEnd(9)} | ${user} | ${window.toString().padEnd(8)} | ${resultStr.padEnd(8)} | ${strategyStr.padEnd(10)} | ${profitStr}`);
        }));
    }

    // 6. SUMMARY
    const conversionRate = stats.found > 0 ? (stats.wins / stats.found * 100).toFixed(1) : '0';

    console.log('\n================================================================');
    console.log('📊 SIMULATION RESULTS (30-DAY)');
    console.log('================================================================');
    console.log(`🔹 Total Opportunities:   ${stats.found}`);
    console.log(`🔹 Winnable (Home PC):    ${stats.wins} (${conversionRate}%)`);
    console.log(`🔹 Total Estimated Profit: $${stats.totalProfit.toFixed(2)}`);
    console.log('================================================================');
}

analyzeLiquidations().catch(console.error);
