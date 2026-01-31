import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from 'dotenv';

config();

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const IS_WINDOWS = process.platform === 'win32';

const CONFIG = {
    RPC_URL_PREMIUM: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    AAVE_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    DISCOVERY_THRESHOLD: 1.1,
    LIQUIDATION_THRESHOLD: 1.0,
};

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

            const anvilCmd = IS_WINDOWS ? 'wsl' : 'anvil';
            const anvilArgs = IS_WINDOWS
                ? ['bash', '-c', `export PATH="$HOME/.foundry/bin:$PATH" && anvil --fork-url ${forkUrl} --fork-block-number ${blockNumber.toString()} --port ${ANVIL_PORT} --accounts 1 --balance 10000 --silent`]
                : ['--fork-url', forkUrl, '--fork-block-number', blockNumber.toString(), '--port', ANVIL_PORT.toString(), '--accounts', '1', '--balance', '10000', '--silent'];

            this.process = spawn(anvilCmd, anvilArgs);
            let started = false;

            this.process.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                if (output.includes('Listening on') && !started) {
                    started = true;
                    console.log(`✅ Anvil started on port ${ANVIL_PORT}`);
                    setTimeout(() => resolve(), 1500);
                }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                if (output.includes('Listening on') && !started) {
                    started = true;
                    console.log(`✅ Anvil started on port ${ANVIL_PORT}`);
                    setTimeout(() => resolve(), 1500);
                }
            });

            this.process.on('error', (error: Error) => {
                reject(new Error(`Failed to start Anvil: ${error.message}`));
            });
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
        type: 'function', name: 'executeLiquidation', inputs: [
            { name: 'collateralAsset', type: 'address' },
            { name: 'debtAsset', type: 'address' },
            { name: 'user', type: 'address' },
            { name: 'debtToCover', type: 'uint256' }
        ], outputs: [], stateMutability: 'nonpayable'
    }
] as const;

const AAVE_POOL_ABI = [
    {
        type: 'function', name: 'getUserAccountData', inputs: [{ name: 'user', type: 'address' }], outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ], stateMutability: 'view'
    }
] as const;

const DATA_PROVIDER_ABI = [
    { type: 'function', name: 'getAllReservesTokens', inputs: [], outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'symbol', type: 'string' }, { name: 'tokenAddress', type: 'address' }] }], stateMutability: 'view' },
    {
        type: 'function', name: 'getUserReserveData', inputs: [{ name: 'asset', type: 'address' }, { name: 'user', type: 'address' }], outputs: [
            { name: 'currentATokenBalance', type: 'uint256' },
            { name: 'currentStableDebt', type: 'uint256' },
            { name: 'currentVariableDebt', type: 'uint256' },
            { name: 'principalStableDebt', type: 'uint256' },
            { name: 'scaledVariableDebt', type: 'uint256' },
            { name: 'stableBorrowRate', type: 'uint256' },
            { name: 'liquidityRate', type: 'uint256' },
            { name: 'stableRateLastUpdated', type: 'uint40' },
            { name: 'usageAsCollateralEnabled', type: 'bool' }
        ], stateMutability: 'view'
    }
] as const;

async function findBestLiquidationPair(user: string, forkClient: any): Promise<{ collateral: string, debt: string } | null> {
    try {
        const tokens = await forkClient.readContract({
            address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
            abi: DATA_PROVIDER_ABI,
            functionName: 'getAllReservesTokens',
        });

        let maxCollateral = { address: '', value: 0n };
        let maxDebt = { address: '', value: 0n };

        const reserveResults = await forkClient.multicall({
            contracts: tokens.map((token: any) => ({
                address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
                abi: DATA_PROVIDER_ABI,
                functionName: 'getUserReserveData',
                args: [token.tokenAddress, user as `0x${string}`]
            }))
        });

        reserveResults.forEach((res: any, index: number) => {
            if (res.status === 'success') {
                const tokenAddress = tokens[index].tokenAddress;
                const result = res.result as unknown as any[];
                const aBalance = result[0] as bigint;
                const vDebt = result[2] as bigint;

                if (aBalance > maxCollateral.value) {
                    maxCollateral = { address: tokenAddress, value: aBalance };
                }

                if (vDebt > maxDebt.value) {
                    maxDebt = { address: tokenAddress, value: vDebt };
                }
            }
        });

        if (!maxCollateral.address || !maxDebt.address) return null;

        console.log(`   🔎 Found: ${maxCollateral.address.slice(0, 8)}/${maxDebt.address.slice(0, 8)}`);
        return { collateral: maxCollateral.address, debt: maxDebt.address };

    } catch (e) {
        console.error(`   ❌ Asset discovery failed:`, e);
        return null;
    }
}

async function testLiquidationOnFork(event: LiquidationEvent, testNumber: number): Promise<ForkTestResult> {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n;

    const result: ForkTestResult = {
        testNumber,
        realLiquidation: { block: blockN, liquidator: event.liquidator, victim: event.user, debtCovered: event.debtToCover, txHash: event.transactionHash },
        forkTest: { forkStartBlock: blockN3, botDetection: false, botHF: null, botExecutionBlock: null, botTxHash: null, status: 'FAILED', gasUsed: null, assetsFound: null, blockAdvantage: 0 },
        comparison: 'BOT_FAILED'
    };

    const anvil = new AnvilManager();

    try {
        await anvil.start(CONFIG.RPC_URL_PREMIUM, blockN3);

        const forkClient = createPublicClient({ chain: base, transport: http(ANVIL_RPC) });
        const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);
        const forkWallet = createWalletClient({ account, chain: base, transport: http(ANVIL_RPC) });

        const accountData = await forkClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [event.user as `0x${string}`]
        });

        const hf = Number(formatUnits(accountData[5], 18));
        result.forkTest.botHF = hf;
        result.forkTest.botDetection = hf < CONFIG.DISCOVERY_THRESHOLD;

        if (!result.forkTest.botDetection) {
            result.forkTest.errorReason = `HF ${hf.toFixed(4)} not in detection range`;
            return result;
        }

        await forkClient.request({ method: 'anvil_mine' as any, params: ['0x2'] });

        const assets = await findBestLiquidationPair(event.user, forkClient);
        result.forkTest.assetsFound = assets;

        if (!assets) {
            result.forkTest.errorReason = 'Asset discovery failed';
            return result;
        }

        console.log(`   💫 Executing liquidation...`);
        const txHash = await forkWallet.writeContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [assets.collateral as `0x${string}`, assets.debt as `0x${string}`, event.user as `0x${string}`, parseUnits('100', 6)]
        });

        result.forkTest.botTxHash = txHash;
        const receipt = await forkClient.waitForTransactionReceipt({ hash: txHash });
        result.forkTest.gasUsed = receipt.gasUsed;
        result.forkTest.botExecutionBlock = receipt.blockNumber;

        if (receipt.status === 'success') {
            result.forkTest.status = 'SUCCESS';
            const botBlock = Number(receipt.blockNumber);
            const realBlock = Number(blockN);
            result.forkTest.blockAdvantage = realBlock - botBlock;
            result.comparison = botBlock < realBlock ? 'BOT_WINS' : (botBlock === realBlock ? 'BOT_SAME' : 'BOT_LOSES');
        } else {
            result.forkTest.status = 'REVERTED';
            result.forkTest.errorReason = 'Transaction reverted';
        }

    } catch (error: any) {
        result.forkTest.status = 'FAILED';
        result.forkTest.errorReason = error.shortMessage || error.message || 'Unknown error';
    } finally {
        anvil.stop();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for Anvil to fully stop
    }

    return result;
}

function formatResult(result: ForkTestResult): string {
    const { realLiquidation, forkTest, comparison } = result;
    let output = `\n${'='.repeat(80)}\n=== TEST #${result.testNumber} ===\n${'='.repeat(80)}\n\n`;
    output += `📍 REAL: Block ${realLiquidation.block} | ${realLiquidation.liquidator.slice(0, 10)} → ${realLiquidation.victim.slice(0, 10)}\n`;
    output += `   Tx: ${realLiquidation.txHash}\n\n`;
    output += `🧪 FORK: Started ${forkTest.forkStartBlock} | Detection ${forkTest.botDetection ? '✅' : '❌'} (HF: ${forkTest.botHF?.toFixed(4)})\n`;
    if (forkTest.assetsFound) output += `   Assets: ${forkTest.assetsFound.collateral.slice(0, 8)}/${forkTest.assetsFound.debt.slice(0, 8)}\n`;
    if (forkTest.botTxHash) {
        output += `   Execution Block: ${forkTest.botExecutionBlock} | Status: ${forkTest.status}\n`;
        output += `   Gas: ${forkTest.gasUsed?.toString()} | Advantage: ${forkTest.blockAdvantage} blocks\n`;
    }
    if (forkTest.errorReason) output += `   Error: ${forkTest.errorReason}\n`;
    output += `\n🏆 ${comparison === 'BOT_WINS' ? '✅ BOT WINS' : (comparison === 'BOT_SAME' ? '⚡ TIE' : (comparison === 'BOT_LOSES' ? '❌ BOT LOSES' : '💀 FAILED'))}\n\n`;
    return output;
}

async function main() {
    console.log('🎯 FORK-BASED TESTING (Recent Liquidations)\n');
    console.log('⚙️  No timeout - Anvil can take as long as needed\n');
    if (!existsSync('./test/results')) mkdirSync('./test/results', { recursive: true });

    const liquidations: LiquidationEvent[] = JSON.parse(readFileSync('./data/liquidations_recent.json', 'utf8'));
    const MAX_TESTS = 10; // Test all recent liquidations
    const testsToRun = liquidations.slice(0, MAX_TESTS);

    console.log(`Testing ${MAX_TESTS} of ${liquidations.length} liquidations...\n`);

    const results: ForkTestResult[] = [];
    let outputFile = '';

    for (let i = 0; i < testsToRun.length; i++) {
        console.log(`\n[${i + 1}/${testsToRun.length}] Block ${testsToRun[i].blockNumber}...`);
        const result = await testLiquidationOnFork(testsToRun[i], i + 1);
        results.push(result);
        const resultText = formatResult(result);
        outputFile += resultText;
        console.log(resultText);
        writeFileSync('./test/results/fork_test_results.txt', outputFile);
    }

    const wins = results.filter(r => r.comparison === 'BOT_WINS').length;
    const losses = results.filter(r => r.comparison === 'BOT_LOSES').length;
    const ties = results.filter(r => r.comparison === 'BOT_SAME').length;
    const failures = results.filter(r => r.comparison === 'BOT_FAILED').length;

    const summary = `\n${'='.repeat(80)}\nSUMMARY\n${'='.repeat(80)}\n\nTotal: ${results.length}\n✅ Wins: ${wins} (${(wins / results.length * 100).toFixed(1)}%)\n❌ Losses: ${losses}\n⚡ Ties: ${ties}\n💀 Failures: ${failures}\n\nSuccess Rate: ${((wins + ties) / results.length * 100).toFixed(1)}%\n`;

    outputFile += summary;
    console.log(summary);
    writeFileSync('./test/results/fork_test_results.txt', outputFile);
    console.log(`\n💾 Results: test/results/fork_test_results.txt`);
}

main().catch(console.error);
