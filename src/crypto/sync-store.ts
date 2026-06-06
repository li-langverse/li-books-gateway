/** User-scoped sync cursors + raw API audit — mirrors lidb `crypto_sync_*` tables. */

export type SyncCursor = {
  book_id: string;
  user_id: string;
  source: string;
  last_sync_at: string;
  cursor_payload?: Record<string, unknown>;
};

export type SyncRawRecord = {
  id: string;
  book_id: string;
  user_id: string;
  source: string;
  sync_cursor?: string;
  response_body: unknown;
  fetched_at: string;
};

export interface SyncStore {
  getCursor(book_id: string, user_id: string, source: string): SyncCursor | null;
  setCursor(cursor: SyncCursor): SyncCursor;
  appendRaw(record: Omit<SyncRawRecord, "id" | "fetched_at">): SyncRawRecord;
  listRaw(book_id: string, user_id: string, source?: string): SyncRawRecord[];
}

export class InMemorySyncStore implements SyncStore {
  private readonly cursors = new Map<string, SyncCursor>();
  private readonly raw: SyncRawRecord[] = [];

  private cursorKey(book_id: string, user_id: string, source: string): string {
    return `${book_id}:${user_id}:${source}`;
  }

  getCursor(book_id: string, user_id: string, source: string): SyncCursor | null {
    return this.cursors.get(this.cursorKey(book_id, user_id, source)) ?? null;
  }

  setCursor(cursor: SyncCursor): SyncCursor {
    this.cursors.set(this.cursorKey(cursor.book_id, cursor.user_id, cursor.source), cursor);
    return cursor;
  }

  appendRaw(record: Omit<SyncRawRecord, "id" | "fetched_at">): SyncRawRecord {
    const stored: SyncRawRecord = {
      ...record,
      id: `raw-${this.raw.length + 1}`,
      fetched_at: new Date().toISOString(),
    };
    this.raw.push(stored);
    return stored;
  }

  listRaw(book_id: string, user_id: string, source?: string): SyncRawRecord[] {
    return this.raw.filter(
      (r) =>
        r.book_id === book_id &&
        r.user_id === user_id &&
        (source == null || r.source === source)
    );
  }
}

export const defaultSyncStore = new InMemorySyncStore();
