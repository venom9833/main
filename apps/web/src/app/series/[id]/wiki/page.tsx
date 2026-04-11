'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getWikiPage, updateWikiPage, searchWiki } from '@/lib/seriesStore';
import type { WikiPage } from '@/types/series';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => router.push(`/series/${id}`)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1rem' }}>← 돌아가기</button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>위키</h1>
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
    </main>
  );
}
