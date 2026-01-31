
import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { CONFIG } from '../bot/config.js';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FLASH_LIQUIDATOR = '0xbb1401392c4be8d34befea077c0e7d50edb2a673';

const ABI = [
    {
        name: 'executeBatch',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'collateralAssets', type: 'address[]' },
            { name: 'debtAssets', type: 'address[]' },
            { name: 'users', type: 'address[]' },
            { name: 'debtsToCover', type: 'uint256[]' }
        ]
    }
] as const;

// Data for the 8 users (hardcoded from my previous simulation run to be fast)
const BATCH_DATA = [
    { user: '0x5B97da1C5351F6bC57cEC74C4C5a27D70c064f59', coll: '0x4200000000000000000000000000000000000006', debt: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', amount: 228062n },
    { user: '0x3246EF49846DFD3dda6D592cDCb80d956b3CF864', coll: '0x4200000000000000000000000000000000000006', debt: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', amount: 3n },
    { user: '0x2AEe4A054ce01a4d1F698064B8d90ec34f9FaC48', coll: '0x4200000000000000000000000000000000000006', debt: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: 190920n },
    { user: '0xB00682Ff3A830A00650f6d428289Be494c5a63E6', coll: '0x4200000000000000000000000000000000000006', debt: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: 1374950n },
    { user: '0x1BB40D45bd1c5f4cEE56f4B4322407992F9b451c', coll: '0x4200000000000000000000000000000000000006', debt: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', amount: 133996n },
    { user: '0x1F84d2C5Ff9BdbD01C1912dDcdd4Ba07bAfA31E0', coll: '0x4200000000000000000000000000000000000006', debt: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', amount: 6294n },
    { user: '0x52066d8ED13A412657cF99c6a2BF5bD664599554', coll: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', debt: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: 5011500n },
    { user: '0x7a2497ad6E4ebA70089c375455FD4cf19d580cE1', coll: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', debt: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', amount: 7452026n }
];

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });
    console.log('🧪 BATCH EXECUTION TESTER\n');

    // Filter those using USDC as debt for the first batch test
    // (Actually the contract requires SAME debt asset for the whole batch)
    const usdcBatch = BATCH_DATA.filter(d => d.debt.toLowerCase() === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase());

    if (usdcBatch.length === 0) {
        console.log('No USDC targets found for batch test.');
        return;
    }

    console.log(`📦 Bundling ${usdcBatch.length} USDC targets...`);

    const collateralAssets = usdcBatch.map(d => d.coll as `0x${string}`);
    const debtAssets = usdcBatch.map(d => d.debt as `0x${string}`);
    const users = usdcBatch.map(d => d.user as `0x${string}`);
    const debtsToCover = usdcBatch.map(d => d.amount);

    try {
        console.log('🔄 Simulating executeBatch...');
        await client.simulateContract({
            address: FLASH_LIQUIDATOR,
            abi: ABI,
            functionName: 'executeBatch',
            args: [collateralAssets, debtAssets, users, debtsToCover],
            account: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1' // Owner
        });
        console.log('✅ Success! Bundle is profitable.');
    } catch (e: any) {
        console.log('\n❌ Simulation Result:');
        console.log('   Short:', e.shortMessage || 'Unknown');

        if (e.message.includes('Insufficient funds')) {
            console.log('   🚀 LOGIC WORKING: Aave passed, but total bonus < total cost.');
        } else {
            console.error('   Error Details:', e.message.slice(0, 500));
        }
    }
}

main().catch(console.error);
