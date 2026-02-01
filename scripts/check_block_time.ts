import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
config();

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    const blockA = await client.getBlock({ blockNumber: 41547260n });
    const blockB = await client.getBlock({ blockNumber: 41547280n }); // +20 blocks

    const timeDiff = Number(blockB.timestamp - blockA.timestamp);
    console.log(`Block N: ${blockA.number} Time: ${blockA.timestamp}`);
    console.log(`Block N+20: ${blockB.number} Time: ${blockB.timestamp}`);
    console.log(`Difference (20 blocks): ${timeDiff} seconds`);
    console.log(`Avg Block Time: ${timeDiff / 20} seconds`);
}

main().catch(console.error);
