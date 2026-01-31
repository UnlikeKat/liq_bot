import fs from 'fs';
import path from 'path';
import { BASE_TOKENS } from '../bot/services/token_registry.js';

// Load history
const historyPath = path.join(process.cwd(), 'data', 'liquidation_history.json');
const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

// Get all unique addresses from history
const usedAddresses = new Set<string>();
history.forEach((liq: any) => {
    if (liq.collateralAsset) usedAddresses.add(liq.collateralAsset.toLowerCase());
    if (liq.debtAsset) usedAddresses.add(liq.debtAsset.toLowerCase());
});

// Get known addresses
const knownAddresses = new Set(Object.keys(BASE_TOKENS).map(a => a.toLowerCase()));

// Find missing
const missing = Array.from(usedAddresses).filter(addr => !knownAddresses.has(addr));

console.log(`🔍 Analyzed ${history.length} records.`);
console.log(`Found ${usedAddresses.size} unique assets.`);
console.log(`Registry has ${knownAddresses.size} known assets.`);
console.log(`\n❌ MISSING ${missing.length} ASSETS:`);
missing.forEach(addr => console.log(addr));
