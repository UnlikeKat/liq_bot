import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

// Aave V3 Pool Interface for Flashloan Premium
const ABI = [
    {
        name: 'FLASHLOAN_PREMIUM_TOTAL',
        type: 'function',
        inputs: [],
        outputs: [{ type: 'uint128' }],
        stateMutability: 'view'
    },
    {
        name: 'FLASHLOAN_PREMIUM_TO_PROTOCOL',
        type: 'function',
        inputs: [],
        outputs: [{ type: 'uint128' }],
        stateMutability: 'view'
    }
] as const;

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    console.log(`🔍 Checking Aave V3 Flashloan Fees...`);

    try {
        const premiumTotal = await client.readContract({
            address: AAVE_POOL as `0x${string}`,
            abi: ABI,
            functionName: 'FLASHLOAN_PREMIUM_TOTAL'
        });

        const premiumProtocol = await client.readContract({
            address: AAVE_POOL as `0x${string}`,
            abi: ABI,
            functionName: 'FLASHLOAN_PREMIUM_TO_PROTOCOL'
        });

        console.log(`   💎 Total Premium: ${premiumTotal} (${Number(premiumTotal) / 100}% aka ${Number(premiumTotal) / 10000} bps)`);
        console.log(`   🏦 Protocol Share: ${premiumProtocol} (${Number(premiumProtocol) / 100}%)`);

        // Aave V3 standard is 9 bps (0.09%). 
        // 900 / 10000 = 0.09.

    } catch (e) {
        console.error('   ❌ Failed to read Aave V3 params:', e);
    }
}

main().catch(console.error);
