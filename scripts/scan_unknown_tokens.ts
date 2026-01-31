
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const HISTORY_FILE = path.resolve('data/liquidation_history.json');
const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

const ERC20_ABI = [
    { name: 'symbol', inputs: [], outputs: [{ type: 'string' }], type: 'function', stateMutability: 'view' },
    { name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], type: 'function', stateMutability: 'view' }
] as const;

async function scanTokens() {
    console.log(`🔍 TOKEN REGISTRY SCANNER`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Collect all unique assets
    const assets = new Set<string>();
    history.forEach((r: any) => {
        assets.add(r.collateralAsset.toLowerCase());
        assets.add(r.debtAsset.toLowerCase());
    });

    console.log(`Found ${assets.size} unique assets in history.`);

    // Check against CONFIG
    const configTokensRaw = CONFIG.TOKENS as Record<string, string>;
    const knownAddresses = Object.values(configTokensRaw).map(a => a.toLowerCase());

    const missingInConfig = [];
    const allTokenMetadata: Record<string, { symbol: string, decimals: number }> = {};

    // Scan All
    for (const asset of assets) {
        // Fetch metadata for ALL (to ensure we have decimals for everyone)
        try {
            const [symbol, decimals] = await Promise.all([
                client.readContract({ address: asset as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
                client.readContract({ address: asset as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' })
            ]);

            allTokenMetadata[asset] = { symbol, decimals };

            const isKnown = knownAddresses.includes(asset);
            if (!isKnown) {
                missingInConfig.push({ address: asset, symbol, decimals });
            }

            process.stdout.write('.');
        } catch (e) {
            console.error(`\nFailed to fetch for ${asset}`);
        }
    }

    console.log(`\n\n=== MISSING FROM CONFIG (${missingInConfig.length}) ===`);
    missingInConfig.forEach(t => console.log(`Address: ${t.address} | Symbol: ${t.symbol} | Decimals: ${t.decimals}`));

    console.log(`\n\n=== UI UPDATE CODE (Copy this to LiquidationHistoryPage.tsx) ===`);
    let symbolCode = `const tokens: Record<string, string> = {\n`;
    let decimalCode = `const decimals: Record<string, number> = {\n`;

    Object.entries(allTokenMetadata).forEach(([addr, meta]) => {
        symbolCode += `        '${addr}': '${meta.symbol}',\n`;
        decimalCode += `        '${addr}': ${meta.decimals}, // ${meta.symbol}\n`;
    });
    symbolCode += `    };`;
    decimalCode += `    };`;

    console.log(symbolCode);
    console.log("");
    console.log(decimalCode);

    // Save metadata for history rebuilder
    fs.writeFileSync('token_metadata_cache.json', JSON.stringify(allTokenMetadata, null, 2));
    console.log(`\nSaved metadata cache to token_metadata_cache.json`);
}

scanTokens();
