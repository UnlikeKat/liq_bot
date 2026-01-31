
import { createPublicClient, http, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

const TARGET_TXS = [
    '0x26684d0cace26ecd3d11b28cedeaef1fd405a95c20c85c85ccdcfa1970a83ccf', // $-30.76 Loss
    '0x2866abdcb28c8d8f8c7ed7d829059577fb269aebe09be043c18f863409a0b6f2', // $-0.08 Loss
    '0x0cb6f2748633e670efd64abf64e9682f6db707c9eddff31193fddb55bb669784', // $-1.31 Loss
    '0x39777b9b295be055a0945fb43b7614f104c6abbb2560669ea3a76b4423858f5b'  // $-0.02 Loss
];

const LIQUIDATION_CALL_ABI = {
    anonymous: false,
    inputs: [
        { indexed: true, name: 'collateralAsset', type: 'address' },
        { indexed: true, name: 'debtAsset', type: 'address' },
        { indexed: true, name: 'user', type: 'address' },
        { indexed: false, name: 'debtToCover', type: 'uint256' },
        { indexed: false, name: 'liquidatedCollateralAmount', type: 'uint256' },
        { indexed: false, name: 'liquidator', type: 'address' },
        { indexed: false, name: 'receiveAToken', type: 'bool' }
    ],
    name: 'LiquidationCall',
    type: 'event'
};

async function inspectLosses() {
    console.log(`🔍 INSPECTING ${TARGET_TXS.length} "LOSS" TRANSACTIONS`);

    for (const hash of TARGET_TXS) {
        console.log(`\n==================================================`);
        console.log(`TX: ${hash.slice(0, 16)}...`);
        try {
            const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
            const tx = await client.getTransaction({ hash: hash as `0x${string}` });

            const gasUsed = receipt.gasUsed;
            const gasPrice = receipt.effectiveGasPrice;
            const totalEthCost = (gasUsed * gasPrice);
            const ethCostFloat = Number(totalEthCost) / 1e18;

            // Assume ETH = $3300 for rough conversion
            const estUsdCost = ethCostFloat * 3300;

            console.log(`  - Gas Used: ${gasUsed}`);
            console.log(`  - Gas Price: ${(Number(gasPrice) / 1e9).toFixed(2)} Gwei`);
            console.log(`  - Total Cost: ${ethCostFloat.toFixed(6)} ETH (~$${estUsdCost.toFixed(2)})`);
            console.log(`  - To: ${tx.to}`); // Is it a router/custom contract?

            // Count Liquidation Events
            let liqCount = 0;
            let totalCollateralSeizedUSD = 0;

            for (const log of receipt.logs) {
                try {
                    const decoded = decodeEventLog({
                        abi: [LIQUIDATION_CALL_ABI],
                        data: log.data,
                        topics: log.topics
                    });
                    if (decoded.eventName === 'LiquidationCall') {
                        liqCount++;
                        // console.log(`    event LiqCall: Col=${decoded.args.collateralAsset} Debt=${decoded.args.debtAsset}`);
                    }
                } catch (e) { }
            }

            console.log(`  - Liquidation Events in Receipt: ${liqCount}`);

            if (liqCount > 1) {
                console.log(`  ✅ MULTI-CALL: This TX executed ${liqCount} liquidations.`);
                console.log(`     The Gas Cost should be split across all ${liqCount} events.`);
                console.log(`     Our history attributes 100% of gas to EACH event -> False Loss.`);
            } else {
                console.log(`  ❌ SINGLE-CALL: This really was just one liquidation.`);
                if (estUsdCost > 10) {
                    console.log(`     WARNING: They paid ~$${estUsdCost.toFixed(2)} in gas.`);
                    console.log(`     Either they are stupid, or they extracted value via MEV/Arb elsewhere in the tx?`);
                }
            }

        } catch (e) {
            console.error(`  Error fetching ${hash}:`, e);
        }
    }
}

inspectLosses();
