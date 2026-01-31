import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
config();

const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ABI = parseAbi([
    'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'
]);

async function main() {
    const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });

    const fees = [100, 500, 3000, 10000];
    for (const fee of fees) {
        const pool = await client.readContract({
            address: FACTORY,
            abi: ABI,
            functionName: 'getPool',
            args: [EURC, USDC, fee]
        });
        if (pool !== '0x0000000000000000000000000000000000000000') {
            console.log(`✅ Found Pool (Fee ${fee}): ${pool}`);
            // Check liquidity?
            // const bal = await client.readContract({ ... balanceOf EURC ... })
        } else {
            console.log(`❌ No Pool for Fee ${fee}`);
        }
    }
}
main().catch(console.error);
