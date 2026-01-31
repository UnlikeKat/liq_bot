import { ethers } from 'hardhat';
import { writeFileSync } from 'fs';

async function main() {
    console.log('🚀 Deploying Multi-Source FlashLiquidator...');

    const [deployer] = await ethers.getSigners();
    console.log(`   Deployer: ${deployer.address}`);
    console.log(`   Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

    const PROFIT_THRESHOLD = 1000000; // 1 USDC (6 decimals)
    const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // Universal Router Base

    const FlashLiquidator = await ethers.getContractFactory("FlashLiquidator");
    const contract = await FlashLiquidator.deploy(PROFIT_THRESHOLD, UNISWAP_ROUTER);

    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log(`\n✅ Contract Deployed at: ${address}`);
    console.log(`   Note: Please update .env FLASH_LIQUIDATOR_ADDRESS with this new address.`);

    // Save to file for easy reading
    writeFileSync('deployed_address.txt', address);
}

main().catch(console.error);
