import { parseAbiItem, formatUnits } from 'viem';
import { publicClient, CONFIG } from './config.js';
import { fetchHealthFactor, killList } from './watcher.js';
import { enqueueUser } from './auditor.js';
import { dashboard } from './logger.js';

/**
 * Adds a user to tracking via the Tiered lifecycle system
 */
async function trackUser(userAddress: string) {
    const addr = userAddress.toLowerCase();
    await enqueueUser(addr);
}

/**
 * Re-evaluates a user. If no debt, removed from active tracking.
 */
async function reevaluateUser(userAddress: string) {
    const addr = userAddress.toLowerCase();

    // Check both local memory and potential cold storage (handled by auditor logic)
    // But for active premium monitoring, we mainly care about killList
    if (!killList.has(addr)) return;

    const position = await fetchHealthFactor(addr);
    if (!position || position.totalDebtBase === 0n) {
        console.log(`👋 User exited or error (Removing): ${addr}`);
        killList.delete(addr);
    }
}

/**
 * Starts the User Tracker on the High-Limit Public RPC
 */
export async function startTracker() {
    console.log('📡 TRACKER (PUBLIC RPC): Real-time borrower discovery active.');

    // 1. Borrow Events
    publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'),
        onLogs: async (logs) => {
            for (const log of logs) {
                if (log.args.onBehalfOf) {
                    // Fetch user position to check total debt
                    const position = await fetchHealthFactor(log.args.onBehalfOf);
                    if (!position) continue;

                    // Only track if total debt >= $50 USD
                    const totalDebtUSD = Number(formatUnits(position.totalDebtBase, 8)); // Debt is in 8 decimals
                    if (totalDebtUSD >= 50) {
                        trackUser(log.args.onBehalfOf);
                    }
                }
            }
        }
    });

    // 2. Repay Events
    publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)'),
        onLogs: (logs) => {
            logs.forEach(log => {
                const user = log.args.user;
                if (user) reevaluateUser(user);
            });
        }
    });

    // 3. Liquidation Events
    publicClient.watchEvent({
        address: CONFIG.AAVE_POOL as `0x${string}`,
        event: parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'),
        onLogs: (logs) => {
            logs.forEach(log => {
                const user = log.args.user;
                if (user) {
                    console.log(`💧 Liquidation detected for ${user}`);
                    reevaluateUser(user);
                }
            });
        }
    });

    console.log('✅ TRKR: Listening for Borrow/Repay/LiquidationCall on PublicNode');
}
