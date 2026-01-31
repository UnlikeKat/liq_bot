import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import { BASE_TOKENS } from '../bot/services/token_registry.js';

const client = createPublicClient({ chain: base, transport: http(CONFIG.RPC_URL_PUBLIC) });

const ABI = parseAbi([
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
]);

async function verify() {
    console.log('🛡️ Verifying Token Registry On-Chain...');
    console.log('---------------------------------------------------');

    let errors = 0;
    const tokens = Object.values(BASE_TOKENS);

    for (const token of tokens) {
        process.stdout.write(`Checking ${token.symbol} (${token.address})... `);

        try {
            const [chainSymbol, chainDecimals] = await Promise.all([
                client.readContract({ address: token.address as `0x${string}`, abi: ABI, functionName: 'symbol' }),
                client.readContract({ address: token.address as `0x${string}`, abi: ABI, functionName: 'decimals' })
            ]);

            let mismatch = false;

            // Check Decimals (Critical)
            if (chainDecimals !== token.decimals) {
                console.log(`\n❌ DECIMAL MISMATCH! Registry: ${token.decimals} | On-Chain: ${chainDecimals}`);
                mismatch = true;
                errors++;
            }

            // Check Symbol (Warning)
            if (chainSymbol !== token.symbol) {
                // Approximate match check (e.g. WETH vs WETH)
                console.log(`\n⚠️  Symbol mismatch. Registry: ${token.symbol} | On-Chain: ${chainSymbol}`);
                // Don't count as critical error if decimals match
            }

            if (!mismatch) {
                console.log('✅ OK');
            }

        } catch (e: any) {
            console.log(`\n❌ FAILED TO READ: ${e.message.split('\n')[0]}`);
            errors++;
        }
    }

    console.log('---------------------------------------------------');
    if (errors === 0) {
        console.log('✅ ALL TOKENS VERIFIED CORRECTLY!');
    } else {
        console.log(`❌ FOUND ${errors} CRITICAL ERRORS.`);
    }
}

verify();
