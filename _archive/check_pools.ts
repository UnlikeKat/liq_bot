import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // V3 Factory
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

const ABI = [
    {
        "inputs": [{ "type": "address" }, { "type": "address" }, { "type": "uint24" }],
        "name": "getPool",
        "outputs": [{ "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });
    const fees = [100, 500, 3000, 10000];

    console.log(`🔍 Checking USDC/EURC Pools...`);

    for (const fee of fees) {
        try {
            const pool = await client.readContract({
                address: FACTORY,
                abi: ABI,
                functionName: 'getPool',
                args: [USDC, EURC, fee]
            });

            if (pool === '0x0000000000000000000000000000000000000000') {
                console.log(`   Fee ${fee}: ❌ No Pool`);
            } else {
                // Check Liquidity
                const liquidity = await client.readContract({
                    address: pool,
                    abi: [{ name: 'liquidity', type: 'function', inputs: [], outputs: [{ type: 'uint128' }], stateMutability: 'view' }],
                    functionName: 'liquidity'
                });
                console.log(`   Fee ${fee}: ✅ Pool Found: ${pool}`);
                console.log(`      💧 Liquidity: ${liquidity}`);
            }
        } catch (e) {
            console.log(`   Fee ${fee}: ⚠️ Error checking`);
        }
    }
}

main().catch(console.error);
