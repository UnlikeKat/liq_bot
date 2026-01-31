import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from './bot/config.js';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL),
});

const RANGES_TO_TEST = [2000, 1000, 500, 250, 100, 50, 20, 15];

async function testLimit() {
    console.log("🧪 Testing RPC Max Block Range...");

    const currentBlock = await client.getBlockNumber();
    console.log(`Current Block: ${currentBlock}`);

    for (const range of RANGES_TO_TEST) {
        process.stdout.write(`Testing range ${range}... `);
        try {
            await client.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: parseAbiItem('event Borrow(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint256 referralCode)'),
                fromBlock: currentBlock - BigInt(range),
                toBlock: currentBlock
            });
            console.log(`✅ SUCCESS`);
            console.log(`\n🎉 Optimal Chunk Size found: ${range}`);
            console.log(`Recommendation: Update CHUNK_SIZE to ${range}n`);
            process.exit(0);
        } catch (e: any) {
            console.log(`❌ FAILED`);
            // console.log(e.message.slice(0, 150));
        }
        await new Promise(r => setTimeout(r, 1000)); // Cool down
    }
    console.log(`\n⚠️  Limit is likely 10 blocks (default fallback).`);
}

testLimit();
