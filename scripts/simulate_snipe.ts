import { createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from 'dotenv';
// Inline ABIs for standalone safety

config();

const FLASH_LIQUIDATOR_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "collateralAsset", "type": "address" },
            { "internalType": "address", "name": "debtAsset", "type": "address" },
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "uint256", "name": "debtToCover", "type": "uint256" }
        ],
        "name": "executeLiquidation",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

const POOL_ABI = [
    {
        "inputs": [],
        "name": "getReservesList",
        "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const;


// User to test
const TARGET_USER = '0x7a2497ad6E4ebA70089c375455FD4cf19d580cE1';

// Config
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
// const FLASH_LIQUIDATOR = process.env.FLASH_LIQUIDATOR_ADDRESS;
const FLASH_LIQUIDATOR = '0x2b7146a5ef5017f9a997a1b152e2e452ff50b4e5'; // New Deployment (Unmasked)
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Log raw values (masked) for debugging
console.log('\n--- STARTING SIMULATION ---');
console.log('MARKER: CONFIG LOADED');
console.log(`FLASH_LIQUIDATOR: '${FLASH_LIQUIDATOR}' (Length: ${FLASH_LIQUIDATOR?.length})`);
console.log(`PRIVATE_KEY: '${PRIVATE_KEY ? 'Set' : 'Unset'}'`);
console.log(`TARGET_USER: '${TARGET_USER}'`);

// Aave V3 Addresses (Base)
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const UI_POOL_DATA_PROVIDER = '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac';

// Common Tokens (for mapping symbol to address if needed, or just use addresses from result)
// We will rely on what the Data Provider tells us.

async function main() {
    console.log('MARKER: INSIDE MAIN');
    if (!FLASH_LIQUIDATOR) {
        throw new Error('FLASH_LIQUIDATOR_ADDRESS not set in .env');
    }
    console.log('MARKER: ADDRESS CHECKED');
    if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY not set in .env');
    }

    console.log('🧪 Starting Flash Liquidation Simulation');
    console.log(`🎯 Target: ${TARGET_USER}`);
    console.log(`📝 Contract: ${FLASH_LIQUIDATOR}`);
    console.log(`🌍 RPC: ${RPC_URL}`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    // 1. Analyze User Position to find Best Debt/Collateral pair
    console.log('\n🔍 Fetching Aave Pool Reserves list...');

    // We need to fetch the user's reserves.
    // We can use the UiPoolDataProvider.getUserReservesData()
    // function getUserReservesData(address provider, address user) external view returns (UserReserveData[] memory, BaseCurrencyInfo memory)

    // Simplified ABI for UiPoolDataProvider
    const uiDataProviderAbi = [
        {
            inputs: [
                { internalType: "contract IPoolAddressesProvider", name: "provider", type: "address" },
                { internalType: "address", name: "user", type: "address" }
            ],
            name: "getUserReservesData",
            outputs: [
                {
                    components: [
                        { internalType: "address", name: "underlyingAsset", type: "address" },
                        { internalType: "uint256", name: "scaledATokenBalance", type: "uint256" },
                        { internalType: "bool", name: "usageAsCollateralEnabledAndOnly", type: "bool" },
                        { internalType: "uint256", name: "scaledVariableDebt", type: "uint256" },
                        { internalType: "uint256", name: "principalStableDebt", type: "uint256" }, // Not used in V3 usually
                        // We need to know the actual values in Base currency or just raw amounts?
                        // UiPoolDataProvider returns confusing scaled values.
                        // Let's use the simpler ProtocolDataProvider if possible, OR just manually calculate.
                    ],
                    internalType: "struct IUiPoolDataProviderV3.UserReserveData[]",
                    name: "",
                    type: "tuple"
                },
                {
                    components: [
                        { internalType: "uint256", name: "marketReferenceCurrencyUnit", type: "uint256" },
                        { internalType: "int256", name: "marketReferenceCurrencyPriceInUsd", type: "int256" },
                        { internalType: "int256", name: "networkBaseTokenPriceInUsd", type: "int256" },
                        { internalType: "uint8", name: "marketReferenceCurrencyDecimals", type: "uint8" }
                    ],
                    internalType: "struct IUiPoolDataProviderV3.BaseCurrencyInfo",
                    name: "",
                    type: "tuple"
                }
            ],
            stateMutability: "view",
            type: "function"
        }
    ] as const;

    // Actually, getting full list is complex.
    // Let's just use the AaveOracle + Pool to get their health factor first.
    // Then iterate known assets? No, too slow.
    // Let's use the existing Bot Logic import?
    // No, standalone script is better to isolate variables.

    // Let's use ProtocolDataProvider for a list of tokens?
    // Or just import the token list from config?
    // Let's assume standard tokens for now.

    // BETTER: Use `getReservesList` from Pool, then loop `getUserReserveData`.
    // Or use the `bot/executor.ts` logic?
    // Let's just import the `analyzeLiquidation` function from bot!
    // But that brings in the full bot baggage.

    // Let's write a raw "Find Best Pair" logic here.

    // 1. Get List of Reserves
    const reservesList = await client.readContract({
        address: AAVE_POOL as `0x${string}`,
        abi: POOL_ABI,
        functionName: 'getReservesList',
    }) as string[];

    console.log(`   ✅ Found ${reservesList.length} active markets on Aave V3 Base.`);

    let maxDebtUSD = 0;
    let maxDebtAsset = '';
    let maxDebtAmount = 0n;

    let maxCollateralUSD = 0;
    let maxCollateralAsset = '';

    // We need Oracle prices to calculate USD value.
    const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';
    console.log('   🔍 Fetching Oracle Prices...');
    const prices = await client.readContract({
        address: AAVE_ORACLE as `0x${string}`,
        abi: [{
            name: 'getAssetsPrices',
            type: 'function',
            inputs: [{ type: 'address[]', name: 'assets' }],
            outputs: [{ type: 'uint256[]', name: '' }],
            stateMutability: 'view'
        }],
        functionName: 'getAssetsPrices',
        args: [reservesList as `0x${string}`[]]
    }) as bigint[];

    console.log('   ✅ Prices fetched.');

    const priceMap = new Map<string, number>(); // Price in USD (Base currency is usually USD in V3 or we assume 8 decimals)
    reservesList.forEach((asset, i) => {
        // Aave prices are in Base Currency (usually USD 8 decimals)
        const price = Number(formatUnits(prices[i], 8));
        priceMap.set(asset.toLowerCase(), price);
    });

    // 0. Check Health Factor
    console.log('\n🏥 Checking Health Factor...');
    const userAccountData = await client.readContract({
        address: AAVE_POOL as `0x${string}`,
        abi: [{
            name: 'getUserAccountData',
            type: 'function',
            inputs: [{ type: 'address', name: 'user' }],
            outputs: [
                { type: 'uint256', name: 'totalCollateralBase' },
                { type: 'uint256', name: 'totalDebtBase' },
                { type: 'uint256', name: 'availableBorrowsBase' },
                { type: 'uint256', name: 'currentLiquidationThreshold' },
                { type: 'uint256', name: 'ltv' },
                { type: 'uint256', name: 'healthFactor' }
            ],
            stateMutability: 'view'
        }],
        functionName: 'getUserAccountData',
        args: [TARGET_USER as `0x${string}`]
    }) as [bigint, bigint, bigint, bigint, bigint, bigint];

    const hf = Number(formatUnits(userAccountData[5], 18));
    console.log(`   Health Factor: ${hf.toFixed(6)}`);

    if (hf >= 1.0) {
        console.error('❌ User is SAFE (HF >= 1.0). Cannot liquidate.');
        return;
    } else {
        console.log('   ✅ User is LIQUIDATABLE (HF < 1.0)');
    }

    // 2. Iterate Reserves to find Debt/Collateral
    console.log('\n🔍 Analyzing reserves for best pair...');

    for (const asset of reservesList) {
        // getUserReserveData
        // returns (currentATokenBalance, currentStableDebt, currentVariableDebt, principalStableDebt, scaledVariableDebt, stableBorrowRate, liquidityRate, stableRateLastUpdated, usageAsCollateralEnabled)
        const userData = await client.readContract({
            address: UI_POOL_DATA_PROVIDER as `0x${string}`, // ProtocolDataProvider!
            abi: [{
                name: 'getUserReserveData',
                type: 'function',
                inputs: [{ type: 'address' }, { type: 'address' }],
                outputs: [
                    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
                    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
                    { type: 'uint256' }, { type: 'uint40' }, { type: 'bool' }
                ],
                stateMutability: 'view'
            }],
            functionName: 'getUserReserveData',
            args: [asset as `0x${string}`, TARGET_USER as `0x${string}`]
        }) as any[];

        const aTokenBalance = userData[0] as bigint;
        const variableDebt = userData[2] as bigint;
        const price = priceMap.get(asset.toLowerCase()) || 0;

        let decimals = 18;
        let symbol = '???';

        if (variableDebt > 0n || aTokenBalance > 0n) {
            const [dec, sym] = await Promise.all([
                client.readContract({
                    address: asset as `0x${string}`,
                    abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }], state_stateMutability: 'view' }],
                    functionName: 'decimals'
                }),
                client.readContract({
                    address: asset as `0x${string}`,
                    abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }], state_stateMutability: 'view' }],
                    functionName: 'symbol'
                })
            ]);
            decimals = dec as number;
            symbol = sym as string;
        }

        if (variableDebt > 0n) {
            const debtValueUSD = Number(formatUnits(variableDebt, decimals)) * price;
            console.log(`   🔴 Debt: ${symbol} ($${debtValueUSD.toFixed(4)})`);
            if (debtValueUSD > maxDebtUSD) {
                maxDebtUSD = debtValueUSD;
                maxDebtAsset = asset;
                maxDebtAmount = variableDebt;
            }
        }

        if (aTokenBalance > 0n) {
            const collValueUSD = Number(formatUnits(aTokenBalance, decimals)) * price;
            console.log(`   🟢 Coll: ${symbol} ($${collValueUSD.toFixed(4)})`);
            if (collValueUSD > maxCollateralUSD) {
                maxCollateralUSD = collValueUSD;
                maxCollateralAsset = asset;
            }
        }
    }

    console.log(`\n📊 Best Liquidation Pair:`);
    console.log(`   🔴 Debt Asset: ${maxDebtAsset} ($${maxDebtUSD.toFixed(4)})`);
    console.log(`   🟢 Coll Asset: ${maxCollateralAsset} ($${maxCollateralUSD.toFixed(4)})`);

    if (!maxDebtAsset || !maxCollateralAsset) {
        console.error('❌ Could not find valid debt/collateral pair');
        return;
    }

    // 2.5 Price Discrepancy Check (The "Forensic" Step)
    console.log('\n⚖️  Checking Market Viability (Oracle vs Uniswap)...');
    try {
        const poolFee = 3000; // Hardcoded in contract
        const factory = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

        const poolAddress = await client.readContract({
            address: factory,
            abi: [{ name: 'getPool', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }], stateMutability: 'view' }],
            functionName: 'getPool',
            args: [maxCollateralAsset as `0x${string}`, maxDebtAsset as `0x${string}`, poolFee]
        });

        if (poolAddress === '0x0000000000000000000000000000000000000000') {
            console.warn('   ⚠️  No Direct Uniswap Pool found!');
        } else {
            const slot0 = await client.readContract({
                address: poolAddress as `0x${string}`,
                abi: [{ name: 'slot0', type: 'function', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], stateMutability: 'view' }],
                functionName: 'slot0'
            }) as any;

            const sqrtPriceX96 = BigInt(slot0[0]);
            const Q96 = 2n ** 96n;
            // Price Token1/Token0 = (sqrtPrice / Q96) ^ 2
            // We need to know which is 0/1. Sorted addresses.
            const isToken0Collateral = maxCollateralAsset.toLowerCase() < maxDebtAsset.toLowerCase();
            const token0 = isToken0Collateral ? maxCollateralAsset : maxDebtAsset;
            // const token1 = isToken0Collateral ? maxDebtAsset : maxCollateralAsset;

            // Calculate Price of Token0 in terms of Token1
            // P = (sqrt / 2^96)^2
            const priceNum = Number(sqrtPriceX96) / Number(Q96);
            const price0in1 = priceNum * priceNum;

            console.log(`   🦄 Uniswap V3 Pool (0.3%): ${poolAddress}`);
            // console.log(`      SqrtPrice: ${sqrtPriceX96}`);

            let swapPrice = 0;
            if (isToken0Collateral) {
                // Collateral is Token0. We sell Token0 (Coll) -> Token1 (Debt).
                // We get Price0in1 units of Debt per Coll.
                // Swap Rate = price0in1
                swapPrice = price0in1;
                console.log(`      Swap Rate: 1 Coll = ${swapPrice.toFixed(4)} Debt`);
            } else {
                // Collateral is Token1. We sell Token1 (Coll) -> Token0 (Debt).
                // We need 1/price0in1 units of Coll to get 1 Debt.
                // Swap Rate = 1 / price0in1
                swapPrice = 1 / price0in1;
                console.log(`      Swap Rate: 1 Coll = ${swapPrice.toFixed(4)} Debt`);
            }

            // Oracle Ratio
            const oraclePriceColl = priceMap.get(maxCollateralAsset.toLowerCase()) || 0;
            const oraclePriceDebt = priceMap.get(maxDebtAsset.toLowerCase()) || 0;
            const oracleRatio = oraclePriceColl / oraclePriceDebt;

            console.log(`   🔮 Oracle Rate: 1 Coll = ${oracleRatio.toFixed(4)} Debt`);

            const diff = (swapPrice - oracleRatio) / oracleRatio * 100;
            console.log(`   📊 Discrepancy: ${diff.toFixed(2)}%`);

            // Liquidation Bonus is usually 5% or 10%.
            // If Swap Rate is < Oracle Rate * 1.05... we lose.
            // Wait, Swap Rate is how much Debt we get per Coll.
            // If Swap Rate (0.84) < Oracle Ratio (1.0), we get LESS Debt than Oracle says.
            // We need Swap Rate > (Oracle Ratio / BonusMultiplier)? No.
            // With Bonus, we get 1.05 * USD_Coll worth of Debt?
            // No, we seize 105 USD Coll to pay 100 USD Debt.
            // So we sell 105 USD Coll.
            // We need it to swap into >= 100 USD Debt.
            // Effective required efficiency: Must retain > 95.2% of value.
            // If Discrepancy is below -5%, ISOLVENCY.

            if (diff < -5) {
                console.error(`   🚨 CRITICAL: Market Price is too poor! Swap yields ${Math.abs(diff).toFixed(2)}% LESS than Oracle.`);
                console.error(`      Likely cause of REVERT: Insolvency.`);
            } else {
                console.log(`   ✅ Price seems OK.`);
            }
        }
    } catch (e) {
        console.warn('   ⚠️  Price Check Error:', e);
    }

    // 3. Calculate Debt To Cover
    // Reverting to 50% to check if 100% was the cause of failure.
    const debtToCover = maxDebtAmount / 2n;
    console.log(`   💰 Debt To Cover: ${debtToCover.toString()} (50% - Test)`);

    // 3.5 Check Balance & Ownership
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    const balance = await client.getBalance({ address: account.address });
    const balanceETH = formatUnits(balance, 18);
    console.log(`\n💳 Sender: ${account.address}`);
    console.log(`   Balance: ${balanceETH} ETH`);

    if (balance === 0n) {
        console.warn('⚠️  WARNING: Sender has 0 ETH. Simulation might fail if gas is required.');
    }

    try {
        const owner = await client.readContract({
            address: FLASH_LIQUIDATOR as `0x${string}`,
            abi: [{ name: 'owner', type: 'function', inputs: [], outputs: [{ type: 'address' }], state_stateMutability: 'view' }],
            functionName: 'owner'
        });
        console.log(`   Contract Owner: ${owner}`);
        if (owner.toLowerCase() !== account.address.toLowerCase()) {
            console.error('   🚨 AUTHORIZATION MISMATCH: Sender is NOT the owner!');
        } else {
            console.log('   ✅ Sender IS the owner.');
        }

        // Check Min Profit Threshold
        try {
            const minProfit = await client.readContract({
                address: FLASH_LIQUIDATOR as `0x${string}`,
                abi: [{ name: 'minProfitThreshold', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], state_stateMutability: 'view' }],
                functionName: 'minProfitThreshold'
            }) as bigint;
            console.log(`   Min Profit Threshold: ${minProfit} (${formatUnits(minProfit, 6)} USDC)`);

            // Heuristic check
            if (minProfit > 100n) { // if > 0.0001 USDC
                console.warn(`   ⚠️  Threshold might be too high for this dust position! (Need > ${formatUnits(minProfit, 6)})`);
                console.warn(`       Current Exp Profit: ~$0.0005. Revert is likely due to 'Profit < Threshold'.`);
            }
        } catch (e) { console.log('   (Could not read minProfitThreshold)'); }

    } catch (e) {
        console.warn('   ⚠️  Could not fetch owner (Contract might not allow public owner read)');
    }

    // 3.6 Find Storage Slot for minProfitThreshold (1000000)
    console.log('\n🔍 Scanning Storage Slots for Profit Threshold...');
    for (let i = 0; i < 0; i++) {
        const data = await client.getStorageAt({
            address: FLASH_LIQUIDATOR as `0x${string}`,
            slot: `0x${i.toString(16)}`
        }); // Returns Hash

        const val = BigInt(data || '0x0');
        console.log(`   Slot ${i}: ${data} -> ${val}`);

        if (val === 1000000n) {
            console.log(`   ✅ FOUND minProfitThreshold at Slot ${i}!`);
        }
    }

    try {
        const { request } = await client.simulateContract({
            address: FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [
                maxCollateralAsset as `0x${string}`,
                maxDebtAsset as `0x${string}`,
                TARGET_USER as `0x${string}`,
                debtToCover
            ],
            account: account
        });

        console.log(`   ✅ SIMULATION SUCCESSFUL!`);
        console.log(`   ⛽ Estimated Gas: ${request.gas}`);

    } catch (error: any) {
        console.error(`   ❌ SIMULATION FAILED:`);

        if (error.reason) console.error(`   Reason: ${error.reason}`);
        if (error.shortMessage) console.error(`   Message: ${error.shortMessage}`);

        // Attempt to decode error data
        if (error.data) {
            console.error(`   Revert Data (Hex): ${error.data}`);
            // Check for specific error signatures if known (e.g. V3_PREREQUISITE_CHECK_FAILED)
            if (error.data?.includes('0x82b42900') || error.data?.includes('0x118cdaa7') || error.reason?.includes('own')) {
                console.error('   🚨 AUTHORIZATION ERROR: Are you the contract owner?');
            }
        }

        // Debug full error object if needed
        // console.error(JSON.stringify(error, null, 2));
    }
}

main().catch(console.error);
