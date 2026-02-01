import fs from 'fs/promises';
import path from 'path';

export interface SyncState {
    lastScannedBlock: number;
    lastScannedTimestamp: number;
}

const SYNC_FILE = path.join(process.cwd(), 'data', 'sync_state.json');

export async function loadSyncState(): Promise<SyncState | null> {
    try {
        const data = await fs.readFile(SYNC_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export async function saveSyncState(state: SyncState): Promise<void> {
    try {
        await fs.writeFile(SYNC_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error('Failed to save sync state', e);
    }
}
