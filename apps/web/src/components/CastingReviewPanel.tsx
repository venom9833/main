// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
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
  photo_polystyle_url: string;
  face_grid_url: string;
}

interface WorldData {
  charA?: string;
  charAName?: string;
  charB?: string;
  charBName?: string;
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
  llm_selected: 'AI 맞춤 선발',
  source_extracted: '소스 원작 추출',
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

function RoleBadge({ role, onClick, isActive, disabled }: {
  role: 'A' | 'B';
  onClick: () => void;
  isActive: boolean;
  disabled: boolean;
}) {
  const colors = {
    A: { active: '#6366f1', activeBg: 'rgba(99,102,241,0.25)', border: 'rgba(99,102,241,0.6)', text: '#a5b4fc' },
    B: { active: '#ec4899', activeBg: 'rgba(236,72,153,0.2)', border: 'rgba(236,72,153,0.5)', text: '#f9a8d4' },
  };
  const c = colors[role];
  return (
    <button
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={isActive ? `주인공 ${role}로 지정됨` : `주인공 ${role}로 지정`}
      style={{
        width: 26, height: 26,
        borderRadius: '6px',
        border: isActive ? `1.5px solid ${c.border}` : '1px solid rgba(255,255,255,0.12)',
        background: isActive ? c.activeBg : 'transparent',
        color: isActive ? c.text : 'rgba(255,255,255,0.25)',
        fontSize: '0.65rem',
        fontWeight: 800,
        cursor: disabled ? 'default' : isActive ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'all 0.15s',
        opacity: disabled && !isActive ? 0.5 : 1,
      }}
    >
      {role}
    </button>
  );
}

function CharDetailCard({
  char, secret, onSecretChange, protagonistRole, onSetA, onSetB, swapping, secretDisabled,
}: {
  char: CastDetail;
  secret: string;
  onSecretChange: (id: string, v: string) => void;
  protagonistRole: 'A' | 'B' | null;
  onSetA: () => void;
  onSetB: () => void;
  swapping: boolean;
  secretDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(protagonistRole !== null);
  const photoUrl = char.photo_polystyle_url || char.photo_real_url || char.face_grid_url;
  const roleLabel = ROLE_LABELS[char.role] || char.role;
  const genderLabel = GENDER_LABEL[char.gender] || char.gender;
  const isProtagonist = protagonistRole !== null;

  return (
    <div style={{
      background: isProtagonist ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${
        protagonistRole === 'A' ? 'rgba(99,102,241,0.3)' :
        protagonistRole === 'B' ? 'rgba(236,72,153,0.25)' :
        'rgba(255,255,255,0.08)'
      }`,
      borderRadius: '14px',
      overflow: 'hidden',
    }}>
      {/* 헤더 */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.7rem',
          padding: '0.9rem 1rem', cursor: 'pointer',
        }}
      >
        {photoUrl && (
          <img
            src={photoUrl}
            alt={char.name}
            style={{ width: 56, height: 56, borderRadius: '10px', objectFit: 'cover', objectPosition: 'top', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            {isProtagonist && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 700, textTransform: 'uppercase',
                padding: '0.1rem 0.4rem', borderRadius: '4px',
                background: protagonistRole === 'A' ? 'rgba(99,102,241,0.2)' : 'rgba(236,72,153,0.2)',
                color: protagonistRole === 'A' ? '#a5b4fc' : '#f9a8d4',
              }}>
                주인공 {protagonistRole}
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

        {/* A/B 지정 버튼 */}
        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <RoleBadge role="A" onClick={onSetA} isActive={protagonistRole === 'A'} disabled={swapping || protagonistRole === 'A'} />
          <RoleBadge role="B" onClick={onSetB} isActive={protagonistRole === 'B'} disabled={swapping || protagonistRole === 'B'} />
        </div>

        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', flexShrink: 0, marginLeft: '0.25rem' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* 상세 — 펼쳤을 때 */}
      {expanded && (
        <div style={{ padding: '0 1.2rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
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

          {char.personality && (
            <div>
              <div style={sectionLabel}>성격</div>
              <div style={valueText}>{char.personality}</div>
            </div>
          )}

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

          {char.concern && (
            <div>
              <div style={sectionLabel}>핵심 걱정</div>
              <div style={valueText}>{char.concern}</div>
            </div>
          )}

          {char.lie_to_self && (
            <div>
              <div style={sectionLabel}>내면의 거짓말</div>
              <div style={{ ...valueText, color: 'rgba(251,191,36,0.75)' }}>{char.lie_to_self}</div>
            </div>
          )}

          {char.fear && (
            <div>
              <div style={sectionLabel}>핵심 두려움</div>
              <div style={{ ...valueText, color: 'rgba(248,113,113,0.75)' }}>{char.fear}</div>
            </div>
          )}

          {char.speaking_style && (
            <div>
              <div style={sectionLabel}>말투</div>
              <div style={valueText}>{char.speaking_style}</div>
            </div>
          )}

          {char.under_stress && (
            <div>
              <div style={sectionLabel}>스트레스 반응</div>
              <div style={valueText}>{char.under_stress}</div>
            </div>
          )}

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
  const [regenerating, setRegenerating] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [userSecrets, setUserSecrets] = useState<Record<string, string>>({});
  const [castDetails, setCastDetails] = useState<CastDetail[]>(worldData.fullCastDetails || []);
  const [castTrope, setCastTrope] = useState<string>(worldData.castTrope || '');
  const [loadingDetails, setLoadingDetails] = useState(false);

  // 주인공 A/B 선택 상태 — world_data 값으로 초기화, 없으면 순서 기반 fallback
  const [selectedA, setSelectedA] = useState<string>(worldData.charA || '');
  const [selectedB, setSelectedB] = useState<string>(worldData.charB || '');

  useEffect(() => {
    if (castDetails.length > 0) {
      // charA/B가 미설정인 경우 첫 두 캐릭터로 초기화
      if (!selectedA && castDetails[0]) setSelectedA(castDetails[0].id);
      if (!selectedB && castDetails[1]) setSelectedB(castDetails[1].id);
      return;
    }
    setLoadingDetails(true);
    fetch(`${API}/series/${seriesId}/cast-details`)
      .then(r => r.ok ? r.json() : { details: [] })
      .then(data => {
        const details = data.details || [];
        setCastDetails(details);
        if (!selectedA && details[0]) setSelectedA(details[0].id);
        if (!selectedB && details[1]) setSelectedB(details[1].id);
      })
      .catch(() => {})
      .finally(() => setLoadingDetails(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const handleSetRole = async (charId: string, role: 'A' | 'B') => {
    if (swapping) return;
    const prevA = selectedA;
    const prevB = selectedB;

    let newA = selectedA;
    let newB = selectedB;
    if (role === 'A') {
      newA = charId;
      if (charId === selectedB) newB = prevA; // B→A 스왑: 기존 A가 B로
    } else {
      newB = charId;
      if (charId === selectedA) newA = prevB; // A→B 스왑: 기존 B가 A로
    }
    if (newA === newB || !newA || !newB) return;

    setSelectedA(newA);
    setSelectedB(newB);
    setSwapping(true);
    try {
      const res = await fetch(`${API}/series/${seriesId}/cast-reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charA_id: newA, charB_id: newB }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSelectedA(prevA);
      setSelectedB(prevB);
    } finally {
      setSwapping(false);
    }
  };

  const handleRegen = async () => {
    setRegenerating(true);
    setUserSecrets({});
    try {
      const res = await fetch(`${API}/series/${seriesId}/regen/casting`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const newDetails: CastDetail[] = data.fullCastDetails || [];
        if (newDetails.length > 0) {
          setCastDetails(newDetails);
          setSelectedA(newDetails[0]?.id || '');
          setSelectedB(newDetails[1]?.id || '');
        }
        if (data.castTrope) setCastTrope(data.castTrope);
      }
    } catch {
      // 실패 시 기존 캐스트 유지
    } finally {
      setRegenerating(false);
    }
  };

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

  const tropeLabel = TROPE_LABELS[castTrope] || castTrope || '—';

  return (
    <div style={{
      marginTop: '2rem',
      background: 'rgba(8,10,22,0.82)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '20px',
      padding: '2rem',
      fontFamily: "var(--font-en), 'Pretendard', sans-serif",
      color: '#e2e8f0',
    }}>
      {/* 헤더 */}
      <div style={{ marginBottom: '1.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>캐릭터 확인</h2>
          <span style={{
            fontSize: '0.65rem', padding: '0.15rem 0.55rem', borderRadius: '6px',
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
            color: '#a5b4fc', fontWeight: 600,
          }}>
            트롭 — {tropeLabel}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>
            총 {castDetails.length}명
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: Object.values(userSecrets).filter(v => v.trim()).length >= MAX_SECRETS ? '#f87171' : 'rgba(255,255,255,0.3)',
            marginLeft: '0.25rem',
          }}>
            · 비밀 {Object.values(userSecrets).filter(v => v.trim()).length}/{MAX_SECRETS}
          </span>
          {swapping && (
            <span style={{ fontSize: '0.65rem', color: 'rgba(251,191,36,0.7)' }}>주인공 변경 중…</span>
          )}
          <button
            className="glass-btn glass-btn--ghost"
            onClick={handleRegen}
            disabled={regenerating || confirming || swapping}
            style={{ marginLeft: 'auto', padding: '0.55rem 1.5rem', fontSize: '0.85rem', fontWeight: 600 }}
          >
            {regenerating ? (
              <>
                <span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                재생성 중…
              </>
            ) : '↺ 캐릭터 재생성'}
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
          각 캐릭터 카드의 <strong style={{ color: '#a5b4fc' }}>A</strong> / <strong style={{ color: '#f9a8d4' }}>B</strong> 버튼으로 주인공을 직접 선택할 수 있습니다. 비밀을 투입한 뒤 확정하면 대본 생성이 시작됩니다.
        </p>
      </div>

      {/* 전체 캐릭터 리스트 — 2열 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
        {castDetails.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.3)', gridColumn: '1/-1' }}>
            {loadingDetails ? '캐릭터 데이터를 불러오는 중…' : '캐릭터 데이터가 없습니다'}
          </div>
        ) : (
          castDetails.map((char) => {
            const filledCount = Object.values(userSecrets).filter(v => v.trim()).length;
            const hasSecret = !!(userSecrets[char.id]?.trim());
            const secretDisabled = filledCount >= MAX_SECRETS && !hasSecret;
            const protagonistRole: 'A' | 'B' | null =
              char.id === selectedA ? 'A' : char.id === selectedB ? 'B' : null;
            return (
              <CharDetailCard
                key={char.id}
                char={char}
                secret={userSecrets[char.id] || ''}
                onSecretChange={handleSecretChange}
                protagonistRole={protagonistRole}
                onSetA={() => handleSetRole(char.id, 'A')}
                onSetB={() => handleSetRole(char.id, 'B')}
                swapping={swapping}
                secretDisabled={secretDisabled}
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
          disabled={confirming || swapping || !selectedA || !selectedB}
          style={{
            padding: '0.65rem 2rem',
            borderRadius: '12px',
            border: 'none',
            background: confirming || swapping ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: confirming || swapping ? 'not-allowed' : 'pointer',
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
