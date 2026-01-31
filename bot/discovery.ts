import { parseAbiItem, formatUnits } from 'viem';
import { CONFIG, publicClient } from './config.js';
import { startWatcher, periodicBasicRefresh, healthFactorCache, batchUpdateHealthFactorsBasic } from './watcher.js';
import { enqueueUser } from './auditor.js';
import { dashboard } from './logger.js';
import { bridge } from './server.js';

import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads initial user list and categorizes them into critical/safe tiers
 */
export async function loadSeedData() {
    const ACTIVE_USERS_FILE = path.join(process.cwd(), 'data', 'active_users.json');
    if (!fs.existsSync(ACTIVE_USERS_FILE)) {
        dashboard.logEvent('⚠️ Seed: active_users.json not found!', 'Discovery');
        return;
    }

    dashboard.logEvent('🌱 Seed: Loading initial target list...', 'Discovery');
    const allUsers: string[] = JSON.parse(fs.readFileSync(ACTIVE_USERS_FILE, 'utf-8'));
    dashboard.logEvent(`📊 Seed: Found ${allUsers.length.toLocaleString()} potential targets`, 'Discovery');

    // Import required functions
    const { persistLists } = await import('./auditor.js');
    const { batchUpdateHealthFactorsBasic } = await import('./watcher.js');

    // Batch process with categorization using Basic RPC
    const BATCH_SIZE = 500; // Process in larger batches with progress reporting
    let totalProcessed = 0;
    const allCritical: string[] = [];
    const allSafe: string[] = [];

    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
        const batch = allUsers.slice(i, i + BATCH_SIZE);
        const { critical, safe } = await batchUpdateHealthFactorsBasic(batch, true);

        allCritical.push(...critical);
        allSafe.push(...safe);

        totalProcessed += batch.length;
        const percent = Math.min(100, Math.floor((totalProcessed / allUsers.length) * 100));
        bridge.broadcast('PROGRESS', { job: 'Initial Load', percent });

        dashboard.logEvent(`⏳ Seed: Processed ${totalProcessed.toLocaleString()}/${allUsers.length.toLocaleString()} (${percent}%)`, 'Discovery');
    }

    // Hide progress bar
    setTimeout(() => {
        bridge.broadcast('PROGRESS', { job: 'Initial Load', percent: -1 });
    }, 2000);

    // Calculate how many were filtered out
    const totalKept = allCritical.length + allSafe.length;
    const totalFiltered = allUsers.length - totalKept;

    // Save categorized lists
    persistLists(allSafe);

    // **UPDATE active_users.json to only contain users who passed filtering**
    const cleanedActiveUsers = [...allCritical, ...allSafe];
    fs.writeFileSync(ACTIVE_USERS_FILE, JSON.stringify(cleanedActiveUsers, null, 2));

    dashboard.logEvent(`✅ Seed: Categorization complete!`, 'Discovery');
    dashboard.logEvent(`   🚨 Critical (HF < 1.5): ${allCritical.length.toLocaleString()} users → Premium RPC`, 'Discovery');
    dashboard.logEvent(`   🧊 Safe (HF >= 1.5): ${allSafe.length.toLocaleString()} users → Basic RPC`, 'Discovery');
    dashboard.logEvent(`   📈 Total monitored: ${totalKept.toLocaleString()} users`, 'Discovery');
    dashboard.logEvent(`   🗑️ Filtered out: ${totalFiltered.toLocaleString()} users (debt or collateral < $20, or HF = 0)`, 'Discovery');

    // Broadcast initial safe user count to UI
    bridge.broadcast('SAFE_USERS', {
        count: allSafe.length,
        lastUpdate: Date.now(),
        removed: 0,
        promoted: 0
    });
}

/**
 * Runs a 90-day discovery scan using progressive block filtering
 * Adapted for Alchemy Free Tier (Max 10 block range)
 */
export async function runDiscovery() {
    dashboard.logEvent('🔍 Discovery: Scanning for new borrowers...', 'Discovery');

    try {
        const currentBlock = await publicClient.getBlockNumber();
        const TOTAL_BLOCKS_TO_SCAN = 300000n; // ~90 Days
        const BLOCK_RANGE = 2000n; // Base optimized range

        const activeUsers = new Set<string>();

        for (let i = 0n; i < TOTAL_BLOCKS_TO_SCAN; i += BLOCK_RANGE) {
            const to = currentBlock - i;
            const from = to - BLOCK_RANGE + 1n;

            try {
                const logs = await publicClient.getLogs({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    event: parseAbiItem('event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'),
                    fromBlock: from,
                    toBlock: to
                });

                for (const log of logs) {
                    const user = (log as any).args.user;
                    if (user) activeUsers.add(user);
                }
            } catch (e) {
                dashboard.logEvent(`⚠️ Discovery: RPC error for block range ${from}-${to}`, 'Discovery');
                continue;
            }

            // Progress reporting
            const processedBlocks = i + BLOCK_RANGE;
            const percent = Math.min(100, Math.floor(Number(processedBlocks * 100n / TOTAL_BLOCKS_TO_SCAN)));
            bridge.broadcast('PROGRESS', { job: 'Discovery Scan', percent });

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (activeUsers.size > 0) {
            dashboard.logEvent(`✨ Discovery: Found ${activeUsers.size} candidates.`, 'Discovery');
            bridge.broadcast('PROGRESS', { job: 'Discovery Scan', percent: 100 });

            // Clear progress after short delay (v10)
            setTimeout(() => {
                bridge.broadcast('PROGRESS', { job: 'Discovery Scan', percent: -1 });
            }, 2000);

            const users = Array.from(activeUsers);
            await batchUpdateHealthFactorsBasic(users, false);

            for (const userAddress of users) {
                await enqueueUser(userAddress);
            }
        }

    } catch (error) {
        dashboard.logEvent('❌ Discovery: RPC error', 'Discovery');
    }
}

/**
 * Orchestrates the full discovery cycle
 */
export async function startDiscovery() {
    dashboard.logEvent('🏁 Discovery: Engine Primed', 'Discovery');

    // Initial scan
    await runDiscovery();

    // Periodic deep re-scan
    setInterval(async () => {
        await runDiscovery();
    }, 3600000); // Every 1 hour
}
