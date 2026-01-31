import { createPublicClient, http, type PublicClient } from 'viem';
import { base } from 'viem/chains';

/**
 * RPC Pool for parallel requests and load balancing
 * Uses multiple free RPC endpoints to speed up historical data fetching
 */

const FREE_RPC_ENDPOINTS = [
    'https://base.llamarpc.com',
    'https://base-rpc.publicnode.com',
    'https://base-public.nodies.app',
    'https://endpoints.omniatech.io/v1/base/mainnet/public',
    'https://base.gateway.tenderly.co',
    'https://base.public.blockpi.network/v1/rpc/public',
    'https://base.lava.build',
    'https://base-mainnet.gateway.tatum.io',
    'https://base-mainnet.public.blastapi.io',
    'https://1rpc.io/base',
    'https://mainnet.base.org',
    'https://base.drpc.org'
];

class RPCPool {
    private clients: PublicClient[];
    private currentIndex: number = 0;
    private requestCounts: number[] = [];

    constructor(endpoints: string[]) {
        this.clients = endpoints.map(url =>
            createPublicClient({
                chain: base,
                transport: http(url, {
                    timeout: 15_000,
                    retryCount: 2,
                    batch: true
                })
            })
        );
        this.requestCounts = new Array(endpoints.length).fill(0);
        console.log(`🌐 RPC Pool initialized with ${endpoints.length} endpoints`);
    }

    /**
     * Get next client using round-robin load balancing
     */
    getClient(): PublicClient {
        const client = this.clients[this.currentIndex];
        this.requestCounts[this.currentIndex]++;
        this.currentIndex = (this.currentIndex + 1) % this.clients.length;
        return client;
    }

    /**
     * Get all clients for parallel execution
     */
    getAllClients(): PublicClient[] {
        return this.clients;
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            totalEndpoints: this.clients.length,
            requestCounts: this.requestCounts,
            totalRequests: this.requestCounts.reduce((a, b) => a + b, 0)
        };
    }
}

export const rpcPool = new RPCPool(FREE_RPC_ENDPOINTS);

/**
 * Execute requests in parallel across the RPC pool
 */
export async function parallelFetch<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number = 6
): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
        const promise = task().then(result => {
            results.push(result);
        });

        executing.push(promise);

        if (executing.length >= concurrency) {
            await Promise.race(executing);
            executing.splice(executing.findIndex(p => p === promise), 1);
        }
    }

    await Promise.all(executing);
    return results;
}
