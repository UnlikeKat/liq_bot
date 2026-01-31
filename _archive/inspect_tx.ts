
import { createPublicClient, http, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

const TARGET_TX = '0x142d0a2487eb93bba40bd0feb41071244b7310c3ff5b93cc7466aa1190fef32a';

// Common Event Signatures
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

async function inspectTx() {
    console.log(`🔍 INSPECTING TX: ${TARGET_TX}`);

    try {
        const tx = await client.getTransaction({ hash: TARGET_TX });
        const receipt = await client.getTransactionReceipt({ hash: TARGET_TX });

        console.log(`\n--- Transaction Details ---`);
        console.log(`Block: ${tx.blockNumber}`);
        console.log(`From: ${tx.from}`);
        console.log(`To: ${tx.to}`);
        console.log(`Gas Used: ${receipt.gasUsed}`);

        console.log(`\n--- Logs Dump (${receipt.logs.length}) ---`);

        let foundLiquidation = false;

        for (const [i, log] of receipt.logs.entries()) {
            console.log(`\n[Log ${i}] Address: ${log.address}`);
            console.log(`   Topic0: ${log.topics[0]}`);

            // Try to decode as LiquidationCall
            try {
                const decoded = decodeEventLog({
                    abi: [LIQUIDATION_CALL_ABI],
                    data: log.data,
                    topics: log.topics
                });

                if (decoded.eventName === 'LiquidationCall') {
                    console.log(`   ✅ DECODED LIQUIDATION:`);
                    console.log(`   - Collateral: ${decoded.args.collateralAsset}`);
                    console.log(`   - Debt: ${decoded.args.debtAsset}`);
                    console.log(`   - User: ${decoded.args.user}`);
                    console.log(`   - Debt Covered: ${decoded.args.debtToCover.toString()}`);
                    console.log(`   - Seized Collateral: ${decoded.args.liquidatedCollateralAmount.toString()}`);
                    console.log(`   - Liquidator: ${decoded.args.liquidator}`);
                    foundLiquidation = true;
                }
            } catch (e) {
                // Not a liquidation event
            }
        }

        if (!foundLiquidation) {
            console.log(`\n❌ Warning: No standard 'LiquidationCall' event found.`);
            console.log(`   This suggests the transaction might be a 'FlashSwap' or 'Swap' that *looked* like a liquidation in our history parser,`);
            console.log(`   OR the event signature is different.`);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

inspectTx();
