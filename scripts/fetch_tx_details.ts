import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const TX_HASH = '0x0e9d701c8896eec65210309d4f977b2915eb2c6f87dbb2a57431f5dcc0195a93';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

const LIQUIDATION_EVENT = parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)');

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    console.log(`🔍 Fetching Tx: ${TX_HASH}`);
    const receipt = await client.getTransactionReceipt({ hash: TX_HASH });

    console.log(`   Block: ${receipt.blockNumber}`);

    // Filter for Aave Pool logs
    const poolLogs = receipt.logs.filter(l => l.address.toLowerCase() === AAVE_POOL.toLowerCase());
    console.log(`   Aave Pool Logs: ${poolLogs.length}`);

    for (const log of poolLogs) {
        try {
            const decoded = decodeEventLog({
                abi: [LIQUIDATION_EVENT],
                data: log.data,
                topics: log.topics
            });

            if (decoded.eventName === 'LiquidationCall') {
                console.log('\n✅ FOUND LiquidationCall:');
                console.log(`   User: ${decoded.args.user}`);
                console.log(`   Collateral: ${decoded.args.collateralAsset}`);
                console.log(`   Debt: ${decoded.args.debtAsset}`);
                console.log(`   Amount: ${decoded.args.liquidatedCollateralAmount}`);
                console.log(`   Liquidator: ${decoded.args.liquidator}`);
                return;
            }
        } catch (e) {
            // Not a LiquidationCall event
            console.log(`   (Skipping non-LiquidationCall event: ${log.topics[0]})`);
        }
    }

    console.log('❌ No LiquidationCall event found in Aave Pool logs.');
}

main().catch(console.error);
