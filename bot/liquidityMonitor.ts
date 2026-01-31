import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from './config.js';

// Simple ABI for Balance Checks
const ERC20_ABI = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)'
]);

interface FlashSourceConfig {
    source: number;
    pool?: string;
    label: string;
}

export class LiquidityMonitor {
    private client;
    private interval: NodeJS.Timeout | null = null;

    // Global State for Best Sources
    // Key: Token Address, Value: Source Config
    public static BEST_SOURCES: Record<string, FlashSourceConfig> = {};

    constructor() {
        this.client = createPublicClient({
            chain: base,
            transport: http(CONFIG.RPC_URL_PUBLIC), // Use Public/Background RPC
        });
    }

    public async start(intervalMs: number = 5 * 60 * 1000) {
        console.log(`💧 Liquidity Monitor Started (Interval: ${intervalMs / 1000}s)`);
        await this.checkLiquidity(); // Run immediately
        this.interval = setInterval(() => this.checkLiquidity(), intervalMs);
    }

    public stop() {
        if (this.interval) clearInterval(this.interval);
    }

    private async checkLiquidity() {
        console.log('   💧 Liquidity Check Running...');
        const tokens = Object.values(CONFIG.TOKENS);

        for (const token of tokens) {
            await this.evaluateToken(token);
        }
        console.log('   💧 Liquidity Check Complete.');
    }

    private async evaluateToken(tokenAddress: string) {
        try {
            // 1. Check Balancer (Source 0 - Preferred/Free)
            const balBalance = await this.client.readContract({
                address: tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [CONFIG.BALANCER_VAULT as `0x${string}`]
            });

            // 2. Decide
            // Rule: If Balancer > $10,000 USD, use it.

            // Get Price (Default to 0 if unknown)
            let price = 0;
            const tokenName = Object.keys(CONFIG.TOKENS).find(key =>
                (CONFIG.TOKENS as any)[key].toLowerCase() === tokenAddress.toLowerCase()
            );

            if (tokenName && (CONFIG.PRICES as any)[tokenName]) {
                price = (CONFIG.PRICES as any)[tokenName];
            }

            // Get Decimals
            const decimals = await this.client.readContract({
                address: tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'decimals'
            });

            const balanceFormatted = Number(formatUnits(balBalance, decimals));
            const usdValue = balanceFormatted * price;

            // console.log(`      ${tokenName || tokenAddress.slice(0,6)} Balancer Liq: $${usdValue.toFixed(2)}`);

            // Threshold: $10,000 (User Configured)
            const defaultSource = CONFIG.FLASH_SOURCES[tokenAddress];

            if (usdValue > 10000) {
                LiquidityMonitor.BEST_SOURCES[tokenAddress] = { source: 0, label: 'Balancer' };
            } else {
                // Balancer Low. Switch to Backup.
                if (defaultSource) {
                    LiquidityMonitor.BEST_SOURCES[tokenAddress] = { ...defaultSource, label: 'Uniswap/Other' };
                } else {
                    LiquidityMonitor.BEST_SOURCES[tokenAddress] = { source: 2, label: 'Aave V3' };
                }
            }

        } catch (e) {
            console.error(`   ⚠️ Failed to check liqudity for ${tokenAddress}`, e);
        }
    }

    // Helper to get source synchronously
    public static getSource(token: string): FlashSourceConfig {
        return this.BEST_SOURCES[token] || { source: 0, label: 'Balancer (Default)' };
    }
}
