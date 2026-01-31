import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FLASH_LIQUIDATOR = process.env.FLASH_LIQUIDATOR_ADDRESS;
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // From previous log
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

const ERC20_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "owner", "type": "address" },
            { "internalType": "address", "name": "spender", "type": "address" }
        ],
        "name": "allowance",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

async function main() {
    if (!FLASH_LIQUIDATOR) throw new Error('No Contract Address');

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`🔐 Checking Allowances for Contract: ${FLASH_LIQUIDATOR}`);
    console.log(`Pool/Router: ${UNISWAP_ROUTER}`);

    // Check USDC
    const allowanceUSDC = await client.readContract({
        address: USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [FLASH_LIQUIDATOR as `0x${string}`, UNISWAP_ROUTER as `0x${string}`]
    });

    console.log(`\n💰 USDC Allowance: ${allowanceUSDC} (${formatUnits(allowanceUSDC, 6)})`);
    if (allowanceUSDC === 0n) {
        console.error('   ❌ CRITICAL: USDC Allowance is ZERO! Contract cannot swap collateral.');
    } else {
        console.log('   ✅ USDC Approved.');
    }

    // Check EURC
    const allowanceEURC = await client.readContract({
        address: EURC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [FLASH_LIQUIDATOR as `0x${string}`, UNISWAP_ROUTER as `0x${string}`]
    });

    console.log(`\n💶 EURC Allowance: ${allowanceEURC} (${formatUnits(allowanceEURC, 6)})`);
    if (allowanceEURC === 0n) {
        console.error('   ⚠️  EURC Allowance is ZERO!');
    } else {
        console.log('   ✅ EURC Approved.');
    }
}

main().catch(console.error);
