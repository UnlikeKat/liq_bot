import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

// A free RPC that might support archive (Base often has good free RPCs)
const transport = http('https://mainnet.base.org');
const client = createPublicClient({ chain: base, transport });

const POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const ABI = parseAbi(['function getUserAccountData(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256)']);

async function testHistorical() {
    try {
        const latest = await client.getBlockNumber();
        const oldBlock = latest - 1000n;

        console.log(`Checking archival capability at block ${oldBlock}...`);

        // Pick a random user likely to exist or just check ANY state
        // Using a random address might return empty zeros, but call should succeed if archive node
        const data = await client.readContract({
            address: POOL,
            abi: ABI,
            functionName: 'getUserAccountData',
            args: ['0x0000000000000000000000000000000000000001'],
            blockNumber: oldBlock
        });

        console.log('✅ Archival call SUCCEEDED!');
        console.log('Result:', data);
        return true;
    } catch (e: any) {
        console.log('❌ Archival call failed:', e.message.slice(0, 100));
        return false;
    }
}

testHistorical();
