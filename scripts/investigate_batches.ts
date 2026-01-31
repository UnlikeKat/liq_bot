
import { createPublicClient, http, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

const TARGET_TXS = [
    '0xd5a542a1d626650ca744b3d505d4010441e88e9fd0426650fbd84287a14522f7',
    '0xf2e6c7a008925d141f6e9b4a1b7baccd50e1c1008c47dc1f3c12620b11cc0ba7',
    '0x2b7d3a291041b9fbbea43f74a0cabef2e1ebf0512c893abafd641a18a374b5b1',
    '0x0ac25cde38984b56bbc722cc6acb12128670f03644ebfb73e56aeafbe097240a',
    '0x26a9561d44fb82a956cd297247bacfaa979de2160063e74e8b9addf9f149cbe9'
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

async function inspectBatches() {
    console.log(`🔍 INSPECTING ${TARGET_TXS.length} BATCH TRANSACTIONS`);

    for (const hash of TARGET_TXS) {
        console.log(`\n==================================================`);
        console.log(`TX: ${hash.slice(0, 16)}...`);
        try {
            const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });

            const gasUsed = receipt.gasUsed;
            const gasPrice = receipt.effectiveGasPrice;
            const totalEthCost = (gasUsed * gasPrice);
            const ethCostFloat = Number(totalEthCost) / 1e18;

            // Assume ETH = $3300 for rough conversion
            const estUsdCost = ethCostFloat * 3300;

            console.log(`  - Block: ${receipt.blockNumber}`);
            console.log(`  - Gas Used: ${Number(gasUsed).toLocaleString()} units`);
            console.log(`  - Gas Price: ${(Number(gasPrice) / 1e9).toFixed(5)} Gwei (Very Cheap!)`);
            console.log(`  - Total Cost: $${estUsdCost.toFixed(4)} (${ethCostFloat.toFixed(6)} ETH)`);

            // Count Liquidation Events
            let liqCount = 0;

            for (const log of receipt.logs) {
                try {
                    const decoded = decodeEventLog({
                        abi: [LIQUIDATION_CALL_ABI],
                        data: log.data,
                        topics: log.topics
                    });
                    if (decoded.eventName === 'LiquidationCall') {
                        liqCount++;
                    }
                } catch (e) { }
            }

            console.log(`  ✅ BATCH SIZE: ${liqCount} Liquidations`);

            if (liqCount > 0) {
                const costPerUser = estUsdCost / liqCount;
                console.log(`  💡 Cost Per User: $${costPerUser.toFixed(4)}`);
                console.log(`     If they made >$${(costPerUser + 0.01).toFixed(2)} per user, it was profitable.`);
            }

        } catch (e) {
            console.error(`  Error fetching ${hash}:`, e);
        }
    }
}

inspectBatches();
