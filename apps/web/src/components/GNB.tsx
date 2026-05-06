'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

type Leaf     = { label: string; href: string };
type SubItem  = { label: string; href: string; key?: string; items?: Leaf[] };
type MainMenu = { label: string; key: string; subItems: SubItem[] };

const mainMenus: MainMenu[] = [
  {
    label: '웹소설+영상',
    key: 'novel-video',
    subItems: [
      {
        label: '웹소설', key: 'novel', href: '/',
        items: [
          { label: '내 시리즈', href: '/' },
          { label: '새 시리즈', href: '/create' },
          { label: '캐릭터',    href: '/characters' },
          { label: '감정선',    href: '/characters/emoline' },
          { label: '키프레임',  href: '/series/keyframe' },
          { label: 'MP4합성',   href: '/series/mp4combine' },
        ],
      },
      { label: '쇼츠',   key: 'shorts',    href: '/shorts',    items: [] },
      { label: '카드뉴스', key: 'cardnews', href: '/cardnews', items: [] },
    ],
  },
  {
    label: 'HTML',
    key: 'html',
    subItems: [
      { label: '문서보관함', href: '/html' },
      { label: '새 문서',   href: '/html/new' },
      { label: '에디터',    href: '/html/editor' },
      { label: '내보내기',  href: '/html/export' },
    ],
  },
  {
    label: 'PDF',
    key: 'pdf',
    subItems: [
      { label: '문서보관함', href: '/pdf' },
      { label: '새 문서',   href: '/pdf/new' },
      { label: '내보내기',  href: '/pdf/export' },
    ],
  },
  {
    label: '유틸리티',
    key: 'utility',
    subItems: [
      { label: '프롬프트', href: '/utility/prompt' },
      { label: '용어집',   href: '/utility/glossary' },
    ],
  },
  {
    label: '🛠 개발도구',
    key: 'dev',
    subItems: [
      { label: '스킬사용법', href: '/dev/skills' },
    ],
  },
];

function hasPath(sub: SubItem, path: string): boolean {
  return path === sub.href || (sub.items ?? []).some(i => i.href === path);
}

export default function GNB() {
  const path = usePathname();

  const activeMain = mainMenus.find(m =>
    m.subItems.some(s => hasPath(s, path))
  ) ?? mainMenus[0];

  const activeSub = activeMain.subItems.find(s => hasPath(s, path))
    ?? activeMain.subItems[0];

  const leafItems: Leaf[] = activeSub.items ?? [];

  // 헤더 높이 CSS 변수 동적 갱신
  useEffect(() => {
    const h = leafItems.length > 0 ? '130px' : '92px';
    document.documentElement.style.setProperty('--gnb-height', h);
  }, [leafItems.length]);

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      background: 'rgba(7,8,15,0.88)',
      backdropFilter: 'blur(28px)',
      WebkitBackdropFilter: 'blur(28px)',
      borderBottom: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.5)',
    }}>
      {/* 상단 accent 라인 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg, transparent 0%, rgba(94,231,223,0.7) 30%, rgba(180,144,245,0.7) 70%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* ── 대메뉴 행 ── */}
      <div style={{
        height: 50,
        display: 'flex', alignItems: 'center',
        padding: '0 2rem', gap: '1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <a href="/" style={{
          fontWeight: 800, fontSize: '1.05rem',
          background: 'linear-gradient(135deg, #5ee7df, #b490f5)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          textDecoration: 'none', letterSpacing: '-0.5px', flexShrink: 0,
        }}>
          LinkDrop V3
        </a>

        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />

        <nav style={{ display: 'flex', gap: '0.25rem' }}>
          {mainMenus.map(m => {
            const isActive = m.key === activeMain.key;
            const defaultHref = m.subItems[0].href;
            return (
              <a
                key={m.key}
                href={defaultHref}
                style={{
                  padding: '0.35rem 1rem',
                  borderRadius: '999px',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                  background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
                  border: isActive
                    ? '1px solid rgba(255,255,255,0.22)'
                    : '1px solid transparent',
                  boxShadow: isActive
                    ? '0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18)'
                    : 'none',
                  cursor: 'pointer',
                  letterSpacing: '-0.1px',
                  textDecoration: 'none',
                  transition: 'all 0.18s ease',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.92)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                {m.label}
              </a>
            );
          })}
        </nav>
      </div>

      {/* ── 중메뉴 행 ── */}
      <div style={{
        height: 42,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 2rem',
        gap: '0.2rem',
        borderBottom: leafItems.length > 0
          ? '1px solid rgba(255,255,255,0.06)'
          : 'none',
      }}>
        {activeMain.subItems.map(sub => {
          const isActive = sub.key
            ? sub.key === activeSub.key
            : sub.href === activeSub.href;
          return (
            <a
              key={sub.key ?? sub.href}
              href={sub.href}
              style={{
                padding: '0.3rem 1rem',
                borderRadius: '999px',
                fontSize: '0.82rem',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#5ee7df' : 'rgba(255,255,255,0.62)',
                background: isActive ? 'rgba(94,231,223,0.12)' : 'transparent',
                border: isActive
                  ? '1px solid rgba(94,231,223,0.35)'
                  : '1px solid transparent',
                boxShadow: isActive ? '0 0 14px rgba(94,231,223,0.18)' : 'none',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
                letterSpacing: '-0.1px',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.92)';
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.62)';
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }
              }}
            >
              {sub.label}
            </a>
          );
        })}
      </div>

      {/* ── 소메뉴 행 (items 있을 때만) ── */}
      {leafItems.length > 0 && (
        <div style={{
          height: 38,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 2rem',
          gap: '0.15rem',
        }}>
          {leafItems.map(item => {
            const isActive = path === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  padding: '0.22rem 0.85rem',
                  borderRadius: '999px',
                  fontSize: '0.76rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#b490f5' : 'rgba(255,255,255,0.50)',
                  background: isActive ? 'rgba(180,144,245,0.12)' : 'transparent',
                  border: isActive
                    ? '1px solid rgba(180,144,245,0.30)'
                    : '1px solid transparent',
                  boxShadow: isActive ? '0 0 10px rgba(180,144,245,0.15)' : 'none',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                  letterSpacing: '-0.1px',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.80)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.50)';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      )}
    </header>
  );
}
