import type { PipelineStep } from '@/types/series';

// 사용자에게 보이는 8단계 (내부 상태 다수를 하나로 통합)
const VISIBLE_STEPS = [
  { key: 'source',    label: '소스',    states: ['awaiting_source_upload'] },
  { key: 'world',     label: '세계관',  states: ['world', 'awaiting_world_approval'] },
  { key: 'casting',   label: '캐릭터',  states: ['casting', 'awaiting_casting_approval'] },
  { key: 'architect', label: '설계',    states: ['architect'] },
  { key: 'script',    label: '대본',    states: ['script', 'awaiting_script_approval'] },
  { key: 'keyframe',  label: '키프레임', states: ['awaiting_keyframe_setup', 'keyframe'] },
  { key: 'tts',       label: 'TTS',     states: ['awaiting_tts', 'tts'] },
  { key: 'render',    label: '렌더',    states: ['render', 'awaiting_upload_approval'] },
  { key: 'upload',    label: '업로드',  states: ['upload', 'naver_upload', 'youtube_manage', 'chapter_done', 'done'] },
];

function getVisibleIndex(step: string): number {
  return VISIBLE_STEPS.findIndex(vs => vs.states.includes(step));
}

function isAwaitingApproval(step: string): boolean {
  return step === 'awaiting_source_upload'
    || step === 'awaiting_world_approval'
    || step === 'awaiting_casting_approval'
    || step === 'awaiting_script_approval'
    || step === 'awaiting_keyframe_setup'
    || step === 'awaiting_tts'
    || step === 'awaiting_upload_approval';
}

export default function PipelineStatus({
  currentStep, error
}: { currentStep: PipelineStep; error: string | null }) {
  const currentIdx = getVisibleIndex(currentStep);
  const isDone = currentStep === 'done';

  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {VISIBLE_STEPS.map((vs, i) => {
          const done = isDone || currentIdx > i;
          const active = currentIdx === i;
          const waiting = active && isAwaitingApproval(currentStep);
          const failed = active && !!error;

          const circleColor = failed
            ? '#ef4444'
            : done
            ? '#10b981'
            : waiting
            ? '#eab308'
            : active
            ? '#6366f1'
            : 'rgba(0,0,0,0.18)';

          const labelColor = active ? '#111' : done ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';

          return (
            <div key={vs.key} style={{ display: 'flex', alignItems: 'flex-start', flex: 1, minWidth: 72 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                {/* 원 */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: circleColor,
                  border: active && !failed ? `2px solid ${circleColor}` : '2px solid transparent',
                  boxShadow: active ? `0 0 12px ${circleColor}66` : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.78rem', color: (done || active || waiting || failed) ? '#fff' : 'rgba(0,0,0,0.45)', fontWeight: 700,
                  transition: 'all 0.3s',
                  flexShrink: 0,
                }}>
                  {done ? '✓' : failed ? '✕' : waiting ? '⏸' : i + 1}
                </div>
                {/* 라벨 */}
                <span style={{
                  fontSize: '0.68rem', color: labelColor,
                  marginTop: '5px', textAlign: 'center',
                  fontWeight: active ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}>
                  {vs.label}
                  {waiting && <span style={{ display: 'block', fontSize: '0.6rem', color: '#b45309' }}>승인 대기</span>}
                </span>
              </div>
              {/* 연결선 */}
              {i < VISIBLE_STEPS.length - 1 && (
                <div style={{
                  height: 2, flex: 0.4, marginTop: 16,
                  background: done ? '#10b981' : 'rgba(0,0,0,0.15)',
                  transition: 'background 0.3s',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
