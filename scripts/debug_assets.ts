import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { CONFIG } from '../bot/config.js';

config();

// Standard ABIs
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const ORACLE_ABI = parseAbi(['function getAssetPrice(address) view returns (uint256)']);
const DATA_PROVIDER_ABI = parseAbi([
    'function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])',
    'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)'
]);

async function main() {
    const USER = '0xa7b0536fb02c422b209868d18447833c6980db18';

    console.log(`🕵️‍♂️ Deep Diagnostic for ${USER}`);

    // Recreate Client
    const client = createPublicClient({
        chain: base,
        transport: http(CONFIG.RPC_URL_PREMIUM)
    });

    console.log('1. Fetching All Reserves...');
    const tokens = await client.readContract({
        address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
        abi: DATA_PROVIDER_ABI,
        functionName: 'getAllReservesTokens'
    });
    console.log(`   Found ${tokens.length} reserves.`);

    console.log('2. Building Multicall...');
    const calls = [];

    // Test with a smaller batch first? No, let's replicate the failure.
    for (const token of tokens) {
        calls.push({ address: token.tokenAddress, abi: ERC20_ABI, functionName: 'decimals' });
        calls.push({ address: CONFIG.AAVE_ORACLE as `0x${string}`, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [token.tokenAddress] });
        calls.push({
            address: CONFIG.AAVE_DATA_PROVIDER as `0x${string}`,
            abi: DATA_PROVIDER_ABI,
            functionName: 'getUserReserveData',
            args: [token.tokenAddress, USER]
        });
    }

    console.log(`   Total Calls: ${calls.length} (Size: ${calls.length * 100} bytes approx)`);

    try {
        const results = await client.multicall({ contracts: calls as any, allowFailure: true });

        console.log('3. analyzing Results...');
        let successCount = 0;
        let failCount = 0;
        let userDataFound = 0;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const resDec = results[i * 3];
            const resPrice = results[i * 3 + 1];
            const resData = results[i * 3 + 2];

            const ok = resDec.status === 'success' && resPrice.status === 'success' && resData.status === 'success';

            if (ok) {
                successCount++;
                const data = resData.result as any;
                const aBal = Number(data[0]);
                const vDebt = Number(data[2]);

                if (aBal > 0 || vDebt > 0) {
                    userDataFound++;
                    console.log(`   ✅ ${token.symbol}: Collateral ${aBal} | Debt ${vDebt}`);
                }
            } else {
                failCount++;
                console.log(`   ❌ ${token.symbol}: Dec:${resDec.status} Price:${resPrice.status} Data:${resData.status}`);
            }
        }

        console.log(`\nRESULTS: ${successCount} Success, ${failCount} Failures.`);
        console.log(`Assets with Balance/Debt: ${userDataFound}`);

    } catch (e: any) {
        console.error('🔥 MULTICALL CRASHED:', e.message);
    }
}

main().then(() => console.log('Done'));
