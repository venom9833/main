'use client';
import { useState, useEffect } from 'react';

const API = 'http://localhost:8001/api/v1';

interface CastDetail {
  id: string;
  name: string;
  gender: string;
  age: number;
  age_group: string;
  occupation: string;
  role: string;
  role_in_story: string;
  family_group: string;
  personality: string;
  speaking_style: string;
  concern: string;
  fear: string;
  lie_to_self: string;
  under_stress: string;
  situations: string[];
  relationships: Record<string, string>;
  photo_real_url: string;
  photo_masako_url: string;
  face_grid_url: string;
}

interface WorldData {
  charA?: string;
  charAName?: string;
  castTrope?: string;
  fullCastDetails?: CastDetail[];
  [key: string]: unknown;
}

interface Props {
  seriesId: string;
  worldData: WorldData;
  onConfirm: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  protagonist: '주인공',
  antagonist: '빌런',
  catalyst: '촉매',
  elder: '시니어',
  mirror: '거울',
};

const TROPE_LABELS: Record<string, string> = {
  affair: '불륜·배신',
  divorce: '이혼',
  office_romance: '오피스 로맨스',
  remarriage: '재혼',
  redevelopment: '재개발',
  inheritance: '상속',
  midlife_crisis: '중년 위기',
  youth: '청년',
  in_law: '시댁 갈등',
  isolation: '고독·소외',
  power_abuse: '갑질·권력',
};

const GENDER_LABEL: Record<string, string> = { male: '남', female: '여' };

const sectionLabel: React.CSSProperties = {
  fontSize: '0.54rem',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.28)',
  marginBottom: '0.2rem',
};

const valueText: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'rgba(255,255,255,0.72)',
  lineHeight: 1.6,
};

const MAX_SECRETS = 2;

function SecretInput({ charId, name, value, onChange, disabled }: {
  charId: string; name: string; value: string;
  onChange: (id: string, v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: '0.58rem', fontWeight: 700, color: disabled && !value ? 'rgba(255,255,255,0.2)' : 'rgba(251,191,36,0.6)', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
        투입할 비밀
      </div>
      <textarea
        value={value}
        onChange={e => onChange(charId, e.target.value)}
        disabled={disabled && !value}
        placeholder={disabled && !value ? '비밀 투입 한도 초과 (전체 최대 2개)' : `${name}의 숨겨진 비밀 — 대본 전반의 복선·반전으로 활용됩니다`}
        rows={2}
        style={{
          width: '100%',
          background: disabled && !value ? 'rgba(255,255,255,0.02)' : 'rgba(251,191,36,0.04)',
          border: `1px solid ${disabled && !value ? 'rgba(255,255,255,0.06)' : 'rgba(251,191,36,0.2)'}`,
          borderRadius: '8px',
          padding: '0.55rem 0.75rem',
          color: disabled && !value ? 'rgba(255,255,255,0.2)' : '#fde68a',
          fontSize: '0.75rem',
          lineHeight: 1.6,
          resize: 'vertical',
          outline: 'none',
          fontFamily: "var(--font-en), 'Pretendard', sans-serif",
          boxSizing: 'border-box',
          cursor: disabled && !value ? 'not-allowed' : 'text',
        }}
      />
    </div>
  );
}

function CharDetailCard({
  char, index, secret, onSecretChange, isProtagonist, secretDisabled,
}: {
  char: CastDetail;
  index: number;
  secret: string;
  onSecretChange: (id: string, v: string) => void;
  isProtagonist: boolean;
  secretDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(isProtagonist);
  // 마사코 이미지 우선, 없으면 real, 없으면 face_grid
  const photoUrl = char.photo_masako_url || char.photo_real_url || char.face_grid_url;
  const roleLabel = ROLE_LABELS[char.role] || char.role;
  const genderLabel = GENDER_LABEL[char.gender] || char.gender;

  return (
    <div style={{
      background: isProtagonist ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isProtagonist ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: '14px',
      overflow: 'hidden',
    }}>
      {/* 헤더 — 항상 표시 */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          padding: '0.9rem 1rem', cursor: 'pointer',
        }}
      >
        {photoUrl && (
          <img
            src={photoUrl}
            alt={char.name}
            style={{ width: 64, height: 64, borderRadius: '10px', objectFit: 'cover', objectPosition: 'top', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            {isProtagonist && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 700, textTransform: 'uppercase',
                padding: '0.1rem 0.4rem', borderRadius: '4px',
                background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
              }}>
                주인공 {index === 0 ? 'A' : 'B'}
              </span>
            )}
            <span style={{
              fontSize: '0.5rem', padding: '0.1rem 0.4rem', borderRadius: '4px',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)',
            }}>
              {roleLabel}
            </span>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#e2e8f0' }}>{char.name}</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginTop: '0.15rem' }}>
            {genderLabel} · {char.age}세 · {char.occupation}
          </div>
          {!expanded && char.situations?.[0] && (
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.15rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {char.situations[0]}
            </div>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* 상세 — 펼쳤을 때 */}
      {expanded && (
        <div style={{ padding: '0 1.2rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {/* 기본 정보 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.5rem' }}>
            <div>
              <div style={sectionLabel}>성별·나이</div>
              <div style={valueText}>{genderLabel} · {char.age}세 ({char.age_group})</div>
            </div>
            <div>
              <div style={sectionLabel}>직업</div>
              <div style={valueText}>{char.occupation || '—'}</div>
            </div>
            <div>
              <div style={sectionLabel}>역할</div>
              <div style={valueText}>{char.role_in_story || roleLabel}</div>
            </div>
            <div>
              <div style={sectionLabel}>가족 그룹</div>
              <div style={valueText}>{char.family_group || '—'}</div>
            </div>
          </div>

          {/* 성격 */}
          {char.personality && (
            <div>
              <div style={sectionLabel}>성격</div>
              <div style={valueText}>{char.personality}</div>
            </div>
          )}

          {/* 현재 상황 전체 */}
          {char.situations?.length > 0 && (
            <div>
              <div style={sectionLabel}>현재 상황</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {char.situations.map((s, i) => (
                  <li key={i} style={{ ...valueText, marginBottom: '0.25rem' }}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 핵심 걱정 */}
          {char.concern && (
            <div>
              <div style={sectionLabel}>핵심 걱정</div>
              <div style={valueText}>{char.concern}</div>
            </div>
          )}

          {/* 내면의 거짓말 */}
          {char.lie_to_self && (
            <div>
              <div style={sectionLabel}>내면의 거짓말</div>
              <div style={{ ...valueText, color: 'rgba(251,191,36,0.75)' }}>{char.lie_to_self}</div>
            </div>
          )}

          {/* 핵심 두려움 */}
          {char.fear && (
            <div>
              <div style={sectionLabel}>핵심 두려움</div>
              <div style={{ ...valueText, color: 'rgba(248,113,113,0.75)' }}>{char.fear}</div>
            </div>
          )}

          {/* 말투 */}
          {char.speaking_style && (
            <div>
              <div style={sectionLabel}>말투</div>
              <div style={valueText}>{char.speaking_style}</div>
            </div>
          )}

          {/* 스트레스 반응 */}
          {char.under_stress && (
            <div>
              <div style={sectionLabel}>스트레스 반응</div>
              <div style={valueText}>{char.under_stress}</div>
            </div>
          )}

          {/* 관계 */}
          {Object.keys(char.relationships || {}).length > 0 && (
            <div>
              <div style={sectionLabel}>주요 관계</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {Object.entries(char.relationships).map(([person, desc]) => (
                  <div key={person} style={{ display: 'flex', gap: '0.6rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a5b4fc', flexShrink: 0, minWidth: '72px' }}>{person}</span>
                    <span style={{ ...valueText, fontSize: '0.7rem' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 비밀 투입 */}
          <div style={{ borderTop: '1px solid rgba(251,191,36,0.1)', paddingTop: '0.9rem' }}>
            <SecretInput charId={char.id} name={char.name} value={secret} onChange={onSecretChange} disabled={secretDisabled} />
          </div>
        </div>
      )}
    </div>
  );
}


export default function CastingReviewPanel({ seriesId, worldData, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [userSecrets, setUserSecrets] = useState<Record<string, string>>({});
  const [castDetails, setCastDetails] = useState<CastDetail[]>(worldData.fullCastDetails || []);
  const [loadingDetails, setLoadingDetails] = useState(false);
  useEffect(() => {
    if (castDetails.length > 0) return;
    setLoadingDetails(true);
    fetch(`${API}/series/${seriesId}/cast-details`)
      .then(r => r.ok ? r.json() : { details: [] })
      .then(data => setCastDetails(data.details || []))
      .catch(() => {})
      .finally(() => setLoadingDetails(false));
  }, [seriesId, castDetails.length]);

  const handleSecretChange = (charId: string, value: string) => {
    setUserSecrets(prev => ({ ...prev, [charId]: value }));
  };

  const handleConfirm = async () => {
    setConfirming(true);
    const secrets = Object.fromEntries(
      Object.entries(userSecrets).filter(([, v]) => v.trim())
    );
    await fetch(`${API}/series/${seriesId}/approve/casting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userSecrets: Object.keys(secrets).length > 0 ? secrets : null }),
    });
    onConfirm();
  };

  const allChars = castDetails;
  const tropeLabel = TROPE_LABELS[worldData.castTrope || ''] || worldData.castTrope || '—';

  return (
    <div style={{
      marginTop: '2rem',
      background: 'linear-gradient(135deg, rgba(30,27,75,0.95), rgba(17,24,39,0.97))',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '20px',
      padding: '2rem',
      fontFamily: "var(--font-en), 'Pretendard', sans-serif",
      color: '#e2e8f0',
    }}>
      {/* 헤더 */}
      <div style={{ marginBottom: '1.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>캐릭터 확인</h2>
          <span style={{
            fontSize: '0.65rem', padding: '0.15rem 0.55rem', borderRadius: '6px',
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
            color: '#a5b4fc', fontWeight: 600,
          }}>
            트롭 — {tropeLabel}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>
            총 {allChars.length}명
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: Object.values(userSecrets).filter(v => v.trim()).length >= MAX_SECRETS ? '#f87171' : 'rgba(255,255,255,0.3)',
            marginLeft: '0.25rem',
          }}>
            · 비밀 {Object.values(userSecrets).filter(v => v.trim()).length}/{MAX_SECRETS}
          </span>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
          세계관 분석으로 선정된 캐릭터입니다. 각 캐릭터에 비밀을 투입한 뒤 확정하면 대본 생성이 시작됩니다.
        </p>
      </div>

      {/* 전체 캐릭터 리스트 — 2열 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
        {allChars.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
            {loadingDetails ? '캐릭터 데이터를 불러오는 중…' : '캐릭터 데이터가 없습니다'}
          </div>
        ) : (
          allChars.map((char, i) => {
            const filledCount = Object.values(userSecrets).filter(v => v.trim()).length;
            const hasSecret = !!(userSecrets[char.id]?.trim());
            const disabled = filledCount >= MAX_SECRETS && !hasSecret;
            return (
              <CharDetailCard
                key={char.id}
                char={char}
                index={i}
                secret={userSecrets[char.id] || ''}
                onSecretChange={handleSecretChange}
                isProtagonist={i < 2}
                secretDisabled={disabled}
              />
            );
          })
        )}
      </div>

      {/* 안내 + 확정 버튼 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '1rem',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        paddingTop: '1.5rem',
      }}>
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, maxWidth: '480px' }}>
          🔒 투입된 비밀은 대본 생성 시 복선·반전으로 활용됩니다. 비워두면 AI가 캐릭터 기본 설정을 사용합니다.
        </div>
        <button
          onClick={handleConfirm}
          disabled={confirming}
          style={{
            padding: '0.65rem 2rem',
            borderRadius: '12px',
            border: 'none',
            background: confirming ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: confirming ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {confirming ? '처리 중…' : '캐스팅 확정 → 대본 생성'}
        </button>
      </div>
    </div>
  );
}
