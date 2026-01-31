import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

const client = createPublicClient({ chain: base, transport: http(CONFIG.RPC_URL_PUBLIC) });

const ABI = parseAbi([
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
]);

const MISSING = [
    '0x63706e401c06ac8513145b7687a14804d17f814b',
    '0xecac9c5f704e954931349da37f60e39f515c11c1',
    '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b',
    '0x2416092f143378750bb29b79ed961ab195cceea5',
    '0xedfa23602d0ec14714057867a78d01e94176bea0'
];

async function identify() {
    console.log('🔍 Identifying missing tokens on-chain...');

    for (const addr of MISSING) {
        try {
            const [symbol, decimals] = await Promise.all([
                client.readContract({ address: addr as `0x${string}`, abi: ABI, functionName: 'symbol' }),
                client.readContract({ address: addr as `0x${string}`, abi: ABI, functionName: 'decimals' })
            ]);
            console.log(`✅ ${addr} -> ${symbol} (${decimals})`);
        } catch (e) {
            console.error(`❌ Failed to identify ${addr}:`, e);
        }
    }
}

identify();
