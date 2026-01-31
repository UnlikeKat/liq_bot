import { createWalletClient, createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { CONFIG } from '../bot/config.js'; // Use compiled JS or TS via tsx? tsx handles .ts imports.

config();

const OLD_CONTRACT = process.env.FLASH_LIQUIDATOR_ADDRESS as `0x${string}`;
const NEW_CONTRACT = '0x4a05cbc4aa8d6554647c49720ef567867c8a508f';

const ABI_WITHDRAW = parseAbi([
    'function withdrawToken(address token) external',
    'function withdrawETH() external',
    'function owner() view returns (address)'
]);

const ERC20_ABI = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
]);

async function main() {
    console.log(`📦 STARTING MIGRATION`);
    console.log(`   Old: ${OLD_CONTRACT}`);
    console.log(`   New: ${NEW_CONTRACT}`);

    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    const client = createWalletClient({
        account,
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });
    const publicClient = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    // 1. Check Owner
    try {
        const owner = await publicClient.readContract({
            address: OLD_CONTRACT,
            abi: ABI_WITHDRAW,
            functionName: 'owner'
        });
        if (owner.toLowerCase() !== account.address.toLowerCase()) {
            console.error(`❌ AUTHORIZATION FAILED: contract owner is ${owner}, you are ${account.address}`);
            return;
        }
    } catch (e) {
        console.warn('   (Could not verify owner, attempting withdrawal anyway...)');
    }

    // 2. Tokens to check
    const tokens = Object.values(CONFIG.TOKENS);
    console.log(`   Checking ${tokens.length} tokens...`);

    for (const token of tokens) {
        const tAddr = token as `0x${string}`;
        try {
            const balance = await publicClient.readContract({
                address: tAddr,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [OLD_CONTRACT]
            });

            if (balance > 0n) {
                const symbol = await publicClient.readContract({ address: tAddr, abi: ERC20_ABI, functionName: 'symbol' });
                const decimals = await publicClient.readContract({ address: tAddr, abi: ERC20_ABI, functionName: 'decimals' });
                console.log(`   💰 Found ${formatUnits(balance, decimals)} ${symbol}`);

                // Withdraw
                console.log(`      Withdraw from Old...`);
                const hash1 = await client.writeContract({
                    address: OLD_CONTRACT,
                    abi: ABI_WITHDRAW,
                    functionName: 'withdrawToken',
                    args: [tAddr]
                });
                await publicClient.waitForTransactionReceipt({ hash: hash1 });
                console.log(`      ✅ Withdrawn.`);

                // Deposit to New
                console.log(`      Sending to New...`);
                const hash2 = await client.writeContract({
                    address: tAddr,
                    abi: ERC20_ABI,
                    functionName: 'transfer',
                    args: [NEW_CONTRACT, balance]
                });
                await publicClient.waitForTransactionReceipt({ hash: hash2 });
                console.log(`      ✅ Transferred.`);
            }
        } catch (e) {
            console.log(`   ⚠️ Failed to process token ${tAddr}:`, e);
        }
    }

    // 3. ETH
    const ethBal = await publicClient.getBalance({ address: OLD_CONTRACT });
    if (ethBal > 0n) {
        console.log(`   💰 Found ${formatUnits(ethBal, 18)} ETH`);
        console.log(`      Withdraw from Old...`);
        const hash1 = await client.writeContract({
            address: OLD_CONTRACT,
            abi: ABI_WITHDRAW,
            functionName: 'withdrawETH'
        });
        await publicClient.waitForTransactionReceipt({ hash: hash1 });

        console.log(`      Sending to New...`);
        const hash2 = await client.sendTransaction({
            to: NEW_CONTRACT,
            value: ethBal
        });
        await publicClient.waitForTransactionReceipt({ hash: hash2 });
        console.log(`      ✅ ETH Transferred.`);
    }

    console.log(`\n🎉 MIGRATION COMPLETE.`);
}

main().catch(console.error);
