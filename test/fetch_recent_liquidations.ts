import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

config();

const AAVE_POOL_ABI = [
    {
        type: 'event',
        name: 'LiquidationCall',
        inputs: [
            { name: 'collateralAsset', type: 'address', indexed: true },
            { name: 'debtAsset', type: 'address', indexed: true },
            { name: 'user', type: 'address', indexed: true },
            { name: 'debtToCover', type: 'uint256', indexed: false },
            { name: 'liquidatedCollateralAmount', type: 'uint256', indexed: false },
            { name: 'liquidator', type: 'address', indexed: false },
            { name: 'receiveAToken', type: 'bool', indexed: false }
        ]
    }
] as const;

const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

async function fetchRecentLiquidations() {
    console.log('📡 Fetching recent liquidations (last 24 hours)...\n');

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const currentBlock = await client.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);

    // Base has 2s block time, 24h = 43200 blocks
    // Fetch in chunks to avoid RPC limits
    const blocksIn24h = 43200n;
    const fromBlock = currentBlock - blocksIn24h;
    const chunkSize = 10000n;

    console.log(`Fetching from block ${fromBlock} to ${currentBlock} in chunks...\n`);

    let allLogs: any[] = [];
    for (let start = fromBlock; start < currentBlock; start += chunkSize) {
        const end = start + chunkSize > currentBlock ? currentBlock : start + chunkSize;
        console.log(`  Chunk: ${start} → ${end}`);

        const logs = await client.getLogs({
            address: AAVE_POOL as `0x${string}`,
            event: AAVE_POOL_ABI[0],
            fromBlock: start,
            toBlock: end
        });

        allLogs.push(...logs);
        console.log(`    Found ${logs.length} liquidations`);
    }

    console.log(`\n✅ Total: ${allLogs.length} liquidations in last 24h\n`);

    const liquidations = allLogs.map(log => ({
        blockNumber: log.blockNumber.toString(),
        transactionHash: log.transactionHash,
        user: log.args.user,
        liquidator: log.args.liquidator,
        collateralAsset: log.args.collateralAsset,
        debtAsset: log.args.debtAsset,
        debtToCover: log.args.debtToCover?.toString() || '0'
    }));

    writeFileSync('./data/liquidations_24h.json', JSON.stringify(liquidations, null, 2));
    console.log(`💾 Saved to data/liquidations_24h.json`);

    if (liquidations.length > 0) {
        console.log(`\nSample liquidation:`);
        console.log(`  Block: ${liquidations[0].blockNumber}`);
        console.log(`  Victim: ${liquidations[0].user}`);
        console.log(`  Liquidator: ${liquidations[0].liquidator}`);
    } else {
        console.log('\n⚠️  No liquidations found in last 24h');
    }
}

fetchRecentLiquidations().catch(console.error);
