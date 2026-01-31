import React, { useMemo } from 'react';
import type { LiquidationRecord } from '../../bot/storage/liquidation_history';
import { analyzeCompetition } from './utils/analytics';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface Props {
    history: LiquidationRecord[];
}

type TimeRange = '7d' | '30d' | '90d' | 'all';

export function CompetitionPage({ history }: Props) {
    const [searchParams, setSearchParams] = useSearchParams();
    const timeRange = (searchParams.get('range') as TimeRange) || 'all';
    const navigate = useNavigate();

    const filteredHistory = useMemo(() => {
        if (timeRange === 'all') return history;

        const now = Date.now() / 1000;
        const days = parseInt(timeRange); // '7d' -> 7
        const cutoff = now - (days * 24 * 60 * 60);

        return history.filter(h => h.timestamp >= cutoff);
    }, [history, timeRange]);

    const buckets = useMemo(() => analyzeCompetition(filteredHistory), [filteredHistory]);

    const handleRangeChange = (newRange: TimeRange) => {
        setSearchParams({ range: newRange });
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto pb-32 md:pb-6">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
                        Competition Analysis
                    </h1>
                    <p className="text-zinc-400 mt-2">
                        Deep dive into competitor behavior by profit bracket. Determine the "Win Cost" (Max Gas) and "Win Speed" (Latency) for every opportunity size.
                    </p>
                </div>

                {/* Time Filter */}
                <div className="flex bg-zinc-900/50 p-1 rounded-lg border border-white/10 shrink-0">
                    {(['7d', '30d', '90d', 'all'] as TimeRange[]).map((range) => (
                        <button
                            key={range}
                            onClick={() => handleRangeChange(range)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${timeRange === range
                                ? 'bg-purple-500/20 text-purple-300 shadow-sm'
                                : 'text-zinc-500 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {range === 'all' ? 'All Time' : range.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {buckets.map((bucket, idx) => (
                    <motion.div
                        key={bucket.rangeLabel}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => navigate(`/analytics/${bucket.id}?range=${timeRange}`)}
                        className="bg-zinc-900/50 border border-white/10 rounded-xl p-5 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all cursor-pointer group"
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-3">
                            <h3 className="text-xl font-mono font-bold text-white group-hover:text-purple-300 transition-colors">{bucket.rangeLabel}</h3>
                            <span className="text-xs font-mono text-zinc-500 bg-white/5 px-2 py-1 rounded">
                                {bucket.count} events
                            </span>
                        </div>

                        {/* Metrics Grid */}
                        <div className="space-y-4">

                            {/* Max Gas Paid (The "Price to Win") */}
                            <div>
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Max Gas Paid (Win Cost)</div>
                                <div className="text-xl font-black text-red-400 font-mono">
                                    {bucket.maxGasPaidETH.toFixed(6)} ETH
                                </div>
                                <div className="text-[10px] text-zinc-500">
                                    Highest gas seen in this bracket
                                </div>
                            </div>

                            {/* Speed (Latency) */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-black/20 p-2 rounded">
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Avg Latency</div>
                                    <div className={`text-lg font-mono ${bucket.avgLatencyBlocks < 5 ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {Math.round(bucket.avgLatencyBlocks)} <span className="text-xs text-zinc-600">blk</span>
                                    </div>
                                </div>
                                <div className="bg-black/20 p-2 rounded">
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Avg Timing</div>
                                    <div className="text-lg font-mono text-blue-400">
                                        ~{Math.round(bucket.avgLatencyBlocks * 2 / 60)} <span className="text-xs text-zinc-600">min</span>
                                    </div>
                                </div>
                            </div>

                            {/* Recency (Avg Block) */}
                            <div>
                                <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Avg Occurrence Block</div>
                                <div className="text-sm font-mono text-zinc-300">
                                    #{Math.round(bucket.avgBlockNumber).toLocaleString()}
                                </div>
                            </div>

                        </div>
                    </motion.div>
                ))}
            </div>

            {buckets.length === 0 && (
                <div className="text-center text-zinc-500 mt-20">
                    No profitable liquidations found in this time range.
                </div>
            )}
        </div>
    );
}
