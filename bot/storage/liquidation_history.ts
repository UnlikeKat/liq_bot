import fs from 'fs/promises';
import path from 'path';
import type { LiquidationWithProfit } from '../services/profit_calculator.js';

// Legacy format for backward compatibility
export interface LiquidationRecord {
    txHash: string;
    blockNumber: number;
    timestamp: number;
    user: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: string;
    liquidatedCollateral: string;
    liquidator: string;
    receiveAToken: boolean;
    // On-chain analysis
    gasUsed: string;
    gasPrice: string;
    totalGasCost: string;
    estimatedProfit?: string; // Legacy field
    profitUSD: number;
    // Forensic Analysis
    insolvencyBlock?: number;
    latencyBlocks?: number;
    positionInBlock?: number; // Transaction index in the block
    breakdown?: {
        collateralUSD: number;
        debtUSD: number;
        gasUSD: number;
        collateralAmount: number;
        debtAmount: number;
        collateralPrice: number;
        debtPrice: number;
        ethPrice: number;
    };
}


const STORAGE_PATH = path.join(process.cwd(), 'data', 'liquidation_history.json');
const BACKUP_PATH = path.join(process.cwd(), 'data', 'liquidation_history.backup.json');

/**
 * Loads liquidation history from disk
 */
export async function loadHistory(): Promise<LiquidationRecord[]> {
    try {
        const data = await fs.readFile(STORAGE_PATH, 'utf-8');
        const records = JSON.parse(data);
        console.log(`📂 Loaded ${records.length} liquidation records from storage`);
        return records;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log('📂 No existing history file, starting fresh');
            return [];
        }
        throw error;
    }
}

/**
 * Saves liquidation history to disk with atomic write and backup
 */
export async function saveHistory(records: LiquidationRecord[]): Promise<void> {
    try {
        // Create backup of existing file
        try {
            await fs.copyFile(STORAGE_PATH, BACKUP_PATH);
        } catch (e) {
            // Ignore if file doesn't exist yet
        }

        // Atomic write: write to temp file then rename
        const tempPath = STORAGE_PATH + '.tmp';
        await fs.writeFile(tempPath, JSON.stringify(records, null, 2), 'utf-8');
        await fs.rename(tempPath, STORAGE_PATH);

        console.log(`💾 Saved ${records.length} liquidation records to storage`);
    } catch (error) {
        console.error('❌ Failed to save history:', error);
        throw error;
    }
}

/**
 * Appends new records to history, deduplicating by txHash
 * Accepts both legacy and new format
 */
export async function appendRecords(newRecords: (LiquidationRecord | LiquidationWithProfit)[]): Promise<void> {
    const existing = await loadHistory();
    const existingHashes = new Set(existing.map(r => r.txHash));

    const uniqueNew = newRecords.filter(r => !existingHashes.has(r.txHash));

    if (uniqueNew.length === 0) {
        console.log('ℹ️  No new unique records to append');
        return;
    }

    const merged = [...existing, ...uniqueNew].sort((a, b) => a.timestamp - b.timestamp);
    await saveHistory(merged);

    console.log(`✅ Appended ${uniqueNew.length} new records (${newRecords.length - uniqueNew.length} duplicates skipped)`);
}


/**
 * Gets records within a date range
 */
export function getRecordsByDateRange(
    records: LiquidationRecord[],
    startDate: Date,
    endDate: Date
): LiquidationRecord[] {
    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    return records.filter(r => r.timestamp >= startTs && r.timestamp <= endTs);
}

/**
 * Gets the date of the oldest and newest records
 */
export function getDateRange(records: LiquidationRecord[]): { oldest: Date | null, newest: Date | null } {
    if (records.length === 0) return { oldest: null, newest: null };

    const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

    return {
        oldest: new Date(sorted[0].timestamp * 1000),
        newest: new Date(sorted[sorted.length - 1].timestamp * 1000)
    };
}
