import { config } from 'dotenv';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { webSocket } from 'viem';

config();

export const CONFIG = {
    // RPC Configuration
    RPC_URL_PUBLIC: 'https://base-rpc.publicnode.com',
    RPC_URL_PREMIUM: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    RPC_URL_WSS: process.env.ALCHEMY_WSS || process.env.BASE_RPC_WSS || 'wss://base.drpc.org',
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',

    // Contract Addresses (Base Mainnet)
    AAVE_POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    AAVE_DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    UNISWAP_ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
    // Confirmed Verified Address (Step 1794)
    FLASH_LIQUIDATOR: process.env.FLASH_LIQUIDATOR_ADDRESS || '0x45bca5dc943501124060762efC143BAb0647f3E5',
    AAVE_SUBGRAPH: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base',
    AAVE_ORACLE: '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',

    // Bot Configuration
    BOT: {
        // Health factor thresholds
        DISCOVERY_THRESHOLD: 1.1, // Add users with HF < 1.1 to kill list
        LIQUIDATION_THRESHOLD: 1.0, // Execute when HF < 1.0

        // Gas strategy
        GAS_MULTIPLIER: 1.05, // Conservative multiplier
        FIXED_GAS_PRICE_GWEI: 0.0005, // Base ultra-aggressive floor for tiny profit

        // Discovery interval (milliseconds)
        DISCOVERY_INTERVAL: 30 * 60 * 1000, // 30 minutes

        // Minimum profit threshold (in USD)
        MIN_PROFIT_USD: 0.1, // $0.10 threshold for noise reduction

        // Max liquidation percentage (Aave allows 50%)
        MAX_LIQUIDATION_PERCENT: 0.5,

        // Simulation Mode (Safety)
        SIMULATE_ONLY: false, // 🚀 PRODUCTION MODE: Real transactions enabled
    },

    // Common token addresses on Base
    TOKENS: {
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
        EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
        weETH: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A',
        cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
        GHO: '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee',
        wstETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
        AAVE: '0x63706e401c06ac8513145b7687A14804d17f814b',
        LBTC: '0xecAc9C5F704e954931349Da37F60E39f515c11c1',
        tBTC: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b',
        ezETH: '0x2416092f143378750bb29b79eD961ab195CcEea5',
        wrsETH: '0xEDfa23602D0EC14714057867A78d01e94176BEA0',
    },

    TOKEN_DECIMALS: {
        '0x4200000000000000000000000000000000000006': 18, // WETH
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 6,  // USDC
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA': 6,  // USDbC (Bridged USDC)
        '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf': 8,  // cbBTC
        '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42': 6,  // EURC
        '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A': 18, // weETH
        '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': 18, // cbETH
        '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee': 18, // GHO
        '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452': 18, // wstETH
        '0x63706e401c06ac8513145b7687A14804d17f814b': 18, // AAVE
        '0xecAc9C5F704e954931349Da37F60E39f515c11c1': 8,  // LBTC
        '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b': 18, // tBTC
        '0x2416092f143378750bb29b79eD961ab195CcEea5': 18, // ezETH
        '0xEDfa23602D0EC14714057867A78d01e94176BEA0': 18, // wrsETH
    } as Record<string, number>,

    // Flash Loan Preferences (0=BALANCER, 1=UNISWAP, 2=AAVE)
    FLASH_SOURCES: {
        '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42': { source: 1, pool: '0x7279c08A36333e12c3Fc81747963264c100D66fB' }, // EURC -> Uniswap V3
    } as Record<string, { source: number, pool?: string }>,

    // Price estimates (update these or integrate with an oracle)
    PRICES: {
        WETH: 3000,
        USDC: 1,
        USDbC: 1,
    },
};

// --- CLIENTS ---

// Public Client: Used for non-critical/heavy background tasks (Scraping, Monitoring new users)
export const publicClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC, {
        retryCount: 3,
        retryDelay: 1000 // 1s backoff
    }),
});

// Premium Client: Used for the critical path (Health check, Execution)
export const premiumClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PREMIUM, {
        retryCount: 3,
        retryDelay: 500 // Fast recovery
    }),
});

// WSS Client: Used for background scanning (DRPC)
export const wssClient = createPublicClient({
    chain: base,
    transport: webSocket(CONFIG.RPC_URL_WSS, {
        retryCount: 3,
        retryDelay: 1000
    }),
});

// Validation
if (!CONFIG.PRIVATE_KEY) {
    console.warn('⚠️  WARNING: PRIVATE_KEY not set in .env file');
}

if (!CONFIG.FLASH_LIQUIDATOR) {
    console.warn('⚠️  WARNING: FLASH_LIQUIDATOR_ADDRESS not set in .env file');
}
