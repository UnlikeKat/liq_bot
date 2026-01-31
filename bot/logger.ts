console.log('🔹 INIT: logger.ts');
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { CONFIG } from './config.js';
import { formatUnits } from 'viem';
import { bridge } from './server.js';

export class Dashboard {
    private screen: blessed.Widgets.Screen;
    private grid: contrib.grid;

    // Components
    private topBar: blessed.Widgets.BoxElement;
    private killListTable: any;
    private sniperLog: any;
    private eventLog: any;
    private inspector: blessed.Widgets.BoxElement;

    private startTime: number;
    private focusIndex: number = 0;
    private focusableElements: any[] = [];

    private cachedUsers: any[] = [];

    constructor() {
        const isGuiMode = process.argv.includes('--gui');

        if (!isGuiMode) {
            this.screen = blessed.screen({
                smartCSR: true,
                title: '🏹 AAVE V3 LIQUIDATOR | BASE COMMAND CENTER',
                fullUnicode: true
            });

            this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

            // 1. TOP BAR: SYSTEM HEALTH
            this.topBar = this.grid.set(0, 0, 2, 12, blessed.box, {
                label: ' [ SYSTEM STATUS ] ',
                content: 'Initializing...',
                tags: true,
                style: { border: { fg: 'white' }, fg: 'white' },
                padding: { left: 1, right: 1 }
            });

            // 2. KILL LIST (FOCUSABLE)
            this.killListTable = this.grid.set(2, 0, 7, 6, contrib.table, {
                keys: true,
                interactive: true,
                mouse: true,
                label: ' 🔥 KILL LIST (TAB TO FOCUS) ',
                width: '100%',
                height: '100%',
                border: { type: 'line', fg: 'cyan' },
                columnSpacing: 2,
                columnWidth: [14, 12, 10, 10],
                style: { header: { fg: 'cyan', bold: true }, border: { fg: 'cyan' } }
            });

            // 3. INSPECTOR (DETAILS)
            this.inspector = this.grid.set(9, 0, 3, 6, blessed.box, {
                label: ' 🧬 POSITION INSPECTOR ',
                tags: true,
                border: { type: 'line', fg: 'magenta' },
                padding: { left: 1, right: 1 }
            });

            // 4. SNIPER SCOPE (FOCUSABLE)
            this.sniperLog = this.grid.set(2, 6, 5, 6, contrib.log, {
                label: ' 🎯 SNIPER SCOPE (TRADES) ',
                keys: true,
                mouse: true,
                tags: true,
                border: { type: 'line', fg: 'red' },
                style: { border: { fg: 'red' } }
            });

            // 5. LIVE EVENT FEED (FOCUSABLE) 
            this.eventLog = this.grid.set(7, 6, 5, 6, contrib.log, {
                label: ' 📡 LIVE MARKET FEED ',
                keys: true,
                mouse: true,
                tags: true,
                border: { type: 'line', fg: 'blue' },
                style: { border: { fg: 'blue' } }
            });

            this.focusableElements = [
                this.killListTable,
                this.sniperLog,
                this.eventLog
            ];

            // --- INTERACTIVITY ---

            this.screen.key(['tab'], () => {
                this.focusIndex = (this.focusIndex + 1) % this.focusableElements.length;
                this.updateFocus();
            });

            this.killListTable.rows.on('select', (item: any, key: number) => {
                this.handleUserSelection(key);
            });

            this.screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

            this.updateFocus();
            this.screen.render();
        } else {
            // GUI Mode: No TUI
            console.log('🖥️ Output redirected to GUI/Console');
        }

        this.startTime = Date.now();
    }

    private updateFocus() {
        if (!this.screen) return;
        this.focusableElements.forEach((el, i) => {
            const isFocused = i === this.focusIndex;
            el.style.border.fg = isFocused ? 'white' : this.getDefaultBorder(el);
            el.options.label = isFocused ? ` {*} ${el.options.label.trim()} {*} ` : ` ${el.options.label.trim()} `;
            if (isFocused) el.focus();
        });
        this.screen.render();
    }

    private getDefaultBorder(el: any): string {
        if (el === this.killListTable) return 'cyan';
        if (el === this.sniperLog) return 'red';
        if (el === this.eventLog) return 'blue';
        return 'white';
    }

    private handleUserSelection(index: number) {
        if (!this.screen) return;
        const user = this.cachedUsers[index];
        if (!user) return;

        const hf = Number(formatUnits(user.healthFactor, 18)).toFixed(4);
        const col = formatUnits(user.totalCollateralBase, 8);
        const debt = formatUnits(user.totalDebtBase, 8);

        this.inspector.setContent(
            `{bold}USER SPEC:{/bold} ${user.address}\n` +
            `{cyan-fg}Collateral:{/cyan-fg} $${Number(col).toLocaleString()} | ` +
            `{yellow-fg}Debt:{/yellow-fg} $${Number(debt).toLocaleString()} | ` +
            `{magenta-fg}Health Factor:{/magenta-fg} {bold}${hf}{/bold}`
        );
        this.screen.render();
    }

    public updateStatus(walletBalance: string, gasPriceGwei: string) {
        const uptime = this.getUptime();
        const statusData = { wallet: walletBalance, gas: gasPriceGwei, uptime, network: 'BASE MAINNET' };

        // Sync to Bridge
        bridge.broadcast('STATUS', statusData);

        if (!this.screen) return; // Skip TUI update

        const balColor = parseFloat(walletBalance) > 0.01 ? '{green-fg}' : '{red-fg}';
        this.topBar.setContent(
            `{bold}BOT WALLET:{/bold} ${balColor}${walletBalance} ETH{/balColor}  |  ` +
            `{bold}GAS:{/bold} {yellow-fg}${gasPriceGwei} Gwei{/yellow-fg}  |  ` +
            `{bold}UPTIME:{/bold} ${uptime}  |  ` +
            `{bold}NETWORK:{/bold} {green-fg}BASE MAINNET{/green-fg}`
        );
        this.screen.render();
    }

    public logEvent(message: string, category: 'System' | 'Discovery' | 'Market' | 'Finance' = 'System') {
        const time = new Date().toLocaleTimeString();

        // Sync to Bridge
        bridge.broadcast('EVENT', { time, message, category });

        if (!this.screen) {
            console.log(`[${category}] ${message}`); // Fallback console log
            return;
        }

        this.eventLog.log(`{blue-fg}[${time}]{/blue-fg} ${message}`);
        this.screen.render();
    }

    public logSniper(success: boolean, message: string) {
        const time = new Date().toLocaleTimeString();

        // Sync to Bridge
        bridge.broadcast('SNIPER', { time, success, message });

        if (!this.screen) {
            console.log(`[SNIPER] ${message}`); // Fallback console log
            return;
        }

        const color = success ? 'green' : 'red';
        const icon = success ? '✅' : '❌';
        this.sniperLog.log(`{${color}-fg}[${time}] ${icon} ${message}{/${color}-fg}`);
        this.screen.render();
    }

    public updateKillList(users: any[]) {
        this.cachedUsers = users
            .sort((a, b) => Number(a.healthFactor) - Number(b.healthFactor))
            .slice(0, 500); // Show top 500 most critical users

        // Sync to Bridge
        bridge.broadcast('KILL_LIST', this.cachedUsers);

        if (!this.screen) return; // Skip TUI

        const data = this.cachedUsers.slice(0, 20).map(u => {
            const hf = Number(formatUnits(u.healthFactor, 18));
            const hfStr = hf < 1.0 ? `{red-fg}{blink}${hf.toFixed(4)}{/blink}{/red-fg}` : hf.toFixed(4);
            const debt = `$${Number(formatUnits(u.totalDebtBase, 8)).toFixed(2)}`;

            return [
                u.address.slice(0, 8) + '...' + u.address.slice(-6),
                debt,
                hfStr,
                hf < 1.0 ? '{red-fg}TARGET{/red-fg}' : 'STABLE'
            ];
        });

        this.killListTable.setData({
            headers: ['Address', 'Debt ($)', 'Health', 'Status'],
            data: data
        });

        if (this.cachedUsers.length > 0 && this.inspector.getContent() === '') {
            this.handleUserSelection(0);
        }

        this.screen.render();
    }

    private getUptime(): string {
        const seconds = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}h ${m}m ${s}s`;
    }
}

export const dashboard = new Dashboard();
