
import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
});

const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

async function debugEvents() {
    const currentBlock = await client.getBlockNumber();
    console.log(`🔍 DEBUG: Scanning last 10,000 blocks from ${currentBlock}...`);

    // Check Supply
    try {
        const supplies = await client.getLogs({
            address: AAVE_POOL,
            event: parseAbiItem('event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'),
            fromBlock: currentBlock - 10000n,
            toBlock: currentBlock
        });
        console.log(`✅ Supply Events: ${supplies.length}`);
        if (supplies.length > 0) console.log('Sample User:', (supplies[0] as any).args.user);
    } catch (e) { console.error('Supply Error:', e); }

    // Check Borrow (Alternative)
    try {
        const borrows = await client.getLogs({
            address: AAVE_POOL,
            event: parseAbiItem('event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'),
            fromBlock: currentBlock - 10000n,
            toBlock: currentBlock
        });
        console.log(`✅ Borrow Events: ${borrows.length}`);
    } catch (e) { console.error('Borrow Error:', e); }
}

debugEvents();
