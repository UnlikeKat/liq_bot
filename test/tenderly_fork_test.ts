import axios from 'axios';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from 'dotenv';

config();

const CONFIG = {
    TENDERLY_ACCESS_KEY: process.env.TENDERLY_ACCESS_KEY || '',
    TENDERLY_ACCOUNT: process.env.TENDERLY_ACCOUNT || '',
    TENDERLY_PROJECT: process.env.TENDERLY_PROJECT || '',
    BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    AAVE_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    DISCOVERY_THRESHOLD: 1.1,
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

async function createTenderlyFork(blockNumber: number): Promise<{ forkId: string, rpcUrl: string }> {
    console.log(`🔧 Creating Tenderly fork at block ${blockNumber}...`);

    const response = await axios.post(
        `https://api.tenderly.co/api/v1/account/${CONFIG.TENDERLY_ACCOUNT}/project/${CONFIG.TENDERLY_PROJECT}/fork`,
        {
            network_id: '8453', // Base
            block_number: blockNumber,
            chain_config: {
                chain_id: 8453
            }
        },
        {
            headers: {
                'X-Access-Key': CONFIG.TENDERLY_ACCESS_KEY,
                'Content-Type': 'application/json'
            }
        }
    );

    const forkId = response.data.simulation_fork.id;
    const rpcUrl = `https://rpc.tenderly.co/fork/${forkId}`;

    console.log(`✅ Fork created: ${forkId}`);
    return { forkId, rpcUrl };
}

async function deleteTenderlyFork(forkId: string): Promise<void> {
    try {
        await axios.delete(
            `https://api.tenderly.co/api/v1/account/${CONFIG.TENDERLY_ACCOUNT}/project/${CONFIG.TENDERLY_PROJECT}/fork/${forkId}`,
            {
                headers: {
                    'X-Access-Key': CONFIG.TENDERLY_ACCESS_KEY
                }
            }
        );
        console.log(`🗑️  Fork deleted: ${forkId}`);
    } catch (e) {
        console.log(`⚠️  Failed to delete fork: ${forkId}`);
    }
}

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

        console.log(`   🔎 Assets: ${maxCollateral.address.slice(0, 8)}/${maxDebt.address.slice(0, 8)}`);
        return { collateral: maxCollateral.address, debt: maxDebt.address };

    } catch (e) {
        console.error(`   ❌ Asset discovery failed:`, e);
        return null;
    }
}

async function testLiquidationOnTenderlyFork(event: LiquidationEvent, testNumber: number) {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST #${testNumber} - Block ${event.blockNumber}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`📍 Real Liquidation:`);
    console.log(`   Victim: ${event.user}`);
    console.log(`   Liquidator: ${event.liquidator}`);
    console.log(`   Tx: ${event.transactionHash}`);

    let forkId = '';

    try {
        // Create Tenderly fork at N-3
        const fork = await createTenderlyFork(Number(blockN3));
        forkId = fork.forkId;

        const forkClient = createPublicClient({
            chain: base,
            transport: http(fork.rpcUrl)
        });

        const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);
        const forkWallet = createWalletClient({
            account,
            chain: base,
            transport: http(fork.rpcUrl)
        });

        // Check health factor
        const accountData = await forkClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [event.user as `0x${string}`]
        });

        const hf = Number(formatUnits(accountData[5], 18));
        console.log(`💊 Health Factor at N-3: ${hf.toFixed(4)}`);

        if (hf >= CONFIG.DISCOVERY_THRESHOLD) {
            console.log(`⚠️  HF too high - Bot wouldn't detect`);
            await deleteTenderlyFork(forkId);
            return { success: false, reason: 'HF above threshold', hf, detected: false };
        }

        console.log(`✅ Bot would detect (HF < ${CONFIG.DISCOVERY_THRESHOLD})`);

        // Discover assets
        const assets = await findBestLiquidationPair(event.user, forkClient);

        if (!assets) {
            console.log(`❌ Asset discovery failed`);
            await deleteTenderlyFork(forkId);
            return { success: false, reason: 'Asset discovery failed', hf, detected: true };
        }

        // Execute liquidation
        console.log(`💫 Executing bot liquidation...`);
        const txHash = await forkWallet.writeContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [assets.collateral as `0x${string}`, assets.debt as `0x${string}`, event.user as `0x${string}`, parseUnits('100', 6)]
        });

        const receipt = await forkClient.waitForTransactionReceipt({ hash: txHash });

        const botBlock = Number(receipt.blockNumber);
        const realBlock = Number(blockN);
        const blockAdvantage = realBlock - botBlock;

        console.log(`\n✅ SUCCESS!`);
        console.log(`   Bot Block: ${botBlock}`);
        console.log(`   Real Block: ${realBlock}`);
        console.log(`   Block Advantage: ${blockAdvantage} blocks`);
        console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(`   Status: ${receipt.status}`);

        if (blockAdvantage > 0) {
            console.log(`   🏆 BOT WINS!`);
        } else if (blockAdvantage === 0) {
            console.log(`   ⚡ TIE`);
        } else {
            console.log(`   ❌ BOT SLOWER`);
        }

        await deleteTenderlyFork(forkId);

        return {
            success: true,
            txHash,
            gasUsed: receipt.gasUsed.toString(),
            hf,
            detected: true,
            botBlock,
            realBlock,
            blockAdvantage,
            status: blockAdvantage > 0 ? 'WIN' : (blockAdvantage === 0 ? 'TIE' : 'LOSS')
        };

    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        console.log(`\n❌ FAILED: ${errorMsg.slice(0, 150)}`);

        if (forkId) {
            await deleteTenderlyFork(forkId);
        }

        return {
            success: false,
            reason: errorMsg,
            detected: true
        };
    }
}

async function main() {
    console.log('🎯 TENDERLY FORK TESTING');
    console.log('='.repeat(70));
    console.log('Testing bot execution on Tenderly forks\n');

    if (!CONFIG.TENDERLY_ACCESS_KEY) {
        console.error('❌ TENDERLY_ACCESS_KEY not set in .env');
        console.log('\nTo get a Tenderly API key:');
        console.log('1. Sign up at https://tenderly.co (free)');
        console.log('2. Go to Settings → Authorization');
        console.log('3. Generate Access Token');
        console.log('4. Add to .env: TENDERLY_ACCESS_KEY=your_key');
        console.log('5. Add to .env: TENDERLY_ACCOUNT=your_username');
        console.log('6. Add to .env: TENDERLY_PROJECT=your_project_name');
        process.exit(1);
    }

    const resultsDir = './test/results';
    if (!existsSync(resultsDir)) {
        mkdirSync(resultsDir, { recursive: true });
    }

    const liquidations: LiquidationEvent[] = JSON.parse(readFileSync('./data/liquidations_recent.json', 'utf8'));
    const MAX_TESTS = 5; // Start with 5
    const testsToRun = liquidations.slice(0, MAX_TESTS);

    console.log(`📊 Testing ${testsToRun.length} liquidations\n`);

    const results: any[] = [];

    for (let i = 0; i < testsToRun.length; i++) {
        const result = await testLiquidationOnTenderlyFork(testsToRun[i], i + 1);
        results.push({ testNumber: i + 1, ...result, event: testsToRun[i] });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between tests
    }

    // Summary
    const successes = results.filter(r => r.success).length;
    const wins = results.filter(r => r.status === 'WIN').length;
    const ties = results.filter(r => r.status === 'TIE').length;
    const losses = results.filter(r => r.status === 'LOSS').length;

    console.log(`\n${'='.repeat(70)}`);
    console.log('SUMMARY');
    console.log(`${'='.repeat(70)}`);
    console.log(`✅ Successful: ${successes}/${results.length}`);
    if (successes > 0) {
        console.log(`🏆 Wins: ${wins} | Ties: ${ties} | Losses: ${losses}`);
    }

    writeFileSync('./test/results/tenderly_fork_results.json', JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to test/results/tenderly_fork_results.json`);
}

main().catch(console.error);
