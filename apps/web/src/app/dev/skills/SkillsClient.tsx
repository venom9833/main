'use client';
import { useState, useMemo } from 'react';

export type SkillMeta = {
  slug: string;
  name: string;
  description: string;
  cat: string;
  badge: string;
  auto: boolean;
  triggers: string[];
};

const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '핵심':    { bg: 'rgba(94,231,223,0.12)',  border: 'rgba(94,231,223,0.4)',  text: '#5ee7df' },
  '아키텍처': { bg: 'rgba(180,144,245,0.12)', border: 'rgba(180,144,245,0.4)', text: '#b490f5' },
  'UI/UX':   { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.4)',  text: '#fbbf24' },
  'React':   { bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.4)',  text: '#60a5fa' },
  'Next.js': { bg: 'rgba(255,255,255,0.1)',  border: 'rgba(255,255,255,0.3)', text: '#e2e8f0' },
  '배포':    { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.4)',  text: '#34d399' },
  'AI/Gemini': { bg: 'rgba(66,194,255,0.12)', border: 'rgba(66,194,255,0.4)', text: '#42c2ff' },
  '문서조회': { bg: 'rgba(255,136,80,0.12)', border: 'rgba(255,136,80,0.4)', text: '#ff8850' },
  '생산성':  { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.4)',  text: '#f97316' },
  '기타':    { bg: 'rgba(148,163,184,0.1)',  border: 'rgba(148,163,184,0.3)', text: '#94a3b8' },
};

export default function SkillsClient({ skills }: { skills: SkillMeta[] }) {
  const categories = useMemo(() => {
    const cats = ['전체', ...Array.from(new Set(skills.map(s => s.cat)))];
    return cats;
  }, [skills]);

  const [activeCat, setActiveCat] = useState('전체');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = skills;
    if (activeCat !== '전체') list = list.filter(s => s.cat === activeCat);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(s =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.badge.toLowerCase().includes(q) ||
        s.triggers.some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [activeCat, query, skills]);

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #07080f 0%, #0d0e1a 60%, #07080f 100%)',
      paddingTop: 92 + 32,
      paddingBottom: 80,
      paddingLeft: 24,
      paddingRight: 24,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em',
              color: '#5ee7df', background: 'rgba(94,231,223,0.1)',
              border: '1px solid rgba(94,231,223,0.3)', borderRadius: 4,
              padding: '3px 8px', textTransform: 'uppercase',
            }}>임시 개발 전용</span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>
              프로덕션 배포 전 제거 · .claude/skills/ 실시간 반영
            </span>
          </div>
          <h1 style={{
            fontSize: '2rem', fontWeight: 800, color: '#fff',
            letterSpacing: '-0.5px', marginBottom: 8,
          }}>
            스킬 사용 가이드
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            설치된 <strong style={{ color: '#fff' }}>{skills.length}개</strong> 스킬의 최적 사용 시점.
            <span style={{ color: '#5ee7df', marginLeft: 8 }}>🔄 자동</span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', marginLeft: 4 }}>= 문맥 감지 시 자동 실행</span>
          </p>
        </div>

        {/* 검색 */}
        <div style={{ position: 'relative', marginBottom: 28 }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'rgba(255,255,255,0.3)', fontSize: '1rem', pointerEvents: 'none',
          }}>🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="스킬명, 명령어, 설명 검색..."
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 16px 12px 40px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, color: '#fff',
              fontSize: '0.9rem', outline: 'none',
            }}
          />
        </div>

        {/* 카테고리 탭 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32 }}>
          {categories.map(cat => {
            const isActive = cat === activeCat;
            const c = CAT_COLORS[cat];
            const count = cat === '전체' ? skills.length : skills.filter(s => s.cat === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                style={{
                  padding: '6px 16px', borderRadius: 999, fontSize: '0.82rem',
                  fontWeight: isActive ? 700 : 400, cursor: 'pointer',
                  background: isActive ? (c?.bg ?? 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isActive ? (c?.border ?? 'rgba(255,255,255,0.3)') : 'rgba(255,255,255,0.1)'}`,
                  color: isActive ? (c?.text ?? '#fff') : 'rgba(255,255,255,0.55)',
                  transition: 'all 0.15s',
                }}
              >
                {cat}
                <span style={{ marginLeft: 6, fontSize: '0.72rem', opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {(query || activeCat !== '전체') && (
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem', marginBottom: 16 }}>
            {filtered.length}개 스킬
          </p>
        )}

        {/* 카드 그리드 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(skill => {
            const c = CAT_COLORS[skill.cat] ?? CAT_COLORS['기타'];
            return (
              <div
                key={skill.slug}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 14, padding: '20px 22px',
                  display: 'flex', flexDirection: 'column', gap: 14,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'rgba(255,255,255,0.07)';
                  el.style.borderColor = c.border;
                  el.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'rgba(255,255,255,0.04)';
                  el.style.borderColor = 'rgba(255,255,255,0.1)';
                  el.style.transform = 'translateY(0)';
                }}
              >
                {/* 헤더 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <code style={{
                        fontSize: '0.8rem', fontFamily: 'monospace',
                        color: c.text, background: c.bg,
                        border: `1px solid ${c.border}`,
                        borderRadius: 5, padding: '2px 8px',
                      }}>
                        /{skill.slug}
                      </code>
                      {skill.auto && (
                        <span style={{
                          fontSize: '0.68rem', color: '#5ee7df',
                          background: 'rgba(94,231,223,0.1)',
                          border: '1px solid rgba(94,231,223,0.25)',
                          borderRadius: 4, padding: '1px 6px',
                        }}>🔄 자동</span>
                      )}
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                      {skill.name}
                    </h3>
                  </div>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600,
                    color: c.text, background: c.bg,
                    border: `1px solid ${c.border}`,
                    borderRadius: 999, padding: '3px 10px',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {skill.badge}
                  </span>
                </div>

                {/* 설명 */}
                <p style={{
                  fontSize: '0.84rem', color: 'rgba(255,255,255,0.6)',
                  lineHeight: 1.65, margin: 0,
                  display: '-webkit-box', WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {skill.description}
                </p>

                {/* 트리거 */}
                {skill.triggers.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: c.text, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      언제 사용하나
                    </p>
                    <ul style={{ margin: 0, padding: '0 0 0 1rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {skill.triggers.slice(0, 4).map((t, i) => (
                        <li key={i} style={{ fontSize: '0.81rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.3)' }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>🔍</p>
            <p>일치하는 스킬이 없습니다.</p>
          </div>
        )}

        {/* 푸터 */}
        <div style={{
          marginTop: 60, paddingTop: 24,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)' }}>
            소스: <code style={{ color: 'rgba(255,255,255,0.4)' }}>C:\LinkDropV3\.claude\skills\</code>
          </p>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)' }}>
            ⚠️ 임시 라우터 — 프로덕션 배포 전 제거
          </p>
        </div>
      </div>
    </main>
  );
}
