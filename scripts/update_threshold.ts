import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
// const FLASH_LIQUIDATOR = process.env.FLASH_LIQUIDATOR_ADDRESS;
const FLASH_LIQUIDATOR = '0x044106147ba2252118d6ca21a55f83575b581a4d'; // New Deployment
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const FLASH_LIQUIDATOR_ABI = [
    {
        "inputs": [
            { "internalType": "uint256", "name": "_newThreshold", "type": "uint256" }
        ],
        "name": "setMinProfitThreshold",
        "outputs": [],
        "stateMutability": "nonpayable",
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
    if (!FLASH_LIQUIDATOR || !PRIVATE_KEY) {
        throw new Error('Missing Config');
    }

    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const wallet = createWalletClient({
        account,
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`🔐 Account: ${account.address}`);
    console.log(`📝 Contract: ${FLASH_LIQUIDATOR}`);

    // Check current
    const current = await client.readContract({
        address: FLASH_LIQUIDATOR as `0x${string}`,
        abi: FLASH_LIQUIDATOR_ABI,
        functionName: 'minProfitThreshold'
    });
    console.log(`📉 Current Threshold: ${current} (${formatUnits(current, 6)} USDC)`);

    const NEW_THRESHOLD = 100n; // 0.0001 USDC
    console.log(`🔄 Updating to: ${NEW_THRESHOLD} (${formatUnits(NEW_THRESHOLD, 6)} USDC)...`);

    const hash = await wallet.writeContract({
        address: FLASH_LIQUIDATOR as `0x${string}`,
        abi: FLASH_LIQUIDATOR_ABI,
        functionName: 'setMinProfitThreshold',
        args: [NEW_THRESHOLD]
    });

    console.log(`🚀 Tx Sent: ${hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`✅ Transaction Confirmed in block ${receipt.blockNumber}`);

    // Verify
    const updated = await client.readContract({
        address: FLASH_LIQUIDATOR as `0x${string}`,
        abi: FLASH_LIQUIDATOR_ABI,
        functionName: 'minProfitThreshold'
    });
    console.log(`🎉 New Threshold: ${updated}`);
}

main().catch(console.error);
