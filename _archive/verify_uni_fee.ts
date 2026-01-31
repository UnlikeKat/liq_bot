import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const POOL_ADDRESS = '0x7279c08A36333e12c3Fc81747963264c100D66fB'; // EURC/USDC 500 Pool

const ABI = parseAbi([
    'function fee() view returns (uint24)'
]);

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL),
    });

    console.log(`🔍 Checking Uniswap V3 Pool Fee for ${POOL_ADDRESS}...`);

    try {
        const fee = await client.readContract({
            address: POOL_ADDRESS,
            abi: ABI,
            functionName: 'fee'
        });

        console.log(`   💎 Pool Fee: ${fee} (microseconds)`);
        console.log(`   📊 Percentage: ${Number(fee) / 10000}%`);

        // Uniswap V3 Fees are in hundredths of a bip (1e-6).
        // 500 = 0.05%
        // 3000 = 0.3%
        // 10000 = 1%

    } catch (e) {
        console.error('   ❌ Failed to read Pool fee:', e);
    }
}

main().catch(console.error);
