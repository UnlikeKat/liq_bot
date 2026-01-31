import { formatUnits } from 'viem';
import { publicClient, CONFIG } from './config.js';
import { killList, fetchHealthFactor } from './watcher.js';
import { dashboard } from './logger.js';
import { bridge } from './server.js';
import * as fs from 'fs';
import * as path from 'path';

const SAFE_USERS_FILE = path.join(process.cwd(), 'data', 'safe_users.json');
const KILL_LIST_FILE = path.join(process.cwd(), 'data', 'kill_list.json');

const BATCH_SIZE = 50;
const PROMOTION_HF = 1.5;
const AUDIT_INTERVAL = 15 * 60 * 1000; // 15 minutes

// In-memory cache to avoid duplicate enqueues in rapid succession
const processingCache = new Set<string>();

/**
 * Loads the safe users list from disk
 */
export function getSafeUsers(): string[] {
    if (!fs.existsSync(SAFE_USERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(SAFE_USERS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

/**
 * Saves both lists to ensure data consistency
 */
export function persistLists(safe: string[]) {
    const risky = Array.from(killList);
    fs.writeFileSync(SAFE_USERS_FILE, JSON.stringify(safe, null, 2));
    fs.writeFileSync(KILL_LIST_FILE, JSON.stringify(risky, null, 2));
}

/**
 * Scans safe users and promotes those who have become risky
 */
export async function runAudit() {
    dashboard.logEvent('🔍 Auditor: Scanning safe list (Public RPC)...');

    let safeUsers = getSafeUsers();
    if (safeUsers.length === 0) {
        return;
    }

    const toPromote: string[] = [];
    const ToDelete: string[] = [];

    for (let i = 0; i < safeUsers.length; i += BATCH_SIZE) {
        const batch = safeUsers.slice(i, i + BATCH_SIZE);

        try {
            const results = await publicClient.multicall({
                contracts: batch.map(addr => ({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [addr as `0x${string}`]
                })),
                allowFailure: true
            });

            results.forEach((res, index) => {
                if (res.status === 'success' && res.result) {
                    const [, totalDebtBase, , , , healthFactor] = res.result;
                    const hf = Number(formatUnits(healthFactor, 18));
                    const debtUSD = Number(formatUnits(totalDebtBase, 8));
                    const addr = batch[index].toLowerCase();

                    if (debtUSD === 0) {
                        ToDelete.push(addr);
                    } else if (hf > 0 && hf < PROMOTION_HF) {
                        toPromote.push(addr);
                    }
                }
            });

        } catch (e: any) {
            dashboard.logEvent(`❌ Auditor: Multicall error`);
            break;
        }
    }

    // Process promotion
    if (toPromote.length > 0) {
        dashboard.logEvent(`🔥 Auditor: PROMOTED ${toPromote.length} users!`);
        toPromote.forEach(addr => {
            killList.add(addr);
        });
    }

    // Clean up safeUsers
    const remainingSafe = safeUsers.filter(u => !toPromote.includes(u) && !ToDelete.includes(u));

    if (ToDelete.length > 0) {
        dashboard.logEvent(`🗑️ Auditor: Cleaned ${ToDelete.length} inactive users.`);
    }

    persistLists(remainingSafe);
    dashboard.logEvent(`✅ Auditor: Scan complete.`);
}

/**
 * Starts the continuous Auditor loop
 */
export function startAuditor() {
    dashboard.logEvent('🏁 Auditor: Process initialized.');

    // Run immediately on start
    runAudit().catch(console.error);

    // Schedule periodic runs
    setInterval(() => {
        runAudit().catch(console.error);
    }, AUDIT_INTERVAL);
}

/**
 * External helper to add a user to the tiered system
 */
export async function enqueueUser(userAddress: string) {
    const addr = userAddress.toLowerCase();

    // Safety: Quick exit if already known or being processed
    if (killList.has(addr) || processingCache.has(addr)) return;

    let safeUsers = getSafeUsers();
    if (safeUsers.includes(addr)) return;

    processingCache.add(addr);

    try {
        const data = await fetchHealthFactor(addr);
        if (!data || data.totalDebtBase === 0n) {
            processingCache.delete(addr);
            return;
        }

        const hf = Number(formatUnits(data.healthFactor, 18));
        if (hf < PROMOTION_HF) {
            killList.add(addr);
            dashboard.logEvent(`🚨 Tracker: ${addr.slice(0, 8)} -> Hot List`);
        } else {
            // Re-fetch safe list to ensure consistency before push
            const currentSafe = getSafeUsers();
            if (!currentSafe.includes(addr)) {
                currentSafe.push(addr);
                persistLists(currentSafe);
                dashboard.logEvent(`🧊 Tracker: ${addr.slice(0, 8)} -> Cold List`);
            }
        }
    } catch (e) {
    } finally {
        processingCache.delete(addr);
    }
}

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
