// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
import type { PipelineStep } from '@/types/series';

const VISIBLE_STEPS = [
  { key: 'source',    label: '소스',   states: ['awaiting_source_upload'] },
  { key: 'world',     label: '세계관', states: ['world', 'awaiting_world_approval'] },
  { key: 'casting',   label: '캐릭터', states: ['casting', 'awaiting_casting_approval'] },
  { key: 'architect', label: '설계',   states: ['architect'] },
  { key: 'script',    label: '대본',   states: ['script', 'awaiting_script_approval'] },
];

const PAST_SCRIPT_STATES = new Set([
  'awaiting_keyframe_setup', 'keyframe', 'awaiting_tts', 'tts',
  'render', 'awaiting_upload_approval', 'upload',
  'naver_upload', 'youtube_manage', 'chapter_done', 'done',
]);

function getVisibleIndex(step: string): number {
  return VISIBLE_STEPS.findIndex(vs => vs.states.includes(step));
}

function isAwaiting(step: string): boolean {
  return ['awaiting_source_upload','awaiting_world_approval','awaiting_casting_approval',
    'awaiting_script_approval','awaiting_keyframe_setup','awaiting_tts','awaiting_upload_approval'].includes(step);
}

export default function PipelineStatus({
  currentStep, error
}: { currentStep: PipelineStep; error: string | null }) {
  const currentIdx = getVisibleIndex(currentStep);
  const isDone = PAST_SCRIPT_STATES.has(currentStep);

  return (
    <div style={{ marginBottom: '2.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
      <div className="glass-stepper">
        {VISIBLE_STEPS.map((vs, i) => {
          const done    = isDone || currentIdx > i;
          const active  = !isDone && currentIdx === i;
          const waiting = active && isAwaiting(currentStep);
          const failed  = active && !!error;

          const stateClass = failed ? 'is-error' : done ? 'is-complete' : waiting ? 'is-waiting' : active ? 'is-active' : '';

          return (
            <div key={vs.key} className={`glass-step ${stateClass}`} style={{ minWidth: 72 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div className="glass-step__node">
                  {done ? '✓' : failed ? '✕' : waiting ? '⏸' : i + 1}
                </div>
                <span className="glass-step__label">
                  {vs.label}
                  {waiting && (
                    <span style={{ display: 'block', fontSize: '0.58rem', color: '#fbbf24', marginTop: 2 }}>
                      승인 대기
                    </span>
                  )}
                </span>
              </div>
              {i < VISIBLE_STEPS.length - 1 && (
                <div className="glass-step__connector" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
