import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from 'dotenv';
import pLimit from 'p-limit';

config();

const HISTORY_FILE = './data/liquidation_history.json';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';
const WETH = '0x4200000000000000000000000000000000000006';

const ORACLE_ABI = parseAbi([
    'function getAssetPrice(address asset) view returns (uint256)'
]);

async function main() {
    console.log('🔧 Starting Historical Price Fixer...');

    if (!existsSync(HISTORY_FILE)) {
        console.error('❌ File not found:', HISTORY_FILE);
        return;
    }

    const rawData = readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);
    console.log(`📊 Found ${history.length} records to process.`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const limit = pLimit(3); // Lower concurrency to verify progress
    let fixedCount = 0;
    let failedCount = 0;
    let processed = 0;

    const tasks = history.map((record: any, index: number) => limit(async () => {
        try {
            const blockNumber = BigInt(record.blockNumber);
            processed++;
            if (processed % 5 === 0) console.log(`Processing ${processed}/${history.length}...`);

            // Timeout Wrapper
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000));

            // 1. Fetch Prices
            const fetchPromise = client.multicall({
                contracts: [
                    { address: AAVE_ORACLE, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [record.collateralAsset] },
                    { address: AAVE_ORACLE, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [record.debtAsset] },
                    { address: AAVE_ORACLE, abi: ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH] }
                ],
                blockNumber: blockNumber
            });

            const results = await Promise.race([fetchPromise, timeout]) as any;

            if (results.some((r: any) => r.status !== 'success')) {
                console.warn(`⚠️ Oracle check failed for TX ${record.txHash}`);
                failedCount++;
                return;
            }

            const collateralPrice = Number(formatUnits(results[0].result as bigint, 8));
            const debtPrice = Number(formatUnits(results[1].result as bigint, 8));
            const wethPrice = Number(formatUnits(results[2].result as bigint, 8));

            // 2. Normalize
            const decimals = getTokenDecimals(record.collateralAsset, record.debtAsset);

            const collatAmt = Number(formatUnits(BigInt(record.liquidatedCollateral), decimals.collateral));
            const debtAmt = Number(formatUnits(BigInt(record.debtToCover), decimals.debt));
            const gasCostETH = Number(formatUnits(BigInt(record.totalGasCost || '0'), 18));

            // 3. Profit
            const valCollateral = collatAmt * collateralPrice;
            const valDebt = debtAmt * debtPrice;
            const valGas = gasCostETH * wethPrice;

            const profitUSD = valCollateral - valDebt - valGas;

            // 4. Update
            record.profitUSD = profitUSD;
            record.estimatedProfit = profitUSD.toString();
            record._fixed = true;

            fixedCount++;

        } catch (e: any) {
            console.error(`❌ Error processing ${record.txHash}: ${e.message}`);
            failedCount++;
        }
    }));

    await Promise.all(tasks);
    console.log(`\n\n✅ Done! Fixed: ${fixedCount}, Failed: ${failedCount}`);

    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log('💾 Saved updated history to disk.');
}

function getTokenDecimals(col: string, debt: string) {
    const known: Record<string, number> = {
        '0x4200000000000000000000000000000000000006': 18, // WETH
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 6,  // USDC
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA': 6,  // USDbC
        '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf': 8,  // cbBTC
        '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42': 6,  // EURC
        '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A': 18, // weETH
        '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': 18, // cbETH
        '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee': 18, // GHO
        '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452': 18, // wstETH
        '0x63706e401c06ac8513145b7687A14804d17f814b': 18, // AAVE
        '0xecAc9C5F704e954931349Da37F60E39f515c11c1': 8,  // LBTC
        '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b': 18, // tBTC
        '0x2416092f143378750bb29b79eD961ab195CcEea5': 18, // ezETH
        '0xEDfa23602D0EC14714057867A78d01e94176BEA0': 18, // wrsETH
    };

    // Robust case-insensitive lookup
    const lookup = (addr: string) => {
        // Try exact
        if (known[addr]) return known[addr];
        // Try lower
        const lower = addr.toLowerCase();
        for (const k in known) {
            if (k.toLowerCase() === lower) return known[k];
        }
        return 18; // Fallback
    };

    // Special USDC check from watcher
    const isUSDC = (addr: string) => ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'].map(a => a.toLowerCase()).includes(addr.toLowerCase());

    return {
        collateral: lookup(col),
        debt: isUSDC(debt) ? 6 : lookup(debt)
    };
}

main().catch(console.error);
