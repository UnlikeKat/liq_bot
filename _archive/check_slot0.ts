import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const POOL = '0x7279c08A36333e12c3Fc81747963264c100D66fB'; // Fee 500

const ABI = [
    {
        "inputs": [],
        "name": "slot0",
        "outputs": [
            { "internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160" },
            { "internalType": "int24", "name": "tick", "type": "int24" },
            { "internalType": "uint16", "name": "observationIndex", "type": "uint16" },
            { "internalType": "uint16", "name": "observationCardinality", "type": "uint16" },
            { "internalType": "uint16", "name": "observationCardinalityNext", "type": "uint16" },
            { "internalType": "uint8", "name": "feeProtocol", "type": "uint8" },
            { "internalType": "bool", "name": "unlocked", "type": "bool" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });

    console.log(`🔍 Checking Pool Slot0: ${POOL}`);

    try {
        const slot0 = await client.readContract({
            address: POOL,
            abi: ABI,
            functionName: 'slot0'
        });

        const sqrtPriceX96 = BigInt(slot0[0]);
        const tick = slot0[1];
        const unlocked = slot0[6];

        console.log(`   ✅ SqrtPriceX96: ${sqrtPriceX96}`);
        console.log(`   ✅ Tick: ${tick}`);
        console.log(`   ✅ Unlocked: ${unlocked}`);

        if (!unlocked) {
            console.error('   ❌ POOL IS LOCKED (Reentrancy?) or Not Initialized properly!');
        }

        // Calculate Price
        // Token0 = EURC (6 dec), Token1 = USDC (6 dec).
        // Price = (sqrtPrice / 2^96)^2
        const Q96 = 2n ** 96n;
        const p = Number(sqrtPriceX96) / Number(Q96);
        const price = p * p;
        console.log(`   Price (EURC/USDC?): ${price.toFixed(6)}`);

    } catch (e: any) {
        console.log(`❌ Error reading slot0: ${e.message}`);
    }
}

main().catch(console.error);
