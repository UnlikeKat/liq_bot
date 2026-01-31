import { formatUnits } from 'viem';
import { publicClient, CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const KILL_LIST_FILE = path.join(process.cwd(), 'data', 'kill_list.json');

const POOL_ABI = [
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

async function diagnose() {
    if (!fs.existsSync(KILL_LIST_FILE)) {
        console.error("❌ kill_list.json not found.");
        return;
    }

    const users: string[] = JSON.parse(fs.readFileSync(KILL_LIST_FILE, 'utf-8'));
    console.log(`📋 Kill List contains ${users.length} users.`);

    // Pick 5 random users
    const sample = users.sort(() => 0.5 - Math.random()).slice(0, 5);

    console.log(`\n🔍 Sampling 5 users for verification:\n`);

    for (const user of sample) {
        try {
            const data = await publicClient.readContract({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user as `0x${string}`]
            });

            const [collateral, debt, , , , hf] = data;

            console.log(`👤 User: ${user}`);
            console.log(`   💰 Collateral: $${formatUnits(collateral, 8)}`);
            console.log(`   💸 Debt:       $${formatUnits(debt, 8)}`);
            console.log(`   📉 Health F:   ${formatUnits(hf, 18)}`);
            console.log(hf < 2000000000000000000n ? "   ✅ VALID RISK" : "   ❌ SHOULD NOT BE HERE");
            console.log('-----------------------------------');

        } catch (e: any) {
            console.error(`   ❌ Error checking ${user}: ${e.message}`);
        }
    }
}

diagnose();
