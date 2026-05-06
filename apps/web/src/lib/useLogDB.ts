/**
 * useLogDB — mp4combine 렌더 로그를 IndexedDB에 영속 저장.
 * seriesId + chapter 단위로 분리. deleteLog(id)로 행 단위 삭제.
 */
import React from 'react';

const DB_NAME        = 'linkdrop_logs';
const STORE          = 'mp4combine';
const PIPELINE_STORE = 'pipeline_logs';
const VER            = 2;

interface LogEntry {
  id?: number;
  seriesId: string;
  chapter: number;
  ts: string;
  line: string;
}

export interface LogLine {
  id: number;
  line: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('bySC', ['seriesId', 'chapter'], { unique: false });
      }
      if (!db.objectStoreNames.contains(PIPELINE_STORE)) {
        db.createObjectStore(PIPELINE_STORE, { keyPath: 'seriesId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function useLogDB(seriesId: string, chapter: number) {
  const [log, setLog] = React.useState<LogLine[]>([]);

  React.useEffect(() => {
    if (!seriesId) { setLog([]); return; }
    openDB().then(db => {
      const req = db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .index('bySC')
        .getAll([seriesId, chapter]);
      req.onsuccess = () =>
        setLog((req.result as LogEntry[]).map(e => ({ id: e.id!, line: e.line })));
    }).catch(() => {});
  }, [seriesId, chapter]);

  const addLog = React.useCallback((line: string) => {
    if (!seriesId) {
      setLog(prev => [...prev, { id: Date.now(), line }]);
      return;
    }
    openDB().then(db => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req   = store.add({ seriesId, chapter, ts: new Date().toISOString(), line } as LogEntry);
      req.onsuccess = () => {
        const id = req.result as number;
        setLog(prev => [...prev, { id, line }]);
      };
    }).catch(() => {
      setLog(prev => [...prev, { id: Date.now(), line }]);
    });
  }, [seriesId, chapter]);

  const deleteLog = React.useCallback((id: number) => {
    setLog(prev => prev.filter(l => l.id !== id));
    if (!seriesId) return;
    openDB().then(db => {
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    }).catch(() => {});
  }, [seriesId]);

  return { log, addLog, deleteLog };
}

// ── Pipeline execution log cache ─────────────────────────────────────────────

export async function getPipelineLogs<T = unknown>(seriesId: string): Promise<T[]> {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const req = db.transaction(PIPELINE_STORE, 'readonly')
        .objectStore(PIPELINE_STORE)
        .get(seriesId);
      req.onsuccess = () => resolve((req.result?.logs as T[]) ?? []);
      req.onerror   = () => resolve([]);
    });
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLog = any;

export async function setPipelineLogs<T = unknown>(
  seriesId: string,
  incomingLogs: T[],
  seriesTitle?: string,
): Promise<void> {
  try {
    const db = await openDB();

    // 1. 기존 IDB 로그 읽기
    const existing = await new Promise<AnyLog[]>(resolve => {
      const req = db.transaction(PIPELINE_STORE, 'readonly')
        .objectStore(PIPELINE_STORE)
        .get(seriesId);
      req.onsuccess = () => resolve((req.result?.logs as AnyLog[]) ?? []);
      req.onerror   = () => resolve([]);
    });

    // 2. id 기준 merge — 기존 먼저 적재 후 incoming으로 덮어써 최신 상태(finished_at 등) 반영
    const map = new Map<string, AnyLog>();
    for (const l of existing)      map.set(String(l.id), l);
    for (const l of incomingLogs)  map.set(String((l as AnyLog).id), l);

    // 3. started_at 내림차순 (최신 로그가 맨 위)
    const merged = Array.from(map.values()).sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );

    // 4. 병합 결과 저장
    return new Promise(resolve => {
      const title = seriesTitle ?? (existing.length > 0 ? undefined : '');
      const req = db.transaction(PIPELINE_STORE, 'readwrite')
        .objectStore(PIPELINE_STORE)
        .put({ seriesId, seriesTitle: title ?? '', logs: merged, cachedAt: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror   = () => resolve();
    });
  } catch {
    return;
  }
}
