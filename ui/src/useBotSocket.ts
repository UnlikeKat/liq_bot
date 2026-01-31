import { useState, useEffect, useRef } from 'react';

export function useBotSocket() {
    const [state, setState] = useState({
        killList: [] as any[],
        sniperLogs: [],
        eventLogs: [] as any[],
        liquidationHistory: [] as any[],
        status: { wallet: '0.00', gas: '0', uptime: '0h 0m 0s', network: 'BASE MAINNET', heartbeat: 0 },
        stats: { totalAttempts: 0, successCount: 0, failedCount: 0, totalProfitUSD: 0, basicRpcCalls: 0, premiumRpcCalls: 0, lastPulse: Date.now() },
        progress: {} as Record<string, number>,
        safeUsers: { count: 0, lastUpdate: 0, removed: 0, promoted: 0 }
    });
    const [connected, setConnected] = useState(false);
    const [lastPulseTime, setLastPulseTime] = useState(Date.now());
    const ws = useRef<WebSocket | null>(null);
    const lastHeartbeat = useRef<number>(Date.now());

    useEffect(() => {
        let timeoutId: any;
        let checkInterval: any;
        let isCleaningUp = false;

        const connect = () => {
            if (isCleaningUp) return;

            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }

            const socket = new WebSocket('ws://localhost:3001');
            ws.current = socket;

            socket.onopen = () => {
                if (isCleaningUp) {
                    socket.close();
                    return;
                }
                setConnected(true);
                lastHeartbeat.current = Date.now();
            };

            socket.onclose = () => {
                if (isCleaningUp) return;
                setConnected(false);
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(connect, 3000);
            };

            socket.onerror = () => {
                console.error('WebSocket error occurred');
            };

            socket.onmessage = (event) => {
                try {
                    const { type, data } = JSON.parse(event.data);

                    lastHeartbeat.current = Date.now();

                    if (type === 'PULSE') {
                        setLastPulseTime(Date.now());
                        setState(prev => ({
                            ...prev,
                            stats: {
                                ...prev.stats,
                                basicRpcCalls: data.basicRpcCalls,
                                premiumRpcCalls: data.premiumRpcCalls
                            }
                        }));
                    }
                    setState((prev: any) => {
                        if (type === 'INIT') return { ...prev, ...data };
                        if (type === 'KILL_LIST') return { ...prev, killList: data };
                        if (type === 'SNIPER') return { ...prev, sniperLogs: [data, ...prev.sniperLogs].slice(0, 100) };
                        if (type === 'EVENT') return { ...prev, eventLogs: [data, ...prev.eventLogs].slice(0, 200) };
                        if (type === 'STATS') return { ...prev, stats: data };
                        if (type === 'SAFE_USERS') return { ...prev, safeUsers: data };
                        if (type === 'LIQUIDATION_HISTORY') return { ...prev, liquidationHistory: data };
                        if (type === 'NEW_LIQUIDATION') {
                            return { ...prev, liquidationHistory: [data, ...prev.liquidationHistory] };
                        }
                        if (type === 'PROGRESS') {
                            if (data.percent === -1) {
                                const nextProgress = { ...prev.progress };
                                delete nextProgress[data.job];
                                return { ...prev, progress: nextProgress };
                            }
                            const newProgress = { ...prev.progress, [data.job]: data.percent };
                            return { ...prev, progress: newProgress };
                        }
                        if (type === 'STATUS') {
                            return { ...prev, status: data };
                        }
                        return prev;
                    });
                } catch (e) { }
            };
        };

        connect();

        checkInterval = setInterval(() => {
            if (isCleaningUp) return;

            const timeSinceLastMessage = Date.now() - lastHeartbeat.current;
            const isSocketOpen = ws.current?.readyState === WebSocket.OPEN;

            const shouldBeConnected = isSocketOpen && timeSinceLastMessage <= 15000;

            setConnected(prev => {
                if (prev !== shouldBeConnected) {
                    console.log(`🔌 Connection: ${prev} → ${shouldBeConnected} | Socket open: ${isSocketOpen} | Last msg: ${timeSinceLastMessage}ms ago`);
                }
                return shouldBeConnected;
            });
        }, 2000);

        return () => {
            isCleaningUp = true;
            if (ws.current) ws.current.close();
            clearTimeout(timeoutId);
            clearInterval(checkInterval);
        };
    }, []);

    return { state, connected, lastPulseTime };
}
