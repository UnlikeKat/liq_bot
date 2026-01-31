import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FLASH_LIQUIDATOR = process.env.FLASH_LIQUIDATOR_ADDRESS;

if (!FLASH_LIQUIDATOR) {
    throw new Error('Missing FLASH_LIQUIDATOR_ADDRESS');
}

const ABI = [
    {
        "inputs": [],
        "name": "POOL_FEE",
        "outputs": [{ "internalType": "uint24", "name": "", "type": "uint24" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "UNISWAP_ROUTER",
        "outputs": [{ "internalType": "contract ISwapRouter", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "minProfitThreshold",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`📝 Checking Config on: ${FLASH_LIQUIDATOR}`);

    const [poolFee, router, minProfit] = await Promise.all([
        client.readContract({ address: FLASH_LIQUIDATOR as `0x${string}`, abi: ABI, functionName: 'POOL_FEE' }),
        client.readContract({ address: FLASH_LIQUIDATOR as `0x${string}`, abi: ABI, functionName: 'UNISWAP_ROUTER' }),
        client.readContract({ address: FLASH_LIQUIDATOR as `0x${string}`, abi: ABI, functionName: 'minProfitThreshold' })
    ]);

    console.log(`   🔢 POOL_FEE: ${poolFee} (${poolFee / 10000}%)`);
    console.log(`   🛣️  ROUTER: ${router}`);
    console.log(`   💰 Min Profit: ${minProfit}`);

    if (poolFee === 3000) console.log('      (0.3% Fee Tier)');
    if (poolFee === 500) console.log('      (0.05% Fee Tier)');
    if (poolFee === 100) console.log('      (0.01% Fee Tier)');
}

main().catch(console.error);
