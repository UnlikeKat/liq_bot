
import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const DATA_PROVIDER = '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac';
const ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';

const DATA_PROVIDER_ABI = [
    {
        name: 'getAllReservesTokens',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'tuple[]', components: [{ name: 'symbol', type: 'string' }, { name: 'tokenAddress', type: 'address' }] }]
    },
    {
        name: 'getUserReserveData',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'asset', type: 'address' }, { name: 'user', type: 'address' }],
        outputs: [
            { name: 'currentATokenBalance', type: 'uint256' },
            { name: 'currentStableDebt', type: 'uint256' },
            { name: 'currentVariableDebt', type: 'uint256' },
            { name: 'principalStableDebt', type: 'uint256' },
            { name: 'scaledVariableDebt', type: 'uint256' },
            { name: 'stableBorrowRate', type: 'uint256' },
            { name: 'liquidityRate', type: 'uint256' },
            { name: 'stableRateLastUpdated', type: 'uint40' },
            { name: 'usageAsCollateralEnabled', type: 'bool' }
        ]
    }
] as const;

const ORACLE_ABI = [
    {
        name: 'getAssetPrice',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }]
    }
] as const;

const ERC20_ABI = [
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
] as const;

const POOL_ABI = [
    {
        name: 'getUserAccountData',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ]
    }
] as const;

const TARGETS = [
    '0x5B97da1C5351F6bC57cEC74C4C5a27D70c064f59',
    '0x3246EF49846DFD3dda6D592cDCb80d956b3CF864',
    '0x2AEe4A054ce01a4d1F698064B8d90ec34f9FaC48',
    '0xB00682Ff3A830A00650f6d428289Be494c5a63E6',
    '0x1BB40D45bd1c5f4cEE56f4B4322407992F9b451c',
    '0x1F84d2C5Ff9BdbD01C1912dDcdd4Ba07bAfA31E0',
    '0x52066d8ED13A412657cF99c6a2BF5bD664599554',
    '0x7a2497ad6E4ebA70089c375455FD4cf19d580cE1'
];

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });
    console.log('🧪 BATCH LIQUIDATION SIMULATOR v4\n');

    const reserveTokens = await client.readContract({
        address: DATA_PROVIDER,
        abi: DATA_PROVIDER_ABI,
        functionName: 'getAllReservesTokens'
    });

    let totalBonusUSD = 0n;
    let totalDebtToFlashUSD = 0n;
    const batchTargets = [];

    for (const addr of TARGETS) {
        console.log(`\n🔎 Analysis: ${addr.slice(0, 10)}...`);
        try {
            const data = await client.readContract({
                address: POOL_ADDRESS,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [addr as `0x${string}`]
            }) as any;

            // In some viem versions, it returns an array even if named
            const hfRaw = Array.isArray(data) ? data[5] : data.healthFactor;
            const totalDebtBase = Array.isArray(data) ? data[1] : data.totalDebtBase;

            if (hfRaw === undefined) {
                console.log(`   ❌ Could not read Health Factor for ${addr}`);
                continue;
            }

            const hf = Number(formatUnits(hfRaw, 18));
            console.log(`   Health Factor: ${hf.toFixed(4)}`);
            if (hf >= 1.0) {
                console.log(`   ✅ Safe.`);
                continue;
            }

            // Find best pair
            let maxCollateral = { addr: '', valUSD8: 0n };
            let maxDebt = { addr: '', valUSD8: 0n };

            const majorSymbols = ["USDC", "WETH", "USDbC", "cbBTC", "EURC", "cbETH"];
            const tokensToCheck = reserveTokens.filter(t => majorSymbols.includes(t.symbol));

            for (const token of tokensToCheck) {
                const res = await client.readContract({
                    address: DATA_PROVIDER,
                    abi: DATA_PROVIDER_ABI,
                    functionName: 'getUserReserveData',
                    args: [token.tokenAddress, addr as `0x${string}`]
                }) as any;

                const price8 = await client.readContract({
                    address: ORACLE,
                    abi: ORACLE_ABI,
                    functionName: 'getAssetPrice',
                    args: [token.tokenAddress]
                }) as bigint;

                const decimals = await client.readContract({
                    address: token.tokenAddress,
                    abi: ERC20_ABI,
                    functionName: 'decimals'
                }) as number;

                const currentATokenBalance = Array.isArray(res) ? res[0] : res.currentATokenBalance;
                const currentVariableDebt = Array.isArray(res) ? res[2] : res.currentVariableDebt;
                const usageAsCollateralEnabled = Array.isArray(res) ? res[8] : res.usageAsCollateralEnabled;

                const collUSD8 = (currentATokenBalance * price8) / BigInt(10 ** decimals);
                const debtUSD8 = (currentVariableDebt * price8) / BigInt(10 ** decimals);

                if (usageAsCollateralEnabled && collUSD8 > maxCollateral.valUSD8) {
                    maxCollateral = { addr: token.tokenAddress, valUSD8: collUSD8 };
                }
                if (debtUSD8 > maxDebt.valUSD8) {
                    maxDebt = { addr: token.tokenAddress, valUSD8: debtUSD8 };
                }
            }

            if (!maxCollateral.addr || !maxDebt.addr) {
                console.log(`   ⚠️ No assets found.`);
                continue;
            }

            const closeFactorPercent = hf < 0.95 ? 100n : 50n;
            const debtToCoverUSD8 = (maxDebt.valUSD8 * closeFactorPercent) / 100n;
            const bonusPercent = 5n;
            const bonusUSD8 = (debtToCoverUSD8 * bonusPercent) / 100n;

            console.log(`   🚨 Target: ${maxCollateral.addr.slice(0, 6)} / ${maxDebt.addr.slice(0, 6)}`);
            console.log(`   💰 Debt Cover: $${formatUnits(debtToCoverUSD8, 8)}`);

            totalBonusUSD += bonusUSD8;
            totalDebtToFlashUSD += debtToCoverUSD8;
            batchTargets.push({ addr, maxCollateral, maxDebt, debtToCoverUSD8 });

        } catch (e) {
            console.error(`   ❌ Error analysis:`, e);
        }
    }

    console.log('\n========================================');
    console.log(`📦 BUNDLE SUMMARY (${batchTargets.length} targets)`);
    console.log(`💵 Total Debt To Cover: $${formatUnits(totalDebtToFlashUSD, 8)}`);
    console.log(`🌟 Total Bonus Gross:  $${formatUnits(totalBonusUSD, 8)}`);

    const ethPrice = BigInt(2300);
    // ⚡ BASE OPTIMIZATION: Use absolute floor L2 gas cost (~0.0005 Gwei)
    // On Base, fees can be infinitesimally small. $0.0004 is a ceiling for a batch at 0.0005 Gwei.
    const gasUSD8 = parseUnits('0.0004', 8);
    const slippageUSD8 = (totalBonusUSD * 2n) / 100n;

    const netProfitUSD8 = totalBonusUSD - gasUSD8 - slippageUSD8;

    console.log(`⛽ Est. Gas Cost:   $${formatUnits(gasUSD8, 8)} (Fixed 0.0005 Gwei)`);
    console.log(`📉 Est. Slippage:   $${formatUnits(slippageUSD8, 8)}`);
    console.log(`----------------------------------------`);

    if (netProfitUSD8 > 0n) {
        console.log(`✅ PROFITABLE BUNDLE! Est Net: $${formatUnits(netProfitUSD8, 8)} USD`);
    } else {
        console.log(`❌ BUNDLE STILL UNPROFITABLE. Net: $${formatUnits(netProfitUSD8, 8)} USD`);
    }
}

main().catch(console.error);
