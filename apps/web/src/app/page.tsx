// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useEffect, useState } from 'react';
import { listSeries } from '@/lib/seriesStore';
import type { Series } from '@/types/series';
import SeriesCard from '@/components/SeriesCard';

function SkeletonCard() {
  return (
    <div className="glass glass-card" style={{ borderRadius: '20px', padding: '1.5rem' }}>
      <div style={{ height: '1rem', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', marginBottom: '0.75rem', width: '60%' }} />
      <div style={{ height: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', marginBottom: '0.4rem', width: '88%' }} />
      <div style={{ height: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', marginBottom: '1.25rem', width: '52%' }} />
      <div style={{ height: '1.7rem', background: 'rgba(255,255,255,0.06)', borderRadius: '999px', width: '6rem' }} />
    </div>
  );
}

export default function DashboardPage() {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSeries()
      .then(setSeries)
      .catch(() => setError('시리즈 목록을 불러오지 못했습니다. API 서버(localhost:8001)가 실행 중인지 확인하세요.'))
      .finally(() => setLoading(false));
  }, []);

  function handleDeleted(id: string) {
    setSeries(prev => prev.filter(s => s.id !== id));
  }

  function renderBody() {
    if (loading) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      );
    }
    if (error) {
      return (
        <div style={{
          marginTop: '2rem', padding: '1rem 1.25rem', borderRadius: '14px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)',
          color: '#f87171', fontSize: '0.88rem',
        }}>
          {error}
        </div>
      );
    }
    if (series.length === 0) {
      return (
        <div style={{ textAlign: 'center', marginTop: '5rem' }}>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            아직 시리즈가 없습니다. 새 시리즈를 만들어보세요.
          </p>
          <a href="/create" className="glass-btn glass-btn--primary" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.75rem 1.75rem', borderRadius: '999px',
            fontSize: '0.9rem', fontWeight: 600, textDecoration: 'none', color: '#fff',
            background: 'linear-gradient(135deg, rgba(94,231,223,0.5) 0%, rgba(59,130,246,0.5) 100%)',
            border: '1px solid rgba(94,231,223,0.45)',
            boxShadow: '0 4px 24px rgba(94,231,223,0.3)',
          }}>
            + 새 시리즈 만들기
          </a>
        </div>
      );
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {series.map((s, i) => (
          <div key={s.id} className={`animate-in animate-in--delay-${Math.min(i + 1, 4)}`}>
            <SeriesCard series={s} onDeleted={handleDeleted} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* 헤더 */}
      <div className="animate-in" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '2rem',
      }}>
        <div>
          <p style={{ fontSize: '0.72rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '0.35rem' }}>
            LinkDrop AI · 콘텐츠 파이프라인
          </p>
          <h1 style={{
            fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', fontWeight: 700, letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #fff 30%, #5ee7df 65%, #b490f5 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            내 시리즈
          </h1>
        </div>
        <a href="/create" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.7rem 1.5rem', borderRadius: '999px',
          fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', color: '#fff',
          background: 'linear-gradient(135deg, rgba(94,231,223,0.5) 0%, rgba(59,130,246,0.5) 100%)',
          border: '1px solid rgba(94,231,223,0.45)',
          boxShadow: '0 4px 24px rgba(94,231,223,0.28)',
          transition: 'transform 180ms, box-shadow 180ms',
        }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 36px rgba(94,231,223,0.5)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = '';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 24px rgba(94,231,223,0.28)';
          }}
        >
          + 새 시리즈
        </a>
      </div>

      {/* 시리즈 목록 */}
      <div className="animate-in animate-in--delay-1">
        {renderBody()}
      </div>
    </main>
  );
}
