const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const CONFIG = {
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    DISCOVERY_THRESHOLD: 1.1,
};

const AAVE_POOL_ABI = [
    'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

const FLASH_LIQUIDATOR_ABI = [
    'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover)'
];

async function testLiquidation(event, testNumber, totalTests) {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${testNumber}/${totalTests}] Testing Block ${event.blockNumber}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`Victim: ${event.user}`);
    console.log(`Real Liquidator: ${event.liquidator}`);
    console.log(`Real Tx: ${event.transactionHash}`);

    try {
        console.log(`\n🔧 Forking to block ${blockN3} (N-3)...`);

        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    jsonRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
                    blockNumber: Number(blockN3)
                }
            }]
        });

        console.log(`✅ Fork active`);

        // Check health factor
        const pool = await ethers.getContractAt(AAVE_POOL_ABI, CONFIG.AAVE_POOL);
        const accountData = await pool.getUserAccountData(event.user);
        const hf = Number(accountData.healthFactor) / 1e18;

        console.log(`💊 Health Factor: ${hf.toFixed(4)}`);

        if (hf >= CONFIG.DISCOVERY_THRESHOLD) {
            console.log(`⚠️  HF too high (${hf.toFixed(4)} >= ${CONFIG.DISCOVERY_THRESHOLD})`);
            return {
                success: false,
                reason: 'HF above threshold',
                hf,
                block: blockN3.toString()
            };
        }

        // Mine 2 blocks to N-1
        console.log(`⛏️  Mining 2 blocks to N-1...`);
        await hre.network.provider.send("hardhat_mine", ["0x2"]);

        // Execute liquidation
        console.log(`💫 Executing liquidation...`);
        const [signer] = await ethers.getSigners();
        const liquidator = await ethers.getContractAt(FLASH_LIQUIDATOR_ABI, CONFIG.FLASH_LIQUIDATOR);

        const tx = await liquidator.connect(signer).executeLiquidation(
            event.collateralAsset,
            event.debtAsset,
            event.user,
            ethers.parseUnits('100', 6),
            { gasLimit: 5000000 }
        );

        const receipt = await tx.wait();

        console.log(`✅ SUCCESS!`);
        console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(`   Bot Tx: ${receipt.hash}`);
        console.log(`   🏆 BOT WINS (executed before real liquidator at block ${blockN})`);

        return {
            success: true,
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
            hf,
            block: blockN3.toString(),
            realBlock: blockN.toString()
        };

    } catch (error) {
        const errorMsg = error.message?.slice(0, 150) || error.toString().slice(0, 150);
        console.log(`❌ FAILED: ${errorMsg}`);

        return {
            success: false,
            reason: errorMsg,
            block: blockN3.toString()
        };
    }
}

async function main() {
    console.log('🎯 HARDHAT FORK TESTING');
    console.log('='.repeat(70));
    console.log('Testing bot liquidation execution on forked Base mainnet\n');

    // Create results directory
    const resultsDir = path.join(__dirname, 'test', 'results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Load liquidations
    const liquidationsPath = path.join(__dirname, 'data', 'liquidations_recent.json');
    const liquidations = JSON.parse(fs.readFileSync(liquidationsPath, 'utf8'));

    const MAX_TESTS = 10;
    const testsToRun = liquidations.slice(0, Math.min(MAX_TESTS, liquidations.length));

    console.log(`📊 Total liquidations to test: ${testsToRun.length}\n`);

    const results = [];

    for (let i = 0; i < testsToRun.length; i++) {
        const result = await testLiquidation(testsToRun[i], i + 1, testsToRun.length);
        results.push({
            ...result,
            event: testsToRun[i]
        });
    }

    // Summary
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    console.log(`\n${'='.repeat(70)}`);
    console.log('FINAL SUMMARY');
    console.log(`${'='.repeat(70)}`);
    console.log(`✅ Successful Liquidations: ${successes}/${results.length} (${(successes / results.length * 100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failures}`);

    if (successes > 0) {
        const avgGas = results
            .filter(r => r.success)
            .reduce((sum, r) => sum + BigInt(r.gasUsed), 0n) / BigInt(successes);
        console.log(`⛽ Average Gas: ${avgGas.toString()}`);
    }

    // Save results
    const outputPath = path.join(resultsDir, 'hardhat_fork_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Detailed results saved to: ${outputPath}`);

    // Create text summary
    let textOutput = '';
    results.forEach((r, i) => {
        textOutput += `\nTest #${i + 1}: ${r.success ? '✅ SUCCESS' : '❌ FAILED'}\n`;
        textOutput += `  Block: ${r.block}\n`;
        textOutput += `  HF: ${r.hf?.toFixed(4) || 'N/A'}\n`;
        if (r.success) {
            textOutput += `  Gas: ${r.gasUsed}\n`;
            textOutput += `  Tx: ${r.txHash}\n`;
        } else {
            textOutput += `  Reason: ${r.reason}\n`;
        }
    });

    const textPath = path.join(resultsDir, 'hardhat_fork_results.txt');
    fs.writeFileSync(textPath, textOutput);
    console.log(`📄 Summary saved to: ${textPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
