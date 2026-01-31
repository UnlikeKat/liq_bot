import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Target,
  Zap,
  ShieldAlert,
  Wallet,
  Gauge,
  Clock,
  ChevronRight,
  Cpu,
  ExternalLink,
  Flame,
  LineChart,
  Trophy,
  Eye,
  ArrowRightLeft,
  X,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for tailwind class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Custom Hook for Bot WebSocket
function useBotSocket() {
  const [state, setState] = useState({
    killList: [] as any[],
    sniperLogs: [] as any[],
    eventLogs: [] as any[],
    liquidationHistory: [] as any[],
    status: { wallet: '0.00', gas: '0', uptime: '0h 0m 0s', network: 'BASE MAINNET', heartbeat: 0 },
    stats: { totalAttempts: 0, successCount: 0, failedCount: 0, totalProfitUSD: 0, basicRpcCalls: 0, premiumRpcCalls: 0, lastPulse: Date.now() },
    progress: {} as Record<string, number>,
    safeUsers: { count: 0, lastUpdate: 0, removed: 0, promoted: 0 }
  });
  const [connected, setConnected] = useState(false);
  const [connectUrl, setConnectUrl] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastPulseTime, setLastPulseTime] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const lastHeartbeat = useRef<number>(Date.now());

  useEffect(() => {
    let timeoutId: any;
    let checkInterval: any;
    let isCleaningUp = false;

    const connect = () => {
      if (ws.current) ws.current.close();

      const host = window.location.hostname;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${host}:3001`;

      console.log(`🔌 Attempting WebSocket connection to: ${url}`);
      setConnectUrl(url);

      const socket = new WebSocket(url);
      ws.current = socket;

      socket.onopen = () => {
        console.log(`✅ WebSocket Connected to ${url}`);
        setConnected(true);
        setLastError(null);
        setRetryCount(0);
        lastHeartbeat.current = Date.now();
      };

      socket.onclose = (event) => {
        if (isCleaningUp) return; // Don't reconnect during cleanup
        setConnected(false);
        console.warn(`🔌 WebSocket Closed: Code ${event.code}, Reason: ${event.reason || 'None'}`);
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setRetryCount(prev => prev + 1);
          connect();
        }, 3000);
      };

      socket.onerror = (error) => {
        console.error('❌ WebSocket error occurred:', error);
        setLastError('Connection failed. Verify Port 3001 is open on VPS Firewall.');
      };

      socket.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);

          // Update heartbeat on any message (not just STATUS)
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

    // Improved connection check: rely on WebSocket state AND last message time
    checkInterval = setInterval(() => {
      const timeSinceLastMessage = Date.now() - lastHeartbeat.current;
      const isSocketOpen = ws.current?.readyState === WebSocket.OPEN;

      // Calculate what the state should be
      const shouldBeConnected = isSocketOpen && timeSinceLastMessage <= 15000;

      // Only update if state needs to change
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

  const sendCommand = (action: string, data: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action, data }));
    }
  };

  return { state, connected, connectUrl, lastError, retryCount, lastPulseTime, sendCommand };
}

// Simple component for relative time refresh
function RelativeTime({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const diff = Math.floor((now - timestamp) / 1000);
  return <span>{diff}s ago</span>;
}

export default function App() {
  const { state, connected, connectUrl, lastError, retryCount, lastPulseTime, sendCommand } = useBotSocket();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'All' | 'Market' | 'System' | 'Discovery'>('All');
  const [activeRadarTab, setActiveRadarTab] = useState<'High Value' | 'Dust Bin'>('High Value');
  const [mobileView, setMobileView] = useState<'radar' | 'execution' | 'feed' | 'status'>('radar');
  const [showFullHeader, setShowFullHeader] = useState(false);
  const [inspectedEvent, setInspectedEvent] = useState<any>(null);

  const openExplorer = (id: string, type: 'tx' | 'address' = 'tx') => {
    const url = `https://basescan.org/${type}/${id}`;
    window.open(url, '_blank', 'rel=noopener');
  };

  const filteredLogs = [...state.eventLogs].filter(log =>
    activeTab === 'All' || log.category === activeTab
  );

  const DUST_THRESHOLD = 15.0;
  const highValueTargets = state.killList.filter(u => (Number(u.totalDebtBase) / 1e8) >= DUST_THRESHOLD);
  const dustTargets = state.killList.filter(u => (Number(u.totalDebtBase) / 1e8) < DUST_THRESHOLD);

  const currentRadarTargets = activeRadarTab === 'High Value' ? highValueTargets : dustTargets;

  const batchLogs = (state.sniperLogs as any[]).filter(log => log.message.includes('BATCH'));
  const individualLogs = (state.sniperLogs as any[]).filter(log => !log.message.includes('BATCH'));

  const navItems = [
    { id: 'radar', label: 'Radar', icon: Target },
    { id: 'execution', label: 'Snipes', icon: Flame },
    { id: 'feed', label: 'Feed', icon: Activity },
    { id: 'status', label: 'Stats', icon: BarChart3 }
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden text-white font-sans bg-[#0a0a0c] p-1 md:p-2 gap-1 md:gap-2">

      {/* SIDEBAR: TARGET RADAR (Hidden on mobile unless active) */}
      <aside className={cn(
        "w-full md:w-80 flex flex-col mica-container shrink-0",
        mobileView !== 'radar' && "hidden md:flex"
      )}>
        <div className="panel-header shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" />
            <span>Target Radar</span>
            <span className="ml-auto text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded font-black">
              {currentRadarTargets.length}
            </span>
          </div>

          <div className="flex bg-black/40 rounded p-0.5 border border-white/5">
            <button
              onClick={() => setActiveRadarTab('High Value')}
              className={cn(
                "flex-1 text-[8px] py-1 rounded font-black uppercase tracking-widest transition-all",
                activeRadarTab === 'High Value' ? "bg-cyan-500 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              High Value ({highValueTargets.length})
            </button>
            <button
              onClick={() => setActiveRadarTab('Dust Bin')}
              className={cn(
                "flex-1 text-[8px] py-1 rounded font-black uppercase tracking-widest transition-all",
                activeRadarTab === 'Dust Bin' ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Dust Bin ({dustTargets.length})
            </button>
          </div>
        </div>

        {/* PROGRESS OVERLAY (Discovery only) - Auto-hide at 100% */}
        {state.progress['Discovery Scan'] !== undefined && state.progress['Discovery Scan'] < 100 && (
          <div className="px-2 pt-2">
            <div className="bg-black/40 border border-white/5 rounded p-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] font-black text-cyan-500 uppercase tracking-widest">Discovery Scan</span>
                <span className="text-[9px] font-black text-white">{state.progress['Discovery Scan']}%</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${state.progress['Discovery Scan']}%` }}
                  className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
          {currentRadarTargets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Activity className="w-8 h-8 text-zinc-800 animate-pulse" />
              <div className="text-center text-zinc-700 uppercase font-black text-[10px] tracking-widest italic px-4">
                {activeRadarTab === 'High Value' ? "Scanning for Alpha..." : "Background Noise Clear"}
              </div>
            </div>
          )}
          {currentRadarTargets.map((user: any) => (
            <motion.div
              layout
              key={user.address}
              onClick={() => setSelectedUser(user)}
              className={cn(
                "p-3 rounded-lg border border-white/5 transition-all cursor-pointer relative overflow-hidden",
                selectedUser?.address === user.address ? "bg-cyan-500/15 border-cyan-500/40" : "hover:bg-white/5 hover:border-white/10",
                (Number(user.healthFactor) / 1e18) < 1.01 && "border-red-500/50 bg-red-500/10 critical-pulse"
              )}
            >
              {/* V10: Visual Refresh Pulse Background */}
              <motion.div
                key={user.lastUpdate}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="absolute inset-0 bg-cyan-500/20 pointer-events-none"
              />

              <div className="flex justify-between items-start mb-1 leading-none relative z-10">
                <div className="flex flex-col">
                  <span className="text-[11px] font-mono text-white/50 leading-none">
                    {user.address.slice(0, 10)}...{user.address.slice(-6)}
                  </span>
                  <span className="text-[8px] text-zinc-600 font-bold uppercase mt-1 leading-none">
                    Refreshed: <RelativeTime timestamp={user.lastUpdate} />
                  </span>
                </div>
                <ChevronRight className="w-3 h-3 text-white/20" />
              </div>
              <div className="flex justify-between items-end relative z-10">
                <div className="flex flex-col">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-tighter font-black">Health Factor</span>
                  <span className={cn(
                    "text-lg font-black tracking-tighter leading-none",
                    (Number(user.healthFactor) / 1e18) < 1.1 ? "text-red-400 glow-red" : "text-cyan-400 glow-cyan"
                  )}>
                    {(Number(user.healthFactor) / 1e18).toFixed(6)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-zinc-500 block uppercase font-black leading-none mb-1 text-zinc-600">Debt</span>
                  <span className="text-sm font-bold text-white/90">
                    ${(Number(user.totalDebtBase) / 1e8).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </aside>

      {/* MAIN VIEW */}
      <main className={cn(
        "flex-1 flex flex-col min-w-0 gap-1 md:gap-2 overflow-hidden",
        (mobileView === 'radar') && "hidden md:flex"
      )}>

        {/* TOP STATUS BAR (Condensed on mobile) */}
        <header className="mica-container shrink-0 flex flex-col overflow-hidden relative">
          <div className={cn(
            "flex flex-col md:flex-row md:h-14 items-stretch md:items-center justify-between px-3 md:px-6 border-b border-white/[0.03]",
            !showFullHeader && "h-12 md:h-14 overflow-hidden"
          )}>
            <div className="flex flex-wrap md:flex-nowrap gap-4 md:gap-10 py-2 md:py-0">
              <div className="flex items-center gap-2 md:gap-3">
                <Wallet className="w-4 h-4 md:w-5 md:h-5 text-emerald-400" />
                <div className="flex flex-col">
                  <span className="text-[7px] md:text-[9px] text-zinc-600 uppercase font-black tracking-widest leading-none mb-0.5 md:mb-1">Gas Account</span>
                  <span className="text-sm md:text-base font-black tracking-tight glow-green leading-none">{state.status.wallet} ETH</span>
                </div>
              </div>
              <div className={cn("flex items-center gap-3", !showFullHeader && "hidden md:flex")}>
                <Gauge className="w-5 h-5 text-amber-500" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest leading-none mb-1">Gas Price</span>
                  <span className="text-base font-black tracking-tight text-white leading-none">{state.status.gas} GWEI</span>
                </div>
              </div>
              <div className={cn("flex items-center gap-3", !showFullHeader && "hidden md:flex")}>
                <Clock className="w-5 h-5 text-blue-400" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest leading-none mb-1">Session</span>
                  <span className="text-base font-black tracking-tight text-white leading-none">{state.status.uptime}</span>
                </div>
              </div>
              <div className={cn("flex items-center gap-3", !showFullHeader && "hidden md:flex")}>
                <ShieldAlert className="w-5 h-5 text-green-400" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest leading-none mb-1">Safe Tier</span>
                  <span className="text-base font-black tracking-tight text-green-400 leading-none">{state.safeUsers.count.toLocaleString()} users</span>
                </div>
              </div>
            </div>

            <div className="absolute top-2 right-2 md:static flex items-center gap-2 md:gap-6">
              <button
                onClick={() => setShowFullHeader(!showFullHeader)}
                className="md:hidden p-1 rounded bg-white/5 border border-white/10"
              >
                {showFullHeader ? <X className="w-3 h-3 text-zinc-400" /> : <BarChart3 className="w-3 h-3 text-cyan-400" />}
              </button>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5 md:gap-2.5 px-2 md:px-3 py-1 md:py-1.5 rounded bg-black/40 border border-white/5 group">
                  <motion.div
                    animate={{ scale: connected ? 1 : 0.9 }}
                    transition={{ duration: 0.2 }}
                    className={cn("w-1.5 h-1.5 md:w-2 md:h-2 rounded-full transition-colors duration-300", connected ? "bg-green-500 shadow-[0_0_12px_rgba(34,197,94,1)]" : "bg-red-600 shadow-[0_0_10px_rgba(220,38,38,1)]")}
                  />
                  <span className="text-[8px] md:text-[10px] font-black tracking-widest leading-none uppercase">
                    {connected ? "CORE ONLINE" : "OFFLINE"}
                  </span>
                </div>
                {showFullHeader && !connected && (
                  <div className="flex flex-col items-end mt-2 md:hidden">
                    <span className="text-[8px] text-zinc-600 font-bold uppercase">
                      Target: {connectUrl} {retryCount > 0 && `(Retry #${retryCount})`}
                    </span>
                    {lastError && (
                      <span className="text-[8px] text-red-500 font-black uppercase animate-pulse">
                        Error: {lastError}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={cn(
            "h-auto py-2 bg-black/30 flex flex-wrap md:flex-nowrap items-center px-6 gap-6 md:gap-10",
            !showFullHeader && "hidden md:flex"
          )}>
            {!connected && (
              <div className="hidden md:flex flex-col">
                <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-tight">
                  Target: {connectUrl} {retryCount > 0 && `(Retry #${retryCount})`}
                </span>
                {lastError && (
                  <span className="text-[8px] text-red-500 font-black uppercase tracking-tight animate-pulse">
                    Error: {lastError}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-[10px] font-black text-zinc-600 uppercase">Yield:</span>
              <span className="text-[11px] font-black text-emerald-400 glow-green tracking-tight">${state.stats.totalProfitUSD.toFixed(2)} USDC</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] font-black text-zinc-600 uppercase">Success:</span>
              <span className="text-[11px] font-black text-white tracking-tight">
                {state.stats.totalAttempts > 0 ? ((state.stats.successCount / state.stats.totalAttempts) * 100).toFixed(1) : "0.0"}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <LineChart className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] font-black text-zinc-600 uppercase">RPC Flow:</span>
              <div className="flex flex-col leading-none">
                <div className="flex items-baseline gap-1">
                  <span className="text-[11px] font-black text-cyan-400 tracking-tight">{(state.stats.basicRpcCalls || 0).toLocaleString()}</span>
                  <span className="text-[8px] text-zinc-600 font-bold uppercase">DRPC</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[11px] font-black text-magenta-400 tracking-tight">{(state.stats.premiumRpcCalls || 0).toLocaleString()}</span>
                  <span className="text-[8px] text-zinc-600 font-bold uppercase">ALCH</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[10px] font-black text-zinc-600 uppercase">Pulse:</span>
              <span className="text-[11px] font-black text-white px-2 py-0.5 bg-white/5 rounded whitespace-nowrap">
                <RelativeTime timestamp={lastPulseTime} />
              </span>
            </div>
          </div>
        </header>

        {/* DASHBOARD CONTENT GRID (Switches to single view on mobile) */}
        <div className={cn(
          "flex-1 p-1 md:p-2 min-h-0",
          mobileView !== 'radar' ? "grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-2" : "hidden md:grid md:grid-cols-2"
        )}>

          {/* SNIPER LOG (Hidden on mobile if not active) */}
          <div className={cn(
            "flex flex-col mica-container overflow-hidden",
            mobileView !== 'execution' && "hidden md:flex"
          )}>
            <div className="panel-header shrink-0 flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500 fill-orange-500/20" />
              <span>Sniper Execution History</span>
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-black/40">
              {/* Top Half: Batch History */}
              <div className="flex-1 flex flex-col min-h-0 border-b border-white/5">
                <div className="px-3 py-1 bg-white/5 flex items-center justify-between">
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Batch Operations</span>
                  <span className="text-[8px] font-bold text-zinc-600 italic">Total: {batchLogs.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1 custom-scrollbar">
                  <AnimatePresence initial={false}>
                    {batchLogs.length === 0 && <div className="py-4 text-center text-zinc-800 uppercase font-black text-[9px] tracking-widest italic opacity-20">No Batches Yet...</div>}
                    {batchLogs.map((log: any, i) => {
                      const txHash = log.message.match(/0x[a-fA-F0-9]{64}/)?.[0];
                      return (
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={`batch-${i}`}
                          className={cn(
                            "group flex gap-2 p-1.5 rounded border border-white/5 leading-tight transition-all",
                            log.success ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/10" : "bg-red-500/5 text-red-300 border-red-500/10"
                          )}
                        >
                          <span className="text-zinc-600 font-black shrink-0">[{log.time}]</span>
                          <span className="font-black underline shrink-0 uppercase tracking-tighter text-[9px]">{log.success ? "EXEC" : "REVE"}</span>
                          <div className="font-medium flex-1 break-words">
                            {log.message.split(txHash || '...')[0]}
                            {txHash && (
                              <span
                                onClick={() => openExplorer(txHash)}
                                className="ml-2 font-mono text-cyan-400 underline cursor-pointer hover:text-cyan-100 transition-all text-[8px] bg-white/5 px-1 rounded"
                              >
                                {txHash.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>

              {/* Bottom Half: Individual Liquidations */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-3 py-1 bg-white/5 flex items-center justify-between">
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Individual Snipes</span>
                  <span className="text-[8px] font-bold text-zinc-600 italic">Total: {individualLogs.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1 custom-scrollbar">
                  <AnimatePresence initial={false}>
                    {individualLogs.length === 0 && <div className="py-4 text-center text-zinc-800 uppercase font-black text-[9px] tracking-widest italic opacity-20">Monitoring Single Targets...</div>}
                    {individualLogs.map((log: any, i) => {
                      const txHash = log.message.match(/0x[a-fA-F0-9]{64}/)?.[0];
                      return (
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={`single-${i}`}
                          className={cn(
                            "group flex gap-2 p-1.5 rounded border border-white/5 leading-tight transition-all",
                            log.success ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/10" : "bg-red-500/5 text-red-300 border-red-500/10"
                          )}
                        >
                          <span className="text-zinc-600 font-black shrink-0">[{log.time}]</span>
                          <span className="font-black underline shrink-0 uppercase tracking-tighter text-[9px]">{log.success ? "EXEC" : "REVE"}</span>
                          <div className="font-medium flex-1 break-words">
                            {log.message.split(txHash || '...')[0]}
                            {txHash && (
                              <span
                                onClick={() => openExplorer(txHash)}
                                className="ml-2 font-mono text-cyan-400 underline cursor-pointer hover:text-cyan-100 transition-all text-[8px] bg-white/5 px-1 rounded"
                              >
                                {txHash.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          {/* MARKET FEED (Hidden on mobile if not active) */}
          <div className={cn(
            "flex flex-col mica-container overflow-hidden border-blue-500/5",
            mobileView !== 'feed' && "hidden md:flex"
          )}>
            <div className="panel-header shrink-0 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <span>Live Intelligence Stream</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 bg-black/40 rounded py-0.5 border border-white/[0.05] overflow-x-auto custom-scrollbar no-scrollbar">
                {['All', 'Market', 'System', 'Discovery'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={cn(
                      "text-[8px] px-2 py-0.5 rounded font-black uppercase tracking-widest transition-all",
                      activeTab === tab ? "bg-blue-500 text-white shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "text-zinc-500 hover:text-white"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 font-mono text-[11px] bg-black/40 custom-scrollbar flex flex-col pt-2">
              {filteredLogs.length === 0 && <div className="flex items-center justify-center p-20 text-zinc-800 uppercase font-black text-[9px] tracking-widest italic opacity-20">No matching signals...</div>}
              <AnimatePresence initial={false}>
                {[...filteredLogs].reverse().map((log: any, i) => {
                  const isRich = !!log.richData;
                  return (
                    <motion.div
                      initial={{ opacity: 0, x: 5 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={i}
                      onClick={() => isRich && setInspectedEvent(log)}
                      className={cn(
                        "flex gap-3 text-zinc-500 hover:text-white transition-all py-1.5 px-3 border-b border-white/[0.02] hover:bg-white/[0.03] group",
                        isRich && "cursor-pointer border-l-2",
                        log.richData?.type === 'HF_COMPARISON' ? "border-l-magenta-500/40 bg-magenta-500/[0.02]" : "border-l-blue-500/40 bg-blue-500/[0.02]"
                      )}>
                      <span className="text-zinc-700 font-bold shrink-0 text-[9px]">[{log.time}]</span>
                      <span className={cn(
                        "font-black uppercase tracking-widest text-[8px] shrink-0 w-14 text-center px-1 rounded",
                        log.category === 'Market' ? "bg-blue-500/10 text-blue-400" :
                          log.category === 'Discovery' ? "bg-cyan-500/10 text-cyan-400" : "bg-white/5 text-zinc-500"
                      )}>
                        {log.category || 'LOG'}
                      </span>
                      <span className="leading-tight tracking-tight flex-1 break-words whitespace-pre-wrap">{log.message}</span>
                      {isRich && (
                        <Eye className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* BOTTOM INSPECTOR FOOTER (Hidden on mobile if not active view or condensed) */}
        <footer className={cn(
          "h-32 mica-container bg-gradient-to-r from-magenta-500/10 via-transparent to-transparent border-magenta-500/20 p-3 md:p-5 flex gap-4 md:gap-10 shrink-0 relative overflow-hidden",
          mobileView !== 'status' && "hidden md:flex"
        )}>
          {selectedUser ? (
            <div className="flex flex-col md:flex-row items-stretch md:items-center w-full gap-4 md:gap-10">
              <div className="flex flex-col justify-center min-w-0 md:min-w-[350px] relative z-10">
                <span className="text-[8px] md:text-[10px] font-black text-magenta-500 uppercase tracking-[0.3em] mb-1 md:mb-2 flex items-center gap-2 leading-none">
                  <Cpu className="w-3 md:w-3.5 h-3 md:h-3.5" /> Positional Analytics
                </span>
                <div className="flex items-center justify-between md:justify-start gap-3">
                  <div
                    onClick={() => openExplorer(selectedUser.address, 'address')}
                    className="cursor-pointer group min-w-0"
                  >
                    <h2 className="text-sm md:text-2xl font-mono font-black tracking-tighter text-white group-hover:text-magenta-400 transition-all truncate" style={{ textShadow: 'none' }} onMouseEnter={(e) => e.currentTarget.style.textShadow = '0 0 10px rgba(217,70,239,0.4), 0 0 20px rgba(217,70,239,0.2)'} onMouseLeave={(e) => e.currentTarget.style.textShadow = 'none'}>
                      {selectedUser.address.slice(0, 10)}...{selectedUser.address.slice(-6)}
                    </h2>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => sendCommand('LIQUIDATE_USER', { address: selectedUser.address })}
                    className="px-3 md:px-4 py-1.5 md:py-2 rounded bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/30 font-black text-[8px] md:text-[10px] uppercase tracking-widest transition-all"
                  >
                    Snipe
                  </motion.button>
                </div>
              </div>
              <div className="hidden md:block h-full w-px bg-white/5" />
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-12 items-center relative z-10">
                <div className="flex flex-col">
                  <span className="text-[8px] md:text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-0.5 md:mb-1 leading-none">Debt Pool</span>
                  <span className="text-lg md:text-3xl font-black tracking-tighter text-white/90 leading-none">${(Number(selectedUser.totalDebtBase) / 1e8).toLocaleString()}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] md:text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-0.5 md:mb-1 leading-none">Collateral</span>
                  <span className="text-lg md:text-3xl font-black tracking-tighter text-white/90 leading-none">${(Number(selectedUser.totalCollateralBase) / 1e8).toLocaleString()}</span>
                </div>
                <div className="flex flex-col col-span-2 md:col-span-1">
                  <span className="text-[8px] md:text-[10px] text-magenta-500 font-black uppercase tracking-widest mb-0.5 md:mb-1 leading-none font-bold">Health Factor</span>
                  <span className={cn("text-lg md:text-3xl font-black tracking-tighter leading-none", (Number(selectedUser.healthFactor) / 1e18) < 1.1 ? "text-red-500 glow-red" : "text-cyan-400 glow-cyan")}>
                    {(Number(selectedUser.healthFactor) / 1e18).toFixed(6)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full text-zinc-800 gap-3 select-none">
              <RefreshCw className="w-5 md:w-6 h-5 md:h-6 border-zinc-800 opacity-20 animate-spin-slow" />
              <span className="font-black uppercase tracking-[0.3em] text-xs md:text-sm italic opacity-30">Monitoring Market</span>
            </div>
          )}
        </footer>
      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="md:hidden flex mica-container border-t border-white/10 h-16 shrink-0 mt-auto overflow-hidden">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setMobileView(item.id as any)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 transition-all",
              mobileView === item.id ? "text-cyan-400 bg-white/5" : "text-zinc-500"
            )}
          >
            <item.icon className={cn("w-5 h-5", mobileView === item.id ? "text-cyan-400" : "text-zinc-600")} />
            <span className="text-[9px] font-black uppercase tracking-widest">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* DEEP INSPECTION MODAL */}
      <AnimatePresence>
        {inspectedEvent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-10"
          >
            {inspectedEvent.richData?.type === 'HF_COMPARISON' ? (
              // HEALTH FACTOR COMPARISON MODAL
              <div className="mica-container w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(217,70,239,0.3)] border-magenta-500/30">
                <div className="panel-header flex items-center justify-between shrink-0 bg-magenta-500/10">
                  <div className="flex items-center gap-3">
                    <ArrowRightLeft className="w-5 h-5 text-magenta-400" />
                    <span className="text-white">POSITION IMPACT ANALYSIS</span>
                    <span className="text-[9px] font-black bg-magenta-500/20 text-magenta-400 px-2 py-0.5 rounded">
                      {inspectedEvent.richData.affectedUsers.length} POSITIONS
                    </span>
                  </div>
                  <button onClick={() => setInspectedEvent(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  <div className="flex flex-col gap-2 mb-4">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Source Transaction</span>
                    <div
                      onClick={() => openExplorer(inspectedEvent.richData.txHash)}
                      className="p-3 bg-black/40 border border-white/5 rounded-lg flex items-center justify-between group cursor-pointer"
                    >
                      <span className="font-mono text-magenta-400 group-hover:text-magenta-200 transition-colors uppercase text-sm">{inspectedEvent.richData.txHash}</span>
                      <ExternalLink className="w-4 h-4 text-white/20 group-hover:text-magenta-400" />
                    </div>
                  </div>

                  {/* Position Impact Summary */}
                  <div className="flex gap-4 mb-4 p-4 bg-black/40 border border-white/5 rounded-lg">
                    <div className="flex items-center gap-2">
                      <ArrowDownRight className="w-4 h-4 text-red-400" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Deteriorated:</span>
                      <span className="text-lg font-black text-red-400">
                        {inspectedEvent.richData.affectedUsers.filter((u: any) => (u.after.hf - u.before.hf) < 0).length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-green-400" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Improved:</span>
                      <span className="text-lg font-black text-green-400">
                        {inspectedEvent.richData.affectedUsers.filter((u: any) => (u.after.hf - u.before.hf) > 0).length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Minus className="w-4 h-4 text-zinc-500" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Unchanged:</span>
                      <span className="text-lg font-black text-zinc-400">
                        {inspectedEvent.richData.affectedUsers.filter((u: any) => (u.after.hf - u.before.hf) === 0).length}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {inspectedEvent.richData.affectedUsers.map((user: any, idx: number) => {
                      const hfDelta = user.after.hf - user.before.hf;
                      const isWorse = hfDelta < 0;
                      const debtDelta = user.after.debt - user.before.debt;
                      const collateralDelta = user.after.collateral - user.before.collateral;

                      return (
                        <div key={idx} className="mica-container bg-white/[0.01] border-white/5 p-4 rounded-lg">
                          <div className="flex items-center justify-between mb-4">
                            <div
                              onClick={() => openExplorer(user.address, 'address')}
                              className="font-mono text-sm text-cyan-400 hover:text-cyan-200 cursor-pointer transition-colors flex items-center gap-2"
                            >
                              <span>{user.address.slice(0, 20)}...</span>
                              <ExternalLink className="w-3 h-3" />
                            </div>
                            <div className={cn(
                              "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase",
                              isWorse ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                            )}>
                              {isWorse ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                              {isWorse ? "DETERIORATED" : "IMPROVED"}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-6">
                            {/* Health Factor */}
                            <div className="flex flex-col">
                              <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mb-2">Health Factor</span>
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">BEFORE</span>
                                  <span className="text-lg font-black text-white/70">{user.before.hf.toFixed(4)}</span>
                                </div>
                                <ArrowRightLeft className="w-4 h-4 text-zinc-700" />
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">AFTER</span>
                                  <span className={cn(
                                    "text-lg font-black",
                                    isWorse ? "text-red-400 glow-red" : "text-emerald-400 glow-green"
                                  )}>
                                    {user.after.hf.toFixed(4)}
                                  </span>
                                </div>
                              </div>
                              <div className={cn(
                                "text-[10px] font-black mt-2 flex items-center gap-1",
                                isWorse ? "text-red-400" : "text-emerald-400"
                              )}>
                                {isWorse ? <Minus className="w-3 h-3" /> : "+"}{Math.abs(hfDelta).toFixed(4)}
                              </div>
                            </div>

                            {/* Debt */}
                            <div className="flex flex-col">
                              <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mb-2">Debt</span>
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">BEFORE</span>
                                  <span className="text-lg font-black text-white/70">${user.before.debt.toLocaleString()}</span>
                                </div>
                                <ArrowRightLeft className="w-4 h-4 text-zinc-700" />
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">AFTER</span>
                                  <span className="text-lg font-black text-white/90">${user.after.debt.toLocaleString()}</span>
                                </div>
                              </div>
                              <div className="text-[10px] font-black text-zinc-500 mt-2">
                                {debtDelta > 0 ? "+" : ""}{debtDelta.toFixed(2)}
                              </div>
                            </div>

                            {/* Collateral */}
                            <div className="flex flex-col">
                              <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mb-2">Collateral</span>
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">BEFORE</span>
                                  <span className="text-lg font-black text-white/70">${user.before.collateral.toLocaleString()}</span>
                                </div>
                                <ArrowRightLeft className="w-4 h-4 text-zinc-700" />
                                <div className="flex flex-col flex-1">
                                  <span className="text-[8px] text-zinc-600 mb-1">AFTER</span>
                                  <span className="text-lg font-black text-white/90">${user.after.collateral.toLocaleString()}</span>
                                </div>
                              </div>
                              <div className="text-[10px] font-black text-zinc-500 mt-2">
                                {collateralDelta > 0 ? "+" : ""}{collateralDelta.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              // ORIGINAL RESERVE UPDATE MODAL
              <div className="mica-container w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(59,130,246,0.2)] border-blue-500/30">
                <div className="panel-header flex items-center justify-between shrink-0 bg-blue-500/10">
                  <div className="flex items-center gap-3">
                    <Activity className="w-5 h-5 text-blue-400" />
                    <span className="text-white">ON-CHAIN RESERVE UPDATE INSPECTOR</span>
                  </div>
                  <button onClick={() => setInspectedEvent(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Source Transaction</span>
                    <div
                      onClick={() => openExplorer(inspectedEvent.richData.txHash)}
                      className="p-3 bg-black/40 border border-white/5 rounded-lg flex items-center justify-between group cursor-pointer"
                    >
                      <span className="font-mono text-cyan-400 group-hover:text-cyan-200 transition-colors uppercase">{inspectedEvent.richData.txHash}</span>
                      <ExternalLink className="w-4 h-4 text-white/20 group-hover:text-cyan-400" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 relative">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                        <Activity className="w-4 h-4 text-zinc-500" />
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Reserve Rates (Post-Update)</span>
                      </div>

                      {/* Explanation Box */}
                      <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                        <p className="text-[11px] text-cyan-200 leading-relaxed">
                          <strong className="text-cyan-400">What this means:</strong> AAVE updated interest rates for these assets. When rates change, all borrowers' health factors shift.
                          Bot recalculates HF for <strong>ALL</strong> risky users (not just the 500 shown in UI) to detect new liquidation opportunities.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {inspectedEvent.richData.updates.map((up: any, idx: number) => (
                          <div key={idx} className="p-3 bg-white/[0.02] border border-white/[0.05] rounded flex flex-col gap-2">
                            <span className="text-[11px] font-mono text-cyan-400">{up.reserve}</span>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-[9px] text-zinc-600 block uppercase font-bold">Stable</span>
                                <span className="text-[12px] font-black text-white">{(Number(up.stableBorrowRate) / 1e25).toFixed(4)}%</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-zinc-600 block uppercase font-bold">Variable</span>
                                <span className="text-[12px] font-black text-white">{(Number(up.variableBorrowRate) / 1e25).toFixed(4)}%</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-2 text-magenta-500">
                        <Target className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">System Impact</span>
                      </div>
                      <div className="mica-container bg-magenta-500/[0.02] border-magenta-500/20 p-8 rounded-lg flex flex-col items-center justify-center gap-6">
                        <div className="relative">
                          <motion.div
                            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="absolute inset-0 bg-magenta-500 rounded-full blur-xl"
                          />
                          <ArrowRightLeft className="w-12 h-12 text-magenta-500 relative z-10" />
                        </div>
                        <div className="text-center">
                          <span className="text-[12px] font-black text-white uppercase tracking-widest block mb-1">Global Recalculation</span>
                          <span className="text-[10px] text-zinc-500 leading-relaxed max-w-[200px] block">
                            Triggering health factor updates for {state.killList.length} targets across all debt positions.
                          </span>
                        </div>
                      </div>

                      <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-lg flex items-center justify-between">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Network Latency</span>
                        <span className="text-xl font-black text-white">2.4ms</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
