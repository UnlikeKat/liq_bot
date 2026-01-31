import { createPublicClient, http, toHex } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';

config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const FLASH_LIQUIDATOR = '0x20ec0186e5b489b2352b00fd4c19ff4b1c9da9c1';

async function main() {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });

    console.log(`🔍 Inspecting Storage of ${FLASH_LIQUIDATOR}`);

    // Check Slot 0 (Ownership?)
    const slot0 = await client.getStorageAt({ address: FLASH_LIQUIDATOR, slot: toHex(0) });
    console.log(`Slot 0: ${slot0}`);

    // Check Slot 1 (Reentrancy?)
    const slot1 = await client.getStorageAt({ address: FLASH_LIQUIDATOR, slot: toHex(1) });
    console.log(`Slot 1: ${slot1}`);

    // Check Slot 2 (minProfit?)
    const slot2 = await client.getStorageAt({ address: FLASH_LIQUIDATOR, slot: toHex(2) });
    console.log(`Slot 2: ${slot2}`);
    console.log(`Expected (100): ${toHex(100n, { size: 32 })}`);
}

main().catch(console.error);
