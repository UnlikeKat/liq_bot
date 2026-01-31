const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./data/liquidations_7d.json', 'utf8'));

// Sort by block number (most recent first) and take top 10
const sorted = data.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber))).slice(0, 10);

fs.writeFileSync('./data/liquidations_recent.json', JSON.stringify(sorted, null, 2));

console.log(`✅ Filtered to ${sorted.length} most recent liquidations`);
console.log(`Latest block: ${sorted[0].blockNumber}`);
console.log(`Oldest in set: ${sorted[sorted.length - 1].blockNumber}`);
