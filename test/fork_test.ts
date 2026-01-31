import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, formatEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from '../bot/config.js';
import { findBestLiquidationPair } from '../bot/executor.js';

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

// Detect if running on Windows
const IS_WINDOWS = process.platform === 'win32';

interface LiquidationEvent {
    blockNumber: string;
    transactionHash: string;
    user: string;
    liquidator: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: string;
}

interface ForkTestResult {
    testNumber: number;
    realLiquidation: {
        block: bigint;
        liquidator: string;
        victim: string;
        debtCovered: string;
        txHash: string;
    };
    forkTest: {
        forkStartBlock: bigint;
        botDetection: boolean;
        botHF: number | null;
        botExecutionBlock: bigint | null;
        botTxHash: string | null;
        status: 'SUCCESS' | 'FAILED' | 'REVERTED';
        gasUsed: bigint | null;
        assetsFound: { collateral: string, debt: string } | null;
        blockAdvantage: number;
        errorReason?: string;
    };
    comparison: 'BOT_WINS' | 'BOT_LOSES' | 'BOT_SAME' | 'BOT_FAILED';
}

class AnvilManager {
    private process: ChildProcess | null = null;

    async start(forkUrl: string, blockNumber: bigint): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`🔧 Starting Anvil fork at block ${blockNumber}...`);

            // On Windows, run anvil via WSL
            const anvilCmd = IS_WINDOWS
                ? 'wsl'
                : 'anvil';

            const anvilArgs = IS_WINDOWS
                ? ['bash', '-c', `export PATH="$HOME/.foundry/bin:$PATH" && anvil --fork-url ${forkUrl} --fork-block-number ${blockNumber.toString()} --port ${ANVIL_PORT} --accounts 1 --balance 10000 --silent`]
                : [
                    '--fork-url', forkUrl,
                    '--fork-block-number', blockNumber.toString(),
                    '--port', ANVIL_PORT.toString(),
                    '--accounts', '1',
                    '--balance', '10000',
                    '--silent'
                ];

            this.process = spawn(anvilCmd, anvilArgs);

            let started = false;

            this.process.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                if (output.includes('Listening on') && !started) {
                    started = true;
                    console.log(`✅ Anvil started on port ${ANVIL_PORT}`);
                    setTimeout(() => resolve(), 1000);
                }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                // Anvil outputs to stderr even for normal logs
                const output = data.toString();
                if (output.includes('Listening on') && !started) {
                    started = true;
                    console.log(`✅ Anvil started on port ${ANVIL_PORT}`);
                    setTimeout(() => resolve(), 1000);
                }
            });

            this.process.on('error', (error: Error) => {
                reject(new Error(`Failed to start Anvil: ${error.message}`));
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!started) {
                    this.stop();
                    reject(new Error('Anvil failed to start within 30 seconds'));
                }
            }, 30000);
        });
    }

    stop(): void {
        if (this.process) {
            console.log('🛑 Stopping Anvil...');
            this.process.kill('SIGTERM');
            this.process = null;
        }
    }
}

const FLASH_LIQUIDATOR_ABI = [
    {
        type: 'function',
        name: 'executeLiquidation',
        inputs: [
            { name: 'collateralAsset', type: 'address' },
            { name: 'debtAsset', type: 'address' },
            { name: 'user', type: 'address' },
            { name: 'debtToCover', type: 'uint256' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    }
] as const;

const AAVE_POOL_ABI = [
    {
        type: 'function',
        name: 'getUserAccountData',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ],
        stateMutability: 'view'
    }
] as const;

async function testLiquidationOnFork(
    event: LiquidationEvent,
    testNumber: number
): Promise<ForkTestResult> {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n;
    const blockN1 = blockN - 1n;

    const result: ForkTestResult = {
        testNumber,
        realLiquidation: {
            block: blockN,
            liquidator: event.liquidator,
            victim: event.user,
            debtCovered: event.debtToCover,
            txHash: event.transactionHash
        },
        forkTest: {
            forkStartBlock: blockN3,
            botDetection: false,
            botHF: null,
            botExecutionBlock: null,
            botTxHash: null,
            status: 'FAILED',
            gasUsed: null,
            assetsFound: null,
            blockAdvantage: 0
        },
        comparison: 'BOT_FAILED'
    };

    const anvil = new AnvilManager();

    try {
        // Start Anvil fork at block N-3
        await anvil.start(CONFIG.RPC_URL_PREMIUM, blockN3);

        // Create clients for fork
        const forkClient = createPublicClient({
            chain: base,
            transport: http(ANVIL_RPC)
        });

        const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);
        const forkWallet = createWalletClient({
            account,
            chain: base,
            transport: http(ANVIL_RPC)
        });

        // Check bot can detect opportunity
        const accountData = await forkClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [event.user as `0x${string}`]
        });

        const hf = Number(formatUnits(accountData[5], 18));
        result.forkTest.botHF = hf;
        result.forkTest.botDetection = hf < CONFIG.BOT.DISCOVERY_THRESHOLD;

        if (!result.forkTest.botDetection) {
            result.forkTest.errorReason = `HF ${hf.toFixed(4)} not in detection range`;
            return result;
        }

        // Mine blocks to get to N-1
        await forkClient.request({
            method: 'anvil_mine' as any,
            params: ['0x2'] // Mine 2 blocks (hex)
        });

        // Discover assets
        const assets = await findBestLiquidationPair(event.user);
        result.forkTest.assetsFound = assets;

        if (!assets) {
            result.forkTest.errorReason = 'Asset discovery failed';
            return result;
        }

        // Execute liquidation on fork
        console.log(`   💫 Executing liquidation on fork...`);
        const txHash = await forkWallet.writeContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [
                assets.collateral as `0x${string}`,
                assets.debt as `0x${string}`,
                event.user as `0x${string}`,
                parseUnits('100', 6) // Small amount for testing
            ]
        });

        result.forkTest.botTxHash = txHash;

        // Wait for transaction
        const receipt = await forkClient.waitForTransactionReceipt({ hash: txHash });
        result.forkTest.gasUsed = receipt.gasUsed;
        result.forkTest.botExecutionBlock = receipt.blockNumber;

        if (receipt.status === 'success') {
            result.forkTest.status = 'SUCCESS';

            // Calculate block advantage
            const botBlock = Number(receipt.blockNumber);
            const realBlock = Number(blockN);
            result.forkTest.blockAdvantage = realBlock - botBlock;

            if (botBlock < realBlock) {
                result.comparison = 'BOT_WINS';
            } else if (botBlock === realBlock) {
                result.comparison = 'BOT_SAME';
            } else {
                result.comparison = 'BOT_LOSES';
            }
        } else {
            result.forkTest.status = 'REVERTED';
            result.forkTest.errorReason = 'Transaction reverted';
        }

    } catch (error: any) {
        result.forkTest.status = 'FAILED';
        result.forkTest.errorReason = error.shortMessage || error.message || 'Unknown error';
    } finally {
        anvil.stop();
    }

    return result;
}

function formatResult(result: ForkTestResult): string {
    const { realLiquidation, forkTest, comparison } = result;

    let output = '';
    output += `\n${'='.repeat(80)}\n`;
    output += `=== LIQUIDATION TEST #${result.testNumber} ===\n`;
    output += `${'='.repeat(80)}\n\n`;

    output += `📍 REAL LIQUIDATION:\n`;
    output += `   Block: ${realLiquidation.block}\n`;
    output += `   Liquidator: ${realLiquidation.liquidator}\n`;
    output += `   Victim: ${realLiquidation.victim}\n`;
    output += `   Debt Covered: ${realLiquidation.debtCovered}\n`;
    output += `   Tx Hash: ${realLiquidation.txHash}\n\n`;

    output += `🧪 FORK TEST RESULTS:\n`;
    output += `   Fork Started: Block ${forkTest.forkStartBlock} (N-3)\n`;
    output += `   Bot Detection: ${forkTest.botDetection ? '✅' : '❌'} ${forkTest.botHF ? `(HF: ${forkTest.botHF.toFixed(4)})` : ''}\n`;

    if (forkTest.assetsFound) {
        output += `   Assets Found:\n`;
        output += `     - Collateral: ${forkTest.assetsFound.collateral}\n`;
        output += `     - Debt: ${forkTest.assetsFound.debt}\n`;
    }

    if (forkTest.botTxHash) {
        output += `   Bot Execution Block: ${forkTest.botExecutionBlock} (N-1)\n`;
        output += `   Transaction Hash (Fork): ${forkTest.botTxHash}\n`;
        output += `   Status: ${forkTest.status === 'SUCCESS' ? '✅' : '❌'} ${forkTest.status}\n`;
        output += `   Gas Used: ${forkTest.gasUsed ? forkTest.gasUsed.toString() : 'N/A'}\n`;
        output += `   Block Advantage: ${forkTest.blockAdvantage} ${forkTest.blockAdvantage > 0 ? '(Bot faster)' : forkTest.blockAdvantage < 0 ? '(Bot slower)' : '(Same block)'}\n`;
    }

    if (forkTest.errorReason) {
        output += `   Error: ${forkTest.errorReason}\n`;
    }

    output += `\n🏆 COMPARISON: `;
    switch (comparison) {
        case 'BOT_WINS':
            output += `✅ BOT WINS (executed ${forkTest.blockAdvantage} blocks faster)\n`;
            break;
        case 'BOT_LOSES':
            output += `❌ BOT LOSES (executed ${Math.abs(forkTest.blockAdvantage)} blocks slower)\n`;
            break;
        case 'BOT_SAME':
            output += `⚡ BOT TIED (same block)\n`;
            break;
        case 'BOT_FAILED':
            output += `💀 BOT FAILED (${forkTest.errorReason})\n`;
            break;
    }

    output += `\n`;

    return output;
}

async function main() {
    console.log('🎯 FORK-BASED LIQUIDATION TESTING\n');
    console.log('This will create real Anvil forks and execute bot transactions.\n');
    console.log(`Platform: ${IS_WINDOWS ? 'Windows (via WSL)' : 'Linux/Mac'}\n`);

    // Create results directory
    if (!existsSync('./test/results')) {
        mkdirSync('./test/results', { recursive: true });
    }

    // Load liquidations
    const liquidations: LiquidationEvent[] = JSON.parse(
        readFileSync('./data/liquidations_7d.json', 'utf8')
    );

    console.log(`📊 Total Liquidations: ${liquidations.length}`);
    console.log(`⏱️  Estimated Time: ~${Math.ceil(liquidations.length * 45 / 60)} minutes\n`);
    console.log('⚠️  Note: Each test takes ~30-45 seconds (Anvil startup + execution)\n');

    const MAX_TESTS = 10; // Limit for initial run
    const testsToRun = liquidations.slice(0, MAX_TESTS);

    console.log(`Running first ${MAX_TESTS} tests...\n`);

    const results: ForkTestResult[] = [];
    let outputFile = '';

    for (let i = 0; i < testsToRun.length; i++) {
        const event = testsToRun[i];
        console.log(`\n[${i + 1}/${testsToRun.length}] Testing block ${event.blockNumber}...`);

        const result = await testLiquidationOnFork(event, i + 1);
        results.push(result);

        // Format and append to output
        const resultText = formatResult(result);
        outputFile += resultText;
        console.log(resultText);

        // Save incrementally
        writeFileSync('./test/results/fork_test_results.txt', outputFile);
    }

    // Generate summary
    const wins = results.filter(r => r.comparison === 'BOT_WINS').length;
    const losses = results.filter(r => r.comparison === 'BOT_LOSES').length;
    const ties = results.filter(r => r.comparison === 'BOT_SAME').length;
    const failures = results.filter(r => r.comparison === 'BOT_FAILED').length;

    const summary = `
${'='.repeat(80)}
SUMMARY
${'='.repeat(80)}

Total Tests: ${results.length}
✅ Bot Wins: ${wins} (${(wins / results.length * 100).toFixed(1)}%)
❌ Bot Losses: ${losses} (${(losses / results.length * 100).toFixed(1)}%)
⚡ Bot Ties: ${ties} (${(ties / results.length * 100).toFixed(1)}%)
💀 Bot Failures: ${failures} (${(failures / results.length * 100).toFixed(1)}%)

Average Block Advantage: ${(results.reduce((sum, r) => sum + r.forkTest.blockAdvantage, 0) / results.length).toFixed(2)} blocks

Success Rate: ${((wins + ties) / results.length * 100).toFixed(1)}%
`;

    outputFile += summary;
    console.log(summary);

    writeFileSync('./test/results/fork_test_results.txt', outputFile);
    console.log(`\n💾 Full results saved to: test/results/fork_test_results.txt`);
}

main().catch(console.error);
