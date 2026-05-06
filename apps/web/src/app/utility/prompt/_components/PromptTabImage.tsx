'use client';
/**
 * PromptTabImage.tsx
 *
 * 역할: 이미지 프롬프트 탭의 메인 컴포넌트.
 *   - 좌측 사이드바: 카테고리 필터 + 검색 + featured 토글
 *   - 우측 그리드: ImagePromptCard × items
 *   - 카드 클릭 → ImagePromptModal
 *   - 페이지네이션
 */

import { useState, useEffect, useCallback } from 'react';
import ImagePromptCard, { type ImgPromptItem, type CatLabelMap } from './ImagePromptCard';
import ImagePromptModal from './ImagePromptModal';
import HeartRating from './HeartRating';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

/** 카테고리 API 응답 타입 */
type CategoryItem = {
  id: string;
  label: string;
  emoji: string;
  count: number;
};

/** 상위 page.tsx에서 ratings 맵과 하트 설정 콜백을 주입받는 Props */
interface TabImageProps {
  ratings: Record<string, number>;
  onSetHearts: (id: string, hearts: number) => void;
}

export default function PromptTabImage({ ratings, onSetHearts }: TabImageProps) {
  // ── 상태 ──────────────────────────────────────────────────────────────────
  const [items, setItems]               = useState<ImgPromptItem[]>([]);
  const [total, setTotal]               = useState(0);
  const [categories, setCategories]     = useState<CategoryItem[]>([]);
  const [categoryLabels, setCatLabels]  = useState<CatLabelMap>({});
  const [activeCat, setActiveCat]       = useState<string | null>(null);
  const [featured, setFeatured]         = useState(false);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<ImgPromptItem | null>(null);
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [sortByHearts, setSortByHearts] = useState(true);  // 하트 많은 순 정렬 토글

  // ── 카테고리 로드 (마운트 1회) ────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/img-prompts/categories`)
      .then((r) => r.json())
      .then((cats: CategoryItem[]) => {
        setCategories(cats);
        // categoryLabels 맵 생성 (카드/모달에서 배지 표시용)
        const map: CatLabelMap = {};
        for (const c of cats) {
          map[c.id] = { label: c.label, emoji: c.emoji };
        }
        setCatLabels(map);
      })
      .catch(() => {});
  }, []);

  // ── 목록 fetch (필터/페이지/정렬 변경 시) ────────────────────────────────
  // 하트 정렬 모드: page_size=1000으로 전체 로드 후 클라이언트에서 정렬 및 페이지네이션
  // 일반 모드: page_size=50 페이지네이션
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCat) params.set('cat', activeCat);
    if (featured)  params.set('featured', 'true');
    if (sortByHearts) {
      // 하트 정렬 — 현재 카테고리 전체를 한번에 불러와 클라이언트에서 정렬
      params.set('page', '1');
      params.set('page_size', '1000');
    } else {
      params.set('page', String(page));
      params.set('page_size', '50');
    }

    fetch(`${API_BASE}/api/v1/img-prompts?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { total: number; page: number; page_size: number; items: ImgPromptItem[] }) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [activeCat, featured, sortByHearts]);

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 하트 정렬 모드: ratings 높은 순 → 0인 카드는 원래 순서 유지, 50개씩 슬라이스
  const displayItems = sortByHearts
    ? [...items].sort((a, b) => (ratings[b.master_no] || 0) - (ratings[a.master_no] || 0)).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : items;

  // 카테고리 선택 핸들러
  const handleCatClick = useCallback((id: string | null) => {
    setActiveCat(id);
    setPage(1);
    setSidebarOpen(false);
  }, []);

  // 현재 카테고리 라벨
  const activeCatLabel = activeCat
    ? (categoryLabels[activeCat]?.label ?? activeCat)
    : '전체';

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 'calc(100vh - 140px)', position: 'relative' }}>

      {/* 모바일 오버레이 */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
        />
      )}

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
        {/* 상단 라벨 */}
        <p style={{
          color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', fontWeight: 600,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          margin: '0 0 10px', paddingLeft: 12,
        }}>
          이미지 프롬프트 · {loading ? '…' : `${total}개`}
        </p>

        {/* featured 토글 */}
        <button
          onClick={() => { setFeatured((v) => !v); setPage(1); }}
          style={{
            width: '100%', padding: '7px 12px', marginBottom: 12,
            borderRadius: 10, fontSize: '0.78rem', fontWeight: 500,
            border: featured ? '1px solid rgba(248,184,77,0.55)' : '1px solid rgba(255,255,255,0.14)',
            background: featured ? 'rgba(248,184,77,0.14)' : 'rgba(255,255,255,0.06)',
            color: featured ? 'rgba(248,184,77,0.95)' : 'rgba(255,255,255,0.55)',
            cursor: 'pointer', textAlign: 'left' as const,
            transition: 'all 0.18s',
          }}
        >
          ★ 추천 프롬프트만
        </button>

        {/* 카테고리 목록 */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* 전체 버튼 */}
          <SidebarCatBtn
            id={null}
            label="전체"
            emoji=""
            count={loading ? 0 : total}
            active={activeCat === null}
            onClick={() => handleCatClick(null)}
          />
          {/* 카테고리별 버튼 */}
          {categories.map((cat) => (
            <SidebarCatBtn
              key={cat.id}
              id={cat.id}
              label={cat.label}
              emoji={cat.emoji}
              count={cat.count}
              active={activeCat === cat.id}
              onClick={() => handleCatClick(cat.id)}
            />
          ))}
        </nav>

        {/* 안내 박스 */}
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(94,231,223,0.06)', border: '1px solid rgba(94,231,223,0.15)',
        }}>
          <p style={{
            fontSize: '0.72rem', margin: 0, lineHeight: 1.7,
            color: 'rgba(255,255,255,0.45)',
          }}>
            변수를 직접 입력하고<br />ChatGPT 또는 AI로 다듬기
          </p>
        </div>
      </aside>

      {/* ── 메인 그리드 ── */}
      <main
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
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.4rem' }}>🖼️</span>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
              {activeCatLabel}
            </h1>
            <span style={{
              fontSize: '0.72rem', color: 'rgba(15,23,42,0.5)',
              background: 'rgba(15,23,42,0.07)', padding: '2px 8px', borderRadius: 99,
            }}>
              {loading ? '…' : `${total}개`}
            </span>
            {featured && (
              <span style={{
                fontSize: '0.68rem', color: 'rgba(180,120,0,0.75)',
                background: 'rgba(248,184,77,0.14)', border: '1px solid rgba(248,184,77,0.35)',
                padding: '2px 8px', borderRadius: 99,
              }}>
                ★ 추천만
              </span>
            )}
            {/* 하트 많은 순 정렬 버튼 */}
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

        {/* 로딩 */}
        {loading ? (
          <div style={{ color: 'rgba(15,23,42,0.4)', fontSize: '0.9rem', paddingTop: 40, textAlign: 'center' }}>
            불러오는 중…
          </div>
        ) : items.length === 0 ? (
          <div style={{ color: 'rgba(15,23,42,0.4)', fontSize: '0.9rem', paddingTop: 40, textAlign: 'center' }}>
            검색 결과가 없습니다
          </div>
        ) : (
          <>
            {/* 카드 그리드 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}>
              {displayItems.map((item) => (
                <ImagePromptCard
                  key={item.id}
                  item={item}
                  catLabels={categoryLabels}
                  onClick={() => setSelected(item)}
                  hearts={ratings[item.master_no] || 0}
                  onSetHearts={(n) => onSetHearts(item.master_no, n)}
                />
              ))}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 12, marginTop: 40,
              }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: '0.82rem',
                    border: '1px solid rgba(15,23,42,0.18)',
                    background: 'rgba(255,255,255,0.7)',
                    color: page <= 1 ? 'rgba(15,23,42,0.25)' : 'rgba(15,23,42,0.70)',
                    cursor: page <= 1 ? 'default' : 'pointer',
                  }}
                >
                  이전
                </button>
                <span style={{ fontSize: '0.82rem', color: 'rgba(15,23,42,0.60)' }}>
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: '0.82rem',
                    border: '1px solid rgba(15,23,42,0.18)',
                    background: 'rgba(255,255,255,0.7)',
                    color: page >= totalPages ? 'rgba(15,23,42,0.25)' : 'rgba(15,23,42,0.70)',
                    cursor: page >= totalPages ? 'default' : 'pointer',
                  }}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* 모달 */}
      {selected && (
        <ImagePromptModal
          item={selected}
          categoryLabels={categoryLabels}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── 사이드바 카테고리 버튼 (내부 컴포넌트) ────────────────────────────────
function SidebarCatBtn({
  id, label, emoji, count, active, onClick,
}: {
  id: string | null;
  label: string;
  emoji: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 12, width: '100%', textAlign: 'left',
        border: active ? '1px solid rgba(94,231,223,0.45)' : '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(94,231,223,0.10)' : 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        boxShadow: active
          ? '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(94,231,223,0.25), 0 0 20px rgba(94,231,223,0.12)'
          : '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)',
        cursor: active ? 'default' : 'pointer',
        transition: 'all 0.18s',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255,255,255,0.12)';
          el.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'rgba(255,255,255,0.06)';
          el.style.transform = 'translateY(0)';
        }
      }}
    >
      {emoji && <span style={{ fontSize: '1rem', flexShrink: 0 }}>{emoji}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.82rem', fontWeight: active ? 600 : 400,
          color: active ? '#5ee7df' : 'rgba(255,255,255,0.85)',
          lineHeight: 1.3, letterSpacing: '-0.1px',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: '0.68rem',
          color: active ? 'rgba(94,231,223,0.55)' : 'rgba(255,255,255,0.35)',
          marginTop: 2,
        }}>
          {count}개
        </div>
      </div>
      {active && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: '#5ee7df', boxShadow: '0 0 8px rgba(94,231,223,0.8)',
        }} />
      )}
    </button>
  );
}
