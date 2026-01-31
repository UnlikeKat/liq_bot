import { createPublicClient, http, keccak256, toHex, stringToBytes, encodeEventTopics } from 'viem';
import { base } from 'viem/chains';

const RPC_URL = 'https://base-rpc.publicnode.com';

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log("🔍 DIAGNOSING BORROW EVENT SIGNATURE...");

    // 1. Calculate hashes for potential signatures
    // Aave V3 standard
    const sig1 = "Borrow(address,address,address,uint256,uint8,uint256,uint16)";
    // My previous script signature (incorrect indexing but checking hash)
    const sig2 = "Borrow(address,address,address,uint256,uint256,uint256,uint256)";

    console.log(`Sig 1: ${sig1} -> ${keccak256(toHex(stringToBytes(sig1)))}`);
    console.log(`Sig 2: ${sig2} -> ${keccak256(toHex(stringToBytes(sig2)))}`);

    // 2. Fetch a single recent Borrow log to see the REAL topics
    const currentBlock = await client.getBlockNumber();
    console.log(`Current Block: ${currentBlock}`);

    // Scan last 100 blocks for ANY Borrow event
    console.log("Scanning last 100 blocks for any logs...");
    const logs = await client.getLogs({
        address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
        fromBlock: currentBlock - 100n,
        toBlock: currentBlock
    });

    console.log(`Found ${logs.length} total logs.`);

    // Look for Borrow topic (0x445cc...?)
    const BORROW_TOPIC = "0x445cc7189b699aba312bd54ce4e386e25919e7992981f28a29855412132fce9c";

    const borrowLogs = logs.filter(l => l.topics[0] === BORROW_TOPIC);
    console.log(`Found ${borrowLogs.length} Borrow events.`);

    if (borrowLogs.length > 0) {
        console.log("Example Borrow Log Topics:");
        borrowLogs[0].topics.forEach((t, i) => console.log(`Topic[${i}]: ${t}`));
    } else {
        console.log("No Borrow events found in last 100 blocks. Trying larger range...");
        const logs2 = await client.getLogs({
            address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
            fromBlock: currentBlock - 1000n,
            toBlock: currentBlock
        });
        const borrowLogs2 = logs2.filter(l => l.topics[0] === BORROW_TOPIC);
        console.log(`Found ${borrowLogs2.length} Borrow events in last 1000 blocks.`);
        if (borrowLogs2.length > 0) {
            console.log("Example Borrow Log Topics:");
            borrowLogs2[0].topics.forEach((t, i) => console.log(`Topic[${i}]: ${t}`));
        }
    }
}

main();
