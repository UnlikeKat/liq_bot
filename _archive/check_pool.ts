import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
});

const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Uniswap V3 Factory Base
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const abi = parseAbi([
    'function getPool(address, address, uint24) view returns (address)'
]);

async function checkPool(fee: number) {
    const pool = await client.readContract({
        address: FACTORY,
        abi: abi,
        functionName: 'getPool',
        args: [EURC, USDC, fee]
    });
    console.log(`Fee ${fee}: Pool ${pool}`);
    if (pool !== '0x0000000000000000000000000000000000000000') {
        const liq = await client.readContract({
            address: pool,
            abi: parseAbi(['function liquidity() view returns (uint128)']),
            functionName: 'liquidity'
        });
        console.log(`   Liquidity: ${liq}`);
    }
}

async function main() {
    await checkPool(100);  // 0.01%
    await checkPool(500);  // 0.05%
    await checkPool(3000); // 0.3%
    await checkPool(10000);// 1.0%
}

main();
