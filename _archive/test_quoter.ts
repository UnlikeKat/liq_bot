import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // QuoterV2
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const FEE = 500; // 0.05%

const ABI = [
    {
        "inputs": [
            { "internalType": "bytes", "name": "path", "type": "bytes" },
            { "internalType": "uint256", "name": "amountIn", "type": "uint256" }
        ],
        "name": "quoteExactInput",
        "outputs": [
            { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
            { "internalType": "uint160[]", "name": "sqrtPriceX96AfterList", "type": "uint160[]" },
            { "internalType": "uint32[]", "name": "initializedTicksCrossedList", "type": "uint32[]" },
            { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
        ],
        "stateMutability": "nonpayable", // Quoter is view/pure simulating state changes
        "type": "function"
    }
]; // QuoterV2 has quoteExactInput(bytes,uint256)

// Or QuoterV1 ? 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6
// quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut)

// Let's use encodePacked for path: tokenIn + fee + tokenOut
const encodePath = (tokenIn: string, fee: number, tokenOut: string) => {
    // fee is 3 bytes (uint24)
    // token is 20 bytes
    // viem encodePacked?
    // Manual hex concat easiest.
    const feeHex = fee.toString(16).padStart(6, '0');
    return `${tokenIn}${feeHex}${tokenOut}`;
};

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });

    const path = encodePath(USDC, FEE, EURC) as `0x${string}`;
    console.log(` Testing Quoter: ${QUOTER}`);
    console.log(`   Path: ${path}`);

    // Amount: 10000 USDC (0.01 USDC)
    const amountIn = 10000n;

    try {
        const result = await client.simulateContract({
            address: QUOTER,
            abi: ABI,
            functionName: 'quoteExactInput',
            args: [path, amountIn],
        });

        console.log(`✅ Quoter Success!`);
        console.log(`   AmountOut: ${result.result[0]}`); // Check logs or return
    } catch (e: any) {
        console.log(`❌ Quoter Failed!`);
        console.log(`   Message: ${e.message}`);
        if (e.data) console.log(`   Data: ${e.data}`);
    }
}

main().catch(console.error);
