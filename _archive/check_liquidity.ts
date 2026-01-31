import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Uniswap V3 Base Factory

const FACTORY_ABI = [{
    inputs: [
        { name: 'tokenA', type: 'address' },
        { name: 'tokenB', type: 'address' },
        { name: 'fee', type: 'uint24' }
    ],
    name: 'getPool',
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
}] as const;

const POOL_ABI = [
    {
        inputs: [],
        name: 'liquidity',
        outputs: [{ name: '', type: 'uint128' }],
        stateMutability: 'view',
        type: 'function'
    },
    {
        inputs: [],
        name: 'slot0',
        outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' },
            { name: 'tick', type: 'int24' },
            { name: 'observationIndex', type: 'uint16' },
            { name: 'observationCardinality', type: 'uint16' },
            { name: 'observationCardinalityNext', type: 'uint16' },
            { name: 'feeProtocol', type: 'uint8' },
            { name: 'unlocked', type: 'bool' }
        ],
        stateMutability: 'view',
        type: 'function'
    }
] as const;

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log('🔍 Checking Uniswap V3 Liquidity for USDC <-> EURC');
    console.log(`USDC: ${USDC}`);
    console.log(`EURC: ${EURC}`);

    const fees = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

    for (const fee of fees) {
        console.log(`\nChecking Fee Tier: ${fee / 10000}% (${fee})`);

        try {
            const poolAddress = await client.readContract({
                address: FACTORY,
                abi: FACTORY_ABI,
                functionName: 'getPool',
                args: [USDC, EURC, fee]
            });

            if (poolAddress === '0x0000000000000000000000000000000000000000') {
                console.log('   ❌ No Pool exists.');
                continue;
            }

            console.log(`   ✅ Pool Found: ${poolAddress}`);

            const liquidity = await client.readContract({
                address: poolAddress,
                abi: POOL_ABI,
                functionName: 'liquidity'
            });

            console.log(`   💧 Liquidity: ${liquidity.toString()}`);

            if (liquidity === 0n) {
                console.log('      ⚠️  Pool is EMPTY (0 Liquidity). Cannot swap.');
            } else {
                const slot0 = await client.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'slot0'
                });
                console.log(`      💰 SqrtPriceX96: ${slot0[0].toString()}`);
                console.log(`      📊 Tick: ${slot0[1]}`);
            }

        } catch (error) {
            console.error('   ❌ Error querying factory/pool:', error);
        }
    }
}

main().catch(console.error);
