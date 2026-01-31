import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com'; // Fallback to verified public RPC
const ARTIFACT_PATH = path.join(process.cwd(), 'out', 'FlashLiquidator.sol', 'FlashLiquidator.json');

async function main() {
    console.log('🚀 Starting Deployment via Viem...');

    if (!process.env.PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY missing in .env');
        process.exit(1);
    }

    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    console.log(`👤 Deployer: ${account.address}`);

    const client = createWalletClient({
        account,
        chain: base,
        transport: http(RPC_URL)
    });

    const publicClient = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    // Load Artifact
    if (!fs.existsSync(ARTIFACT_PATH)) {
        console.error('❌ Artifact not found. Ensure "forge build" ran previously (artifacts exist in out/).');
        process.exit(1);
    }
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));

    // Deploy
    console.log('📦 Deploying FlashLiquidator...');
    const hash = await client.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object, // Foundry JSON structure
        args: [1000000n], // 1 USDC Profit Threshold
    });

    console.log(`📝 Transaction sent: ${hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.contractAddress) {
        console.log(`✅ DEPLOYMENT SUCCESS`);
        console.log(`📍 Contract Address: ${receipt.contractAddress}`);
        console.log(`\n👉 NEXT STEP: Update "FLASH_LIQUIDATOR_ADDRESS" in your .env file with this address.`);
    } else {
        console.log('❌ Deployment failed (No contract address returned)');
    }
}

main().catch(console.error);
