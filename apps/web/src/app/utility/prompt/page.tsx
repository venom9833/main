'use client';
import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import HeartRating from './_components/HeartRating';

// ssr: false — 이미지 프롬프트 탭은 서버 렌더링 불필요 (API fetch 기반)
const PromptTabImage = dynamic(
  () => import('./_components/PromptTabImage'),
  { ssr: false, loading: () => (
    <div style={{ padding: 60, textAlign: 'center', color: 'rgba(15,23,42,0.35)', fontSize: '0.9rem' }}>
      불러오는 중…
    </div>
  )}
);

type Tab = 'prompts' | 'dark' | 'brand' | 'image';
type ApiCategory = { id: string; letter: string; icon: string; label: string };
type ApiPrompt   = { code: string; cat: string; title: string; description: string; body: string; is_premium: boolean };

// 이미지+Brand 탭 전용 프론트 서브카테고리 (DB에는 모두 cat13)
const BRAND_SUBCATEGORIES: ApiCategory[] = [
  { id: 'brand-kit',      letter: 'M', icon: '🏷️', label: '브랜드 시스템' },
  { id: 'brand-digital',  letter: 'M', icon: '📱', label: '디지털 채널' },
  { id: 'brand-campaign', letter: 'M', icon: '📣', label: '캠페인·경험' },
];

// code → 서브카테고리 매핑 (M01-M12 순서 기반)
const BRAND_SUBCAT: Record<string, string> = {
  M01: 'brand-kit', M08: 'brand-kit', M10: 'brand-kit',
  M03: 'brand-digital', M05: 'brand-digital', M07: 'brand-digital', M11: 'brand-digital',
  M02: 'brand-campaign', M04: 'brand-campaign', M06: 'brand-campaign', M09: 'brand-campaign', M12: 'brand-campaign',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

export default function PromptPage() {
  const [activeTab,     setActiveTab]     = useState<Tab>('prompts');
  const [activecat,     setActivecat]     = useState('cat01');
  const [activeBrandCat, setActiveBrandCat] = useState('brand-kit');
  const [copiedId,      setCopiedId]      = useState<string | null>(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [categories,    setCategories]    = useState<ApiCategory[]>([]);
  const [prompts,       setPrompts]       = useState<ApiPrompt[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [ratings,       setRatings]       = useState<Record<string, number>>({});
  const [sortByHearts,  setSortByHearts]  = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 카테고리 + 프롬프트 목록 + 하트 평점을 동시에 불러온다
    Promise.all([
      fetch(`${API_BASE}/api/v1/prompts/categories`).then(r => r.json()),
      fetch(`${API_BASE}/api/v1/prompts`).then(r => r.json()),
      fetch(`${API_BASE}/api/v1/prompt-ratings`).then(r => r.json()),
    ]).then(([cats, ps, rtgs]: [ApiCategory[], ApiPrompt[], Record<string, number>]) => {
      setCategories(cats);
      setPrompts(ps);
      setRatings(rtgs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // 탭별 데이터 분기
  const promptCats   = categories.filter(c => c.id !== 'cat12' && c.id !== 'cat13');
  const darkCat      = categories.find(c => c.id === 'cat12');
  const darkPrompts  = prompts.filter(p => p.cat === 'cat12');
  const brandPrompts = prompts.filter(p => p.cat === 'cat13');

  const activeCat         = promptCats.find(c => c.id === activecat) ?? promptCats[0];
  const filteredPrompts   = prompts.filter(p => p.cat === activecat);
  const filteredBrand     = brandPrompts.filter(p => BRAND_SUBCAT[p.code] === activeBrandCat);
  const activeBrandCatObj = BRAND_SUBCATEGORIES.find(c => c.id === activeBrandCat) ?? BRAND_SUBCATEGORIES[0];

  // 탭별 헤더 정보 (image 탭은 PromptTabImage 내부에서 자체 헤더 렌더)
  const headerMap: Record<string, { icon: string; label: string; count: number }> = {
    prompts: { icon: activeCat?.icon ?? '📝', label: activeCat?.label ?? '', count: filteredPrompts.length },
    dark:    { icon: '💀', label: '다크경제학', count: darkPrompts.length },
    brand:   { icon: activeBrandCatObj.icon, label: activeBrandCatObj.label, count: filteredBrand.length },
    image:   { icon: '🖼️', label: '이미지 프롬프트', count: 0 },
  };
  const header = headerMap[activeTab] ?? headerMap['prompts'];

  function handleCopy(code: string, body: string) {
    navigator.clipboard.writeText(body.replace(/\\n/g, '\n')).then(() => {
      setCopiedId(code);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  /** 하트 평점 설정 — API POST 후 로컬 상태도 즉시 갱신 (낙관적 업데이트) */
  function handleSetHearts(id: string, hearts: number) {
    fetch(`${API_BASE}/api/v1/prompt-ratings/${encodeURIComponent(id)}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hearts }),
    }).then(() => {
      setRatings(prev => {
        const next = { ...prev };
        if (hearts === 0) delete next[id];
        else next[id] = hearts;
        return next;
      });
    });
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setExpandedId(null);
    setSidebarOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function selectCat(id: string) {
    setActivecat(id);
    setExpandedId(null);
    setSidebarOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function selectBrandCat(id: string) {
    setActiveBrandCat(id);
    setExpandedId(null);
    setSidebarOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  // 탭별 사이드바 렌더 데이터
  type SidebarItem = { id: string; icon: string; label: string; count: number; active: boolean; onClick: () => void };
  const sidebarItems: SidebarItem[] = activeTab === 'prompts'
    ? promptCats.map(c => ({
        id: c.id, icon: c.icon, label: c.label,
        count: prompts.filter(p => p.cat === c.id).length,
        active: c.id === activecat,
        onClick: () => selectCat(c.id),
      }))
    : activeTab === 'dark'
    ? [{
        id: 'cat12', icon: '💀', label: '다크경제학',
        count: darkPrompts.length, active: true,
        onClick: () => {},
      }]
    : BRAND_SUBCATEGORIES.map(c => ({
        id: c.id, icon: c.icon, label: c.label,
        count: brandPrompts.filter(p => BRAND_SUBCAT[p.code] === c.id).length,
        active: c.id === activeBrandCat,
        onClick: () => selectBrandCat(c.id),
      }));

  // 탭별 기본 카드 목록
  const baseCards: ApiPrompt[] =
    activeTab === 'prompts' ? filteredPrompts :
    activeTab === 'dark'    ? darkPrompts :
    filteredBrand;

  // 하트 많은 순 정렬 — 하트 없는 카드는 뒤로
  const currentCards = sortByHearts
    ? [...baseCards].sort((a, b) => (ratings[b.code] || 0) - (ratings[a.code] || 0))
    : baseCards;

  const totalCount =
    activeTab === 'prompts' ? prompts.filter(p => p.cat !== 'cat12' && p.cat !== 'cat13').length :
    activeTab === 'dark'    ? darkPrompts.length :
    brandPrompts.length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'transparent' }}>

      {/* ── 탭 바 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '14px 24px 0',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(0,0,0,0.18)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      }}>
        {([
          { key: 'prompts' as Tab, label: 'AI 프롬프트', icon: '💬' },
          { key: 'dark'    as Tab, label: '다크경제학',  icon: '💀' },
          { key: 'brand'   as Tab, label: '이미지+Brand', icon: '🎨' },
          { key: 'image'   as Tab, label: '이미지 프롬프트', icon: '🖼️' },
        ]).map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 18px',
                borderRadius: '10px 10px 0 0',
                border: 'none', cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: isActive ? 600 : 400,
                color: isActive ? '#5ee7df' : 'rgba(255,255,255,0.5)',
                background: isActive ? 'rgba(94,231,223,0.12)' : 'transparent',
                borderBottom: isActive ? '2px solid #5ee7df' : '2px solid transparent',
                transition: 'all 0.18s',
                marginBottom: '-1px',
              }}
            >
              <span style={{ fontSize: '1rem' }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 모바일 오버레이 */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }} />
      )}

      {/* 모바일 FAB */}
      <button
        onClick={() => setSidebarOpen(v => !v)}
        className="mobile-fab"
        style={{
          display: 'none', position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #5ee7df, #b490f5)',
          border: 'none', cursor: 'pointer', fontSize: '1.4rem',
          boxShadow: '0 4px 20px rgba(94,231,223,0.35)',
        }}
        aria-label="카테고리 열기"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* 이미지 프롬프트 탭 — 자체 사이드바 포함이므로 기존 레이아웃 바이패스 */}
      {activeTab === 'image' && (
        <div style={{ flex: 1 }}>
          <PromptTabImage ratings={ratings} onSetHearts={handleSetHearts} />
        </div>
      )}

      <div style={{ display: activeTab === 'image' ? 'none' : 'flex', flex: 1, minHeight: 'calc(100vh - 140px)', position: 'relative' }}>

        {/* ── 사이드바 ── */}
        <aside
          className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}
          style={{
            width: 260, flexShrink: 0,
            background: 'transparent',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRight: '1px solid rgba(255,255,255,0.12)',
            position: 'sticky', top: 92, height: 'calc(100vh - 92px)',
            overflowY: 'auto', display: 'flex', flexDirection: 'column',
            padding: '20px',
          }}
        >
          <p style={{
            color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            margin: '0 0 12px', paddingLeft: 12,
          }}>
            카테고리 · {loading ? '…' : `${totalCount}개`} 프롬프트
          </p>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sidebarItems.map(item => (
              <SidebarBtn key={item.id} item={item} />
            ))}
          </nav>

          {/* 탭별 안내 박스 */}
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 10,
            ...(activeTab === 'brand'
              ? { background: 'rgba(248,184,77,0.08)', border: '1px solid rgba(248,184,77,0.28)' }
              : activeTab === 'dark'
              ? { background: 'rgba(207,81,72,0.08)', border: '1px solid rgba(207,81,72,0.28)' }
              : { background: 'rgba(94,231,223,0.06)', border: '1px solid rgba(94,231,223,0.15)' }),
          }}>
            <p style={{
              fontSize: '0.72rem', margin: 0, lineHeight: 1.7,
              color: activeTab === 'brand'
                ? 'rgba(248,184,77,0.85)'
                : activeTab === 'dark'
                ? 'rgba(230,100,90,0.85)'
                : 'rgba(255,255,255,0.45)',
            }}>
              {activeTab === 'brand'
                ? '📷 ChatGPT 4o 전용\n이미지를 먼저 업로드한\n후 프롬프트를 붙여넣으세요'
                : activeTab === 'dark'
                ? '⚠️ 비공개 전용 프롬프트\n외부 공유 시 주의하세요'
                : '[ ] 안에 구체적으로\n채울수록 결과가 달라진다'}
            </p>
          </div>
        </aside>

        {/* ── 메인 콘텐츠 ── */}
        <main
          ref={contentRef}
          style={{
            flex: 1, minWidth: 0,
            paddingTop: 36, paddingBottom: 80, paddingLeft: 40, paddingRight: 40,
            background: `
              radial-gradient(ellipse 90% 70% at 10% 65%, rgba(180,144,245,0.45) 0%, transparent 58%),
              radial-gradient(ellipse 80% 65% at 92% 12%, rgba(94,231,223,0.35) 0%, transparent 52%),
              radial-gradient(ellipse 55% 45% at 52% 98%, rgba(247,168,196,0.22) 0%, transparent 48%),
              #f0f4ff
            `,
          }}
        >
          {/* 헤더 */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.4rem' }}>{header.icon}</span>
              <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
                {header.label}
              </h1>
              <span style={{
                fontSize: '0.72rem', color: 'rgba(15,23,42,0.5)',
                background: 'rgba(15,23,42,0.07)', padding: '2px 8px', borderRadius: 99, marginLeft: 4,
              }}>
                {header.count}개
              </span>
              {activeTab === 'brand' && (
                <span style={{
                  fontSize: '0.68rem', color: 'rgba(180,120,0,0.75)',
                  background: 'rgba(248,184,77,0.14)', border: '1px solid rgba(248,184,77,0.35)',
                  padding: '2px 8px', borderRadius: 99, marginLeft: 2,
                }}>
                  ChatGPT 4o · 이미지 업로드 필요
                </span>
              )}
              {/* 하트 많은 순 정렬 버튼 — flex row 끝에 배치 */}
              <button
                onClick={() => setSortByHearts(v => !v)}
                style={{
                  marginLeft: 'auto', padding: '4px 12px', borderRadius: 20,
                  fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                  border: sortByHearts ? '1px solid rgba(225,29,72,0.55)' : '1px solid rgba(15,23,42,0.18)',
                  background: sortByHearts ? 'rgba(225,29,72,0.12)' : 'transparent',
                  color: sortByHearts ? '#e11d48' : 'rgba(15,23,42,0.40)',
                  transition: 'all 0.15s',
                }}
              >
                ♥ 많은 순{sortByHearts ? ' ✓' : ''}
              </button>
            </div>
            <div style={{ height: 1, background: 'rgba(15,23,42,0.09)', marginTop: 16 }} />
          </div>

          {/* 카드 목록 */}
          {loading ? (
            <div style={{ color: 'rgba(15,23,42,0.4)', fontSize: '0.9rem', paddingTop: 40, textAlign: 'center' }}>
              불러오는 중…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {currentCards.map(p => (
                <PromptCard
                  key={p.code}
                  prompt={p}
                  copied={copiedId === p.code}
                  onCopy={() => handleCopy(p.code, p.body)}
                  expanded={expandedId === p.code}
                  onToggle={() => setExpandedId(expandedId === p.code ? null : p.code)}
                  hearts={ratings[p.code] || 0}
                  onSetHearts={(n) => handleSetHearts(p.code, n)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <style>{`
        .sidebar { scrollbar-width: none; -ms-overflow-style: none; }
        .sidebar::-webkit-scrollbar { display: none; }
        @media (max-width: 768px) {
          .mobile-fab { display: flex !important; align-items: center; justify-content: center; }
          .sidebar {
            position: fixed !important; top: 0 !important; left: 0 !important; bottom: 0 !important;
            width: 280px !important; background: rgba(10,10,20,0.92) !important;
            backdrop-filter: blur(20px) !important; -webkit-backdrop-filter: blur(20px) !important;
            border-right: 1px solid rgba(255,255,255,0.12) !important;
            z-index: 50; transform: translateX(-100%); transition: transform 0.25s ease;
            padding-top: 80px !important; overflow-y: auto;
            padding-left: 16px; padding-right: 16px; height: 100vh !important;
          }
          .sidebar.sidebar-open { transform: translateX(0); }
          main { padding-left: 20px !important; padding-right: 20px !important; }
        }
      `}</style>
    </div>
  );
}

// ── 사이드바 버튼 ──
type SidebarItem = { id: string; icon: string; label: string; count: number; active: boolean; onClick: () => void };

function SidebarBtn({ item }: { item: SidebarItem }) {
  return (
    <button
      onClick={item.onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 12, width: '100%', textAlign: 'left',
        border: item.active ? '1px solid rgba(94,231,223,0.45)' : '1px solid rgba(255,255,255,0.12)',
        background: item.active ? 'rgba(94,231,223,0.10)' : 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        boxShadow: item.active
          ? '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(94,231,223,0.25), 0 0 20px rgba(94,231,223,0.12)'
          : '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)',
        cursor: item.active ? 'default' : 'pointer',
        transition: 'transform 360ms cubic-bezier(0.22,0.68,0,1.2), box-shadow 360ms, background 360ms, border-color 360ms',
      }}
      onMouseEnter={e => {
        if (!item.active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255,255,255,0.12)';
          el.style.transform = 'translateY(-2px)';
          el.style.boxShadow = '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)';
          el.style.borderColor = 'rgba(255,255,255,0.22)';
        }
      }}
      onMouseLeave={e => {
        if (!item.active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255,255,255,0.06)';
          el.style.transform = 'translateY(0)';
          el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)';
          el.style.borderColor = 'rgba(255,255,255,0.12)';
        }
      }}
    >
      <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{item.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.82rem', fontWeight: item.active ? 600 : 400,
          color: item.active ? '#5ee7df' : 'rgba(255,255,255,0.85)',
          lineHeight: 1.3, letterSpacing: '-0.1px',
        }}>
          {item.label}
        </div>
        <div style={{
          fontSize: '0.68rem',
          color: item.active ? 'rgba(94,231,223,0.55)' : 'rgba(255,255,255,0.35)',
          marginTop: 2,
        }}>
          프롬프트 총 {item.count}개
        </div>
      </div>
      {item.active && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: '#5ee7df', boxShadow: '0 0 8px rgba(94,231,223,0.8)',
        }} />
      )}
    </button>
  );
}

// ── 프롬프트 카드 ──
function PromptCard({
  prompt, copied, onCopy, expanded, onToggle, hearts, onSetHearts,
}: {
  prompt: ApiPrompt; copied: boolean;
  onCopy: () => void; expanded: boolean; onToggle: () => void;
  hearts: number; onSetHearts: (n: number) => void;
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.48)', border: '1px solid rgba(15,23,42,0.12)',
        borderRadius: 14, overflow: 'hidden', transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(255,255,255,0.65)';
        el.style.borderColor = 'rgba(15,23,42,0.20)';
        el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.92)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(255,255,255,0.48)';
        el.style.borderColor = 'rgba(15,23,42,0.12)';
        el.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.85)';
      }}
    >
      <div onClick={onToggle}
        style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
      >
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, color: '#0891b2',
          background: 'rgba(8,145,178,0.12)', padding: '3px 8px', borderRadius: 6,
          letterSpacing: '0.04em', flexShrink: 0, border: '1px solid rgba(8,145,178,0.25)',
        }}>
          #{prompt.code}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>
            {prompt.title}
          </div>
          <div style={{
            fontSize: '0.75rem', color: 'rgba(15,23,42,0.55)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {prompt.description}
          </div>
        </div>
        {/* 하트 평점 — 카드 헤더 우측, 화살표 바로 앞 배치 */}
        <HeartRating hearts={hearts} onSet={onSetHearts} />
        <span style={{
          color: 'rgba(15,23,42,0.3)', fontSize: '0.75rem', display: 'inline-block',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
        }}>▾</span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(15,23,42,0.09)', padding: '16px 20px', background: 'rgba(15,23,42,0.03)' }}>
          <pre style={{
            margin: 0, fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
            fontSize: '0.84rem', lineHeight: 1.75, color: 'rgba(15,23,42,0.75)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {prompt.body.replace(/\\n/g, '\n')}
          </pre>
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onCopy}
              style={{
                padding: '8px 20px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
                borderColor: copied ? 'rgba(8,145,178,0.45)' : 'rgba(15,23,42,0.18)',
                background: copied ? 'rgba(8,145,178,0.1)' : 'rgba(15,23,42,0.06)',
                color: copied ? '#0891b2' : 'rgba(15,23,42,0.65)',
                fontSize: '0.8rem', fontWeight: 500, transition: 'all 0.15s',
              }}
            >
              {copied ? '✓ 클립보드에 복사됨' : '프롬프트 복사하기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
