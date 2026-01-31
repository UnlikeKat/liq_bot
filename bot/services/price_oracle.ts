import { publicClient } from '../config.js';
import type { Address } from 'viem';

/**
 * AAVE V3 Oracle on Base
 * Returns asset prices in USD with 8 decimals
 */
const AAVE_ORACLE_ADDRESS = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156' as const;

const ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

// Price cache: asset_block -> price
const priceCache = new Map<string, number>();

/**
 * Get USD price for an asset from AAVE Oracle
 * @param asset Token address
 * @param blockNumber Optional block number for historical prices
 * @returns USD price (e.g., 3300.00 for $3300)
 */
export async function getAssetPriceUSD(
    asset: string,
    blockNumber?: bigint
): Promise<number> {
    const cacheKey = `${asset.toLowerCase()}_${blockNumber?.toString() || 'latest'}`;

    // Check cache first
    if (priceCache.has(cacheKey)) {
        return priceCache.get(cacheKey)!;
    }

    try {
        const priceRaw = await publicClient.readContract({
            address: AAVE_ORACLE_ADDRESS,
            abi: ORACLE_ABI,
            functionName: 'getAssetPrice',
            args: [asset as Address]
            // NOTE: blockNumber removed - historical state queries fail on free RPCs
        });

        // Oracle returns price with 8 decimals
        // e.g., 330000000000 = $3300.00
        const price = Number(priceRaw) / 1e8;

        // Cache the price
        priceCache.set(cacheKey, price);

        return price;
    } catch (error) {
        console.error(`Failed to get price for ${asset}:`, error);
        throw error;
    }
}

/**
 * Get multiple asset prices in batch
 */
export async function getBatchAssetPrices(
    assets: string[],
    blockNumber?: bigint
): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Fetch all prices in parallel
    const results = await Promise.allSettled(
        assets.map(asset => getAssetPriceUSD(asset, blockNumber))
    );

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            prices.set(assets[index].toLowerCase(), result.value);
        } else {
            console.error(`Failed to fetch price for ${assets[index]}:`, result.reason);
        }
    });

    return prices;
}

/**
 * Clear price cache (useful for testing or memory management)
 */
export function clearPriceCache(): void {
    priceCache.clear();
}

/**
 * Get cache statistics
 */
export function getPriceCacheStats(): { size: number; keys: string[] } {
    return {
        size: priceCache.size,
        keys: Array.from(priceCache.keys())
    };
}
