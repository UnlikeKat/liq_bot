import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { ethers } from 'hardhat';

const CONFIG = {
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    AAVE_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    DISCOVERY_THRESHOLD: 1.1,
};

const FLASH_LIQUIDATOR_ABI = [
    'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover)'
];

const AAVE_POOL_ABI = [
    'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

async function testLiquidation(event: any, testNumber: number) {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n;

    console.log(`\n[${testNumber}/10] Testing block ${event.blockNumber}...`);
    console.log(`🔧 Resetting fork to block ${blockN3}...`);

    // Reset fork to specific block
    await ethers.provider.send("hardhat_reset", [{
        forking: {
            jsonRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
            blockNumber: Number(blockN3)
        }
    }]);

    console.log(`✅ Fork active at block ${blockN3}`);

    // Get user health factor
    const pool = await ethers.getContractAt(AAVE_POOL_ABI, CONFIG.AAVE_POOL);
    const accountData = await pool.getUserAccountData(event.user);
    const hf = Number(accountData.healthFactor) / 1e18;

    console.log(`   Health Factor: ${hf.toFixed(4)}`);

    if (hf >= CONFIG.DISCOVERY_THRESHOLD) {
        console.log(`   ❌ HF too high, skipping`);
        return { success: false, reason: 'HF above threshold' };
    }

    // Mine 2 blocks
    await ethers.provider.send("hardhat_mine", ["0x2"]);

    // Try to liquidate
    try {
        const [signer] = await ethers.getSigners();
        const liquidator = await ethers.getContractAt(FLASH_LIQUIDATOR_ABI, CONFIG.FLASH_LIQUIDATOR);

        console.log(`   💫 Executing liquidation...`);
        const tx = await liquidator.connect(signer).executeLiquidation(
            event.collateralAsset,
            event.debtAsset,
            event.user,
            ethers.parseUnits('100', 6)
        );

        const receipt = await tx.wait();
        console.log(`   ✅ SUCCESS! Gas: ${receipt.gasUsed.toString()}`);
        console.log(`   📍 Tx: ${receipt.hash}`);

        return { success: true, tx: receipt.hash, gasUsed: receipt.gasUsed.toString() };
    } catch (e: any) {
        console.log(`   ❌ Failed: ${e.message?.slice(0, 100)}`);
        return { success: false, reason: e.message };
    }
}

async function main() {
    console.log('🎯 HARDHAT FORK TESTING\n');

    if (!existsSync('./test/results')) mkdirSync('./test/results', { recursive: true });

    const liquidations = JSON.parse(readFileSync('./data/liquidations_recent.json', 'utf8'));
    const results: any[] = [];

    for (let i = 0; i < Math.min(10, liquidations.length); i++) {
        const result = await testLiquidation(liquidations[i], i + 1);
        results.push(result);
    }

    const successes = results.filter(r => r.success).length;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SUMMARY: ${successes}/${results.length} successful liquidations`);
    console.log(`${'='.repeat(60)}`);

    writeFileSync('./test/results/hardhat_results.json', JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to test/results/hardhat_results.json`);
}

main().catch(console.error);
