// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSeries } from '@/lib/seriesStore';

const API = 'http://localhost:8001/api/v1';
const ACCEPT = '.txt,.srt,.vtt,.pdf';
const VIDEO_ACCEPT = '.mp4,.mov,.webm,.avi,.mkv,.m4v,.mp3,.m4a,.wav,.aac';

type TranscribeStatus = 'idle' | 'uploading' | 'done' | 'error';


function VideoToSrtSection() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<TranscribeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [language, setLanguage] = useState('ko');
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setVideoFile(f); setError(null); }
  }, []);

  async function handleTranscribe() {
    if (!videoFile || status === 'uploading') return;
    setStatus('uploading');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', videoFile);
      form.append('language', language);
      form.append('model', 'small');
      const res = await fetch(`${API}/transcribe`, { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `서버 오류 (${res.status})`);
      }
      const blob = await res.blob();
      const stem = videoFile.name.replace(/\.[^.]+$/, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${stem}.srt`; a.click();
      URL.revokeObjectURL(url);
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
      setStatus('error');
    }
  }

  function reset() { setVideoFile(null); setStatus('idle'); setError(null); }

  const busy = status === 'uploading';

  return (
    <div style={{
      marginTop: '2.5rem',
      paddingTop: '2rem',
      borderTop: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.3rem', color: 'rgba(255,255,255,0.92)' }}>
          영상에서 자막 추출
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.38)' }}>
          30분 이하 영상·오디오 업로드 → SRT 파일 다운로드
        </p>
      </div>

      {!videoFile ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragging ? '#5ee7df' : 'rgba(255,255,255,0.14)'}`,
            borderRadius: '14px',
            padding: '1.75rem 1.5rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgba(94,231,223,0.06)' : 'rgba(255,255,255,0.025)',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.18s',
          }}
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>🎬</div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.88rem' }}>
            영상을 드래그하거나 클릭해서 선택
          </p>
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {['MP4', 'MOV', 'WEBM', 'MKV', 'MP3', 'M4A'].map(t => (
              <span key={t} style={{
                fontSize: '0.67rem', padding: '0.12rem 0.5rem', borderRadius: '999px',
                background: 'rgba(94,231,223,0.1)', color: '#5ee7df',
                border: '1px solid rgba(94,231,223,0.2)',
              }}>{t}</span>
            ))}
          </div>
          <input ref={inputRef} type="file" accept={VIDEO_ACCEPT} style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { setVideoFile(f); setError(null); } }} />
        </div>
      ) : (
        <div style={{
          padding: '0.85rem 1.1rem', borderRadius: '12px',
          backdropFilter: 'blur(12px)',
          background: status === 'done'
            ? 'rgba(94,231,223,0.07)'
            : status === 'error'
            ? 'rgba(239,68,68,0.07)'
            : 'rgba(255,255,255,0.05)',
          border: `1px solid ${
            status === 'done' ? 'rgba(94,231,223,0.25)'
            : status === 'error' ? 'rgba(239,68,68,0.25)'
            : 'rgba(255,255,255,0.12)'}`,
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>
            {status === 'done' ? '✅' : status === 'error' ? '❌' : '🎬'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: '0.86rem', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: status === 'error' ? '#f87171' : 'rgba(255,255,255,0.9)',
            }}>{videoFile.name}</p>
            <p style={{ margin: '0.1rem 0 0', fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>
              {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
          {!busy && (
            <button onClick={reset} style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '0.85rem',
            }}>✕</button>
          )}
        </div>
      )}

      {videoFile && status === 'idle' && (
        <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap' }}>언어</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            style={{
              flex: 1, padding: '0.4rem 0.7rem', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)',
              backdropFilter: 'blur(8px)',
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.14)', fontSize: '0.85rem',
              outline: 'none',
            }}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
            <option value="auto">자동 감지</option>
          </select>
        </div>
      )}

      {error && (
        <div style={{
          marginTop: '0.65rem', padding: '0.6rem 0.85rem', borderRadius: '8px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#f87171', fontSize: '0.8rem',
        }}>{error}</div>
      )}

      {videoFile && status !== 'done' && (
        <button
          onClick={handleTranscribe}
          disabled={busy}
          style={{
            marginTop: '0.65rem', width: '100%', padding: '0.8rem',
            background: busy
              ? 'rgba(94,231,223,0.3)'
              : 'linear-gradient(135deg, #5ee7df 0%, #3b82f6 100%)',
            color: busy ? 'rgba(255,255,255,0.6)' : '#0b0e1a',
            border: 'none', borderRadius: '12px',
            fontSize: '0.95rem', fontWeight: 700,
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: busy ? 'none' : '0 4px 20px rgba(94,231,223,0.3)',
          }}
        >
          {busy ? '변환 중… (최대 수분 소요)' : 'SRT 자막 추출하기'}
        </button>
      )}

      {status === 'done' && (
        <div style={{ marginTop: '0.65rem', textAlign: 'center' }}>
          <p style={{ color: '#5ee7df', fontSize: '0.85rem', marginBottom: '0.45rem' }}>
            SRT 파일이 다운로드되었습니다
          </p>
          <button onClick={reset} style={{
            padding: '0.45rem 1.1rem', borderRadius: '8px',
            background: 'rgba(94,231,223,0.1)', color: '#5ee7df',
            border: '1px solid rgba(94,231,223,0.25)', cursor: 'pointer', fontSize: '0.82rem',
            transition: 'all 0.15s',
          }}>다른 영상 변환</button>
        </div>
      )}
    </div>
  );
}

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
      setPhase('creating');
      let series;
      try {
        series = await createSeries(effectiveTopic);
      } catch (e) {
        throw new Error(`시리즈 생성 실패: API 서버(localhost:8001)가 실행 중인지 확인하세요. (${e instanceof Error ? e.message : e})`);
      }
      const seriesId = series.id;

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

      const approveRes = await fetch(`${API}/series/${seriesId}/approve/source_upload`, { method: 'POST' });
      if (!approveRes.ok) {
        throw new Error(`파이프라인 시작 실패 (${approveRes.status}): API 서버(localhost:8001)가 실행 중인지 확인하세요.`);
      }

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
    <>
      <main style={{
        minHeight: 'calc(100vh - 82px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "var(--font-en), 'Pretendard', sans-serif",
        padding: '2rem',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Glass card */}
        <div className="glass animate-in" style={{
          width: '100%', maxWidth: '620px',
          borderRadius: '24px',
          padding: '2.5rem 2rem',
        }}>
          {/* 타이틀 */}
          <div style={{ textAlign: 'center', marginBottom: '2.25rem', position: 'relative', zIndex: 2 }}>
            <p style={{ fontSize: '0.72rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '0.4rem' }}>
              LinkDrop AI · 새 시리즈
            </p>
            <h1 style={{
              fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 700, marginBottom: '0.5rem',
              background: 'linear-gradient(135deg, #fff 30%, #5ee7df 65%, #b490f5 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              소스를 올려주세요
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '0.92rem' }}>
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
              border: `1.5px dashed ${dragging ? '#b490f5' : 'rgba(255,255,255,0.14)'}`,
              borderRadius: '16px',
              padding: '2.25rem 1.75rem',
              textAlign: 'center',
              cursor: busy ? 'default' : 'pointer',
              background: dragging ? 'rgba(180,144,245,0.07)' : 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.18s',
              marginBottom: pendingFiles.length > 0 ? '0' : '1.5rem',
              position: 'relative', zIndex: 2,
            }}
          >
            <div style={{ fontSize: '2.25rem', marginBottom: '0.65rem' }}>📂</div>
            <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: '0.95rem', fontWeight: 500 }}>
              파일을 여기로 드래그하거나 클릭해서 선택
            </p>
            <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.45rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {['.txt — 소설·시나리오', '.srt/.vtt — YouTube 자막', '.pdf — 기사·보고서'].map(t => (
                <span key={t} style={{
                  fontSize: '0.7rem', padding: '0.18rem 0.6rem', borderRadius: '999px',
                  background: 'rgba(180,144,245,0.12)', color: '#b490f5',
                  border: '1px solid rgba(180,144,245,0.2)',
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
              margin: '0.7rem 0 1.5rem',
              display: 'flex', flexDirection: 'column', gap: '0.4rem',
              position: 'relative', zIndex: 2,
            }}>
              {pendingFiles.map((pf, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.7rem',
                  padding: '0.5rem 0.85rem', borderRadius: '10px',
                  backdropFilter: 'blur(8px)',
                  background: pf.status === 'error'
                    ? 'rgba(239,68,68,0.08)'
                    : pf.status === 'done'
                    ? 'rgba(94,231,223,0.07)'
                    : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${
                    pf.status === 'error' ? 'rgba(239,68,68,0.2)'
                    : pf.status === 'done' ? 'rgba(94,231,223,0.2)'
                    : 'rgba(255,255,255,0.1)'}`,
                }}>
                  <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>
                    {pf.status === 'uploading' ? '⏳'
                      : pf.status === 'done' ? '✅'
                      : pf.status === 'error' ? '❌'
                      : '📄'}
                  </span>
                  <span style={{
                    flex: 1, fontSize: '0.84rem', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: pf.status === 'error' ? '#f87171' : 'rgba(255,255,255,0.82)',
                  }}>
                    {pf.file.name}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                    {(pf.file.size / 1024).toFixed(0)} KB
                  </span>
                  {!busy && (
                    <button
                      onClick={e => { e.stopPropagation(); removeFile(i); }}
                      style={{
                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)',
                        cursor: 'pointer', fontSize: '0.82rem', padding: '0 0.2rem', flexShrink: 0,
                      }}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 주제 입력 */}
          <div style={{ marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
            <label style={{ display: 'block', fontSize: '0.77rem', color: 'rgba(255,255,255,0.38)', marginBottom: '0.4rem' }}>
              {pendingFiles.length > 0 ? '주제 (파일명에서 자동 추출, 수정 가능)' : '주제 입력'}
            </label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canStart && handleStart()}
              disabled={busy}
              placeholder={pendingFiles.length > 0 ? '파일에서 주제를 자동 추출합니다' : '예: 재벌 2세와 비서의 불륜'}
              style={{
                width: '100%', padding: '0.82rem 1rem',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(8px)',
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.97rem', outline: 'none',
                opacity: busy ? 0.5 : 1,
                boxSizing: 'border-box',
                transition: 'border-color 0.18s',
              }}
            />
          </div>

          {/* 카드 1 — 갈등 해소 방식 */}
          {worldOptions && (
            <div style={{ marginBottom: '0.75rem', position: 'relative', zIndex: 2 }}>
              <button
                onClick={() => setResolutionOpen(o => !o)}
                style={{
                  width: '100%', padding: '0.72rem 1rem',
                  backdropFilter: 'blur(8px)',
                  background: resolutionOpen ? 'rgba(94,231,223,0.07)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${resolutionOpen ? 'rgba(94,231,223,0.3)' : resolutionSelected ? 'rgba(94,231,223,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '12px', color: 'rgba(255,255,255,0.9)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: '0.88rem', fontWeight: 600, transition: 'all 0.18s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.95rem' }}>⚔️</span>
                  갈등 해소 방식
                  {resolutionSelected && !resolutionOpen && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, color: '#5ee7df',
                      background: 'rgba(94,231,223,0.12)', padding: '0.08rem 0.45rem',
                      borderRadius: '999px', border: '1px solid rgba(94,231,223,0.25)',
                    }}>
                      ✓ {worldOptions.resolution_methods.find(o => o.id === selectedOptions.resolution_method)?.label}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.32)' }}>
                  {resolutionOpen ? '▲' : '▼'}
                </span>
              </button>

              {resolutionOpen && (
                <div style={{
                  marginTop: '0.35rem',
                  border: '1px solid rgba(94,231,223,0.18)',
                  borderRadius: '12px',
                  padding: '1rem',
                  backdropFilter: 'blur(10px)',
                  background: 'rgba(94,231,223,0.03)',
                }}>
                  <p style={{ margin: '0 0 0.85rem', fontSize: '0.73rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                    결말에서 갈등이 어떤 방식으로 해소되는지 선택하세요. AI는 선택한 방식으로 6화 구조를 설계합니다.
                  </p>
                  {(['현실적', '비현실적'] as const).map(cat => {
                    const items = worldOptions.resolution_methods.filter(o => o.category === cat);
                    const accent = cat === '현실적' ? '#5ee7df' : '#b490f5';
                    return (
                      <div key={cat} style={{ marginBottom: '0.75rem' }}>
                        <div style={{
                          fontSize: '0.67rem', fontWeight: 700, color: accent,
                          marginBottom: '0.32rem', letterSpacing: '0.06em',
                          display: 'flex', alignItems: 'center', gap: '0.32rem',
                        }}>
                          <span style={{
                            width: '5px', height: '5px', borderRadius: '50%',
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
                                  padding: '0.48rem 0.55rem', borderRadius: '8px',
                                  textAlign: 'left', cursor: 'pointer',
                                  background: sel ? `rgba(${cat === '현실적' ? '94,231,223' : '180,144,245'},0.15)` : 'rgba(255,255,255,0.04)',
                                  border: `1px solid ${sel ? accent : 'rgba(255,255,255,0.08)'}`,
                                  color: sel ? '#fff' : 'rgba(255,255,255,0.58)',
                                  transition: 'all 0.15s',
                                }}
                              >
                                <div style={{ fontSize: '0.76rem', fontWeight: 600 }}>{opt.label}</div>
                                <div style={{ fontSize: '0.63rem', color: sel ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.28)', marginTop: '0.18rem', lineHeight: 1.3 }}>{opt.tension}</div>
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
            <div style={{ marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
              <button
                onClick={() => setPovOpen(o => !o)}
                style={{
                  width: '100%', padding: '0.72rem 1rem',
                  backdropFilter: 'blur(8px)',
                  background: povOpen ? 'rgba(180,144,245,0.07)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${povOpen ? 'rgba(180,144,245,0.3)' : povSelected ? 'rgba(180,144,245,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '12px', color: 'rgba(255,255,255,0.9)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: '0.88rem', fontWeight: 600, transition: 'all 0.18s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.95rem' }}>👁️</span>
                  서술 시점
                  {povSelected && !povOpen && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, color: '#b490f5',
                      background: 'rgba(180,144,245,0.12)', padding: '0.08rem 0.45rem',
                      borderRadius: '999px', border: '1px solid rgba(180,144,245,0.25)',
                    }}>
                      ✓ {worldOptions.narrative_povs.find(o => o.id === selectedOptions.narrative_pov)?.label}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.32)' }}>
                  {povOpen ? '▲' : '▼'}
                </span>
              </button>

              {povOpen && (
                <div style={{
                  marginTop: '0.35rem',
                  border: '1px solid rgba(180,144,245,0.18)',
                  borderRadius: '12px',
                  padding: '1rem',
                  backdropFilter: 'blur(10px)',
                  background: 'rgba(180,144,245,0.03)',
                }}>
                  <p style={{ margin: '0 0 0.85rem', fontSize: '0.73rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                    누구의 시선으로 이야기를 서술할지 선택하세요. 독자가 세계를 경험하는 방식이 달라집니다.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    {worldOptions.narrative_povs.map(opt => {
                      const sel = selectedOptions.narrative_pov === opt.id;
                      return (
                        <button key={opt.id}
                          onClick={() => toggleOption('narrative_pov', opt.id)}
                          style={{
                            padding: '0.7rem 0.8rem', borderRadius: '10px',
                            textAlign: 'left', cursor: 'pointer',
                            background: sel ? 'rgba(180,144,245,0.18)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${sel ? '#b490f5' : 'rgba(255,255,255,0.08)'}`,
                            color: sel ? '#fff' : 'rgba(255,255,255,0.62)',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.22rem' }}>{opt.label}</div>
                          <div style={{ fontSize: '0.68rem', color: sel ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.32)', marginBottom: '0.3rem' }}>{opt.tension}</div>
                          <div style={{ fontSize: '0.64rem', color: sel ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)', fontStyle: 'italic', lineHeight: 1.4 }}>
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
              marginBottom: '1rem', padding: '0.72rem 0.95rem', borderRadius: '10px',
              backdropFilter: 'blur(8px)',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)',
              color: '#f87171', fontSize: '0.83rem',
              position: 'relative', zIndex: 2,
            }}>
              {error}
            </div>
          )}

          {/* 시작 버튼 */}
          <button
            onClick={handleStart}
            disabled={!canStart}
            style={{
              width: '100%', padding: '0.95rem',
              background: !canStart
                ? 'rgba(180,144,245,0.25)'
                : busy
                ? 'rgba(180,144,245,0.5)'
                : 'linear-gradient(135deg, #b490f5 0%, #6366f1 100%)',
              color: canStart ? '#fff' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: '14px',
              fontSize: '1.05rem', fontWeight: 700,
              cursor: canStart ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canStart && !busy ? '0 4px 24px rgba(180,144,245,0.35)' : 'none',
              position: 'relative', zIndex: 2,
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
            <p style={{ textAlign: 'center', marginTop: '0.9rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', position: 'relative', zIndex: 2 }}>
              소스 없이 주제만 입력해도 AI가 독자적으로 세계관을 설계합니다
            </p>
          )}

          <VideoToSrtSection />
        </div>
      </main>
    </>
  );
}
