'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { listDocs, deleteDoc, type HtmlDocMeta } from '@/lib/htmlDocs';

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  done:  { label: '완료', color: '#059669', bg: '#ecfdf5' },
  draft: { label: '초안', color: '#d97706', bg: '#fffbeb' },
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const TEMPLATE_META: Record<string, { icon: string; type: string; variant: string; badge: string; accent: string }> = {
  // 랜딩페이지
  'landing/ethereal':            { icon: '🌊', type: '랜딩', variant: 'Ethereal',       badge: 'ETHEREAL',  accent: '#726193' },
  'landing/glass-kit':           { icon: '🪟', type: '랜딩', variant: 'Glass Dark',     badge: 'GLASS',     accent: '#5ee7df' },
  'landing/glassmorphism-light': { icon: '✨', type: '랜딩', variant: 'Glass Light',    badge: 'GLASS·L',   accent: '#60b4ff' },
  'landing/romantic-landing':    { icon: '💗', type: '랜딩', variant: 'Romantic',       badge: 'ROMANTIC',  accent: '#c9a96e' },
  'landing/video-studio':        { icon: '🎬', type: '랜딩', variant: 'Video Studio',   badge: 'VIDEO',     accent: '#a78bfa' },
  'landing/stacking-cards':      { icon: '🃏', type: '랜딩', variant: 'Stacking Cards', badge: 'STACK',     accent: '#fb923c' },
  'landing/pottery':             { icon: '🏺', type: '랜딩', variant: 'Pottery',        badge: 'POTTERY',   accent: '#d4a06a' },
  'landing/web3':                { icon: '🔗', type: '랜딩', variant: 'Web3',           badge: 'WEB3',      accent: '#34d399' },
  'landing/contents-marker':     { icon: '📑', type: '랜딩', variant: 'ContentsMarker', badge: 'C·MARKER',  accent: '#b45309' },
  'landing/sharp-minimal':       { icon: '◼', type: '랜딩', variant: 'Sharp Minimal',   badge: 'SHARP',     accent: '#111111' },
  'landing':                     { icon: '🚀', type: '랜딩', variant: 'Standard',       badge: 'STD',       accent: '#d97706' },
  // 포트폴리오
  'portfolio/romantic-portfolio':{ icon: '🎭', type: '포트폴리오', variant: 'Romantic',       badge: 'ROMANTIC',  accent: '#c9a96e' },
  'portfolio/dark':              { icon: '🎨', type: '포트폴리오', variant: 'Dark',            badge: 'DARK',      accent: '#db2777' },
  'portfolio/stacking-cards':    { icon: '🃏', type: '포트폴리오', variant: 'Stacking Cards',  badge: 'STACK',     accent: '#fb923c' },
  'portfolio/pottery':           { icon: '🏺', type: '포트폴리오', variant: 'Pottery',         badge: 'POTTERY',   accent: '#d4a06a' },
  'portfolio/neumorphism':       { icon: '🧊', type: '포트폴리오', variant: 'Neumorphism',      badge: 'NEUMORP',   accent: '#94a3b8' },
  'portfolio':                   { icon: '🎨', type: '포트폴리오', variant: 'Standard',         badge: 'STD',       accent: '#db2777' },
  // 이력서
  'resume/classic':              { icon: '👤', type: '이력서',    variant: 'Classic',     badge: 'CLASSIC',   accent: '#4f46e5' },
  'resume/neumorphism':          { icon: '🧊', type: '이력서',    variant: 'Neumorphism',  badge: 'NEUMORP',   accent: '#94a3b8' },
  'resume':                      { icon: '👤', type: '이력서',    variant: 'Standard',     badge: 'STD',       accent: '#4f46e5' },
  // 기타
  'proposal':                    { icon: '📋', type: '제안서',    variant: 'Standard',     badge: 'STD',       accent: '#7c3aed' },
  'report':                      { icon: '📊', type: '보고서',    variant: 'Standard',     badge: 'STD',       accent: '#0284c7' },
  'newsletter':                  { icon: '📧', type: '뉴스레터',  variant: 'Standard',     badge: 'STD',       accent: '#059669' },
  'infographic':                 { icon: '📌', type: '인포그래픽', variant: 'Standard',    badge: 'STD',       accent: '#dc2626' },
  'guide/attributes':            { icon: '📐', type: '가이드',    variant: 'Attributes',   badge: 'ATTR',      accent: '#82bfdb' },
  'guide/standard':              { icon: '📖', type: '가이드',    variant: 'Standard',     badge: 'STD',       accent: '#b45309' },
  'guide/contents-marker':       { icon: '📑', type: '가이드',    variant: 'ContentsMarker', badge: 'C·MARKER', accent: '#b45309' },
  'one-page/minimalist':         { icon: '📄', type: '랜딩',     variant: 'Minimalist',   badge: 'MINIMAL',   accent: '#6b7280' },
  'one-page/contents-marker':    { icon: '🪪', type: '프로필',   variant: 'ContentsMarker', badge: 'C·MARKER', accent: '#7c3aed' },
  'one-page/neumorphism':        { icon: '🧊', type: '랜딩',     variant: 'Neumorphism',  badge: 'NEUMORP',   accent: '#94a3b8' },
  'product/minimalist':          { icon: '📦', type: '제품',      variant: 'Minimalist',   badge: 'MINIMAL',   accent: '#6b7280' },
  'product/stacking-cards':      { icon: '🃏', type: '제품',      variant: 'Stacking Cards', badge: 'STACK',   accent: '#fb923c' },
  'product/contents-marker':     { icon: '📑', type: '제품',      variant: 'ContentsMarker', badge: 'C·MARKER', accent: '#b45309' },
  'neuromorphic/standard':       { icon: '🧠', type: '개발자 프로필', variant: 'Standard',  badge: 'DEV',       accent: '#818cf8' },
  'letter/open':                 { icon: '✉️', type: '레터',      variant: 'Open',         badge: 'LETTER',    accent: '#06b6d4' },
  'letter/editorial':            { icon: '📰', type: '레터',      variant: 'Editorial',    badge: 'EDITORIAL', accent: '#374151' },
};

const TEMPLATE_THUMB: Record<string, string> = {
  'landing/ethereal':             'ethereal-landing.png',
  'landing/glass-kit':            'glass-dark.png',
  'landing/glassmorphism-light':  'glass-lite.png',
  'landing/romantic-landing':     'romantic-landing.png',
  'landing/video-studio':         'video.png',
  'landing/stacking-cards':       'stack-landing.png',
  'landing/pottery':              'pottery-landing.png',
  'landing/web3':                 'web3-landing.png',
  'landing/contents-marker':      'contentsmaker-landing.png',
  'portfolio/romantic-portfolio': 'romantic-portfolio.png',
  'portfolio/dark':               'dark-portfolio.png',
  'portfolio/stacking-cards':     'stack-landing.png',
  'portfolio/pottery':            'pottery-portfolio.png',
  'portfolio/neumorphism':        'neumorphism-profile.png',
  'resume/neumorphism':           'neumorphism-profile.png',
  'guide/attributes':             'attr-guide.png',
  'guide/contents-marker':        'contentsmaker-guide.png',
  'one-page/minimalist':          'Minimalist-onepage.png',
  'one-page/contents-marker':     'contentsmaker-portfolio.png',
  'one-page/neumorphism':         'neumorphism-profile.png',
  'product/minimalist':           'minimalist-product.png',
  'product/stacking-cards':       'stack-landing.png',
  'product/contents-marker':      'contentsmaker-product.png',
  'neuromorphic/standard':        'NeuromorphicUI.png',
  'letter/open':                  'executive-letter.png',
  'letter/editorial':             'editorial-letter.png',
};

const API_IMG_BASE =
  typeof window !== 'undefined'
    ? `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'}/template-img`
    : 'http://localhost:8001/template-img';

function getTemplateMeta(templateId: string) {
  return TEMPLATE_META[templateId] ?? {
    icon: '📄', type: templateId.split('/')[0] || '문서', variant: templateId.split('/')[1] || 'Standard',
    badge: 'STD', accent: '#9ca3af',
  };
}

export default function HtmlDocListPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<HtmlDocMeta[]>([]);

  useEffect(() => {
    listDocs().then(setDocs);
  }, []);

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('이 문서를 삭제하시겠습니까?')) return;
    deleteDoc(id); // fire-and-forget
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f8f9fb',
      padding: '2rem',
      fontFamily: "'Pretendard', -apple-system, sans-serif",
      color: '#111',
    }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 700, marginBottom: '0.2rem', color: '#111' }}>문서보관함</h1>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: docs.length > 0 ? '0.5rem' : 0 }}>
              생성된 HTML 문서를 관리합니다 ({docs.length}개)
            </p>
            {docs.length > 0 && (() => {
              const counts: Record<string, number> = {};
              docs.forEach(d => {
                const t = getTemplateMeta(d.template).type;
                counts[t] = (counts[t] ?? 0) + 1;
              });
              return (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {Object.entries(counts).map(([type, cnt]) => (
                    <span key={type} style={{ fontSize: '0.68rem', color: '#6b7280', background: '#f3f4f6', padding: '0.1rem 0.5rem', borderRadius: '999px', fontWeight: 500 }}>
                      {type} {cnt}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
          <button
            onClick={() => router.push('/html/new')}
            style={{ background: '#4f46e5', color: '#fff', padding: '0.7rem 1.4rem', borderRadius: '10px', border: 'none', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', flexShrink: 0 }}
          >
            + 새 문서
          </button>
        </div>

        {docs.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '6rem', color: '#9ca3af' }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 1.25rem' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <p style={{ marginBottom: '1.75rem', fontSize: '0.9rem', color: '#6b7280' }}>아직 문서가 없습니다. 새 문서를 만들어보세요.</p>
            <button
              onClick={() => router.push('/html/new')}
              style={{ background: '#4f46e5', color: '#fff', padding: '0.65rem 1.6rem', borderRadius: '10px', border: 'none', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#4338ca')}
              onMouseLeave={e => (e.currentTarget.style.background = '#4f46e5')}
            >
              새 문서 만들기
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.1rem' }}>
            {docs.map(doc => {
              const meta = getTemplateMeta(doc.template);
              const st = STATUS[doc.status];
              return (
                <div
                  key={doc.id}
                  onClick={() => router.push(`/html/editor?id=${doc.id}`)}
                  style={{
                    borderRadius: '16px',
                    background: '#fff',
                    border: '1px solid #e9eaec',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = `0 8px 28px ${meta.accent}22, 0 2px 8px rgba(0,0,0,0.06)`;
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.borderColor = `${meta.accent}55`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.borderColor = '#e9eaec';
                  }}
                >
                  {/* 상단 배너 */}
                  <div style={{
                    height: '88px',
                    ...(TEMPLATE_THUMB[doc.template]
                      ? {
                          backgroundImage: `linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)), url(${API_IMG_BASE}/${TEMPLATE_THUMB[doc.template]})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center top',
                        }
                      : { background: `linear-gradient(135deg, ${meta.accent}22 0%, ${meta.accent}0a 100%)` }
                    ),
                    borderBottom: `1px solid ${meta.accent}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 1.1rem',
                    position: 'relative',
                  }}>
                    {/* 대형 아이콘 */}
                    <span style={{
                      fontSize: '2.4rem',
                      lineHeight: 1,
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))',
                    }}>{meta.icon}</span>
                    {/* 뱃지 */}
                    <span style={{
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      letterSpacing: '0.09em',
                      color: meta.accent,
                      background: '#fff',
                      border: `1.5px solid ${meta.accent}55`,
                      padding: '0.18rem 0.55rem',
                      borderRadius: '999px',
                      boxShadow: `0 1px 4px ${meta.accent}22`,
                    }}>
                      {meta.badge}
                    </span>
                  </div>

                  {/* 본문 */}
                  <div style={{ padding: '0.9rem 1.1rem 0.8rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* 타입·Variant */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        color: meta.accent,
                        background: `${meta.accent}14`,
                        padding: '0.1rem 0.45rem',
                        borderRadius: '4px',
                      }}>{meta.type}</span>
                      <span style={{ fontSize: '0.65rem', color: '#c4c7cc' }}>·</span>
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 500 }}>{meta.variant}</span>
                    </div>

                    {/* 주제 */}
                    <h3 style={{
                      fontSize: '0.93rem',
                      fontWeight: 650,
                      color: '#111827',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      margin: 0,
                      lineHeight: 1.4,
                    }}>
                      {doc.topic || '(무제)'}
                    </h3>

                    {/* 하단: 날짜 + 상태 + 삭제 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.7rem', borderTop: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{formatDate(doc.updatedAt)}</span>
                        <span style={{
                          fontSize: '0.64rem',
                          fontWeight: 600,
                          color: st.color,
                          background: st.bg,
                          padding: '0.12rem 0.48rem',
                          borderRadius: '999px',
                          border: `1px solid ${st.color}30`,
                        }}>
                          {st.label}
                        </span>
                      </div>
                      <button
                        onClick={e => handleDelete(e, doc.id)}
                        title="삭제"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', borderRadius: '6px', display: 'flex', alignItems: 'center', transition: 'background 0.15s', color: '#d1d5db' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = '#d1d5db'; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
