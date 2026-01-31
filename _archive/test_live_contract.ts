import { createPublicClient, http, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FLASH_LIQUIDATOR = '0x20ec0186e5b489b2352b00fd4c19ff4b1c9da9c1'; // Router Fix + Fee Fix
const TARGET_USER = '0x7a2497ad6E4ebA70089c375455FD4cf19d580cE1';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

// 14903 EURC (Dust)
const debtToCover = 14903n;

const ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "collateralAsset", "type": "address" },
            { "internalType": "address", "name": "debtAsset", "type": "address" },
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "uint256", "name": "debtToCover", "type": "uint256" }
        ],
        "name": "executeLiquidation",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`🧪 Testing Liquidator: ${FLASH_LIQUIDATOR}`);
    console.log(`   User: ${TARGET_USER}`);
    console.log(`   Debt: ${debtToCover}`);

    console.log(`Simulating liquidation with State Override (minProfit = 0)...`);

    // Encode the call
    const data = encodeFunctionData({
        abi: ABI, // Changed from FlashLiquidatorABI to ABI
        functionName: 'executeLiquidation',
        args: [
            EURC, // Collateral (EURC)
            USDC, // Debt (USDC)
            TARGET_USER,
            100n // debtToCover (Dust)
        ]
    });

    try {
        const result = await client.call({ // Changed from publicClient to client
            account: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Random sender
            to: FLASH_LIQUIDATOR as `0x${string}`,
            data: data,
            stateOverride: [
                {
                    address: FLASH_LIQUIDATOR as `0x${string}`,
                    stateDiff: [
                        {
                            slot: '0x0000000000000000000000000000000000000000000000000000000000000002', // Slot 2
                            value: '0x0000000000000000000000000000000000000000000000000000000000000000' // Value 0
                        }
                    ]
                }
            ]
        });

        console.log(`✅ Simulation Successful (State Override)!`);
        console.log(`   Result Data: ${result.data}`);
        // return; // Removed return to allow subsequent simulation

    } catch (e: any) {
        console.log(`❌ Simulation Failed (State Override)!`); // Added context to message
        console.log(`   Message: ${e.message}`);
        if (e.walk) {
            const cause = e.walk();
            console.log(`   Cause:`, cause);
        }
        if (e.data) console.log(`   Data: ${e.data}`);
    }

    try {
        await client.simulateContract({
            address: FLASH_LIQUIDATOR,
            abi: ABI,
            functionName: 'executeLiquidation',
            args: [USDC, EURC, TARGET_USER, debtToCover],
            account: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1'
        });
        console.log(`✅ Simulation SUCCESS!`);
    } catch (e: any) {
        console.log(`❌ Simulation Failed!`);
        console.log(`   Message: ${e.message}`);
        if (e.walk) {
            const cause = e.walk();
            console.log(`   Cause:`, cause);
        }
        if (e.data) console.log(`   Data: ${e.data}`);
    }

}
main().catch(console.error);
