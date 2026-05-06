// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import { useEffect, useState } from 'react';

const API = 'http://localhost:8001/api/v1';

/* ── 타입 ── */
interface Character {
  id: string;
  name: string;
  gender: string;
  age: number;
  age_group: string;
  occupation: string;
  family_group: string;
  relation: string;
  role: string;
  role_pool: string[];
  trope_tags: string[];
  villain_intensity: number;
  voice_id?: string;
  supertone_voice_id?: string;
  supertone_style?: string;
  photo_real_url?: string;
  photo_masako_url?: string;
  photo_polystyle_url?: string;
}

type Style = 'poly' | 'masako';

/* ── 가족 그룹 메타 ── */
const FAMILY_META: Record<string, { label: string; color: string; glow: string }> = {
  family_park: { label: '박준혁 가족', color: '#3b82f6', glow: 'rgba(59,130,246,0.2)' },
  family_kim:  { label: '김태호 가족', color: '#10b981', glow: 'rgba(16,185,129,0.2)' },
  family_choi: { label: '최민성 가족', color: '#f59e0b', glow: 'rgba(245,158,11,0.2)' },
  supporting:  { label: '주변 인물',   color: '#a78bfa', glow: 'rgba(167,139,250,0.2)' },
};
const GROUP_ORDER = ['family_park', 'family_kim', 'family_choi', 'supporting'];

const VILLAIN_LABEL: Record<number, string> = {
  1: '잠재 갈등',
  2: '복합 빌런',
  3: '악역',
};


/* ── CharCard ── */
function CharCard({ char }: { char: Character }) {
  const [style, setStyle] = useState<Style>('poly');
  const [stVoiceId, setStVoiceId] = useState(char.supertone_voice_id ?? '');
  const [stStyle, setStStyle] = useState(char.supertone_style ?? '');
  const [stSaving, setStSaving] = useState(false);
  const [stSaved, setStSaved] = useState(false);
  const meta  = FAMILY_META[char.family_group] ?? FAMILY_META.supporting;
  const imgSrc = style === 'poly' ? char.photo_polystyle_url : char.photo_masako_url;

  async function handleSupertoneVoiceSave() {
    if (!stVoiceId.trim()) return;
    setStSaving(true);
    setStSaved(false);
    try {
      await fetch(`${API}/characters/${char.id}/supertone-voice`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supertone_voice_id: stVoiceId.trim(), supertone_style: stStyle.trim() }),
      });
      setStSaved(true);
      setTimeout(() => setStSaved(false), 2500);
    } finally {
      setStSaving(false);
    }
  }

  async function handleSupertoneVoiceClear() {
    setStVoiceId('');
    setStStyle('');
    setStSaving(true);
    try {
      await fetch(`${API}/characters/${char.id}/supertone-voice`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supertone_voice_id: '', supertone_style: '' }),
      });
    } finally {
      setStSaving(false);
    }
  }

  return (
    <div style={{
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid rgba(255,255,255,0.08)`,
      backdropFilter: 'blur(8px)',
      transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${meta.glow}`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = '';
        (e.currentTarget as HTMLElement).style.boxShadow = '';
      }}
    >
      {/* 폴리 / 마사코 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {(['poly', 'masako'] as Style[]).map(s => (
          <button key={s} onClick={() => setStyle(s)} style={{
            flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 700,
            border: 'none', cursor: 'pointer',
            background: style === s ? meta.color : 'transparent',
            color: style === s ? '#fff' : 'rgba(255,255,255,0.3)',
            transition: 'all 0.15s',
          }}>
            {s === 'poly' ? '폴리' : '마사코'}
          </button>
        ))}
      </div>

      {/* 1:1 이미지 */}
      <div style={{ position: 'relative', paddingBottom: '100%' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {imgSrc ? (
            <img src={imgSrc} alt={char.name} style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'top',
            }} />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              background: `linear-gradient(145deg, ${meta.glow}, rgba(0,0,0,0.3))`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${meta.color}25`, color: meta.color,
                fontSize: 18, fontWeight: 700,
              }}>
                {char.name[0]}
              </div>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{char.age_group}</span>
            </div>
          )}
        </div>
      </div>

      {/* 정보 */}
      <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* 이름 + 나이 */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{char.name}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0, marginLeft: 4 }}>{char.age}세</span>
        </div>

        {/* 성별 + 관계 + 악역 배지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: char.gender === 'male' ? '#60a5fa' : '#f472b6',
          }}>
            {char.gender === 'male' ? '♂' : '♀'}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: char.gender === 'male' ? '#60a5fa' : '#f472b6',
            background: char.gender === 'male' ? 'rgba(96,165,250,0.1)' : 'rgba(244,114,182,0.1)',
            border: `1px solid ${char.gender === 'male' ? 'rgba(96,165,250,0.25)' : 'rgba(244,114,182,0.25)'}`,
            borderRadius: 4, padding: '1px 5px',
          }}>
            {char.relation}
          </span>
          {char.villain_intensity > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: '#f87171',
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 4, padding: '1px 5px',
            }}>
              {VILLAIN_LABEL[char.villain_intensity] ?? '빌런'}
            </span>
          )}
        </div>

        {/* 직업 */}
        <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {char.occupation}
        </p>

        {/* 역할 */}
        <p style={{
          fontSize: 10, color: meta.color, fontWeight: 500, margin: 0, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        } as React.CSSProperties}>
          {char.role}
        </p>

        {/* ── 슈퍼톤 성우 (주연) ── */}
        {stVoiceId ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{
                fontSize: 8, fontWeight: 700, padding: '1px 5px',
                background: 'rgba(250,204,21,0.15)',
                border: '1px solid rgba(250,204,21,0.4)',
                borderRadius: 3, color: '#fbbf24', flexShrink: 0,
              }}>ST</span>
              <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {stVoiceId}{stStyle ? ` · ${stStyle}` : ''}
              </span>
              {stSaved && <span style={{ fontSize: 8, color: '#10b981' }}>✓</span>}
              <button
                onClick={handleSupertoneVoiceClear}
                style={{
                  fontSize: 9, border: 'none', background: 'none',
                  color: 'rgba(255,255,255,0.2)', cursor: 'pointer', padding: '0 2px',
                }}
                title="Supertone 설정 해제"
              >×</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              <input
                type="text"
                placeholder="Supertone voice ID"
                value={stVoiceId}
                onChange={e => setStVoiceId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSupertoneVoiceSave()}
                style={{
                  flex: 1, fontSize: 9, padding: '2px 5px',
                  background: 'rgba(250,204,21,0.05)',
                  border: `1px solid ${stSaving ? '#fbbf24' : 'rgba(250,204,21,0.2)'}`,
                  borderRadius: 4, color: '#fbbf24',
                  outline: 'none', minWidth: 0,
                }}
              />
              <input
                type="text"
                placeholder="style"
                value={stStyle}
                onChange={e => setStStyle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSupertoneVoiceSave()}
                style={{
                  width: 44, fontSize: 9, padding: '2px 4px',
                  background: 'rgba(250,204,21,0.05)',
                  border: `1px solid rgba(250,204,21,0.2)`,
                  borderRadius: 4, color: 'rgba(255,255,255,0.4)',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSupertoneVoiceSave}
                disabled={!stVoiceId.trim()}
                style={{
                  fontSize: 9, padding: '1px 6px',
                  background: stVoiceId.trim() ? 'rgba(250,204,21,0.2)' : 'transparent',
                  border: `1px solid ${stVoiceId.trim() ? 'rgba(250,204,21,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 4, color: stVoiceId.trim() ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                  cursor: stVoiceId.trim() ? 'pointer' : 'default',
                }}
              >저장</button>
            </div>
          </div>
        )}

        {/* edge-tts 폴백 표시 (읽기 전용) */}
        {char.voice_id && (
          <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>🎙</span>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{char.voice_id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Page ── */
export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/characters`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setCharacters(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const groups = GROUP_ORDER.map(key => ({
    key,
    meta: FAMILY_META[key],
    chars: characters.filter(c => c.family_group === key),
  }));

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #0d0d1a 0%, #111827 50%, #0d0d1a 100%)',
      fontFamily: "var(--font-en), 'Pretendard', sans-serif",
    }}>
      {/* 타이틀 바 */}
      <div style={{
        position: 'sticky', top: 82, zIndex: 40,
        background: 'rgba(10,10,20,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 2rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        minHeight: 44,
      }}>
        <span style={{
          background: '#a78bfa', color: '#0d0d1a',
          padding: '2px 8px', borderRadius: 6,
          fontSize: 10, fontWeight: 900, letterSpacing: '0.06em',
        }}>
          CHARACTER
        </span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
          인물 프로필
        </span>
        {!loading && (
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)' }}>
            {characters.length}명
          </span>
        )}
      </div>

      <div style={{ padding: '2rem' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6rem 0' }}>
            <div style={{
              width: 28, height: 28,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#a78bfa', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : (
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '3rem' }}>
            {groups.map(({ key, meta, chars }) => chars.length === 0 ? null : (
              <section key={key}>
                {/* 섹션 헤더 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: meta.color,
                  }}>
                    {meta.label}
                  </span>
                  <div style={{ flex: 1, height: 1, background: `${meta.color}30` }} />
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{chars.length}명</span>
                </div>

                {/* 4열 그리드 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '0.875rem',
                }}>
                  {chars.map(char => <CharCard key={char.id} char={char} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
