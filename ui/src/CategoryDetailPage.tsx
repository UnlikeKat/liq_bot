import { useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { LiquidationRecord } from '../../bot/storage/liquidation_history';
import { analyzeCompetition } from './utils/analytics';
import { ArrowLeft, ExternalLink, Flame } from 'lucide-react';

interface Props {
    history: LiquidationRecord[];
}

type TimeRange = '7d' | '30d' | '90d' | 'all';

export function CategoryDetailPage({ history }: Props) {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const timeRange = (searchParams.get('range') as TimeRange) || 'all';

    const filteredHistory = useMemo(() => {
        if (timeRange === 'all') return history;

        const now = Date.now() / 1000;
        const days = parseInt(timeRange); // '7d' -> 7
        const cutoff = now - (days * 24 * 60 * 60);

        return history.filter(h => h.timestamp >= cutoff);
    }, [history, timeRange]);

    const bucket = useMemo(() => {
        const buckets = analyzeCompetition(filteredHistory);
        return buckets.find(b => b.id === id);
    }, [filteredHistory, id]);

    const handleBack = () => {
        navigate(`/analytics?range=${timeRange}`);
    };

    if (!bucket) {
        return (
            <div className="p-10 text-center text-zinc-500">
                Category not found or empty for this time range. <button onClick={handleBack} className="text-blue-400 underline">Go back</button>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-black text-white">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={handleBack}
                    className="p-2 rounded-full bg-zinc-900 hover:bg-zinc-800 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-zinc-400" />
                </button>
                <div>
                    <div className="text-xs font-mono text-zinc-500 uppercase font-bold tracking-widest mb-1">
                        Category Analysis ({timeRange === 'all' ? 'ALL TIME' : timeRange.toUpperCase()})
                    </div>
                    <h1 className="text-3xl font-black font-mono">
                        Range: <span className="text-purple-400">{bucket.rangeLabel}</span>
                    </h1>
                </div>
                <div className="ml-auto flex gap-4">
                    <div className="px-4 py-2 bg-zinc-900 rounded-lg flex flex-col items-end">
                        <span className="text-[10px] text-zinc-500 uppercase font-black">Max Gas</span>
                        <span className="text-lg font-mono font-bold text-red-400">{bucket.maxGasPaidETH.toFixed(6)} ETH</span>
                    </div>
                    <div className="px-4 py-2 bg-zinc-900 rounded-lg flex flex-col items-end">
                        <span className="text-[10px] text-zinc-500 uppercase font-black">Avg Speed</span>
                        <span className="text-lg font-mono font-bold text-green-400">{Math.round(bucket.avgLatencyBlocks)} blk</span>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-zinc-900/30 border border-white/5 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/5 text-[10px] uppercase tracking-widest text-zinc-500">
                                <th className="p-4 font-black">Block / Time</th>
                                <th className="p-4 font-black">Tx Pos</th>
                                <th className="p-4 font-black">Profit (USD)</th>
                                <th className="p-4 font-black">Gas Paid (ETH)</th>
                                <th className="p-4 font-black">Latency</th>
                                <th className="p-4 font-black text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-base font-mono">
                            {bucket.liquidations.map((liq, i) => {
                                const gasCostEth = (BigInt(liq.gasUsed) * BigInt(liq.gasPrice)); // Wei
                                const gasEth = Number(gasCostEth) / 1e18; // ETH
                                const isTopBlock = liq.positionInBlock !== undefined && liq.positionInBlock < 3;

                                return (
                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-zinc-300">#{liq.blockNumber}</span>
                                                <span className="text-sm text-zinc-600 mt-1">{new Date(liq.timestamp * 1000).toLocaleString()}</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            {liq.positionInBlock !== undefined ? (
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-bold ${isTopBlock ? 'text-purple-400' : 'text-zinc-400'}`}>
                                                        idx:{liq.positionInBlock}
                                                    </span>
                                                    {isTopBlock && (
                                                        <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded uppercase font-black">
                                                            TOP
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-zinc-700 text-sm">--</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <span className="text-green-400 font-bold text-lg">${liq.profitUSD.toFixed(2)}</span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <Flame className="w-4 h-4 text-red-500/50" />
                                                <span className="text-red-300">{gasEth.toFixed(6)} ETH</span>
                                            </div>
                                            <div className="text-xs text-zinc-600 mt-1 ml-6">
                                                {(Number(liq.gasPrice) / 1e9).toFixed(2)} Gwei
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className={`font-bold ${liq.latencyBlocks && liq.latencyBlocks < 5 ? 'text-green-400' : 'text-yellow-500'}`}>
                                                    {liq.latencyBlocks} blocks
                                                </span>
                                                <span className="text-sm text-zinc-600 mt-1">
                                                    ~{(liq.latencyBlocks || 0) * 2 / 60} mins
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <a
                                                href={`https://basescan.org/tx/${liq.txHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                                            >
                                                Tx <ExternalLink className="w-4 h-4" />
                                            </a>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
