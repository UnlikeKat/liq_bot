import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

const ABI = [
    {
        "inputs": [],
        "name": "factory",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{
            "components": [
                { "internalType": "address", "name": "tokenIn", "type": "address" },
                { "internalType": "address", "name": "tokenOut", "type": "address" },
                { "internalType": "uint24", "name": "fee", "type": "uint24" },
                { "internalType": "address", "name": "recipient", "type": "address" },
                { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
                { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
                { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
            ],
            "internalType": "struct ISwapRouter.ExactInputSingleParams",
            "name": "params",
            "type": "tuple"
        }],
        "name": "exactInputSingle",
        "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
        "stateMutability": "payable",
        "type": "function"
    }
];

async function main() {
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    console.log(`Checking Router: ${ROUTER}`);

    // 1. Check Code
    const code = await client.getBytecode({ address: ROUTER });
    if (!code || code === '0x') {
        console.error('❌ Router has NO CODE!');
        return;
    }
    console.log(`✅ Router Code Exists (${code.length} bytes)`);

    // 2. Check Factory
    try {
        const factory = await client.readContract({
            address: ROUTER,
            abi: ABI,
            functionName: 'factory'
        });
        console.log(`✅ Factory: ${factory}`);
    } catch (e) {
        console.error('❌ Factory call failed:', e.shortMessage || e.message);
    }

    // 3. Check exactInputSingle Selector
    try {
        // We simulate a call with 0 params to see if it reverts with "Execution Reverted" (Selector OK) 
        // or "Fallback" (Selector Missing)
        // Actually, we pass zeroes.
        await client.simulateContract({
            address: ROUTER,
            abi: ABI,
            functionName: 'exactInputSingle',
            args: [{
                tokenIn: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
                tokenOut: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', // EURC
                fee: 3000,
                recipient: '0x0000000000000000000000000000000000000000',
                deadline: Math.floor(Date.now() / 1000) + 1000,
                amountIn: 0n,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n
            }],
            account: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1'
        });
        console.log(`✅ Selector OK (Simulation accepted 0 amount but didn't revert with fallback)`);
    } catch (e) {
        // Analyze error
        console.log(`⚠️ Simulation Result: ${e.shortMessage || e.message}`);
        if (e.message.includes('fallback') || e.message.includes('Method not found')) {
            console.error('❌ METHOD NOT FOUND!');
        } else {
            console.log('✅ Selector likely found (Reverted with other reason)');
        }
    }
}

main().catch(console.error);
