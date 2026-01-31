import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';

// CONFIG
const TARGET_TX = process.argv[2];
if (!TARGET_TX) {
    console.log("Usage: npx tsx scripts/forensic.ts <TX_HASH>");
    process.exit(1);
}

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';

const POOL_ABI = parseAbi(['function getUserAccountData(address) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)']);

async function forensics(txHash: string) {
    console.log(`\n🕵️ FORENSIC ANALYSIS: ${txHash}`);

    // 1. Get Transaction Details
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const liqBlock = receipt.blockNumber;

    // Find Liquidation Log
    const LIQ_TOPIC = '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286';
    const liqLog = receipt.logs.find(l => l.topics[0] === LIQ_TOPIC);

    if (!liqLog) {
        console.error('❌ NOT a liquidation transaction (no LiquidationCall event)');
        return;
    }

    const userTopic = liqLog.topics[3];
    const user = `0x${userTopic!.slice(26)}` as `0x${string}`;

    console.log(`   User: ${user}`);
    console.log(`   Liquidation Block: ${liqBlock}`);

    // 2. Find Exact Insolvency Block (Binary Search)
    console.log('\n⏱️ Calculating Exact Latency...');
    let healthy = liqBlock - 20000n; // Look back 40000s (~11h)
    let insolvent = liqBlock;

    // Quick check if recent
    const checkState = async (block: bigint) => {
        try {
            const [, , , , , hf] = await client.readContract({
                address: AAVE_POOL,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user],
                blockNumber: block
            });
            return hf;
        } catch (e) {
            return 0n; // Assume broken/insolvent if call fails? Or retry
        }
    };

    const startHf = await checkState(healthy);
    if (startHf < 1e18) {
        console.log(`   ⚠️ User was already insolvent at block ${healthy}. This position was underwater for a LONG time.`);
    } else {
        // Binary search
        let ops = 0;
        while (healthy + 1n < insolvent && ops < 25) {
            ops++;
            const mid = (healthy + insolvent) / 2n;
            const hf = await checkState(mid);

            if (hf >= 1e18) {
                healthy = mid;
            } else {
                insolvent = mid;
            }
        }
    }

    const insolvencyBlock = insolvent;
    const blocksLate = liqBlock - insolvencyBlock;
    const secondsLate = blocksLate * 2n;

    console.log(`\n✅ RESULTS:`);
    console.log(`   Insolvency Block: ${insolvencyBlock}`);
    console.log(`   Liquidation Block: ${liqBlock}`);
    console.log(`   🚨 LATENCY: ${blocksLate} blocks (~${secondsLate} seconds)`);

    console.log(`\n   What this means:`);
    console.log(`   The user's Health Factor dropped below 1.0 at block ${insolvencyBlock}.`);
    console.log(`   It took ${blocksLate} blocks for a liquidator to successfully mine the transaction.`);
}

forensics(TARGET_TX).catch(console.error);
