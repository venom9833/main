'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSeries } from '@/lib/seriesStore';

const API = 'http://localhost:8001/api/v1';
const ACCEPT = '.txt,.srt,.vtt,.pdf';

interface PendingFile {
  file: File;
  status: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface WorldOption {
  id: string;
  label: string;
  tension: string;
  scene: string;
  category?: string;
}

interface WorldOptionsData {
  backgrounds: WorldOption[];
  relationships: WorldOption[];
  social_fractures: WorldOption[];
  conflict_structures: WorldOption[];
  resolution_methods: WorldOption[];
  narrative_povs: WorldOption[];
}

interface SelectedOptions {
  background?: string;
  relationship?: string;
  social_fracture?: string;
  conflict_structure?: string;
  resolution_method?: string;
  narrative_pov?: string;
}

function guessTopicFromFiles(files: PendingFile[]): string {
  const first = files[0]?.file.name ?? '';
  return first.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
}


export default function CreatePage() {
  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [topic, setTopic] = useState('');
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'creating' | 'uploading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [worldOptions, setWorldOptions] = useState<WorldOptionsData | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<SelectedOptions>({});
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [povOpen, setPovOpen] = useState(false);

  useEffect(() => {
    fetch(`${API}/world-options`)
      .then(r => r.json())
      .then(setWorldOptions)
      .catch(() => {});
  }, []);

  function toggleOption(dim: keyof SelectedOptions, id: string) {
    setSelectedOptions(prev => ({
      ...prev,
      [dim]: prev[dim] === id ? undefined : id,
    }));
  }

  const resolutionSelected = !!selectedOptions.resolution_method;
  const povSelected = !!selectedOptions.narrative_pov;

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const added = Array.from(fileList).map(f => ({ file: f, status: 'ready' as const }));
    setPendingFiles(prev => {
      const next = [...prev, ...added];
      // 첫 파일에서 주제 자동 추출 (topic이 비어있을 때만)
      if (!topic.trim() && added.length > 0) {
        setTopic(guessTopicFromFiles(next));
      }
      return next;
    });
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [topic]);

  function removeFile(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleStart() {
    if (!topic.trim() && pendingFiles.length === 0) return;
    setError(null);

    const effectiveTopic = topic.trim() || pendingFiles[0]?.file.name.replace(/\.[^.]+$/, '') || '새 시리즈';

    try {
      // 1. 시리즈 생성
      setPhase('creating');
      let series;
      try {
        series = await createSeries(effectiveTopic);
      } catch (e) {
        throw new Error(`시리즈 생성 실패: API 서버(localhost:8001)가 실행 중인지 확인하세요. (${e instanceof Error ? e.message : e})`);
      }
      const seriesId = series.id;

      // 2. 파일 업로드 + wiki 인제스트
      if (pendingFiles.length > 0) {
        setPhase('uploading');
        await Promise.all(
          pendingFiles.map(async (pf, i) => {
            setPendingFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'uploading' } : f));
            const form = new FormData();
            form.append('file', pf.file);
            try {
              const res = await fetch(`${API}/wiki/${seriesId}/sources/upload-file`, {
                method: 'POST',
                body: form,
              });
              const data = res.ok ? await res.json().catch(() => ({})) : {};
              const ok = res.ok && data.ok !== false;
              setPendingFiles(prev => prev.map((f, idx) =>
                idx === i ? { ...f, status: ok ? 'done' : 'error', error: ok ? undefined : (data.error || '업로드 실패') } : f
              ));
            } catch {
              setPendingFiles(prev => prev.map((f, idx) =>
                idx === i ? { ...f, status: 'error', error: '네트워크 오류' } : f
              ));
            }
          })
        );
      }

      // 3. 세계관 초기 옵션 저장 (선택된 경우)
      if (Object.values(selectedOptions).some(Boolean)) {
        try {
          await fetch(`${API}/series/${seriesId}/world`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ world_data: { selectedOptions } }),
          });
        } catch {
          console.warn('[create] world_data PATCH 실패 — 기본값으로 계속');
        }
      }

      // 4. 소스 업로드 승인 → 세계관 생성 자동 시작
      const approveRes = await fetch(`${API}/series/${seriesId}/approve/source_upload`, { method: 'POST' });
      if (!approveRes.ok) {
        throw new Error(`파이프라인 시작 실패 (${approveRes.status}): API 서버(localhost:8001)가 실행 중인지 확인하세요.`);
      }

      // 5. 시리즈 상세 페이지로 이동
      router.push(`/series/${seriesId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';
  const canStart = !busy && (topic.trim().length > 0 || pendingFiles.length > 0);

  const PHASE_LABEL: Record<string, string> = {
    creating: '시리즈 생성 중…',
    uploading: '소스 분석 중…',
  };

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "var(--font-en), 'Pretendard', sans-serif", padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '620px' }}>

        {/* 타이틀 */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            소스를 올려주세요
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.95rem' }}>
            뉴스 자막, 소설, 기사를 올리면 AI가 세계관을 설계합니다
          </p>
        </div>

        {/* 드래그앤드롭 업로드 존 */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? '#6366f1' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: '18px',
            padding: '2.5rem 2rem',
            textAlign: 'center',
            cursor: busy ? 'default' : 'pointer',
            background: dragging ? 'rgba(99,102,241,0.07)' : 'rgba(255,255,255,0.025)',
            transition: 'all 0.15s',
            marginBottom: pendingFiles.length > 0 ? '0' : '1.5rem',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📂</div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1rem', fontWeight: 500 }}>
            파일을 여기로 드래그하거나 클릭해서 선택
          </p>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {['.txt — 소설·시나리오', '.srt/.vtt — YouTube 자막', '.pdf — 기사·보고서'].map(t => (
              <span key={t} style={{
                fontSize: '0.72rem', padding: '0.2rem 0.65rem', borderRadius: '999px',
                background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
              }}>{t}</span>
            ))}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={e => addFiles(e.target.files)}
          />
        </div>

        {/* 업로드된 파일 목록 */}
        {pendingFiles.length > 0 && (
          <div style={{
            margin: '0.75rem 0 1.5rem',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
          }}>
            {pendingFiles.map((pf, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.55rem 0.9rem', borderRadius: '10px',
                background: pf.status === 'error'
                  ? 'rgba(239,68,68,0.08)'
                  : pf.status === 'done'
                  ? 'rgba(16,185,129,0.07)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${
                  pf.status === 'error' ? 'rgba(239,68,68,0.2)'
                  : pf.status === 'done' ? 'rgba(16,185,129,0.2)'
                  : 'rgba(255,255,255,0.07)'}`,
              }}>
                <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>
                  {pf.status === 'uploading' ? '⏳'
                    : pf.status === 'done' ? '✅'
                    : pf.status === 'error' ? '❌'
                    : '📄'}
                </span>
                <span style={{
                  flex: 1, fontSize: '0.85rem', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: pf.status === 'error' ? '#f87171' : 'rgba(255,255,255,0.8)',
                }}>
                  {pf.file.name}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                  {(pf.file.size / 1024).toFixed(0)} KB
                </span>
                {!busy && (
                  <button
                    onClick={e => { e.stopPropagation(); removeFile(i); }}
                    style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)',
                      cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.2rem', flexShrink: 0,
                    }}
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 주제 입력 */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.4rem' }}>
            {pendingFiles.length > 0 ? '주제 (파일명에서 자동 추출, 수정 가능)' : '주제 입력'}
          </label>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canStart && handleStart()}
            disabled={busy}
            placeholder={pendingFiles.length > 0 ? '파일에서 주제를 자동 추출합니다' : '예: 재벌 2세와 비서의 불륜'}
            style={{
              width: '100%', padding: '0.85rem 1rem',
              borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)', color: '#fff',
              fontSize: '1rem', outline: 'none',
              opacity: busy ? 0.5 : 1,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 카드 1 — 갈등 해소 방식 */}
        {worldOptions && (
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              onClick={() => setResolutionOpen(o => !o)}
              style={{
                width: '100%', padding: '0.75rem 1rem',
                background: resolutionOpen ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${resolutionOpen ? 'rgba(16,185,129,0.35)' : resolutionSelected ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '12px', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>⚔️</span>
                갈등 해소 방식
                {resolutionSelected && !resolutionOpen && (
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#10b981',
                    background: 'rgba(16,185,129,0.15)', padding: '0.1rem 0.5rem',
                    borderRadius: '999px', border: '1px solid rgba(16,185,129,0.3)',
                  }}>
                    ✓ {worldOptions.resolution_methods.find(o => o.id === selectedOptions.resolution_method)?.label}
                  </span>
                )}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>
                {resolutionOpen ? '▲' : '▼'}
              </span>
            </button>

            {resolutionOpen && (
              <div style={{
                marginTop: '0.4rem',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: '12px',
                padding: '1rem',
                background: 'rgba(16,185,129,0.03)',
              }}>
                <p style={{ margin: '0 0 0.9rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                  결말에서 갈등이 어떤 방식으로 해소되는지 선택하세요. AI는 선택한 방식으로 6화 구조를 설계합니다.
                </p>
                {(['현실적', '비현실적'] as const).map(cat => {
                  const items = worldOptions.resolution_methods.filter(o => o.category === cat);
                  const accent = cat === '현실적' ? '#10b981' : '#a78bfa';
                  return (
                    <div key={cat} style={{ marginBottom: '0.75rem' }}>
                      <div style={{
                        fontSize: '0.68rem', fontWeight: 700, color: accent,
                        marginBottom: '0.35rem', letterSpacing: '0.06em',
                        display: 'flex', alignItems: 'center', gap: '0.35rem',
                      }}>
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: accent, display: 'inline-block',
                        }} />
                        {cat}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                        {items.map(opt => {
                          const sel = selectedOptions.resolution_method === opt.id;
                          return (
                            <button key={opt.id}
                              onClick={() => toggleOption('resolution_method', opt.id)}
                              style={{
                                padding: '0.5rem 0.6rem', borderRadius: '8px',
                                textAlign: 'left', cursor: 'pointer',
                                background: sel ? `rgba(${cat === '현실적' ? '16,185,129' : '167,139,250'},0.18)` : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${sel ? accent : 'rgba(255,255,255,0.07)'}`,
                                color: sel ? '#fff' : 'rgba(255,255,255,0.6)',
                                transition: 'all 0.15s',
                              }}
                            >
                              <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{opt.label}</div>
                              <div style={{ fontSize: '0.65rem', color: sel ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)', marginTop: '0.2rem', lineHeight: 1.3 }}>{opt.tension}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 카드 2 — 서술 시점 */}
        {worldOptions && (
          <div style={{ marginBottom: '1.5rem' }}>
            <button
              onClick={() => setPovOpen(o => !o)}
              style={{
                width: '100%', padding: '0.75rem 1rem',
                background: povOpen ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${povOpen ? 'rgba(99,102,241,0.35)' : povSelected ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '12px', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>👁️</span>
                서술 시점
                {povSelected && !povOpen && (
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#818cf8',
                    background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.5rem',
                    borderRadius: '999px', border: '1px solid rgba(99,102,241,0.3)',
                  }}>
                    ✓ {worldOptions.narrative_povs.find(o => o.id === selectedOptions.narrative_pov)?.label}
                  </span>
                )}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>
                {povOpen ? '▲' : '▼'}
              </span>
            </button>

            {povOpen && (
              <div style={{
                marginTop: '0.4rem',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '12px',
                padding: '1rem',
                background: 'rgba(99,102,241,0.03)',
              }}>
                <p style={{ margin: '0 0 0.9rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                  누구의 시선으로 이야기를 서술할지 선택하세요. 독자가 세계를 경험하는 방식이 달라집니다.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {worldOptions.narrative_povs.map(opt => {
                    const sel = selectedOptions.narrative_pov === opt.id;
                    return (
                      <button key={opt.id}
                        onClick={() => toggleOption('narrative_pov', opt.id)}
                        style={{
                          padding: '0.75rem 0.85rem', borderRadius: '10px',
                          textAlign: 'left', cursor: 'pointer',
                          background: sel ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${sel ? '#6366f1' : 'rgba(255,255,255,0.07)'}`,
                          color: sel ? '#fff' : 'rgba(255,255,255,0.65)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.25rem' }}>{opt.label}</div>
                        <div style={{ fontSize: '0.7rem', color: sel ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)', marginBottom: '0.35rem' }}>{opt.tension}</div>
                        <div style={{ fontSize: '0.67rem', color: sel ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)', fontStyle: 'italic', lineHeight: 1.4 }}>
                          &ldquo;{opt.scene}&rdquo;
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div style={{
            marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '10px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
            color: '#f87171', fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}

        {/* 시작 버튼 */}
        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{
            width: '100%', padding: '1rem',
            background: !canStart
              ? 'rgba(99,102,241,0.3)'
              : busy
              ? 'rgba(99,102,241,0.6)'
              : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', border: 'none', borderRadius: '14px',
            fontSize: '1.1rem', fontWeight: 700,
            cursor: canStart ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
          }}
        >
          {busy ? PHASE_LABEL[phase] : (
            pendingFiles.length > 0
              ? `소스 ${pendingFiles.length}건으로 시리즈 시작`
              : '주제만으로 시리즈 시작'
          )}
        </button>

        {/* 하단 안내 */}
        {!busy && (
          <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.2)' }}>
            소스 없이 주제만 입력해도 AI가 독자적으로 세계관을 설계합니다
          </p>
        )}
      </div>
    </main>
  );
}
