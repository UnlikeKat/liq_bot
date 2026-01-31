import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

const ABI = [
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

    // 1. Simulate a Swap
    // Use a rich holder or just simulate call?
    // We can simulate call if we don't need funds (just check if it reverts validation).
    // Actually, exactInputSingle checks transferFrom likely.

    // We will simulate from a random address but assume approval? No.
    // We can use state override if needed, but not easily via public client.

    // However, if we call it, Uniswap will try transferFrom(msg.sender, ...).
    // If msg.sender doesn't have funds/approval, it will fail with "STF".
    // This confirms Function Exists and Logic runs.

    console.log(`🧪 Testing Swap: USDC -> EURC via ${ROUTER}`);

    try {
        await client.simulateContract({
            address: ROUTER,
            abi: ABI,
            functionName: 'exactInputSingle',
            args: [{
                tokenIn: USDC,
                tokenOut: EURC,
                fee: 3000,
                recipient: '0x0000000000000000000000000000000000000000',
                deadline: Math.floor(Date.now() / 1000) + 1000,
                amountIn: 10000n, // 0.01 USDC
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n
            }],
            account: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1' // User
        });
        console.log(`✅ Simulation Pass (Should not happen without funds/approve)`);
    } catch (e: any) {
        console.log(`⚠️ Reverted as expected (or not?). Reason:`);
        if (e.message.includes('fallback') || e.message.includes('not found')) {
            console.error('❌ FATAL: Function not found!');
        } else if (e.message.includes('transferFrom')) {
            // STF usually implies transfer failed
            console.log(`✅ Function exists! Failed on Transfer (Expected).`);
        } else {
            console.log(`ℹ️ Error: ${e.shortMessage || e.message}`);
            // If "STF" or similar, we are good.
        }
    }

}
main().catch(console.error);
