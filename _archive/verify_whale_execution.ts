
import { readFileSync } from 'fs';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from '../bot/config.js'; // Config is safe to import usually

// Standalone Setup to avoid Port Conflicts
const premiumClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PREMIUM)
});

const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(CONFIG.RPC_URL_PREMIUM)
});

// ABIS
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

const DATA_PROVIDER_ABI = [
    {
        type: 'function',
        name: 'getAllReservesTokens',
        inputs: [],
        outputs: [
            {
                name: '',
                type: 'tuple[]',
                components: [
                    { name: 'symbol', type: 'string' },
                    { name: 'tokenAddress', type: 'address' }
                ]
            }
        ],
        stateMutability: 'view'
    },
    {
        type: 'function',
        name: 'getUserReserveData',
        inputs: [
            { name: 'asset', type: 'address' },
            { name: 'user', type: 'address' }
        ],
        outputs: [
            { name: 'currentATokenBalance', type: 'uint256' },
            { name: 'currentStableDebt', type: 'uint256' },
            { name: 'currentVariableDebt', type: 'uint256' },
            // ... truncated simplified
        ],
        stateMutability: 'view'
    }
] as const;

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

const MIN_WHALE_DEBT = 900000; // $900k

// --- LOGIC REPLICATION ---

async function findBestLiquidationPair(user: string): Promise<{ collateral: string, debt: string } | null> {
    try {
        const tokens = await premiumClient.readContract({
            address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
            abi: DATA_PROVIDER_ABI,
            functionName: 'getAllReservesTokens',
        });

        let maxCollateral = { address: '', value: 0n };
        let maxDebt = { address: '', value: 0n };

        // Multicall
        const reserveResults = await premiumClient.multicall({
            contracts: tokens.map(token => ({
                address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
                abi: DATA_PROVIDER_ABI,
                functionName: 'getUserReserveData',
                args: [token.tokenAddress, user as `0x${string}`]
            }))
        });

        reserveResults.forEach((res, index) => {
            if (res.status === 'success') {
                const tokenAddress = tokens[index].tokenAddress;
                const result = res.result as unknown as any[];

                // Index 0 = aToken, Index 2 = Variable Debt (Same as executor.ts)
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

        console.log(`   🔎 Found best pair for ${user.slice(0, 6)}: Collateral ${maxCollateral.address.slice(0, 6)} / Debt ${maxDebt.address.slice(0, 6)}`);
        return { collateral: maxCollateral.address, debt: maxDebt.address };

    } catch (e) {
        console.error(`   ❌ Failed to find assets for ${user}:`, e);
        return null;
    }
}

async function main() {
    let whaleAddress = '0x4B9859dF9ba9B428328c05eEA63B51c3b36fd2bB';
    console.log(`🐳 TARGETING WHALE: ${whaleAddress}`);

    /* Skipping scan since we have the address */
    /*
    const safeUsers = JSON.parse(readFileSync('./data/safe_users.json', 'utf8'));
    const activeUsers = JSON.parse(readFileSync('./data/active_users.json', 'utf8'));
    const allUsers = [...new Set([...safeUsers, ...activeUsers])];

    console.log(`📋 Scanning ${allUsers.length} users for debt > $${MIN_WHALE_DEBT.toLocaleString()}...`);

    // Batched check
    for (let i = 0; i < allUsers.length; i += 100) {
        const batch = allUsers.slice(i, i + 100);
        const end = Math.min(i + 100, allUsers.length);

        try {
            const results = await premiumClient.multicall({
                contracts: batch.map(addr => ({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: AAVE_POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [addr as `0x${string}`]
                })),
                allowFailure: true
            });

            for (let j = 0; j < results.length; j++) {
                const res = results[j];
                if (res.status === 'success' && res.result) {
                    const debtBase = res.result[1]; // totalDebtBase
                    const debtUSD = Number(formatUnits(debtBase, 8));

                    if (debtUSD > MIN_WHALE_DEBT) {
                        console.log(`\n🎯 FOUND WHALE!`);
                        console.log(`   Address: ${batch[j]}`);
                        console.log(`   Debt: $${debtUSD.toLocaleString()}`);
                        const hf = formatUnits(res.result[5], 18);
                        console.log(`   HF: ${hf}`);
                        whaleAddress = batch[j];
                        break;
                    }
                }
            }
        } catch (e) {
            // ignore batch error
        }
        if (whaleAddress) break;
        if (i % 2000 === 0 && i > 0) console.log(`   Scanned ${i} users...`);
    }

    if (!whaleAddress) {
        console.log('❌ Could not find whale in local files.');
        return;
    }
    */

    console.log('\n🧪 STARTING SIMULATION...');

    // 2. Test Asset Discovery
    console.log(`   🔍 Running Dynamic Asset Discovery (Multicall)...`);
    const startTime = Date.now();
    const assets = await findBestLiquidationPair(whaleAddress);
    const endTime = Date.now();

    if (!assets) {
        console.log('   ❌ Asset Discovery Failed! (Returned null)');
        return;
    }

    console.log(`   ✅ Asset Discovery Complete in ${endTime - startTime}ms`);

    // 3. Simulate Transaction
    console.log(`\n   🔄 Simulating Execution (Expect HF Revert)...`);

    try {
        await premiumClient.simulateContract({
            address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
            abi: FLASH_LIQUIDATOR_ABI,
            functionName: 'executeLiquidation',
            args: [
                assets.collateral as `0x${string}`,
                assets.debt as `0x${string}`,
                whaleAddress as `0x${string}`,
                parseUnits('100', 6) // Try to liquidate small amount
            ],
            account,
        });
        console.log('   ❓ Simulation unexpectedly succeeded (Did HF drop?)');
    } catch (e: any) {
        if (e.message?.includes('Health factor is not below the threshold')) {
            console.log('   ✅ REVERTED CORRECTLY: "Health factor is not below the threshold"');
            console.log('   (This confirms the contract was reached and logic is working)');
        } else {
            console.log('   ❌ REVERTED WITH UNEXPECTED ERROR:');
            // Log a snippet of error
            const msg = e.details || e.shortMessage || e.message;
            console.log(`   ${msg}`);
        }
    }

    console.log('\n📊 TEST COMPLETE.');
}

main().catch(console.error);
