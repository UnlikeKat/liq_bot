
import axios from 'axios';
import { CONFIG } from '../bot/config.js';
import * as dotenv from 'dotenv';
import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';

dotenv.config();

const USER_ADDRESS = '0xFe3ca4B8C27cD94c6902adF95d39B85F2817A0a1';
const API_KEY = process.env.BASESCAN_API_KEY;
const BASESCAN_API = 'https://api.basescan.org/api';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] }
];

const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL)
});

async function main() {
    if (!API_KEY) {
        console.error('❌ BASESCAN_API_KEY not found in .env');
        return;
    }

    console.log(`🔍 Searching for contracts created by ${USER_ADDRESS}...`);

    const createdContracts = new Set<string>();

    try {
        // 1. Check Normal Transactions
        console.log('📡 Fetching normal transactions...');
        const respNormal = await axios.get(BASESCAN_API, {
            params: {
                module: 'account',
                action: 'txlist',
                address: USER_ADDRESS,
                startblock: 0,
                endblock: 99999999,
                sort: 'desc',
                apikey: API_KEY
            }
        });

        console.log(`   Status: ${respNormal.data.status}, Message: ${respNormal.data.message}`);
        if (respNormal.data.status === '1') {
            console.log(`   Found ${respNormal.data.result.length} transactions.`);
            for (const tx of respNormal.data.result) {
                // Check if it's a contract creation
                if (!tx.to || tx.to === "" || tx.to === "0x0000000000000000000000000000000000000000") {
                    if (tx.contractAddress) {
                        createdContracts.add(tx.contractAddress.toLowerCase());
                    }
                }
            }
        } else {
            console.log(`   No transactions or error: ${JSON.stringify(respNormal.data)}`);
        }

        // 2. Check Internal Transactions
        console.log('📡 Fetching internal transactions...');
        const respInternal = await axios.get(BASESCAN_API, {
            params: {
                module: 'account',
                action: 'txlistinternal',
                address: USER_ADDRESS,
                startblock: 0,
                endblock: 99999999,
                sort: 'desc',
                apikey: API_KEY
            }
        });

        if (respInternal.data.status === '1') {
            for (const tx of respInternal.data.result) {
                if (tx.type === 'create') {
                    if (tx.contractAddress) {
                        createdContracts.add(tx.contractAddress.toLowerCase());
                    }
                }
            }
        }

        console.log(`✅ Identified ${createdContracts.size} total created contracts.`);

        const addresses = Array.from(createdContracts);
        console.log('\n📊 Checking Balances:');
        console.log('--------------------------------------------------');

        for (const addr of addresses) {
            const ethBalance = await client.getBalance({ address: addr as `0x${string}` });

            // Check common tokens
            const usdcBal = await client.readContract({
                address: USDC,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [addr as `0x${string}`]
            }).catch(() => 0n) as bigint;

            const eurcBal = await client.readContract({
                address: EURC,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [addr as `0x${string}`]
            }).catch(() => 0n) as bigint;

            if (ethBalance > 0n || usdcBal > 0n || eurcBal > 0n) {
                console.log(`💰 FOUND CAPITAL in ${addr}:`);
                if (ethBalance > 0n) console.log(`   - ETH: ${formatEther(ethBalance)}`);
                if (usdcBal > 0n) console.log(`   - USDC: ${formatUnits(usdcBal, 6)}`);
                if (eurcBal > 0n) console.log(`   - EURC: ${formatUnits(eurcBal, 6)}`);
            } else {
                console.log(`   [Empty] ${addr}`);
            }
        }

        console.log('--------------------------------------------------');
        console.log('Done scanning.');

    } catch (error: any) {
        console.error('❌ Error fetching from Basescan:', error.message);
    }
}

main().catch(console.error);
