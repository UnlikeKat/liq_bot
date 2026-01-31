
import { checkAndExecute } from '../bot/executor.js';
import { UserPosition } from '../bot/interfaces.js';
import { parseUnits } from 'viem';

// Mock Config to bypass network if needed, but executor imports real config
// We rely on SIMULATE_ONLY=true in real config

async function main() {
    console.log('🧪 TESTING LOGIC UPDATE: Dust vs High Priority\n');

    // 1. Mock Dust Position ($50 Debt, HF 0.9)
    const dustPosition: UserPosition = {
        address: '0xDUST_USER_000000000000000000000000000001',
        totalCollateralBase: parseUnits('100', 8), // $100
        totalDebtBase: parseUnits('50', 8),        // $50
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8000n, // 80%
        ltv: 7500n,
        healthFactor: parseUnits('0.9', 18) // < 1.0 (Liquidatable)
    };

    console.log('--- TEST CASE 1: DUST (< $100) ---');
    await checkAndExecute(dustPosition);

    // 2. Mock High Priority Position ($500 Debt, HF 0.9)
    const whalePosition: UserPosition = {
        address: '0xWHALE_USER_00000000000000000000000000001',
        totalCollateralBase: parseUnits('1000', 8), // $1000
        totalDebtBase: parseUnits('500', 8),        // $500
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8000n,
        ltv: 7500n,
        healthFactor: parseUnits('0.9', 18)
    };

    console.log('\n--- TEST CASE 2: HIGH PRIORITY (>= $100) ---');
    await checkAndExecute(whalePosition);

    console.log('\n✅ Verification Complete.');
}

main().catch(console.error);
