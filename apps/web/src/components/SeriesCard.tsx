'use client';
import { useState } from 'react';
import { deleteSeries } from '@/lib/seriesStore';
import type { Series, PipelineStep } from '@/types/series';

const STEP_LABELS: Record<PipelineStep, string> = {
  idle: '대기', trend: '트랜드 분석', world: '세계관 생성',
  script: '대본 작성', awaiting_script_approval: '대본 승인 대기',
  keyframe: '키프레임 생성', tts: 'TTS 생성', render: '영상 렌더링',
  awaiting_upload_approval: '업로드 승인 대기',
  upload: 'YouTube 업로드', youtube_manage: 'YouTube 관리',
  done: '완료', failed: '오류',
};

const STEP_COLORS: Partial<Record<PipelineStep, string>> = {
  done: '#10b981', failed: '#ef4444',
  awaiting_script_approval: '#f59e0b', awaiting_upload_approval: '#f59e0b',
};

interface Props {
  series: Series;
  onDeleted?: (id: string) => void;
}

export default function SeriesCard({ series, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const step = series.pipelineStep;
  const color = STEP_COLORS[step] ?? '#6366f1';

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      await deleteSeries(series.id);
      onDeleted?.(series.id);
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  return (
    <a href={`/series/${series.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        position: 'relative',
        padding: '1.5rem', borderRadius: '16px',
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${confirming ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
        cursor: 'pointer', transition: 'border-color 0.2s',
      }}>
        {/* 삭제 버튼 */}
        {!confirming ? (
          <button
            onClick={handleDelete}
            title="삭제"
            style={{
              position: 'absolute', top: '0.75rem', right: '0.75rem',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.25)', fontSize: '1rem', lineHeight: 1,
              padding: '0.25rem', borderRadius: '6px', transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            ✕
          </button>
        ) : (
          <div
            onClick={e => e.preventDefault()}
            style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', display: 'flex', gap: '0.4rem' }}
          >
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                background: '#ef4444', border: 'none', cursor: 'pointer',
                color: '#fff', fontSize: '0.75rem', fontWeight: 700,
                padding: '0.25rem 0.6rem', borderRadius: '6px',
              }}
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
            <button
              onClick={handleCancelDelete}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer',
                color: '#fff', fontSize: '0.75rem',
                padding: '0.25rem 0.6rem', borderRadius: '6px',
              }}
            >
              취소
            </button>
          </div>
        )}

        <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem', paddingRight: '2rem' }}>
          {series.title || series.topic}
        </p>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', marginBottom: '1rem' }}>
          {series.topic}
        </p>
        <span style={{
          display: 'inline-block', padding: '0.25rem 0.75rem',
          borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600,
          background: `${color}20`, color,
        }}>
          {STEP_LABELS[step] ?? step}
        </span>
      </div>
    </a>
  );
}
