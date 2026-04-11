'use client';
import { usePathname } from 'next/navigation';

export default function GNB() {
  const path = usePathname();

  const navItems = [
    { label: '내 시리즈',  href: '/' },
    { label: '새 시리즈', href: '/create' },
    { label: '캐릭터',    href: '/characters' },
    { label: '감정선',    href: '/characters/emoline' },
  ];

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: '56px',
      background: 'rgba(10,10,15,0.85)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', alignItems: 'center',
      padding: '0 2rem', gap: '2rem',
    }}>
      {/* 로고 */}
      <a href="/" style={{
        fontWeight: 800, fontSize: '1.1rem',
        background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        textDecoration: 'none', letterSpacing: '-0.5px',
      }}>
        LinkDrop V3
      </a>

      {/* 구분선 */}
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

      {/* 네비게이션 */}
      <nav style={{ display: 'flex', gap: '0.25rem' }}>
        {navItems.map(item => {
          const active = item.href === '/'
            ? path === '/'
            : path.startsWith(item.href);
          return (
            <a key={item.href} href={item.href} style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: active ? 600 : 400,
              color: active ? '#fff' : 'rgba(255,255,255,0.45)',
              background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
              textDecoration: 'none',
              transition: 'all 0.15s',
            }}>
              {item.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
