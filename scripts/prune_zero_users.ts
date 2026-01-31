
import * as fs from 'fs';
import * as path from 'path';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import * as dotenv from 'dotenv';

dotenv.config();

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

const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL)
});

async function main() {
    const ACTIVE_USERS_FILE = path.join(process.cwd(), 'data', 'active_users.json');
    if (!fs.existsSync(ACTIVE_USERS_FILE)) {
        console.error('❌ active_users.json not found!');
        return;
    }

    const allUsers: string[] = JSON.parse(fs.readFileSync(ACTIVE_USERS_FILE, 'utf-8'));
    console.log(`📊 Loaded ${allUsers.length.toLocaleString()} users from list.`);

    const BATCH_SIZE = 100;
    const cleanedUsers: string[] = [];
    let processed = 0;

    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
        const batch = allUsers.slice(i, i + BATCH_SIZE);

        try {
            const results = await publicClient.multicall({
                contracts: batch.map(addr => ({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: AAVE_POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [addr as `0x${string}`]
                })),
                allowFailure: true
            });

            results.forEach((res, index) => {
                if (res.status === 'success' && res.result) {
                    const [totalCollateralBase, totalDebtBase] = res.result;

                    // The user wants to delete those that have DEBT = 0.00 and COLLATERAL = 0.00
                    // Aave V3 Base currency is USD with 8 decimals.
                    const collateral = Number(formatUnits(totalCollateralBase, 8));
                    const debt = Number(formatUnits(totalDebtBase, 8));

                    if (collateral > 0 || debt > 0) {
                        cleanedUsers.push(batch[index]);
                    }
                } else {
                    // If error, keep the user just in case
                    cleanedUsers.push(batch[index]);
                }
            });

        } catch (error) {
            console.error(`Batch ${i} failed, keeping users.`);
            cleanedUsers.push(...batch);
        }

        processed += batch.length;
        if (processed % 1000 === 0 || processed === allUsers.length) {
            console.log(`⏳ Processed ${processed.toLocaleString()}/${allUsers.length.toLocaleString()}... (Kept ${cleanedUsers.length.toLocaleString()})`);
        }
    }

    console.log(`✅ Finished pruning. Kept ${cleanedUsers.length.toLocaleString()} users.`);
    console.log(`🗑️ Removed ${(allUsers.length - cleanedUsers.length).toLocaleString()} zombie accounts.`);

    fs.writeFileSync(ACTIVE_USERS_FILE, JSON.stringify(cleanedUsers, null, 2));
    console.log('💾 File updated.');
}

main().catch(console.error);
