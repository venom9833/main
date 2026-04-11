'use client';
import { useEffect, useState } from 'react';
import { listSeries } from '@/lib/seriesStore';
import type { Series } from '@/types/series';
import SeriesCard from '@/components/SeriesCard';

export default function DashboardPage() {
  const [series, setSeries] = useState<Series[]>([]);

  useEffect(() => {
    listSeries().then(setSeries);
  }, []);

  function handleDeleted(id: string) {
    setSeries(prev => prev.filter(s => s.id !== id));
  }

  return (
    <main style={{ padding: '2rem', fontFamily: "var(--font-en), 'Pretendard', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>내 시리즈</h1>
        <a href="/create" style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff', padding: '0.75rem 1.5rem',
          borderRadius: '12px', textDecoration: 'none', fontWeight: 600,
        }}>
          + 새 시리즈
        </a>
      </div>
      {series.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: '4rem' }}>
          아직 시리즈가 없습니다. 새 시리즈를 만들어보세요.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {series.map(s => <SeriesCard key={s.id} series={s} onDeleted={handleDeleted} />)}
        </div>
      )}
    </main>
  );
}
