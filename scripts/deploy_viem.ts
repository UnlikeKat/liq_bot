import { createWalletClient, createPublicClient, http, parseAbi, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';

config();

async function main() {
    console.log('🚀 Deploying Multi-Source FlashLiquidator (Viem)...');

    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    const client = createWalletClient({
        account,
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    const publicClient = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    console.log(`   Deployer: ${account.address}`);
    const balance = await publicClient.getBalance({ address: account.address });
    console.log(`   Balance: ${formatEther(balance)} ETH`);

    // Read Solc Artifacts
    const abi = JSON.parse(readFileSync('artifacts/src_FlashLiquidator_sol_FlashLiquidator.abi', 'utf8'));
    const bytecodeHex = '0x' + readFileSync('artifacts/src_FlashLiquidator_sol_FlashLiquidator.bin', 'utf8');

    // Constructor Args
    const PROFIT_THRESHOLD = 1000000n; // 1 USDC
    const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // Universal Router

    console.log('   📤 Sending Deployment Tx...');
    const hash = await client.deployContract({
        abi,
        bytecode: bytecodeHex as `0x${string}`,
        args: [PROFIT_THRESHOLD, UNISWAP_ROUTER],
    });

    console.log(`   Wait Tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.contractAddress) {
        console.log(`\n✅ Contract Deployed at: ${receipt.contractAddress}`);
        console.log(`   Note: Please update .env FLASH_LIQUIDATOR_ADDRESS`);
        writeFileSync('deployed_address.txt', receipt.contractAddress);
    } else {
        console.error('   ❌ Deployment Failed (No address returned)');
    }
}

main().catch(console.error);
