
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

const BATCH_HASH = '0xd5a542a1d626650ca744b3d505d4010441e88e9fd0426650fbd84287a14522f7';

async function decodeBatch() {
    console.log(`🔍 ONE-SHOT FORENSIC: Decoding Batch Tx ${BATCH_HASH}...`);

    try {
        const tx = await client.getTransaction({ hash: BATCH_HASH });

        console.log(`\n📋 Transaction Details:`);
        console.log(`   To (Contract): ${tx.to}`);
        console.log(`   Input Data Length: ${tx.input.length} chars`);
        console.log(`   Method ID (Selector): ${tx.input.slice(0, 10)}`);

        // Check for common Multicall selectors
        const selectors = {
            '0xac9650d8': 'multicall(bytes[])', // Uniswap/standard
            '0x252dba42': 'aggregate((address,bytes)[])', // Multicall2
            '0xca335729': 'aggregate3((address,bool,bytes)[])', // Multicall3
            '0x5ae401dc': 'multicall(uint256,bytes[])' // Some variants
        };

        const method = selectors[tx.input.slice(0, 10) as keyof typeof selectors] || 'UNKNOWN (Custom)';
        console.log(`   Likely Function: ${method}`);

        console.log(`\n📦 Raw Input Preview:`);
        console.log(tx.input.slice(0, 300) + '...');

    } catch (e) {
        console.error('Error:', e);
    }
}

decodeBatch();
