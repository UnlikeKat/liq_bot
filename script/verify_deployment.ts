import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const RPC_URL = 'https://base-rpc.publicnode.com';
const ADDRESS_B = '0x45bca5dc943501124060762efC143BAb0647f3E5'; // User found address

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`🔍 Checking Address on BASE Chain...`);

    // Check B
    const codeB = await client.getBytecode({ address: ADDRESS_B });
    console.log(`\nAddress B (User Found): ${ADDRESS_B}`);
    console.log(`   Bytecode Length: ${codeB ? codeB.length : 0}`);
    console.log(`   Status: ${codeB && codeB.length > 2 ? '✅ DEPLOYED' : '❌ EMPTY'}`);
}

main();
