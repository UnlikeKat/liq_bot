import { startWatcher, startPriorityScanner, startBackgroundScanner, periodicBasicRefresh, healthFactorCache, killList } from './watcher.js';
import { startDiscovery, loadSeedData } from './discovery.js';
import { LiquidityMonitor } from './liquidityMonitor.js';
import { checkAndExecute } from './executor.js';
import { startTracker } from './tracker.js';
import { startAuditor } from './auditor.js';
import { CONFIG, premiumClient } from './config.js';
import { dashboard } from './logger.js';
import { bridge } from './server.js';
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const START_TIME = Date.now();

/**
 * Main bot dash orchestration
 */
async function main() {
    try {
        const isGuiMode = process.argv.includes('--gui');

        if (isGuiMode) {
            console.log('🤖 Aave V3 Liquidation Bot Starting (GUI Mode - TUI Disabled)...');
        } else {
            dashboard.logEvent('🤖 Aave V3 Liquidation Bot Starting (TUI Mode)...');
        }

        // 1. Initial Data Load
        loadSeedData();

        // 2. Start Bot Modules
        console.log('\n==================================================');
        console.log('🚀 LIQUIDATION BOT STARTING... (v2.1 BATCHING FIX)');
        console.log('==================================================\n');

        bridge.start(); // Start WebSocket Server
        await startWatcher();
        startPriorityScanner();    // Premium RPC: 1s refresh for TOP 25
        startBackgroundScanner();  // WSS RPC: 10s refresh for REST
        periodicBasicRefresh();    // Basic RPC: 5min refresh for safe users
        await startTracker();
        startDiscovery();

        // 2a. Start Liquidity Monitor (Background)

        // 2a. Start Liquidity Monitor (Background)
        const monitor = new LiquidityMonitor();
        monitor.start();


        // 3. Load History & Fill Gaps (non-blocking)
        // This automatically:
        // - Loads existing liquidation_history.json
        // - Detects any gaps (e.g., bot was offline 4pm-1am)
        // - Fetches ONLY the missing liquidations
        // - Broadcasts complete history to UI
        console.log('\n📂 Initializing liquidation history (with gap detection)...');
        const { initializeLiquidationHistory } = await import('./services/gap_filler.js');

        initializeLiquidationHistory().then(liquidationHistory => {
            bridge.broadcast('LIQUIDATION_HISTORY', liquidationHistory);
            console.log(`✅ Liquidation history ready: ${liquidationHistory.length} records\n`);
        }).catch(error => {
            console.error('❌ Failed to initialize liquidation history:', error);
        });

        // 4. Status Polling Loop
        const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);

        setInterval(async () => {
            try {
                bridge.recordPremiumRpc(); // Heartbeat uses premium client for balance/gas
                const [balance, gasPrice] = await Promise.all([
                    premiumClient.getBalance({ address: account.address }),
                    premiumClient.getGasPrice()
                ]);

                const gasGwei = (Number(gasPrice) / 1e9).toFixed(2);

                if (isGuiMode) {
                    const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
                    const h = Math.floor(uptimeSeconds / 3600);
                    const m = Math.floor((uptimeSeconds % 3600) / 60);
                    const s = uptimeSeconds % 60;
                    const uptimeStr = `${h}h ${m}m ${s}s`;

                    bridge.broadcast('STATUS', {
                        wallet: formatEther(balance).slice(0, 6),
                        gas: gasGwei,
                        uptime: uptimeStr,
                        network: 'BASE MAINNET',
                        heartbeat: Date.now()
                    });
                } else {
                    dashboard.updateStatus(formatEther(balance).slice(0, 6), gasGwei);
                }
            } catch (e) { }
        }, 1000);

        // 5. Execution Loop
        setInterval(async () => {
            if (killList.size > 0) {
                for (const address of killList) {
                    const position = healthFactorCache.get(address);
                    if (position) {
                        await checkAndExecute(position);
                    }
                }
            }
        }, 10000);


        // 6. Manual Command Hook
        bridge.onCommand = async (cmd) => {
            if (cmd.action === 'LIQUIDATE_USER') {
                const userAddr = cmd.data.address;
                const position = healthFactorCache.get(userAddr);
                if (position) {
                    dashboard.logEvent(`🕹️ GUI: Manual Liquidation triggered for ${userAddr.slice(0, 10)}`, 'System');
                    await checkAndExecute(position);
                } else {
                    dashboard.logEvent(`⚠️ GUI: Manual Trigger failed - ${userAddr.slice(0, 10)} not in active cache`, 'System');
                }
            }
        };

        if (!isGuiMode) {
            dashboard.logEvent('🚀 Bot Heartbeat: Active', 'System');
        } else {
            console.log('🚀 Bot Heartbeat: Active (Streaming to GUI)');
        }

    } catch (error) {
        console.error(`❌ FATAL ERROR: ${error}`);
        process.exit(1);
    }
}

main().catch(console.error);
