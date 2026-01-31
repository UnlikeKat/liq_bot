import type { LiquidationRecord } from "../../../bot/storage/liquidation_history";

export interface BucketStats {
    id: string;
    rangeLabel: string;
    minProfit: number;
    maxProfit: number;
    count: number;
    maxGasPaidETH: number; // Exact cost in ETH
    avgLatencyBlocks: number;
    avgBlockNumber: number;
    liquidations: LiquidationRecord[];
}

// Define brackets: [start, end)
// IDs will be used for routing: /analytics/under-1, /analytics/100-200
const BRACKETS = [
    { max: 1, label: '<$1', id: 'under-1' },
    { max: 5, label: '$1 - $5', id: '1-5' },
    { max: 10, label: '$5 - $10', id: '5-10' },
    { max: 20, label: '$10 - $20', id: '10-20' },
    { max: 30, label: '$20 - $30', id: '20-30' },
    { max: 40, label: '$30 - $40', id: '30-40' },
    { max: 50, label: '$40 - $50', id: '40-50' },
    { max: 60, label: '$50 - $60', id: '50-60' },
    { max: 70, label: '$60 - $70', id: '60-70' },
    { max: 80, label: '$70 - $80', id: '70-80' },
    { max: 90, label: '$80 - $90', id: '80-90' },
    { max: 100, label: '$90 - $100', id: '90-100' },
    { max: 200, label: '$100 - $200', id: '100-200' },
    { max: 300, label: '$200 - $300', id: '200-300' },
    { max: 400, label: '$300 - $400', id: '300-400' },
    { max: 500, label: '$400 - $500', id: '400-500' },
    { max: 600, label: '$500 - $600', id: '500-600' },
    { max: 700, label: '$600 - $700', id: '600-700' },
    { max: 800, label: '$700 - $800', id: '700-800' },
    { max: 900, label: '$800 - $900', id: '800-900' },
    { max: 1000, label: '$900 - $1000', id: '900-1000' },
    { max: 2000, label: '$1000 - $2000', id: '1000-2000' },
    { max: 3000, label: '$2000 - $3000', id: '2000-3000' },
    { max: 4000, label: '$3000 - $4000', id: '3000-4000' },
    { max: Infinity, label: '$4000+', id: '4000-plus' }
];

export function analyzeCompetition(history: LiquidationRecord[]): BucketStats[] {
    const buckets: BucketStats[] = BRACKETS.map((b, i) => {
        const prevMax = i === 0 ? 0 : BRACKETS[i - 1].max;
        return {
            id: b.id,
            rangeLabel: b.label,
            minProfit: prevMax,
            maxProfit: b.max,
            count: 0,
            maxGasPaidETH: 0,
            avgLatencyBlocks: 0,
            avgBlockNumber: 0,
            liquidations: []
        };
    });

    // Distribute
    history.forEach(liq => {
        if (liq.profitUSD <= 0) return; // Skip non-profitable

        const bucket = buckets.find(b => liq.profitUSD < b.maxProfit && liq.profitUSD >= b.minProfit);
        if (bucket) {
            bucket.liquidations.push(liq);
        }
    });

    // Calculate Stats for populated buckets
    return buckets
        .filter(b => b.liquidations.length > 0)
        .map(b => {
            const count = b.liquidations.length;

            // Gas in ETH
            // gasUsed * gasPrice = Wei
            // Wei / 1e18 = ETH
            const maxGasETH = Math.max(...b.liquidations.map(l => {
                const used = BigInt(l.gasUsed);
                const price = BigInt(l.gasPrice);
                const costWei = used * price;
                return Number(costWei) / 1e18;
            }));

            // Latency
            const totalLatency = b.liquidations.reduce((sum, l) => sum + (l.latencyBlocks || 0), 0);

            // Block Number
            const totalBlock = b.liquidations.reduce((sum, l) => sum + l.blockNumber, 0);

            return {
                ...b,
                count,
                maxGasPaidETH: maxGasETH,
                avgLatencyBlocks: count > 0 ? totalLatency / count : 0,
                avgBlockNumber: count > 0 ? totalBlock / count : 0,
                liquidations: b.liquidations.sort((a, b) => b.blockNumber - a.blockNumber) // Newest first
            };
        });
}
