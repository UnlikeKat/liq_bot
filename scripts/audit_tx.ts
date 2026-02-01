import { createPublicClient, http, formatUnits, parseAbiItem, getAddress } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import colors from 'colors'; // Optional, but let's stick to standard console for widely compatible script
// If user doesn't have 'colors', we'll just use raw strings.

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';
const WETH = '0x4200000000000000000000000000000000000006';

const ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: 'price', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

// Helper to find specific LiquidationCall event
const LIQUIDATION_EVENT = parseAbiItem(
    'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
);

async function main() {
    // defaults to a recent example if no arg provided
    const txHash = process.env.TX || process.argv[2];

    if (!txHash) {
        console.log('❌ Please provide a TX Hash:');
        console.log('   npx hardhat run scripts/audit_tx.ts -- 0xYourHashHere');
        console.log('   OR: TX=0x... npx hardhat run scripts/audit_tx.ts');
        return;
    }

    console.log(`\n🔍 AUDITING TRANSACTION: ${txHash}\n`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    try {
        // 1. Fetch Receipt & Block Info
        const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        const tx = await client.getTransaction({ hash: txHash as `0x${string}` });

        console.log(`📦 Block:        ${receipt.blockNumber} (Time: ${new Date(Number(block.timestamp) * 1000).toLocaleString()})`);
        console.log(`⛽ Gas Used:     ${receipt.gasUsed} @ ${formatUnits(receipt.effectiveGasPrice, 9)} Gwei`);

        const gasCostETH = Number(formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18));
        console.log(`💸 Total Gas:    ${gasCostETH.toFixed(6)} ETH`);

        // 2. Find Liquidation Log
        const logs = await client.getLogs({
            blockHash: receipt.blockHash,
            event: LIQUIDATION_EVENT
        });

        // Filter for this specific TX
        const log = logs.find(l => l.transactionHash === txHash);

        if (!log) {
            console.log('⚠️  No Aave V3 Liquidation Event found in this transaction.');
            console.log('   (It might be a different protocol or a failed liquidation attempt)');
            return;
        }

        const args = log.args;
        console.log(`\n--- TRACE ---`);
        console.log(`👤 User:         ${args.user}`);
        console.log(`🗡️  Liquidator:   ${args.liquidator}`);
        console.log(`📉 Collateral:   ${args.collateralAsset}`);
        console.log(`💳 Debt Asset:   ${args.debtAsset}`);

        // 3. Oracle Check (Time Travel)
        console.log(`\n--- ORACLE SNAPSHOT (Block ${receipt.blockNumber}) ---`);

        const assets = [args.collateralAsset!, args.debtAsset!, WETH];
        const results = await client.multicall({
            contracts: assets.map(a => ({
                address: AAVE_ORACLE,
                abi: ORACLE_ABI,
                functionName: 'getAssetPrice',
                args: [a]
            })),
            blockNumber: receipt.blockNumber
        });

        const collateralPrice = Number(formatUnits(results[0].result as bigint, 8));
        const debtPrice = Number(formatUnits(results[1].result as bigint, 8));
        const wethPrice = Number(formatUnits(results[2].result as bigint, 8));

        console.log(`💲 Collateral Price: $${collateralPrice.toFixed(2)}`);
        console.log(`💲 Debt Price:       $${debtPrice.toFixed(2)}`);
        console.log(`💲 ETH Price:        $${wethPrice.toFixed(2)}`);

        // 4. Financial Breakdown
        const decimals = getTokenDecimals(args.collateralAsset!, args.debtAsset!);

        const collateralAmt = Number(formatUnits(args.liquidatedCollateralAmount!, decimals.collateral));
        const debtAmt = Number(formatUnits(args.debtToCover!, decimals.debt));

        const collatValue = collateralAmt * collateralPrice;
        const debtValue = debtAmt * debtPrice;
        const gasValue = gasCostETH * wethPrice;

        const profit = collatValue - debtValue - gasValue;

        console.log(`\n--- PROFIT ANALYSIS ---`);
        console.log(`(+) Received:     ${collateralAmt.toFixed(6)} units  = $${collatValue.toFixed(2)}`);
        console.log(`(-) Repaid:       ${debtAmt.toFixed(6)} units  = $${debtValue.toFixed(2)}`);
        console.log(`(-) Gas Cost:                              = $${gasValue.toFixed(2)}`);
        console.log(`-----------------------------------------------------`);
        console.log(`💰 NET PROFIT:                             = $${profit.toFixed(2)}`);

        if (profit < 0) console.log(`🔻 (Unprofitable Transaction)`);
        else console.log(`✅ (Profitable Transaction)`);

    } catch (e) {
        console.error('Audit failed:', e);
    }
}

// Copy of helper from fix_historical_prices.ts
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

    const lookup = (addr: string) => {
        const lower = addr.toLowerCase();
        for (const k in known) { if (k.toLowerCase() === lower) return known[k]; }
        return 18;
    };
    const isUSDC = (addr: string) => ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'].map(a => a.toLowerCase()).includes(addr.toLowerCase());

    return { collateral: lookup(col), debt: isUSDC(debt) ? 6 : lookup(debt) };
}

main().catch(console.error);
