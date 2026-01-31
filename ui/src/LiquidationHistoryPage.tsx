import { useState } from 'react';
import { Search, Download, ExternalLink, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';

// Token helpers
function getTokenSymbol(address: string): string {
    const tokens: Record<string, string> = {
        '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': 'weETH',
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
        '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
        '0x4200000000000000000000000000000000000006': 'WETH',
        '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': 'EURC',
        '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDbC',
        '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'cbETH',
        '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee': 'GHO',
        '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'wstETH',
        '0x63706e401c06ac8513145b7687a14804d17f814b': 'AAVE',
        '0xecac9c5f704e954931349da37f60e39f515c11c1': 'LBTC',
        '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b': 'tBTC',
        '0x2416092f143378750bb29b79ed961ab195cceea5': 'ezETH',
        '0xedfa23602d0ec14714057867a78d01e94176bea0': 'wrsETH',
    };
    return tokens[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getTokenDecimals(address: string): number {
    const decimals: Record<string, number> = {
        '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': 18, // weETH
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6, // USDC
        '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8, // cbBTC
        '0x4200000000000000000000000000000000000006': 18, // WETH
        '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': 6, // EURC
        '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6, // USDbC
        '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 18, // cbETH
        '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee': 18, // GHO
        '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 18, // wstETH
        '0x63706e401c06ac8513145b7687a14804d17f814b': 18, // AAVE
        '0xecac9c5f704e954931349da37f60e39f515c11c1': 8, // LBTC
        '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b': 18, // tBTC
        '0x2416092f143378750bb29b79ed961ab195cceea5': 18, // ezETH
        '0xedfa23602d0ec14714057867a78d01e94176bea0': 18, // wrsETH
    };
    return decimals[address.toLowerCase()] || 18;
}

function formatTokenAmount(rawAmount: string, address: string): string {
    const decimals = getTokenDecimals(address);
    const amount = Number(rawAmount) / Math.pow(10, decimals);
    if (amount > 1000) return amount.toFixed(2);
    if (amount > 1) return amount.toFixed(4);
    return amount.toFixed(6);
}

interface LiquidationHistoryPageProps {
    history: any[];
    progress?: Record<string, number>;
}

function openExplorer(hash: string, type: 'tx' | 'address' = 'tx') {
    const baseUrl = 'https://basescan.org';
    const url = type === 'tx' ? `${baseUrl}/tx/${hash}` : `${baseUrl}/address/${hash}`;
    window.open(url, '_blank');
}

function formatTimestamp(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
}

function shortenAddress(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function LiquidationHistoryPage({ history, progress = {} }: LiquidationHistoryPageProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('90'); // 7, 30, 90 days
    const [hideDust, setHideDust] = useState(true); // Default hide dust (< $0.05)
    const [sortBy, setSortBy] = useState<'timestamp' | 'profitUSD' | 'blockNumber'>('timestamp');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // Filter by date range
    const filteredByDate = history.filter(liq => {
        const days = parseInt(dateFilter);
        const cutoff = Date.now() / 1000 - (days * 24 * 60 * 60);
        return liq.timestamp >= cutoff;
    });

    // Filter by search term AND dust
    const filtered = filteredByDate.filter(liq => {
        // Dust filter
        if (hideDust && Math.abs(liq.profitUSD) < 0.01) return false;

        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return liq.txHash.toLowerCase().includes(term) ||
            liq.user.toLowerCase().includes(term) ||
            liq.liquidator.toLowerCase().includes(term);
    });

    // Client-Side Batch Detection (Ensures live updates work instantly)
    const processedHistory = filtered.map(liq => {
        const batchItems = history.filter(h => h.txHash === liq.txHash);
        const batchCount = batchItems.length;
        const batchProfit = batchItems.reduce((sum, item) => sum + item.profitUSD, 0);

        return {
            ...liq,
            isBatch: batchCount > 1,
            batchSize: batchCount,
            batchProfit: batchProfit
        };
    });

    // Sort
    const sorted = [...processedHistory].sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        const multiplier = sortDir === 'asc' ? 1 : -1;
        return (aVal > bVal ? 1 : -1) * multiplier;
    });

    // Export to CSV
    const exportCSV = () => {
        const headers = ['Timestamp', 'Block', 'TxHash', 'User', 'Liquidator', 'Collateral', 'Debt', 'Profit USD', 'Gas Used'];
        const rows = sorted.map(liq => [
            formatTimestamp(liq.timestamp),
            liq.blockNumber,
            liq.txHash,
            liq.user,
            liq.liquidator,
            liq.collateralAsset,
            liq.debtAsset,
            liq.profitUSD.toFixed(2),
            liq.gasUsed
        ]);

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liquidations_${Date.now()}.csv`;
        a.click();
    };

    const totalProfit = sorted.reduce((sum, liq) => sum + liq.profitUSD, 0);

    return (
        <div className="min-h-screen bg-black text-white p-6">
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <Trophy className="w-8 h-8 text-yellow-500" />
                        <div>
                            <h1 className="text-3xl font-black tracking-tight">90-Day Liquidation History</h1>
                            <p className="text-sm text-zinc-500">Complete on-chain liquidation analytics</p>
                        </div>
                    </div>
                    <button
                        onClick={exportCSV}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        <span className="font-bold text-sm">Export CSV</span>
                    </button>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Total Liquidations</div>
                        <div className="text-2xl font-black text-white">{sorted.length.toLocaleString()}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Total Profit</div>
                        <div className="text-2xl font-black text-green-400">${totalProfit.toFixed(2)}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Avg Profit</div>
                        <div className="text-2xl font-black text-cyan-400">${(totalProfit / sorted.length || 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Date Range</div>
                        <div className="text-2xl font-black text-magenta-400">{dateFilter} Days</div>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex gap-4 mb-6">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Search by tx hash, user, or liquidator..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                        />
                    </div>

                    <button
                        onClick={() => setHideDust(!hideDust)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${hideDust
                            ? 'bg-amber-500/20 text-amber-500 border border-amber-500/50'
                            : 'bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10'
                            }`}
                    >
                        {hideDust ? 'Dust Hidden' : 'Show Dust'}
                    </button>

                    <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                        style={{ colorScheme: 'dark' }}
                    >
                        <option value="7" className="bg-zinc-900 text-white">Last 7 Days</option>
                        <option value="30" className="bg-zinc-900 text-white">Last 30 Days</option>
                        <option value="90" className="bg-zinc-900 text-white">Last 90 Days</option>
                    </select>

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                        style={{ colorScheme: 'dark' }}
                    >
                        <option value="timestamp" className="bg-zinc-900 text-white">Sort by Time</option>
                        <option value="profitUSD" className="bg-zinc-900 text-white">Sort by Profit</option>
                        <option value="blockNumber" className="bg-zinc-900 text-white">Sort by Block</option>
                    </select>

                    <button
                        onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
                        className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm hover:bg-white/10"
                    >
                        {sortDir === 'desc' ? '↓' : '↑'}
                    </button>
                </div>
            </div>

            {/* Liquidation List */}
            <div className="max-w-7xl mx-auto h-[calc(100vh-28rem)] overflow-y-auto space-y-2 pr-2 pb-20 md:pb-0">
                {sorted.slice(0, 50).map((liq, idx) => (
                    <motion.div
                        key={liq.txHash}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                        className="bg-white/5 border border-white/10 hover:border-cyan-500/50 rounded-lg p-4 transition-colors"
                    >
                        <div className="flex flex-col md:grid md:grid-cols-12 gap-2 items-start md:items-center">
                            {/* Timestamp & Block (2) */}
                            <div className="col-span-2">
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Time & Block</div>
                                <div className="text-sm text-white font-mono">{formatTimestamp(liq.timestamp)}</div>
                                <div className="text-xs text-cyan-400 font-mono">Block {liq.blockNumber.toLocaleString()}</div>
                            </div>

                            {/* Participant Addresses (2) */}
                            <div className="col-span-2 flex flex-col gap-1">
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Transaction</div>
                                    <div
                                        onClick={() => openExplorer(liq.txHash, 'tx')}
                                        className="text-xs text-cyan-400 font-mono hover:text-cyan-200 cursor-pointer flex items-center gap-1 truncate"
                                    >
                                        {shortenAddress(liq.txHash)} <ExternalLink className="w-2 h-2" />
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">User</div>
                                    <div
                                        onClick={() => openExplorer(liq.user, 'address')}
                                        className="text-xs text-magenta-400 font-mono hover:text-magenta-200 cursor-pointer flex items-center gap-1 truncate"
                                    >
                                        {shortenAddress(liq.user)} <ExternalLink className="w-2 h-2" />
                                    </div>
                                </div>
                            </div>

                            {/* Assets (2) */}
                            <div className="col-span-2">
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Assets</div>
                                <div className="text-xs text-white font-mono">
                                    <div className="text-cyan-400">{getTokenSymbol(liq.collateralAsset)}</div>
                                    <div className="text-magenta-400">{getTokenSymbol(liq.debtAsset)}</div>
                                </div>
                            </div>

                            {/* Amounts (2) */}
                            <div className="col-span-2">
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Amounts</div>
                                <div className="text-xs text-white font-mono">
                                    <div>{formatTokenAmount(liq.liquidatedCollateral, liq.collateralAsset)} {getTokenSymbol(liq.collateralAsset)}</div>
                                    <div>{formatTokenAmount(liq.debtToCover, liq.debtAsset)} {getTokenSymbol(liq.debtAsset)}</div>
                                </div>
                            </div>

                            {/* Profit & Gas (2) */}
                            <div className="col-span-2">
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Profit & Gas</div>
                                <div className={`text-lg font-black ${liq.profitUSD > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {Math.abs(liq.profitUSD) < 0.01 && liq.profitUSD !== 0
                                        ? '<$0.01'
                                        : `$${liq.profitUSD.toFixed(2)}`
                                    }
                                </div>
                                <div className="text-xs text-zinc-400 flex flex-col">
                                    <span>Gas: {parseInt(liq.gasUsed).toLocaleString()}</span>
                                    <span className="text-zinc-500">
                                        (${((Number(liq.totalGasCost) / 1e18) * 3300).toFixed(2)})
                                    </span>
                                </div>
                            </div>

                            {/* Forensics (New Column) */}
                            {liq.latencyBlocks !== undefined && (
                                <div className="col-span-2">
                                    <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Forensics</div>
                                    <div className="text-xs text-white">
                                        <span className="text-zinc-400">Late:</span> <span className="text-red-400 font-bold">{liq.latencyBlocks} blk</span>
                                    </div>
                                    <div className="text-xs text-zinc-500">
                                        (~{Math.floor(liq.latencyBlocks * 2 / 60)} min)
                                    </div>

                                    {/* Batch Badge & Profit */}
                                    {liq.isBatch && (
                                        <div className="mt-1 flex flex-col gap-1">
                                            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/50 text-[10px] font-bold w-fit">
                                                <span>📦 Bundle ({liq.batchSize})</span>
                                            </div>
                                            <div className="text-[10px] text-zinc-400">
                                                Batch Net: <span className={liq.batchProfit > 0 ? 'text-green-400' : 'text-red-400'}>
                                                    ${liq.batchProfit?.toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                ))}
                {sorted.length > 50 && (
                    <div className="text-center py-4 text-xs text-zinc-600 uppercase font-black tracking-widest">
                        Showing top 50 of {sorted.length} (Filter to see more)
                    </div>
                )}

                {sorted.length === 0 && (() => {
                    const fetchProgress = progress['INITIAL_LIQUIDATION_FETCH'] || progress['FILLING_LIQUIDATION_GAPS'] || 0;
                    const isLoading = history.length === 0 && fetchProgress >= 0;

                    return (
                        <div className="text-center py-20 text-zinc-600">
                            <Trophy className="w-16 h-16 mx-auto mb-4 opacity-20" />
                            <p className="text-lg font-bold">
                                {isLoading ? '⏳ Loading 90-day liquidation history...' : 'No liquidations found'}
                            </p>
                            <p className="text-sm mb-4">
                                {isLoading ? 'Fetching and analyzing on-chain data. This may take 10-15 minutes.' : 'Try adjusting your filters'}
                            </p>
                            {isLoading && fetchProgress > 0 && (
                                <div className="max-w-md mx-auto mt-6">
                                    <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-cyan-500 to-magenta-500 rounded-full transition-all duration-300"
                                            style={{ width: `${fetchProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-sm text-white mt-3 font-mono">{fetchProgress}% complete</p>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        {fetchProgress < 50 ? 'Fetching liquidation events...' : 'Analyzing on-chain data...'}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
