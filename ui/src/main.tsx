import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LiquidationHistoryPage } from './LiquidationHistoryPage.tsx'
import { CompetitionPage } from './CompetitionPage.tsx'
import { CategoryDetailPage } from './CategoryDetailPage.tsx'
import { Trophy, LayoutDashboard, BarChart2 } from 'lucide-react'
import { useBotSocket } from './useBotSocket'



// Wrapper for Analytics
function AnalyticsPageWrapper({ state }: { state: any }) {
  return <CompetitionPage history={state.liquidationHistory} />;
}

// Wrapper for Detail Page
function DetailPageWrapper({ state }: { state: any }) {
  return <CategoryDetailPage history={state.liquidationHistory} />;
}

// Navigation wrapper component
function AppWithNav() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { state, connected, sendCommand } = useBotSocket(); // Lifted State

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col bg-black">
      {/* DESKTOP NAVIGATION BAR (Hidden on Mobile) */}
      <nav className="hidden md:flex h-16 bg-black/80 border-b border-white/10 items-center px-6 gap-6 shrink-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
          <span className="font-black text-sm tracking-widest uppercase">Liquidation<span className="text-cyan-400">Bot</span></span>
        </div>
        <Link to="/" className={`flex items-center gap-2 px-3 py-1.5 rounded transition-all ${currentPath === '/' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'text-zinc-500 hover:text-white'}`}>
          <LayoutDashboard className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wide">Dashboard</span>
        </Link>
        <Link to="/history" className={`flex items-center gap-2 px-3 py-1.5 rounded transition-all ${currentPath === '/history' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' : 'text-zinc-500 hover:text-white'}`}>
          <Trophy className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wide">History</span>
        </Link>
        <Link to="/analytics" className={`flex items-center gap-2 px-3 py-1.5 rounded transition-all ${currentPath.startsWith('/analytics') ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50' : 'text-zinc-500 hover:text-white'}`}>
          <BarChart2 className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wide">Analytics</span>
        </Link>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-zinc-500 uppercase font-black">Network</span>
            <span className="text-xs font-mono text-cyan-400">BASE MAINNET</span>
          </div>
        </div>
      </nav>

      {/* GLOBAL MOBILE BOTTOM NAV BAR */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0a0a0c] border-t border-white/10 z-[60] flex items-center justify-around px-4 pb-safe shadow-2xl">
        <Link to="/" className={`flex flex-col items-center gap-1 p-2 ${currentPath === '/' ? 'text-cyan-400' : 'text-zinc-500 hover:text-white'}`}>
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest">Dash</span>
        </Link>
        <Link to="/history" className={`flex flex-col items-center gap-1 p-2 ${currentPath === '/history' ? 'text-cyan-400' : 'text-zinc-500 hover:text-white'}`}>
          <Trophy className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest">History</span>
        </Link>
        <Link to="/analytics" className={`flex flex-col items-center gap-1 p-2 ${currentPath.startsWith('/analytics') ? 'text-cyan-400' : 'text-zinc-500 hover:text-white'}`}>
          <BarChart2 className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-widest">Analytics</span>
        </Link>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-hidden overflow-y-auto custom-scrollbar pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<App socketState={{ state, connected, sendCommand }} />} />
          <Route path="/history" element={<LiquidationHistoryPage history={state.liquidationHistory} progress={state.progress} />} />
          <Route path="/analytics" element={<AnalyticsPageWrapper state={state} />} />
          <Route path="/analytics/:id" element={<DetailPageWrapper state={state} />} />
        </Routes>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppWithNav />
    </BrowserRouter>
  </StrictMode>,
)
