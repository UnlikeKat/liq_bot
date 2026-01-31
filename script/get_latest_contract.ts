import { createPublicClient, http, getContractAddress } from 'viem';
import { base } from 'viem/chains';

const DEPLOYER = '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1';
const RPC_URL = 'https://base-rpc.publicnode.com';

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const nonce = await client.getTransactionCount({ address: DEPLOYER });
    console.log(`Current Nonce: ${nonce}`);

    if (nonce === 0) {
        console.log("No transactions found.");
        return;
    }

    // The deployment was likely the last transaction (nonce - 1)
    const deploymentNonce = BigInt(nonce - 1);

    const contractAddress = getContractAddress({
        from: DEPLOYER,
        nonce: deploymentNonce
    });

    // console.log(`Calculated Contract Address (Nonce ${deploymentNonce}): ${contractAddress}`);

    const code = await client.getBytecode({ address: contractAddress });
    if (code && code.length > 2) {
        // console.log("✅ Verified: Code exists at address.");
        console.log(contractAddress);
    } else {
        console.error("NO_CODE");
    }
}

main();
