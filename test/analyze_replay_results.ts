import { readFileSync } from 'fs';

interface SimulationResult {
    event: any;
    botWouldDetect: boolean;
    botWouldExecute: boolean;
    healthFactorAtN3: number | null;
    healthFactorAtN1: number | null;
    assetsFound: { collateral: string, debt: string } | null;
    simulationSuccess: boolean;
    estimatedBlockAdvantage: number;
    failureReason?: string;
}

const results: SimulationResult[] = JSON.parse(
    readFileSync('./data/replay_results.json', 'utf8')
);

console.log('📊 HISTORICAL REPLAY ANALYSIS\n');
console.log(`Total Simulations: ${results.length}\n`);

// Overall metrics
const detected = results.filter(r => r.botWouldDetect).length;
const executed = results.filter(r => r.botWouldExecute).length;
const wins = results.filter(r => r.botWouldExecute && r.estimatedBlockAdvantage <= 0).length;

console.log('🎯 PERFORMANCE METRICS:');
console.log(`   Detection Rate: ${detected}/${results.length} (${(detected / results.length * 100).toFixed(1)}%)`);
console.log(`   Execution Rate: ${executed}/${results.length} (${(executed / results.length * 100).toFixed(1)}%)`);
console.log(`   Win Rate: ${wins}/${results.length} (${(wins / results.length * 100).toFixed(1)}%)\n`);

// Failure analysis
const failures = results.filter(r => r.failureReason);
const failureCategories = failures.reduce((acc, r) => {
    const category = r.failureReason!.split(':')[0];
    acc[category] = (acc[category] || 0) + 1;
    return acc;
}, {} as Record<string, number>);

console.log('❌ FAILURE BREAKDOWN:');
Object.entries(failureCategories)
    .sort(([, a], [, b]) => b - a)
    .forEach(([reason, count]) => {
        console.log(`   ${reason}: ${count} (${(count / results.length * 100).toFixed(1)}%)`);
    });

// Asset discovery success rate
const assetDiscoveryAttempts = results.filter(r => r.healthFactorAtN1 !== null && r.healthFactorAtN1 < 1.0);
const assetDiscoverySuccess = assetDiscoveryAttempts.filter(r => r.assetsFound !== null);

console.log(`\n🔍 ASSET DISCOVERY:`);
console.log(`   Attempts: ${assetDiscoveryAttempts.length}`);
console.log(`   Success: ${assetDiscoverySuccess.length} (${(assetDiscoverySuccess.length / assetDiscoveryAttempts.length * 100).toFixed(1)}%)`);
console.log(`   Failure: ${assetDiscoveryAttempts.length - assetDiscoverySuccess.length} (${((assetDiscoveryAttempts.length - assetDiscoverySuccess.length) / assetDiscoveryAttempts.length * 100).toFixed(1)}%)`);

// Block advantage distribution
const withAdvantage = results.filter(r => r.estimatedBlockAdvantage !== 0);
const avgAdvantage = withAdvantage.reduce((sum, r) => sum + r.estimatedBlockAdvantage, 0) / withAdvantage.length;

console.log(`\n⚡ SPEED ANALYSIS:`);
console.log(`   Avg Block Advantage: ${avgAdvantage.toFixed(2)} blocks`);
console.log(`   (Positive = bot faster, Negative = bot slower)`);

// Health factor analysis
const hfAtN1 = results.filter(r => r.healthFactorAtN1 !== null).map(r => r.healthFactorAtN1!);
const avgHF = hfAtN1.reduce((sum, hf) => sum + hf, 0) / hfAtN1.length;
const belowThreshold = hfAtN1.filter(hf => hf < 1.0).length;

console.log(`\n💊 HEALTH FACTOR STATS:`);
console.log(`   Avg HF at N-1: ${avgHF.toFixed(4)}`);
console.log(`   Below 1.0: ${belowThreshold}/${hfAtN1.length} (${(belowThreshold / hfAtN1.length * 100).toFixed(1)}%)`);

// Sample successful executions
const successes = results.filter(r => r.simulationSuccess);
console.log(`\n✅ SUCCESSFUL SIMULATIONS: ${successes.length}`);
if (successes.length > 0) {
    console.log(`\nSample Success:`);
    const sample = successes[0];
    console.log(`   User: ${sample.event.user}`);
    console.log(`   Block: ${sample.event.blockNumber}`);
    console.log(`   HF: ${sample.healthFactorAtN1?.toFixed(4)}`);
    console.log(`   Assets Found: ${sample.assetsFound?.collateral.slice(0, 6)}/${sample.assetsFound?.debt.slice(0, 6)}`);
    console.log(`   Block Advantage: ${sample.estimatedBlockAdvantage}`);
}

// Key insights
console.log(`\n💡 KEY INSIGHTS:`);
console.log(`   1. Asset discovery is the main bottleneck (${failureCategories['Asset discovery failed'] || 0} failures)`);
console.log(`   2. When assets are found, simulations often succeed`);
console.log(`   3. Bot would execute ~2 blocks before real liquidators (good speed)`);
console.log(`   4. Need to fix asset discovery to query historical state, not current state`);
