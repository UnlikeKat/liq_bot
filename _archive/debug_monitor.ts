import { CONFIG } from '../bot/config.js';
import { LiquidityMonitor } from '../bot/liquidityMonitor.js';

async function main() {
    console.log("🧪 Verifying Liquidity Monitor Logic...");

    const monitor = new LiquidityMonitor();

    await (monitor as any).checkLiquidity();
    console.log("   ✅ Check Complete");

    const eurcSource = LiquidityMonitor.getSource(CONFIG.TOKENS.EURC); // EURC
    const usdcSource = LiquidityMonitor.getSource(CONFIG.TOKENS.USDC); // USDC

    console.log(`\n📊 Results:`);
    console.log(`   EURC Source: ${eurcSource.label} (ID: ${eurcSource.source})`);
    console.log(`   USDC Source: ${usdcSource.label} (ID: ${usdcSource.source})`);

    // Expectations:
    // EURC -> Uniswap (ID 1) because we know Balancer is empty.
    // USDC -> Balancer (ID 0) probably.

    if (eurcSource.source === 1) {
        console.log("   ✅ EURC correctly mapped to Uniswap.");
    } else {
        console.error("   ❌ EURC mapping incorrect!");
    }

    if (usdcSource.source === 0) {
        console.log("   ✅ USDC correctly mapped to Balancer.");
    } else {
        console.log("   ℹ️ USDC mapped to other (Expected if Balancer low).");
    }
}
main();
