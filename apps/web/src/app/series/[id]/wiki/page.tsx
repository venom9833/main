'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getWikiPage, updateWikiPage, searchWiki } from '@/lib/seriesStore';
import type { WikiPage } from '@/types/series';

const API = 'http://localhost:8001/api/v1';

const SLUGS = ['world', 'characters', 'foreshadows', 'timeline'];
const SLUG_LABELS: Record<string, string> = {
  world: '세계관', characters: '캐릭터', foreshadows: '복선', timeline: '타임라인',
};

export default function WikiPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [activeSlug, setActiveSlug] = useState('world');
  const [page, setPage] = useState<WikiPage | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [lintReport, setLintReport] = useState('');
  const [lintLoading, setLintLoading] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseResult, setReviseResult] = useState<string | null>(null);

  const runLintAndRevise = async () => {
    if (!confirm('위키 기준으로 대본을 검수한 뒤 수정 필요 항목을 자동 재작성합니다.\n계속하시겠습니까?')) return;
    setLintLoading(true);
    setLintReport('');
    setReviseResult(null);
    try {
      // 1단계: Lint 검수
      const lintRes = await fetch(`${API}/wiki/${id}/lint`, { method: 'POST' });
      const lintData = await lintRes.json();
      setLintReport(lintData.report ?? '');

      // 2단계: 자동 수정
      setLintLoading(false);
      setRevising(true);
      const reviseRes = await fetch(`${API}/wiki/${id}/revise`, { method: 'POST' });
      const reviseData = await reviseRes.json();
      const count = reviseData.revised ?? 0;
      setReviseResult(count > 0 ? `챕터 ${reviseData.chapters?.join(', ')}화 재작성 완료.` : '수정 필요 항목이 없습니다.');
    } finally {
      setLintLoading(false);
      setRevising(false);
    }
  };

  useEffect(() => {
    getWikiPage(id, activeSlug).then(p => {
      setPage(p);
      setDraft(p?.contentMd ?? '');
    });
    setEditing(false);
    setSearchResults([]);
  }, [id, activeSlug]);

  const save = async () => {
    setSaving(true);
    try {
      await updateWikiPage(id, activeSlug, draft);
      setPage(prev => prev ? { ...prev, contentMd: draft } : null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    const res = await searchWiki(id, query.trim());
    setSearchResults(res.chunks as unknown[]);
  };

  return (
    <main style={{ minHeight: '100vh', fontFamily: "var(--font-en), 'Pretendard', sans-serif", padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button onClick={() => router.push(`/series/${id}`)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1rem' }}>← 돌아가기</button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, flex: 1 }}>위키</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={runLintAndRevise}
            disabled={lintLoading || revising}
            style={{ padding: '0.5rem 1.2rem', borderRadius: '8px', border: 'none', cursor: (lintLoading || revising) ? 'not-allowed' : 'pointer', background: (lintLoading || revising) ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.7)', color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}
          >
            {lintLoading ? '검수 중...' : revising ? '교정 중...' : '대본 교정'}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {SLUGS.map(slug => (
          <button key={slug} onClick={() => setActiveSlug(slug)} style={{
            padding: '0.5rem 1.2rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: activeSlug === slug ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,0.08)',
            color: '#fff', fontWeight: activeSlug === slug ? 700 : 400,
          }}>{SLUG_LABELS[slug]}</button>
        ))}
      </div>

      {/* RAG 검색 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="위키 검색 (RAG)..." style={{
            flex: 1, padding: '0.6rem 1rem', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
            color: '#fff', outline: 'none',
          }} />
        <button onClick={doSearch} style={{
          padding: '0.6rem 1.2rem', borderRadius: '10px', border: 'none',
          background: 'rgba(99,102,241,0.5)', color: '#fff', cursor: 'pointer',
        }}>검색</button>
      </div>

      {searchResults.length > 0 && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#a78bfa' }}>검색 결과</p>
          {searchResults.map((r, i) => (
            <div key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)' }}>
              <span style={{ color: '#6366f1', marginRight: '0.5rem' }}>[{r.sourceType}]</span>{r.content?.slice(0, 200)}...
            </div>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div style={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontWeight: 700 }}>{SLUG_LABELS[activeSlug]}</span>
          {!editing ? (
            <button onClick={() => setEditing(true)} style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'none', color: '#fff', cursor: 'pointer' }}>편집</button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setEditing(false)} style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'none', color: '#fff', cursor: 'pointer' }}>취소</button>
              <button onClick={save} disabled={saving} style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>{saving ? '저장 중...' : '저장'}</button>
            </div>
          )}
        </div>
        <div style={{ padding: '1.5rem' }}>
          {editing ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)} style={{
              width: '100%', minHeight: '400px', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
              color: '#fff', padding: '1rem', fontSize: '0.95rem', resize: 'vertical', outline: 'none', fontFamily: 'monospace',
            }} />
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', lineHeight: 1.7, margin: 0 }}>
              {page?.contentMd || '내용이 없습니다. 파이프라인이 완료되면 자동으로 채워집니다.'}
            </pre>
          )}
        </div>
      </div>
      {/* Lint 리포트 */}
      {(lintReport || reviseResult) && (
        <div style={{ marginTop: '2rem', borderRadius: '16px', border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
            <span style={{ fontWeight: 700, color: '#a78bfa' }}>🔍 Lint 보고서 — 33차원</span>
            <button
              onClick={() => { setLintReport(''); setReviseResult(null); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.2rem' }}
            >✕</button>
          </div>
          {reviseResult && (
            <div style={{ padding: '0.8rem 1.5rem', background: 'rgba(16,185,129,0.1)', borderBottom: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7', fontWeight: 600, fontSize: '0.9rem' }}>
              ✅ {reviseResult}
            </div>
          )}
          <pre style={{ padding: '1.5rem', whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.8)', fontSize: '0.88rem', lineHeight: 1.75, margin: 0, maxHeight: '600px', overflowY: 'auto' }}>
            {lintReport}
          </pre>
        </div>
      )}
    </main>
  );
}
