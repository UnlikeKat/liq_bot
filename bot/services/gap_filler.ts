import { LiquidationRecord, loadHistory, appendRecords, getDateRange } from '../storage/liquidation_history.js';
import { fetchLiquidationsByDateRange } from '../fetchers/historical_liquidations.js';
import { bridge } from '../server.js';

export interface DateRange {
    start: Date;
    end: Date;
}

/**
 * Detects missing date ranges in the 90-day window
 */
/**
 * Detects gaps ONLY at the end of the history (bot downtime)
 * Ignores holes in the past to avoid re-fetching empty days
 */
export async function detectGaps(records: LiquidationRecord[]): Promise<DateRange[]> {
    const { loadSyncState } = await import('../storage/sync_state.js');
    const syncState = await loadSyncState();
    const now = new Date(); // Use local system time as anchor

    // 1. Prefer Explicit Sync State (Precision Mode)
    if (syncState) {
        const lastScanned = new Date(syncState.lastScannedTimestamp);
        const diffMs = now.getTime() - lastScanned.getTime();

        // If we haven't scanned for > 10 mins, we need to catch up.
        // This is safe now because we KNOW exactly when we last stopped checking.
        if (diffMs > 10 * 60 * 1000) {
            console.log(`⏱️ Last sync was at ${lastScanned.toISOString()} (${Math.floor(diffMs / 60000)} mins ago)`);
            return [{ start: lastScanned, end: now }];
        }
        return [];
    }

    // 2. Fallback to Last Record Heuristic (Legacy Mode)
    if (records.length === 0) return [];

    let maxTimestamp = 0;
    for (const record of records) {
        if (record.timestamp > maxTimestamp) {
            maxTimestamp = record.timestamp;
        }
    }

    if (maxTimestamp === 0) return [];

    const lastRecordDate = new Date(maxTimestamp * 1000);
    const diffMs = now.getTime() - lastRecordDate.getTime();

    // If using heuristic, keep the 60 min buffer to avoid false positives on quiet days
    if (diffMs > 60 * 60 * 1000) {
        console.log(`⏱️ Last liquidation record was ${Math.floor(diffMs / 60000)} mins ago (Heuristic Gap)`);
        return [{
            start: new Date(lastRecordDate.getTime() + 1000),
            end: now
        }];
    }

    return [];
}

/**
 * Fills detected gaps by fetching missing liquidations
 */
export async function fillGaps(gaps: DateRange[]): Promise<void> {
    if (gaps.length === 0) {
        console.log('✅ No gaps detected, history is complete!');
        return;
    }

    console.log(`🔧 Detected ${gaps.length} gap(s) to fill:`);
    gaps.forEach((gap, i) => {
        console.log(`  ${i + 1}. ${gap.start.toISOString()} → ${gap.end.toISOString()}`);
    });

    for (let i = 0; i < gaps.length; i++) {
        const gap = gaps[i];
        console.log(`\n🚀 Filling gap ${i + 1}/${gaps.length}...`);

        bridge.broadcast('PROGRESS', {
            job: 'FILLING_LIQUIDATION_GAPS',
            percent: Math.floor((i / gaps.length) * 100)
        });

        try {
            const records = await fetchLiquidationsByDateRange(
                gap.start,
                gap.end,
                (current, total) => {
                    const gapProgress = (i / gaps.length) * 100;
                    const analysisProgress = (current / total) * (100 / gaps.length);
                    bridge.broadcast('PROGRESS', {
                        job: 'FILLING_LIQUIDATION_GAPS',
                        percent: Math.floor(gapProgress + analysisProgress)
                    });
                }
            );

            await appendRecords(records);
            console.log(`✅ Gap ${i + 1} filled: ${records.length} liquidations added`);

        } catch (error) {
            console.error(`❌ Failed to fill gap ${i + 1}:`, error);
        }
    }

    bridge.broadcast('PROGRESS', {
        job: 'FILLING_LIQUIDATION_GAPS',
        percent: -1 // Remove progress indicator
    });

    console.log('\n✅ All gaps filled successfully!');
}

/**
 * Main initialization: loads history and fills gaps
 */
export async function initializeLiquidationHistory(): Promise<LiquidationRecord[]> {
    console.log('\n🎯 Initializing 90-day liquidation history...');

    // Load existing history
    const history = await loadHistory();

    if (history.length === 0) {
        console.log('📭 No existing history found, fetching initial 90 days...');
        bridge.broadcast('PROGRESS', {
            job: 'INITIAL_LIQUIDATION_FETCH',
            percent: 0
        });

        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        const records = await fetchLiquidationsByDateRange(
            ninetyDaysAgo,
            now,
            (current, total) => {
                bridge.broadcast('PROGRESS', {
                    job: 'INITIAL_LIQUIDATION_FETCH',
                    percent: Math.floor((current / total) * 100)
                });
            }
        );

        await appendRecords(records);

        bridge.broadcast('PROGRESS', {
            job: 'INITIAL_LIQUIDATION_FETCH',
            percent: -1
        });

        console.log(`✅ Initial fetch complete: ${records.length} liquidations`);
        return records;
    }

    // Check for gaps
    const range = getDateRange(history);
    console.log(`📊 Existing history: ${history.length} records`);
    console.log(`   Oldest: ${range.oldest?.toISOString()}`);
    console.log(`   Newest: ${range.newest?.toISOString()}`);

    const gaps = await detectGaps(history);

    if (gaps.length > 0) {
        await fillGaps(gaps);
        return await loadHistory(); // Reload after filling
    }

    const { saveSyncState } = await import('../storage/sync_state.js');
    const { publicClient } = await import('../config.js');
    const latestBlock = await publicClient.getBlockNumber();

    await saveSyncState({
        lastScannedBlock: Number(latestBlock),
        lastScannedTimestamp: Date.now()
    });

    return history;
}
