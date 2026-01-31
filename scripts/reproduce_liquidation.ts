import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';

config();

const TARGET_TX = '0x0e9d701c8896eec65210309d4f977b2915eb2c6f87dbb2a57431f5dcc0195a93';
const TARGET_BLOCK_NUMBER = 41474052n;
const FORK_BLOCK_NUMBER = TARGET_BLOCK_NUMBER - 1n;

const TARGET_USER = '0xfA5F8396Cd2eC4DeB0b71f5499a7f33ABFE77777';
const COLLATERAL_ASSET = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const DEBT_ASSET = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'; // EURC
const DEBT_TO_COVER_AMT = 16233.93;
const DEBT_DECIMALS = 6;
// Our Contract (NEW)
const FLASH_LIQUIDATOR = '0x4a05cbc4aa8d6554647c49720ef567867c8a508f';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// ABIs
const FLASH_LIQUIDATOR_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "collateralAsset", "type": "address" },
            { "internalType": "address", "name": "debtAsset", "type": "address" },
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "uint256", "name": "debtToCover", "type": "uint256" },
            { "internalType": "uint8", "name": "source", "type": "uint8" },
            { "internalType": "address", "name": "flashPool", "type": "address" }
        ],
        "name": "executeLiquidation",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    // 1. Check Balancer Vault Liquidity for EURC
    console.log(`\n🔍 Checking Balancer Vault Liquidity (at Block ${FORK_BLOCK_NUMBER})...`);

    // ERC20 balanceOf(vault)
    const liquidity = await client.readContract({
        address: DEBT_ASSET as `0x${string}`,
        abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
        functionName: 'balanceOf',
        args: [BALANCER_VAULT],
        blockNumber: FORK_BLOCK_NUMBER
    });

    const formattedLiq = formatUnits(liquidity as bigint, DEBT_DECIMALS);
    console.log(`   🏦 Vault EURC Balance: ${formattedLiq}`);
    console.log(`   💰 Required: ${DEBT_TO_COVER_AMT}`);

    // 2. Logic: EURC Price ~ $1.00
    const PRICE = 1;
    const usdValue = Number(formattedLiq) * PRICE;

    console.log(`   💵 Balancer Liq Value: $${usdValue.toFixed(2)}`);

    let FLASH_SOURCE = 0; // Default: Balancer
    let FLASH_POOL = '0x0000000000000000000000000000000000000000'; // Default

    if (usdValue < 10000) {
        console.warn(`   ⚠️ Balancer Liquidity < $10,000 Threshold. Switching Source...`);
        FLASH_SOURCE = 1; // Uniswap
        FLASH_POOL = '0x7279c08A36333e12c3Fc81747963264c100D66fB'; // EURC/USDC 0.05%
        console.log(`   ➡️ New Source: Uniswap V3 (Pool: ${FLASH_POOL})`);
    } else {
        console.log(`   ✅ Balancer Liquidity Sufficient (> $10k). Using Source 0.`);
    }

    // 3. Simulate Execution
    const sourceLabel = FLASH_SOURCE === 0 ? 'Balancer' : 'Uniswap V3';
    console.log(`\n🤖 Simulating Bot Execution (${sourceLabel})...`);

    // Config for Uniswap Source
    const debtToCover = parseUnits(DEBT_TO_COVER_AMT.toString(), DEBT_DECIMALS);

    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

    try {
        const { request, result } = await client.simulateContract({
            address: FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [
                COLLATERAL_ASSET as `0x${string}`,
                DEBT_ASSET as `0x${string}`,
                TARGET_USER as `0x${string}`,
                debtToCover,
                FLASH_SOURCE,
                FLASH_POOL
            ],
            account: account,
            blockNumber: FORK_BLOCK_NUMBER // Simulate AT this block
        });

        console.log(`\n✨ SIMULATION SUCCESS!`);
        console.log(`   Gas Estimate: ${request.gas}`);
        console.log(`   ✅ Bot logic (Monitor + Switch) would have SUCCEEDED.`);

    } catch (error: any) {
        console.error(`\n❌ SIMULATION FAILED:`);
        if (error.reason) console.error(`   Reason: ${error.reason}`);
        if (error.shortMessage) console.error(`   Message: ${error.shortMessage}`);
    }
}

main().catch(console.error);
