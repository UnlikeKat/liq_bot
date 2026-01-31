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

// Wrapper to connect history page to WebSocket data
function HistoryPageWrapper() {
  const { state } = useBotSocket();
  return <LiquidationHistoryPage
    history={state.liquidationHistory}
    progress={state.progress}
  />;
}

// Wrapper for Analytics
function AnalyticsPageWrapper() {
  const { state } = useBotSocket();
  return <CompetitionPage history={state.liquidationHistory} />;
}

// Wrapper for Detail Page
function DetailPageWrapper() {
  const { state } = useBotSocket();
  return <CategoryDetailPage history={state.liquidationHistory} />;
}

// Navigation wrapper component
function AppWithNav() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col bg-black">
      {/* Navigation Bar */}
      <nav className="h-12 bg-black/80 border-b border-white/10 flex items-center px-4 gap-4 shrink-0 z-50">
        <Link
          to="/"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${currentPath === '/'
            ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
            : 'text-zinc-500 hover:text-white hover:bg-white/5'
            }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span className="text-sm font-bold">Dashboard</span>
        </Link>
        <Link
          to="/history"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${currentPath === '/history'
            ? 'bg-yellow-500/20 border border-yellow-500/50 text-yellow-400'
            : 'text-zinc-500 hover:text-white hover:bg-white/5'
            }`}
        >
          <Trophy className="w-4 h-4" />
          <span className="text-sm font-bold">History</span>
        </Link>
        <Link
          to="/analytics"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${currentPath.startsWith('/analytics')
            ? 'bg-purple-500/20 border border-purple-500/50 text-purple-400'
            : 'text-zinc-500 hover:text-white hover:bg-white/5'
            }`}
        >
          <BarChart2 className="w-4 h-4" />
          <span className="text-sm font-bold">Analytics</span>
        </Link>
      </nav>

      {/* Page Content */}
      <div className="flex-1 overflow-hidden overflow-y-auto custom-scrollbar">
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/history" element={<HistoryPageWrapper />} />
          <Route path="/analytics" element={<AnalyticsPageWrapper />} />
          <Route path="/analytics/:id" element={<DetailPageWrapper />} />
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
