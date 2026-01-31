import { createPublicClient, http, formatUnits, parseAbiItem, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js'; // Ensure we use the shared config

// Configuration for the Pessimistic Model
const MY_REACTION_BLOCKS = 3; // Home PC + Free RPC Latency Assumption
const BACKTRACK_LIMIT = 50;   // How far back to check for the insolvency event

// Pool Address (Base Mainnet)
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'; // Verified from previous steps

// ABI for Health Factor
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

// Historic Liquidations to Analyze (Add real hashes here)
const PAST_LIQUIDATION_TXS = [
    // Placeholder: You should replace these with real tx hashes from Basescan
    // Example: "0x..."
];

const publicClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL),
});

async function getHealthFactorAtBlock(user: `0x${string}`, blockNumber: bigint): Promise<number> {
    try {
        const data = await publicClient.readContract({
            address: AAVE_POOL as `0x${string}`,
            abi: POOL_ABI,
            functionName: 'getUserAccountData',
            args: [user],
            blockNumber: blockNumber
        });
        return Number(formatUnits(data[5], 18));
    } catch (e) {
        return 1.1; // Assume usage error or missing data implies healthy to skip false negatives
    }
}

async function analyzeTransaction(txHash: string) {
    console.log(`\n🔍 Analyzing Tx: ${txHash}`);

    try {
        // 1. Get Receipt
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        const liquidationBlock = receipt.blockNumber;

        // 2. Find Liquidated User from Logs
        // Event: LiquidationCall(..., address indexed user, ...)
        let user: `0x${string}` | undefined;
        let debtCovered = 0n;

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === AAVE_POOL.toLowerCase()) {
                try {
                    const decoded = decodeEventLog({
                        abi: [parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)')],
                        data: log.data,
                        topics: log.topics
                    });
                    user = decoded.args.user;
                    debtCovered = decoded.args.debtToCover;
                    break;
                } catch (e) { continue; } // Not the event we want
            }
        }

        if (!user) {
            console.log('   ❌ Could not identify liquidated user (Logs empty or parse error).');
            return null;
        }

        console.log(`   User: ${user}`);
        console.log(`   Liquidation Block: ${liquidationBlock}`);

        // 3. Backtrack to find when HF dropped < 1.0
        let insolventBlock: bigint | null = null;

        // Optimized Binary Search logic is overkill, simple linear backtrack is safer for correctness
        for (let i = 1; i <= BACKTRACK_LIMIT; i++) {
            const checkBlock = liquidationBlock - BigInt(i);
            const hf = await getHealthFactorAtBlock(user, checkBlock);

            // If HF is healthy, the insolvency started at the NEXT block (checkBlock + 1)
            // Or if we hit limit, we assume it started way back
            if (hf >= 1.0) {
                insolventBlock = checkBlock + 1n;
                break;
            }
            // If i == BACKTRACK_LIMIT, assume it was insolvent for > 50 blocks
            if (i === BACKTRACK_LIMIT) {
                insolventBlock = liquidationBlock - BigInt(BACKTRACK_LIMIT);
                console.log(`   ⚠️  User was insolvent for >${BACKTRACK_LIMIT} blocks.`);
            }
        }

        if (!insolventBlock) {
            console.log('   ❓ Could not determine start of insolvency.');
            return null;
        }

        // 4. Calculate Latency
        const competitorLatency = Number(liquidationBlock - insolventBlock);
        const myReaction = MY_REACTION_BLOCKS;

        console.log(`   Insolvent Block: ${insolventBlock}`);
        console.log(`   Competitor Latency: ${competitorLatency} blocks`);
        console.log(`   My Reaction Time:   ${myReaction} blocks`);

        // 5. Verdict
        let result = '';
        let estimatedProfit = '0';

        if (competitorLatency > myReaction) {
            result = '✅ WIN';
            // Estimate Profit: 5% bonus - $0.50 gas
            // debtCovered is in token units. Assume USD peg 1:1 for simplicity or skip conversion
            // Simplified: Profit = Debt * 0.05
            // This is purely illustrative without token prices
            const profitTokens = Number(formatUnits(debtCovered, 6)) * 0.05; // Assume USDC 6 decimals
            estimatedProfit = `$${profitTokens.toFixed(2)}`;
        } else {
            result = '❌ LOSS';
        }

        console.log(`   Result: ${result}`);
        if (result.includes('WIN')) {
            console.log(`   Est. Profit: ${estimatedProfit}`);
        }

        return {
            hash: txHash,
            latency: competitorLatency,
            result,
            profit: estimatedProfit
        };

    } catch (error: any) {
        console.error('   ❌ Error analyzing tx:', error.message);
        return null;
    }
}

async function runTimeMachine() {
    console.log('🕰️  Starting Time Machine Verification...');
    console.log(`   Setup: Base Mainnet | Reaction Time: ${MY_REACTION_BLOCKS} Blocks`);
    console.log('================================================================');

    if (PAST_LIQUIDATION_TXS.length === 0) {
        console.log('⚠️  No transaction hashes provided.');
        console.log('   Add hashes to PAST_LIQUIDATION_TXS in time_machine.ts to verify.');
        return;
    }

    let wins = 0;
    let totalTxs = 0;

    for (const tx of PAST_LIQUIDATION_TXS) {
        const result = await analyzeTransaction(tx);
        if (result) {
            totalTxs++;
            if (result.result.includes('WIN')) wins++;
        }
    }

    console.log('\n================================================================');
    console.log(`📊 Final Score: ${wins}/${totalTxs} Wins (${totalTxs > 0 ? (wins / totalTxs * 100).toFixed(1) : 0}%)`);
    if (wins > 0) {
        console.log('   Conclusion: Your setup is competitive for these slow opportunities.');
    } else {
        console.log('   Conclusion: Competitors are extremely optimized. Consider upgrading RPC/VPS.');
    }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTimeMachine();
}

export { runTimeMachine };
