import type { PipelineStep } from '@/types/series';

interface Props {
  seriesId: string;
  step: PipelineStep;
  onApprove: () => Promise<void>;
}

export default function ApprovalPanel({ step, onApprove }: Props) {
  const isScript = step === 'awaiting_script_approval';

  return (
    <div style={{
      marginTop: '2rem', padding: '2rem',
      background: 'rgba(245,158,11,0.08)',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: '16px', textAlign: 'center',
    }}>
      <p style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fbbf24', marginBottom: '0.5rem' }}>
        {isScript ? '대본을 확인해주세요' : '최종 영상을 확인해주세요'}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '1.5rem' }}>
        {isScript
          ? '생성된 대본을 검토하고 승인하면 영상 제작이 시작됩니다.'
          : '최종 MP4를 확인하고 승인하면 YouTube 업로드가 시작됩니다.'}
      </p>
      <button
        onClick={onApprove}
        style={{
          padding: '0.75rem 2.5rem',
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          color: '#fff', border: 'none', borderRadius: '12px',
          fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
        }}
      >
        {isScript ? '대본 승인 → 영상 제작 시작' : '영상 승인 → YouTube 업로드'}
      </button>
    </div>
  );
}
