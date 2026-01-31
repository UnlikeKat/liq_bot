import { WebSocketServer, WebSocket } from 'ws';

interface BotStats {
    totalAttempts: number;
    successCount: number;
    failedCount: number;
    totalProfitUSD: number;
    basicRpcCalls?: number;    // Public RPC tier
    premiumRpcCalls?: number;  // Premium RPC tier (Alchemy)
    rpcCalls?: number;         // Legacy - will be removed
    lastPulse: number;
}

interface BotState {
    killList: any[];
    sniperLogs: any[];
    eventLogs: any[];
    liquidationHistory: any[]; // Data persistence for new clients
    status: {
        wallet: string;
        gas: string;
        uptime: string;
        network: string;
    };
    stats: BotStats;
    progress: Record<string, number>; // Job Name -> Percentage
}

export class BridgeServer {
    private wss?: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    public currentState: BotState = {
        killList: [],
        sniperLogs: [],
        eventLogs: [],
        liquidationHistory: [], // Initialize empty
        status: { wallet: '0.00', gas: '0', uptime: '0h', network: 'BASE' },
        stats: {
            totalAttempts: 0,
            successCount: 0,
            failedCount: 0,
            totalProfitUSD: 0,
            rpcCalls: 0,
            lastPulse: Date.now()
        },
        progress: {}
    };

    // Callback for manual commands from UI
    public onCommand?: (cmd: { action: string, data: any }) => void;

    constructor() {
        // Init happens on start()
    }

    public start(port: number = 3001) {
        if (this.wss) return; // Already started

        try {
            this.wss = new WebSocketServer({ port, host: '0.0.0.0' });

            this.wss.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`\n❌ ERROR: Port ${port} is busy! Is the bot already running?`);
                    console.error(`   Try: netstat -ano | findstr :${port}`);
                    process.exit(1);
                } else {
                    console.error('❌ WebSocket Server Error:', err);
                }
            });
        } catch (e) { console.error(e); }

        this.wss?.on('connection', (ws: WebSocket, req) => {
            const ip = req.socket.remoteAddress;
            console.log(`🔌 New WebSocket Client Connected from: ${ip}`);
            this.clients.add(ws);

            // Send initial state with BigInt serialization fix
            ws.send(this.safeStringify({ type: 'INIT', data: this.currentState }));

            ws.on('close', () => {
                console.log(`🔌 WebSocket Client Disconnected: ${ip}`);
                this.clients.delete(ws);
            });

            ws.on('error', (err) => {
                console.error(`❌ Client WebSocket Error (${ip}):`, err);
            });

            ws.on('message', (message: Buffer) => {
                try {
                    const cmd = JSON.parse(message.toString());
                    console.log(`📥 Received command from ${ip}: ${cmd?.action}`);
                    this.handleCommand(cmd);
                } catch (e) { }
            });
        });

        console.log(`📡 Bridge: WebSocket server live on port ${port} (host: 0.0.0.0)`);

        // Keep-Alive Heartbeat (Prevents UI from timing out when idle)
        setInterval(() => {
            this.broadcast('HEARTBEAT', { time: Date.now() });
        }, 5000);
    }

    private safeStringify(obj: any): string {
        return JSON.stringify(obj, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
    }

    /**
     * Updates global bot statistics
     */
    public updateStats(update: Partial<BotStats>) {
        this.currentState.stats = { ...this.currentState.stats, ...update };
        this.broadcast('STATS', this.currentState.stats);
    }


    /**
     * Increments Basic RPC call counter (public client)
     */
    public recordBasicRpc() {
        this.currentState.stats.basicRpcCalls = (this.currentState.stats.basicRpcCalls || 0) + 1;
        this.currentState.stats.lastPulse = Date.now();
        this.broadcast('PULSE', {
            basicRpcCalls: this.currentState.stats.basicRpcCalls,
            premiumRpcCalls: this.currentState.stats.premiumRpcCalls || 0,
            time: Date.now()
        });
    }

    /**
     * Increments Premium RPC call counter (Alchemy/paid tier)
     */
    public recordPremiumRpc() {
        this.currentState.stats.premiumRpcCalls = (this.currentState.stats.premiumRpcCalls || 0) + 1;
        this.currentState.stats.lastPulse = Date.now();
        this.broadcast('PULSE', {
            basicRpcCalls: this.currentState.stats.basicRpcCalls || 0,
            premiumRpcCalls: this.currentState.stats.premiumRpcCalls,
            time: Date.now()
        });
    }

    public broadcast(type: string, data: any) {
        // Update local cache
        if (type === 'KILL_LIST') this.currentState.killList = data;
        if (type === 'SNIPER') this.currentState.sniperLogs = [...this.currentState.sniperLogs, data].slice(-1000);
        if (type === 'EVENT') this.currentState.eventLogs = [...this.currentState.eventLogs, data].slice(-2000);
        if (type === 'LIQUIDATION_HISTORY') this.currentState.liquidationHistory = data;
        if (type === 'NEW_LIQUIDATION') {
            this.currentState.liquidationHistory = [data, ...this.currentState.liquidationHistory].slice(0, 2000);
        }
        if (type === 'STATUS') this.currentState.status = data;
        if (type === 'STATS') this.currentState.stats = data;
        if (type === 'PROGRESS') {
            this.currentState.progress[data.job] = data.percent;
        }

        const payload = this.safeStringify({ type, data });

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    private handleCommand(cmd: any) {
        if (this.onCommand) {
            this.onCommand(cmd);
        }
        console.log(`🕹️ GUI COMMAND RECEIVED: ${cmd?.action}`);
    }
}

export const bridge = new BridgeServer();
