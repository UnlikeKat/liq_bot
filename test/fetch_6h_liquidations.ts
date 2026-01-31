import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { writeFileSync } from 'fs';

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
const PUBLIC_RPC = 'https://mainnet.base.org'; // Public Base RPC

async function fetchRecentLiquidations() {
    console.log('📡 Fetching liquidations from last 6 hours (public RPC)...\n');

    const client = createPublicClient({
        chain: base,
        transport: http(PUBLIC_RPC)
    });

    const currentBlock = await client.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);

    // Base has 2s block time, 6h = 10800 blocks
    const blocksIn6h = 10800n;
    const fromBlock = currentBlock - blocksIn6h;

    console.log(`Fetching from block ${fromBlock} to ${currentBlock}\n`);

    const logs = await client.getLogs({
        address: AAVE_POOL as `0x${string}`,
        event: AAVE_POOL_ABI[0],
        fromBlock,
        toBlock: currentBlock
    });

    console.log(`✅ Found ${logs.length} liquidations in last 6 hours\n`);

    const liquidations = logs.map(log => ({
        blockNumber: log.blockNumber.toString(),
        transactionHash: log.transactionHash,
        user: log.args.user,
        liquidator: log.args.liquidator,
        collateralAsset: log.args.collateralAsset,
        debtAsset: log.args.debtAsset,
        debtToCover: log.args.debtToCover?.toString() || '0'
    }));

    writeFileSync('./data/liquidations_6h.json', JSON.stringify(liquidations, null, 2));
    console.log(`💾 Saved to data/liquidations_6h.json`);

    if (liquidations.length > 0) {
        console.log(`\n📊 Sample:`);
        console.log(`  Block: ${liquidations[0].blockNumber}`);
        console.log(`  Victim: ${liquidations[0].user}`);
        console.log(`  Liquidator: ${liquidations[0].liquidator}`);
    } else {
        console.log('\n⚠️  No liquidations found - will use most recent from 7-day data');
    }
}

fetchRecentLiquidations().catch(console.error);
