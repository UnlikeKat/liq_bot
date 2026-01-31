import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Standard SwapRouter
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });

    console.log(`🧪 Testing Router Direct: WETH -> USDC`);
    console.log(`   Router: ${ROUTER}`);

    // We simulate sending ETH (wrapped to WETH implicitly by Router? No, Router needs WETH approval usually).
    // EXCEPT SwapRouter often has exactInputSingle payable that wraps ETH if tokenIn is WETH?
    // Let's assume we are swapping existing WETH.
    // Simulating from a random Whale who has WETH and approved Router.
    // Hard to find?

    // Easier: ExactInputSingle with MSG.VALUE?
    // Does exactInputSingle accept value? Yes, generic Multicall does.
    // But exactInputSingle is payable.
    // If msg.value > 0 and tokenIn == WETH9, it wraps automatically?
    // Standard V3 Router DOES wrap/unwrap.

    try {
        await client.simulateContract({
            address: ROUTER,
            abi: ABI,
            functionName: 'exactInputSingle',
            args: [{
                tokenIn: WETH,
                tokenOut: USDC,
                fee: 500, // 0.05% WETH/USDC
                recipient: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1',
                deadline: Math.floor(Date.now() / 1000) + 1000,
                amountIn: 1000000000000000n, // 0.001 ETH
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n
            }],
            value: 1000000000000000n, // Send ETH
            account: '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1' // Me
        });
        console.log(`✅ Router is WORKING (ETH -> USDC Swap simulated successfully)!`);
    } catch (e: any) {
        console.log(`❌ Router Failed!`);
        console.log(`   Message: ${e.message}`);
    }
}

main().catch(console.error);
