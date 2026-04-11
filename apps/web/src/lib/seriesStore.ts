'use client';

/**
 * V3 통합 저장소 클라이언트
 * - IDB: linkdrop_v3 (빠른 로컬 캐시)
 * - Supabase: 단일 진실 공급원
 * - 이 파일 외부에서 indexedDB.open() 직접 호출 금지
 */

import type {
  Series, Chapter, Scene, WikiPage, DraftKey, PipelineStep
} from '@/types/series';

const DB_NAME = 'linkdrop_v3';
const DB_VERSION = 1;
const API_BASE = 'http://localhost:8001/api/v1';

// ── IDB 초기화 ───────────────────────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('series'))
        db.createObjectStore('series', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chapters'))
        db.createObjectStore('chapters', { keyPath: ['seriesId', 'chapter'] });
      if (!db.objectStoreNames.contains('scenes'))
        db.createObjectStore('scenes', { keyPath: ['seriesId', 'chapter', 'sceneIndex'] });
      if (!db.objectStoreNames.contains('draft'))
        db.createObjectStore('draft');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = key !== undefined
      ? tx.objectStore(store).put(value, key)
      : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── API 응답 변환 (snake_case → camelCase) ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSeries(raw: any): Series {
  return {
    ...raw,
    pipelineStep: raw.pipeline_step ?? raw.pipelineStep,
    worldData:    raw.world_data    ?? raw.worldData,
    errorDetail:  raw.error_detail  ?? raw.errorDetail,
    createdAt:    raw.created_at    ?? raw.createdAt,
    updatedAt:    raw.updated_at    ?? raw.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toChapter(raw: any): Chapter {
  return {
    id: raw.id,
    seriesId: raw.series_id,
    chapter: raw.chapter,
    role: raw.role,
    content: raw.content,
    approved: raw.approved,
    errorDetail: raw.error_detail,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  } as Chapter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toScene(raw: any): Scene {
  return {
    id: raw.id,
    seriesId: raw.series_id,
    chapter: raw.chapter,
    sceneIndex: raw.scene_index,
    text: raw.text,
    imageHint: raw.image_hint,
    isHook: raw.is_hook,
    ttsUrl: raw.tts_url,
    srtUrl: raw.srt_url,
    clipUrl: raw.clip_url,
    keyframeUrl: raw.keyframe_url,
    durationSec: raw.duration_sec,
    status: raw.status,
    errorDetail: raw.error_detail,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  } as Scene;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toWikiPage(raw: any): WikiPage {
  return {
    id: raw.id,
    seriesId: raw.series_id,
    slug: raw.slug,
    title: raw.title,
    contentMd: raw.content_md,
    updatedAt: raw.updated_at,
  } as WikiPage;
}

// ── API 헬퍼 ─────────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── 시리즈 ───────────────────────────────────────────────────────────────────
export async function createSeries(topic: string, settings?: object): Promise<Series> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await apiFetch<any>('/series', {
    method: 'POST',
    body: JSON.stringify({ topic, settings }),
  });
  const series = toSeries(raw);
  await idbPut('series', series);
  return series;
}

export async function getSeries(seriesId: string): Promise<Series | null> {
  // 네트워크 우선 — IDB는 오프라인 폴백 전용
  // (캐시-우선 시 world_data 등 최신 필드 누락 문제 발생)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await apiFetch<any>(`/series/${seriesId}`);
    const series = toSeries(raw);
    await idbPut('series', series);
    return series;
  } catch {
    return idbGet<Series>('series', seriesId);
  }
}

export async function listSeries(status?: string): Promise<Series[]> {
  const qs = status ? `?status=${status}` : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raws = await apiFetch<any[]>(`/series${qs}`);
  return raws.map(toSeries);
}

export async function updateSeries(seriesId: string, patch: Partial<Series>): Promise<void> {
  await apiFetch(`/series/${seriesId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function getSeriesStatus(seriesId: string) {
  return apiFetch<{ status: string; pipeline_step: PipelineStep; error_detail?: string }>(`/series/${seriesId}/status`);
}

export async function approvePipelineStep(seriesId: string, stepName: string): Promise<void> {
  await apiFetch(`/series/${seriesId}/approve/${stepName}`, { method: 'POST' });
}

export async function retryPipelineStep(seriesId: string, stepName: string): Promise<void> {
  await apiFetch(`/series/${seriesId}/retry/${stepName}`, { method: 'POST' });
}

export async function deleteSeries(seriesId: string): Promise<void> {
  await apiFetch(`/series/${seriesId}`, { method: 'DELETE' });
}

// ── 챕터 ─────────────────────────────────────────────────────────────────────
export async function getChapter(seriesId: string, chapter: number): Promise<Chapter | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await apiFetch<any>(`/series/${seriesId}/chapters/${chapter}`);
    return toChapter(raw);
  } catch {
    return null;
  }
}

export async function approveChapter(seriesId: string, chapter: number): Promise<void> {
  await apiFetch(`/series/${seriesId}/chapters/${chapter}/approve`, { method: 'POST' });
}

export async function listChapters(seriesId: string): Promise<Chapter[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raws = await apiFetch<any[]>(`/series/${seriesId}/chapters`);
    return raws.map(toChapter);
  } catch {
    return [];
  }
}

// ── 드래프트 (편집 중 임시 저장) ──────────────────────────────────────────────
export async function saveDraft(key: DraftKey, data: unknown): Promise<void> {
  await idbPut('draft', data, key);
}

export async function loadDraft<T>(key: DraftKey): Promise<T | null> {
  return idbGet<T>('draft', key);
}

// ── Wiki ─────────────────────────────────────────────────────────────────────
export async function getWikiPage(seriesId: string, slug: string): Promise<WikiPage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await apiFetch<any>(`/wiki/${seriesId}/pages/${slug}`);
    return toWikiPage(raw);
  } catch {
    return null;
  }
}

export async function updateWikiPage(seriesId: string, slug: string, contentMd: string): Promise<void> {
  await apiFetch(`/wiki/${seriesId}/pages/${slug}`, {
    method: 'PUT',
    body: JSON.stringify({ content_md: contentMd }),
  });
}

export async function searchWiki(seriesId: string, query: string, topK = 10) {
  return apiFetch<{ chunks: unknown[] }>(`/wiki/${seriesId}/search`, {
    method: 'POST',
    body: JSON.stringify({ query, top_k: topK }),
  });
}
