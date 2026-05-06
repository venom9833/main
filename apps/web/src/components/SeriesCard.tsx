// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useState } from 'react';
import { deleteSeries } from '@/lib/seriesStore';
import type { Series, PipelineStep } from '@/types/series';

const STEP_LABELS: Record<string, string> = {
  idle: '대기', world: '세계관 생성', awaiting_world_approval: '세계관 승인 대기',
  casting: '캐스팅', awaiting_casting_approval: '캐스팅 승인 대기',
  architect: '아키텍처', script: '대본 작성', awaiting_script_approval: '대본 승인 대기',
  script_approved: '대본 승인됨',
  awaiting_source_upload: '소스 업로드 대기', awaiting_keyframe_setup: '키프레임 설정 대기',
  keyframe: '키프레임 생성', awaiting_tts: 'TTS 대기', tts: 'TTS 생성',
  render: '영상 렌더링', awaiting_upload_approval: '업로드 승인 대기',
  upload: 'YouTube 업로드', youtube_manage: 'YouTube 관리',
  naver_upload: 'Naver 업로드', chapter_done: '챕터 완료',
  done: '완료', failed: '오류',
};

function stepBadgeClass(step: PipelineStep): string {
  if (step === 'done') return 'glass-badge--success';
  if (step === 'failed') return 'glass-badge--error';
  if (step === 'awaiting_script_approval' || step === 'awaiting_upload_approval') return 'glass-badge--amber';
  if (step === 'awaiting_casting_approval' || step === 'awaiting_world_approval') return 'glass-badge--aqua';
  if (step === 'script' || step === 'keyframe' || step === 'render' || step === 'tts') return 'glass-badge--violet';
  return 'glass-badge--running';
}

function hasDot(step: PipelineStep): boolean {
  return ['script', 'keyframe', 'render', 'tts', 'casting', 'world', 'architect'].includes(step);
}

const KEYFRAME_STEPS = new Set<PipelineStep>([
  'script_approved', 'awaiting_keyframe_setup', 'keyframe',
  'awaiting_tts', 'tts', 'render', 'awaiting_upload_approval',
  'upload', 'youtube_manage', 'naver_upload', 'chapter_done', 'done',
]);

function getSeriesHref(id: string, step: PipelineStep): string {
  return KEYFRAME_STEPS.has(step)
    ? `/series/keyframe?series_id=${id}`
    : `/series/${id}`;
}

interface Props {
  series: Series;
  onDeleted?: (id: string) => void;
}

export default function SeriesCard({ series, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const step = series.pipelineStep;

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
    <a href={getSeriesHref(series.id, step)} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        className="glass glass-card"
        style={{
          borderRadius: '20px',
          padding: '1.5rem',
          position: 'relative',
          cursor: 'pointer',
          border: confirming ? '1px solid rgba(239,68,68,0.5)' : undefined,
          minHeight: '130px',
        }}
      >
        {/* 상단 accent 라인 */}
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(94,231,223,0.5), rgba(180,144,245,0.5), transparent)',
          borderRadius: '0 0 4px 4px',
        }} />

        {/* 삭제 버튼 */}
        <div
          onClick={e => e.preventDefault()}
          style={{ position: 'absolute', top: '0.85rem', right: '0.85rem', display: 'flex', gap: '0.35rem', zIndex: 2 }}
        >
          {!confirming ? (
            <button
              onClick={handleDelete}
              title="삭제"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.2)', fontSize: '0.9rem', lineHeight: 1,
                padding: '0.2rem 0.3rem', borderRadius: '6px',
                transition: 'color 0.2s, background 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              ✕
            </button>
          ) : (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  background: 'rgba(239,68,68,0.7)', border: '1px solid rgba(239,68,68,0.5)',
                  cursor: 'pointer', color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                  padding: '0.2rem 0.55rem', borderRadius: '6px', backdropFilter: 'blur(8px)',
                }}
              >
                {deleting ? '삭제 중…' : '삭제'}
              </button>
              <button
                onClick={handleCancelDelete}
                style={{
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem',
                  padding: '0.2rem 0.55rem', borderRadius: '6px',
                }}
              >
                취소
              </button>
            </>
          )}
        </div>

        {/* 제목 */}
        <p style={{
          fontSize: '1.05rem', fontWeight: 600, color: '#fff',
          marginBottom: '0.4rem', paddingRight: '2.5rem',
          lineHeight: 1.3,
        }}>
          {series.title || series.topic}
        </p>

        {/* 토픽 */}
        <p style={{
          fontSize: '0.82rem', color: 'rgba(255,255,255,0.38)',
          marginBottom: '1rem', lineHeight: 1.4,
        }}>
          {series.topic}
        </p>

        {/* 상태 배지 */}
        <span className={`glass-badge ${stepBadgeClass(step)}`} style={{ position: 'relative', zIndex: 2 }}>
          {hasDot(step) && <span className="glass-badge--dot" />}
          {STEP_LABELS[step] ?? step}
        </span>
      </div>
    </a>
  );
}
