// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useState } from 'react';

const API = 'http://localhost:8001/api/v1';

interface KeyframeOption {
  id: string;
  label: string;
  badge: string;
  badgeColor: string;
  description: string;
  pros: string[];
  cons: string[];
}

const OPTIONS: KeyframeOption[] = [
  {
    id: 'gemini',
    label: 'Gemini 이미지',
    badge: 'AI 생성',
    badgeColor: '#6366f1',
    description: 'Google Gemini API로 씬별 배경 이미지를 생성합니다.',
    pros: ['화풍 일관성 높음', '씬 맥락 반영'],
    cons: ['API 비용 발생', '생성 시간 3~5초/씬'],
  },
  {
    id: 'pillow',
    label: 'Pillow 플레이스홀더',
    badge: '무료',
    badgeColor: '#10b981',
    description: '그라데이션 + 텍스트 오버레이 이미지를 즉시 생성합니다.',
    pros: ['무료', '즉시 생성 (< 0.1초/씬)'],
    cons: ['단순한 비주얼'],
  },
];

interface Props {
  seriesId: string;
  currentProvider?: string;
  onConfirm: () => void;
}

export default function KeyframeSetupEditor({ seriesId, currentProvider, onConfirm }: Props) {
  const [selected, setSelected] = useState<string>(currentProvider ?? 'gemini');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      // 1. settings에 keyframeProvider 저장
      await fetch(`${API}/series/${seriesId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { keyframeProvider: selected } }),
      });
      // 2. keyframe_setup 승인 → KEYFRAME 단계 진입
      const res = await fetch(`${API}/series/${seriesId}/approve/keyframe_setup`, { method: 'POST' });
      if (!res.ok) throw new Error('승인 실패');
      onConfirm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      marginTop: '1.5rem',
      background: 'rgba(8,10,22,0.82)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      {/* 헤더 */}
      <div style={{
        padding: '1.25rem 1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.2rem' }}>
            키프레임 이미지 방식 선택
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)' }}>
            씬별 배경 이미지를 어떤 방식으로 생성할지 선택하세요
          </p>
        </div>
      </div>

      {/* 옵션 카드 */}
      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {OPTIONS.map(opt => {
          const active = selected === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => setSelected(opt.id)}
              style={{
                padding: '1.25rem',
                borderRadius: '12px',
                border: `2px solid ${active ? opt.badgeColor : 'rgba(255,255,255,0.08)'}`,
                background: active ? `${opt.badgeColor}10` : 'rgba(255,255,255,0.02)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {/* 상단 행 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                {/* 라디오 */}
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: `2px solid ${active ? opt.badgeColor : 'rgba(255,255,255,0.25)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {active && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: opt.badgeColor }} />
                  )}
                </div>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{opt.label}</span>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700,
                  background: `${opt.badgeColor}22`,
                  color: opt.badgeColor,
                  padding: '0.15rem 0.6rem', borderRadius: '999px',
                }}>
                  {opt.badge}
                </span>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.55)', marginBottom: '0.75rem', paddingLeft: '1.65rem' }}>
                {opt.description}
              </p>

              {/* 장단점 */}
              <div style={{ display: 'flex', gap: '2rem', paddingLeft: '1.65rem' }}>
                <div>
                  {opt.pros.map(p => (
                    <div key={p} style={{ fontSize: '0.78rem', color: '#10b981', marginBottom: '0.2rem' }}>
                      ✓ {p}
                    </div>
                  ))}
                </div>
                <div>
                  {opt.cons.map(c => (
                    <div key={c} style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', marginBottom: '0.2rem' }}>
                      · {c}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ margin: '0 1.5rem 1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* 하단 버튼 */}
      <div style={{
        padding: '1rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          onClick={handleConfirm}
          disabled={saving}
          style={{
            padding: '0.65rem 2rem',
            borderRadius: '10px',
            border: 'none',
            background: saving ? 'rgba(99,102,241,0.4)' : '#6366f1',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {saving ? '처리 중…' : '이 방식으로 키프레임 생성 시작'}
        </button>
      </div>
    </div>
  );
}
