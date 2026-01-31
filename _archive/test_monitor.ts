import { LiquidityMonitor } from '../bot/liquidityMonitor.js';
import { CONFIG } from '../bot/config.js';

async function main() {
    console.log('🧪 Testing Liquidity Monitor...');

    try {
        const monitor = new LiquidityMonitor();
        console.log('   ✅ Monitor Initialized');

        // We want to see what it picks for EURC and USDC.
        console.log('   🔄 Running checkLiquidity()...');
        await (monitor as any).checkLiquidity();
        console.log('   ✅ checkLiquidity() Complete');

        const eurcSource = LiquidityMonitor.getSource(CONFIG.TOKENS.EURC);
        const usdcSource = LiquidityMonitor.getSource(CONFIG.TOKENS.USDC);

        console.log(`\n📊 Results:`);
        console.log(`   EURC Source: ${eurcSource.label} (ID: ${eurcSource.source})`);
        console.log(`   USDC Source: ${usdcSource.label} (ID: ${usdcSource.source})`);

        if (eurcSource.source === 1 && usdcSource.source === 0) {
            console.log(`\n✅ TEST PASSED: Monitor correctly switched EURC to Uniswap and kept USDC on Balancer.`);
        } else {
            console.log(`\n❌ TEST FAILED: Unexpected sources.`);
        }
    } catch (e) {
        console.error('CRASH:', e);
    }
}

main().catch(console.error);
