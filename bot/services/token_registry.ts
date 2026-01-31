/**
 * Token Registry for Base AAVE V3
 * Contains metadata for all supported assets including decimals
 */

export interface TokenInfo {
    symbol: string;
    decimals: number;
    address: string;
}

/**
 * Base AAVE V3 Token Registry
 * Addresses are lowercase for consistent lookups
 */
export const BASE_TOKENS: Record<string, TokenInfo> = {
    // WETH - Wrapped Ethereum
    '0x4200000000000000000000000000000000000006': {
        symbol: 'WETH',
        decimals: 18,
        address: '0x4200000000000000000000000000000000000006'
    },

    // USDC - USD Coin
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': {
        symbol: 'USDC',
        decimals: 6,
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    },

    // cbBTC - Coinbase Wrapped Bitcoin
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': {
        symbol: 'cbBTC',
        decimals: 8,
        address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'
    },

    // cbETH - Coinbase Wrapped Staked ETH
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': {
        symbol: 'cbETH',
        decimals: 18,
        address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22'
    },

    // wstETH - Wrapped Staked ETH (Lido)
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': {
        symbol: 'wstETH',
        decimals: 18,
        address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452'
    },

    // USDbC - Bridged USD Coin (Base)
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': {
        symbol: 'USDbC',
        decimals: 6,
        address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'
    },

    // weETH - Wrapped eETH (ether.fi)
    '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': {
        symbol: 'weETH',
        decimals: 18,
        address: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A'
    },

    // GHO - Aave Stablecoin
    '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee': {
        symbol: 'GHO',
        decimals: 18,
        address: '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee'
    },

    // AAVE (Aave Token)
    '0x63706e401c06ac8513145b7687a14804d17f814b': {
        symbol: 'AAVE',
        decimals: 18,
        address: '0x63706e401c06ac8513145b7687a14804d17f814b'
    },

    // LBTC (Lombard Staked BTC)
    '0xecac9c5f704e954931349da37f60e39f515c11c1': {
        symbol: 'LBTC',
        decimals: 8,
        address: '0xecac9c5f704e954931349da37f60e39f515c11c1'
    },

    // tBTC (Threshold BTC)
    '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b': {
        symbol: 'tBTC',
        decimals: 18,
        address: '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b'
    },

    // ezETH (Renzo Restaked ETH)
    '0x2416092f143378750bb29b79ed961ab195cceea5': {
        symbol: 'ezETH',
        decimals: 18,
        address: '0x2416092f143378750bb29b79ed961ab195cceea5'
    },

    // wrsETH (Kelp DAO Restaked ETH)
    '0xedfa23602d0ec14714057867a78d01e94176bea0': {
        symbol: 'wrsETH',
        decimals: 18,
        address: '0xedfa23602d0ec14714057867a78d01e94176bea0'
    },

    // EURC - Euro Coin (Circle)
    '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': {
        symbol: 'EURC',
        decimals: 6,
        address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'
    }
};

/**
 * Get token info by address (case-insensitive)
 */
export function getTokenInfo(address: string): TokenInfo | undefined {
    return BASE_TOKENS[address.toLowerCase()];
}

/**
 * Get token decimals by address
 */
export function getTokenDecimals(address: string): number {
    const token = getTokenInfo(address);
    if (!token) {
        console.warn(`Unknown token address: ${address}, defaulting to 18 decimals`);
        return 18;
    }
    return token.decimals;
}

/**
 * Get token symbol by address
 */
export function getTokenSymbol(address: string): string {
    const token = getTokenInfo(address);
    return token?.symbol || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format token amount to human-readable string
 */
export function formatTokenAmount(rawAmount: string | bigint, address: string, precision: number = 4): string {
    const decimals = getTokenDecimals(address);
    const amount = Number(rawAmount) / Math.pow(10, decimals);
    return amount.toFixed(precision);
}

/**
 * Convert raw token amount to decimal number
 */
export function toDecimalAmount(rawAmount: string | bigint, address: string): number {
    const decimals = getTokenDecimals(address);
    return Number(rawAmount) / Math.pow(10, decimals);
}
