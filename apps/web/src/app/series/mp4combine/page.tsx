// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLogDB, LogLine } from '@/lib/useLogDB';

const API = 'http://localhost:8001/api/v1';

// ─── 색상 토큰 (화이트 테마) ──────────────────────────────────────────────────
const C = {
  pageBg:      '#f4f5f7',
  topBar:      'rgba(255,255,255,0.97)',
  cardBg:      '#ffffff',
  cardBorder:  'rgba(200,204,215,0.8)',
  text:        '#18181b',
  textSub:     '#3f3f46',
  textCaption: '#71717a',
  textMuted:   '#a1a1aa',
  purple:      '#7c3aed',
  purpleDk:    '#5b21b6',
  emerald:     '#059669',
  red:         '#dc2626',
  amber:       '#d97706',
  blue:        '#2563eb',
} as const;

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface Series  { id: string; title?: string; topic?: string; }
interface SceneRow {
  scene_code: string; scene_index: number; cut_index: number;
  type: string; text: string;
  bg_url: string | null; keyframe_url: string | null;
  lipsync_url: string | null; tts_url: string | null; kb_mode: string | null;
}
interface RenderResult {
  ok: boolean; output?: string; clips?: number; missing?: string[]; reason?: string;
}
interface KrMp4File {
  name: string; path: string; resolution: string; size_mb: number;
}

// ─── BgmCopyItem — 클릭 시 클립보드 복사, user-select:all ────────────────────
function BgmCopyItem({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleClick = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span
      onClick={handleClick}
      title="클릭하면 복사"
      style={{
        fontSize: 13, fontWeight: 700,
        color: copied ? '#fff' : '#065f46',
        background: copied ? '#059669' : '#f0fdf4',
        padding: '4px 14px', borderRadius: 6,
        border: `1px solid ${copied ? '#059669' : '#bbf7d0'}`,
        cursor: 'copy', userSelect: 'all',
        transition: 'background 150ms, color 150ms',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? '복사됨 ✓' : text}
    </span>
  );
}

// ─── SceneThumb ───────────────────────────────────────────────────────────────
function SceneThumb({ scene, selected, onClick }: {
  scene: SceneRow;
  selected: boolean; onClick: () => void;
}) {
  const [imgError, setImgError] = React.useState(false);
  const isHook = scene.scene_index === 0;
  const hasTts = !!scene.tts_url;
  const hasMp4 = !!(scene.kb_mode || scene.lipsync_url);
  const short  = scene.scene_code.replace(/^\d{8}_\d{6}_/, '');
  const imgSrc = scene.bg_url || scene.keyframe_url;
  const videoTag = !hasMp4
    ? '미완'
    : scene.kb_mode
      ? (scene.type === 'dialogue' ? 'K+립씽크' : 'K')
      : scene.type === 'dialogue'
        ? '립씽크'
        : 'mp4';

  return (
    <div
      onClick={onClick}
      style={{ flexShrink: 0, width: 120, cursor: 'pointer', userSelect: 'none' }}
    >
      {/* 썸네일 */}
      <div style={{
        position: 'relative', width: 120, height: 68,
        borderRadius: 6, overflow: 'hidden',
        background: '#e8eaf0',
        border: selected
          ? `2px solid ${isHook ? C.amber : C.purple}`
          : `1px solid ${isHook ? 'rgba(251,191,36,0.4)' : C.cardBorder}`,
        transition: 'border-color 120ms',
        boxShadow: selected ? `0 0 12px ${isHook ? 'rgba(251,191,36,0.35)' : 'rgba(124,58,237,0.4)'}` : 'none',
      }}>
        {/* 이미지 썸네일 — bg_url(R2 또는 로컬 PNG) 직접 사용 */}
        {imgSrc && !imgError
          ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt=""
              onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )
          : (
          <div style={{
            position: 'absolute', inset: 0,
            background: isHook
              ? 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(255,248,235,1))'
              : 'linear-gradient(135deg,rgba(124,58,237,0.08),rgba(240,242,255,1))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 9, color: C.textMuted }}>NO IMG</span>
          </div>
        )}

        {/* HOOK 뱃지 */}
        {isHook && (
          <div style={{
            position: 'absolute', top: 3, left: 3,
            background: 'rgba(245,158,11,0.92)',
            fontSize: 8, fontWeight: 900, color: '#000',
            padding: '1px 5px', borderRadius: 3, letterSpacing: 0.5,
          }}>HOOK</div>
        )}

        {/* TTS 누락 표시 */}
        {!hasTts && (
          <div style={{
            position: 'absolute', top: 3, right: 3,
            width: 6, height: 6, borderRadius: '50%', background: C.red,
            boxShadow: '0 0 4px rgba(248,113,113,0.7)',
          }} />
        )}

        {/* MP4 없음 표시 */}
        {!hasMp4 && (
          <div style={{
            position: 'absolute', bottom: 3, right: 3,
            background: 'rgba(220,38,38,0.88)',
            fontSize: 7, fontWeight: 700, color: '#fff',
            padding: '1px 4px', borderRadius: 2,
          }}>MISS</div>
        )}
      </div>

      {/* 씬 코드 */}
      <div style={{
        marginTop: 4, fontSize: 9.5, fontFamily: 'monospace',
        color: isHook ? C.amber : C.textCaption,
        textAlign: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {short}
      </div>

      {/* 태그 행 */}
      <div style={{ display: 'flex', gap: 3, justifyContent: 'center', marginTop: 3 }}>
        {/* TTS 상태 */}
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 3,
          background: hasTts ? '#f0fdf4' : '#fef2f2',
          color: hasTts ? C.emerald : C.red,
          border: `1px solid ${hasTts ? '#bbf7d0' : '#fecaca'}`,
          fontWeight: 700,
        }}>
          {hasTts ? 'TTS' : 'TTS없'}
        </span>
        {/* 영상 타입 */}
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 3,
          background: !hasMp4 ? '#fef2f2' : '#f5f3ff',
          color: !hasMp4 ? C.red : C.purple,
          border: `1px solid ${!hasMp4 ? '#fecaca' : '#ddd6fe'}`,
          fontWeight: 700,
        }}>
          {videoTag}
        </span>
      </div>
    </div>
  );
}

// ─── LogPanel ─────────────────────────────────────────────────────────────────
function LogPanel({ log, onDelete }: { log: LogLine[]; onDelete: (id: number) => void }) {
  return (
    <div style={{
      background: C.cardBg, border: `1px solid ${C.cardBorder}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{
        padding: '7px 12px', borderBottom: `1px solid ${C.cardBorder}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.purple }}>렌더 로그</span>
      </div>
      <div style={{
        maxHeight: 220, overflowY: 'auto',
        padding: '4px 0',
        fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
      }}>
        {[...log].reverse().map(entry => (
          <div
            key={entry.id}
            style={{
              display: 'flex', alignItems: 'flex-start',
              padding: '2px 10px 2px 12px',
              gap: 6,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{
              flex: 1,
              color: entry.line.startsWith('[') ? C.purple
                   : entry.line.startsWith('✓') ? C.emerald
                   : entry.line.startsWith('✗') || entry.line.startsWith('오류') ? C.red
                   : C.textCaption,
              wordBreak: 'break-all',
            }}>
              {entry.line}
            </span>
            <button
              onClick={() => onDelete(entry.id)}
              style={{
                flexShrink: 0, background: 'transparent', border: 'none',
                color: C.textMuted, fontSize: 16, cursor: 'pointer',
                padding: '0 2px', lineHeight: 1, marginTop: 1,
              }}
              title="이 항목 삭제"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
function Mp4CombineInner() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const initSid     = searchParams.get('series_id') || '';

  // 공식 라우터: ?series_id=... 필수 — 없으면 루트로 차단
  React.useEffect(() => {
    if (!initSid) router.replace('/');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [seriesList, setSeriesList]   = React.useState<Series[]>([]);
  const [seriesId, setSeriesId]       = React.useState(initSid);
  const [chapter, setChapter]         = React.useState(1);
  const [scenes, setScenes]           = React.useState<SceneRow[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [selectedCode, setSelectedCode] = React.useState<string | null>(null);
  const [rendering, setRendering]     = React.useState(false);
  const [result, setResult]           = React.useState<RenderResult | null>(null);
  const { log, addLog, deleteLog }     = useLogDB(seriesId, chapter);
  const [syncing, setSyncing]         = React.useState(false);
  const [syncMsg, setSyncMsg]         = React.useState<string | null>(null);
  const [exportLoading, setExportLoading] = React.useState(false);
  const [exportMsg, setExportMsg]     = React.useState<string | null>(null);
  const [krMp4Loading, setKrMp4Loading] = React.useState(false);
  const [krMp4Modal, setKrMp4Modal]   = React.useState<{
    open: boolean; files: KrMp4File[]; krDir: string;
  }>({ open: false, files: [], krDir: '' });
  const [krBurning, setKrBurning] = React.useState<string[]>([]);        // 진행 중인 파일명 목록
  const [krBurnResults, setKrBurnResults] = React.useState<            // 파일별 결과
    Record<string, { ok: boolean; msg: string }>
  >({});
  // 챕터 기본 추천 (컷 미선택 시)
  const [sfxRecs, setSfxRecs]         = React.useState<string[]>([]);
  const [sfxKoRecs, setSfxKoRecs]     = React.useState<string[]>([]);
  const [bgmRecs, setBgmRecs]         = React.useState<string[]>([]);
  const [audioRecLoading, setAudioRecLoading] = React.useState(false);
  // 컷 선택 시 해당 컷 전용 추천
  const [cutSfxRecs, setCutSfxRecs]   = React.useState<string[]>([]);
  const [cutSfxKoRecs, setCutSfxKoRecs] = React.useState<string[]>([]);
  const [cutBgmRecs, setCutBgmRecs]   = React.useState<string[]>([]);
  const [cutAudioLoading, setCutAudioLoading] = React.useState(false);

  const stripRef = React.useRef<HTMLDivElement>(null);

  // 시리즈 목록 로드
  React.useEffect(() => {
    fetch(`${API}/series`).then(r => r.json()).then(setSeriesList).catch(() => {});
  }, []);

  // 씬 로드 (수동 재로드용 — handleSync 등에서 직접 호출)
  async function loadScenes() {
    if (!seriesId) return;
    setLoading(true); setResult(null);
    try {
      const r = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/local-scenes`);
      setScenes(await r.json());
    } catch { setScenes([]); } finally { setLoading(false); }
  }

  // AbortController로 StrictMode 이중 실행 방지
  React.useEffect(() => {
    if (!seriesId) return;
    const ac = new AbortController();
    setLoading(true); setResult(null);
    setSfxRecs([]); setSfxKoRecs([]); setBgmRecs([]);

    fetch(`${API}/series/${seriesId}/chapters/${chapter}/local-scenes`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (!ac.signal.aborted) setScenes(d); })
      .catch(e => { if (!ac.signal.aborted && e.name !== 'AbortError') setScenes([]); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });

    setAudioRecLoading(true);
    fetch(`${API}/series/${seriesId}/chapters/${chapter}/recommend-audio`, { method: 'POST', signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (!ac.signal.aborted) { setSfxRecs(d.sfx || []); setSfxKoRecs(d.sfx_ko || []); setBgmRecs(d.bgm || []); } })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setAudioRecLoading(false); });

    return () => ac.abort();
  }, [seriesId, chapter]); // eslint-disable-line

  // 컷 선택 시 해당 컷 전용 추천 효과음/BGM 업데이트
  React.useEffect(() => {
    if (!seriesId || !selectedCode) {
      setCutSfxRecs([]); setCutSfxKoRecs([]); setCutBgmRecs([]);
      return;
    }
    const ac = new AbortController();
    setCutAudioLoading(true);
    fetch(`${API}/series/${seriesId}/chapters/${chapter}/scenes/${selectedCode}/recommend-audio`,
      { method: 'POST', signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (!ac.signal.aborted) { setCutSfxRecs(d.sfx || []); setCutSfxKoRecs(d.sfx_ko || []); setCutBgmRecs(d.bgm || []); } })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setCutAudioLoading(false); });
    return () => ac.abort();
  }, [selectedCode]); // eslint-disable-line

  // KR 합성 — 16:9·9:16 동시 요청
  async function handleRender() {
    if (!seriesId || rendering) return;
    setRendering(true); setResult(null);
    const ts = () => new Date().toLocaleTimeString();
    addLog(`[${ts()}] KR 합성 시작 — ch${String(chapter).padStart(2,'0')} (16:9 + 9:16 동시)`);

    const call = (res: '16:9' | '9:16') =>
      fetch(`${API}/series/${seriesId}/chapters/${chapter}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: res }),
      }).then(r => r.json() as Promise<RenderResult>);

    try {
      const [r169, r916] = await Promise.allSettled([call('16:9'), call('9:16')]);

      let anyOk = false;
      let lastData: RenderResult | null = null;

      for (const [label, settled] of [['16:9', r169], ['9:16', r916]] as const) {
        if (settled.status === 'fulfilled') {
          const data = settled.value;
          lastData = data;
          if (data.ok) {
            anyOk = true;
            addLog(`[${ts()}] ✓ ${label} 완료 — ${data.clips}클립`);
            const langOuts = (data as any).lang_outputs as Record<string, string> | undefined;
            if (langOuts) {
              Object.entries(langOuts).forEach(([lang, p]) => addLog(`  ${lang.toUpperCase()}: ${p}`));
            } else if (data.output) {
              addLog(`  출력: ${data.output}`);
            }
            if (data.missing?.length) {
              addLog(`  누락: ${data.missing.slice(0, 5).join(', ')}${data.missing.length > 5 ? '...' : ''}`);
            }
          } else {
            addLog(`[${ts()}] ✗ ${label} 실패 — ${data.reason}`);
          }
        } else {
          addLog(`[${ts()}] ✗ ${label} 오류 — ${settled.reason}`);
        }
      }

      setResult(anyOk
        ? { ok: true, ...(lastData ?? {}) }
        : { ok: false, reason: '16:9·9:16 모두 실패' });
    } catch (e) {
      const msg = String(e);
      addLog(`오류: ${msg}`);
      setResult({ ok: false, reason: msg });
    } finally { setRendering(false); }
  }

  // 동기화
  async function handleSync() {
    if (!seriesId || syncing) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/sync-to-r2`, { method: 'POST' });
      const data = await r.json();
      setSyncMsg(data.ok ? `R2 ${data.uploaded}개 완료${data.errors?.length ? ` (오류 ${data.errors.length}개)` : ''}` : `실패: ${data.reason}`);
      await loadScenes();
    } catch { setSyncMsg('동기화 실패'); } finally { setSyncing(false); }
  }

  // EN/JP SRT 생성 (prepare-export)
  async function handleExport() {
    if (!seriesId || exportLoading) return;
    setExportLoading(true); setExportMsg(null);
    try {
      const r = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/prepare-export`, { method: 'POST' });
      const data = await r.json();
      setExportMsg(data.ok ? `kr/en/jp SRT 저장 완료 → ${data.output_dir || ''}` : `실패: ${data.detail || r.status}`);
    } catch { setExportMsg('실패'); } finally { setExportLoading(false); }
  }

  async function handleKrSubtitle() {
    if (!seriesId || krMp4Loading) return;
    setKrMp4Loading(true);
    setKrBurning([]);
    setKrBurnResults({});
    try {
      const r = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/kr-mp4-list`);
      const data = await r.json();
      setKrMp4Modal({ open: true, files: data.files || [], krDir: data.kr_dir || '' });
    } catch {
      alert('KR MP4 목록 조회 실패');
    } finally {
      setKrMp4Loading(false);
    }
  }

  async function handleBurnSubtitle(filename: string) {
    if (!seriesId || krBurning.includes(filename)) return;
    setKrBurning(prev => [...prev, filename]);
    setKrBurnResults(prev => { const n = { ...prev }; delete n[filename]; return n; });
    addLog(`[${new Date().toLocaleTimeString()}] KR 자막 합성 시작 — ${filename}`);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10 * 60 * 1000);
    // keyframe cut=0에서 설정한 자막 스타일 읽기
    const subtitleSettings = {
      font_name:   localStorage.getItem('ld_subtitle_font') || 'NotoSerifKR-Regular',
      subtitle_y:  parseInt(localStorage.getItem('ld_subtitle_y') || '80', 10),
      subtitle_bg: localStorage.getItem('ld_subtitle_bg') === '1',
    };
    addLog(`[${new Date().toLocaleTimeString()}]  폰트: ${subtitleSettings.font_name} | Y: ${subtitleSettings.subtitle_y} | 배경: ${subtitleSettings.subtitle_bg ? 'ON' : 'OFF'}`);
    try {
      const r = await fetch(
        `${API}/series/${seriesId}/chapters/${chapter}/burn-subtitles`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mp4_filename: filename, ...subtitleSettings }),
          signal: ac.signal,
        }
      );
      clearTimeout(timer);
      const data = await r.json();
      if (!r.ok) {
        const errMsg = data.detail || '번인 실패';
        setKrBurnResults(prev => ({ ...prev, [filename]: { ok: false, msg: errMsg } }));
        addLog(`[${new Date().toLocaleTimeString()}] ✗ 자막 합성 실패 — ${errMsg}`);
      } else {
        setKrBurnResults(prev => ({ ...prev, [filename]: { ok: true, msg: `완료 — ${data.size_mb} MB` } }));
        addLog(`[${new Date().toLocaleTimeString()}] ✓ 자막 합성 완료 — ${filename} (${data.size_mb} MB)`);
        const lr = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/kr-mp4-list`);
        const ld = await lr.json();
        setKrMp4Modal(m => ({ ...m, files: ld.files || [] }));
      }
    } catch (e: unknown) {
      clearTimeout(timer);
      const msg = e instanceof Error && e.name === 'AbortError'
        ? '타임아웃 (10분 초과) — 서버에서 계속 처리 중일 수 있습니다'
        : String(e);
      setKrBurnResults(prev => ({ ...prev, [filename]: { ok: false, msg } }));
      addLog(`[${new Date().toLocaleTimeString()}] ✗ 자막 합성 오류 — ${msg}`);
    } finally {
      setKrBurning(prev => prev.filter(n => n !== filename));
    }
  }

  function scrollStrip(dir: 'left' | 'right') {
    stripRef.current?.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
  }

  const totalCuts = scenes.length;
  const mp4Count  = scenes.filter(s => s.kb_mode || s.lipsync_url).length;

  // 공용 버튼 스타일
  const btnBase: React.CSSProperties = {
    height: 38, borderRadius: 8, border: 'none',
    cursor: 'pointer', fontWeight: 700, fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 18px', transition: 'all 150ms',
    whiteSpace: 'nowrap',
  };
  const selectStyle: React.CSSProperties = {
    background: '#ffffff',
    border: `1px solid ${C.cardBorder}`,
    borderRadius: 8, color: C.text,
    padding: '6px 12px', fontSize: 13,
    cursor: 'pointer', outline: 'none',
  };

  return (
    <>
      {/* KR 자막 합성 — 대상 선택 모달 */}
      {krMp4Modal.open && (
        <div
          onClick={() => setKrMp4Modal(m => ({ ...m, open: false }))}
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14,
              padding: '24px 28px', minWidth: 400, maxWidth: 560,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            {/* 헤더 */}
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: C.purple }}>KR 자막 합성</span>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 20,
                background: '#f5f3ff', color: C.purple, border: '1px solid #ddd6fe', fontWeight: 700,
              }}>
                CH{String(chapter).padStart(2, '0')}
              </span>
            </div>

            {/* kr 폴더 경로 */}
            <div style={{
              fontSize: 10, fontFamily: 'monospace', color: C.textMuted,
              background: '#f4f5f7', padding: '5px 10px', borderRadius: 6,
              marginBottom: 16, wordBreak: 'break-all',
            }}>
              {krMp4Modal.krDir}
            </div>

            {/* 파일 없음 */}
            {krMp4Modal.files.length === 0 ? (
              <div style={{
                padding: '20px 0', textAlign: 'center',
                color: C.red, fontSize: 13, fontWeight: 700,
              }}>
                kr 폴더에 MP4 파일이 없습니다.
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, fontWeight: 400 }}>
                  먼저 KR 합성 시작을 실행하세요.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.textSub, marginBottom: 12 }}>
                  {krMp4Modal.files.length === 2
                    ? '16:9 · 9:16 두 파일이 모두 있습니다. 자막을 합성할 파일을 선택하세요.'
                    : '자막을 합성할 파일을 선택하세요.'}
                </div>

                {/* 파일 목록 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {krMp4Modal.files.map(f => {
                    const isBurning = krBurning.includes(f.name);
                    const result    = krBurnResults[f.name];
                    return (
                      <div key={f.path} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{
                          border: `1px solid ${isBurning ? C.purple : result ? (result.ok ? '#bbf7d0' : '#fecaca') : C.cardBorder}`,
                          borderRadius: 8, padding: '10px 14px',
                          display: 'flex', alignItems: 'center', gap: 12,
                          background: isBurning ? 'rgba(124,58,237,0.04)' : '#fff',
                          transition: 'all 150ms',
                        }}>
                          {/* 해상도 뱃지 */}
                          <span style={{
                            fontSize: 11, fontWeight: 900, padding: '3px 9px',
                            borderRadius: 6,
                            background: f.resolution === '16:9' ? '#eff6ff' : '#fdf4ff',
                            color: f.resolution === '16:9' ? C.blue : C.purple,
                            border: `1px solid ${f.resolution === '16:9' ? '#bfdbfe' : '#e9d5ff'}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {f.resolution}
                          </span>

                          {/* 파일명 + 크기 */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 700, color: C.text,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {f.name}
                            </div>
                            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                              {f.size_mb} MB
                            </div>
                          </div>

                          {/* 자막 번인 버튼 */}
                          <button
                            onClick={() => handleBurnSubtitle(f.name)}
                            disabled={isBurning}
                            style={{
                              ...btnBase,
                              height: 32, fontSize: 12, padding: '0 14px',
                              background: isBurning
                                ? 'rgba(124,58,237,0.3)'
                                : 'linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%)',
                              color: '#fff',
                              boxShadow: isBurning ? 'none' : '0 2px 8px rgba(124,58,237,0.35)',
                              cursor: isBurning ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isBurning ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{
                                  width: 10, height: 10, borderRadius: '50%',
                                  border: '2px solid rgba(255,255,255,0.4)',
                                  borderTopColor: '#fff',
                                  animation: 'spin 0.7s linear infinite',
                                  display: 'inline-block',
                                }} />
                                번인 중...
                              </span>
                            ) : '자막 합성'}
                          </button>
                        </div>
                        {/* 파일별 인라인 결과 메시지 */}
                        {result && (
                          <div style={{
                            padding: '5px 10px', borderRadius: 6,
                            fontSize: 11, fontWeight: 700,
                            background: result.ok ? '#f0fdf4' : '#fef2f2',
                            border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`,
                            color: result.ok ? C.emerald : C.red,
                          }}>
                            {result.ok ? `✓ ${result.msg}` : `✗ ${result.msg}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 닫기 */}
            <button
              onClick={() => {
                setKrMp4Modal(m => ({ ...m, open: false }));
                setKrBurnResults({});
              }}
              style={{
                width: '100%', height: 36, borderRadius: 8,
                border: `1px solid ${C.cardBorder}`,
                background: '#f4f5f7', color: C.textSub,
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* spin 애니메이션 */}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{
        minHeight: '100vh', background: C.pageBg, color: C.text,
        fontFamily: "'Pretendard Variable','Apple SD Gothic Neo',sans-serif",
      }}>

        {/* ══ TOP BAR ════════════════════════════════════════════════════════ */}
        <div style={{
          background: C.topBar,
          borderBottom: `1px solid ${C.cardBorder}`,
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 100,
        }}>
          {/* 제목 */}
          <h1 style={{
            margin: 0, fontSize: 19, fontWeight: 900,
            color: C.purple, letterSpacing: -0.3, marginRight: 6,
          }}>MP4 합성</h1>

          {/* 시리즈 선택 */}
          <select value={seriesId} onChange={e => setSeriesId(e.target.value)}
            style={{ ...selectStyle, minWidth: 160 }}>
            <option value="">시리즈 선택</option>
            {seriesList.map(s => (
              <option key={s.id} value={s.id}>{s.title || s.topic || s.id.slice(0, 8)}</option>
            ))}
          </select>

          {/* 챕터 */}
          <select value={chapter} onChange={e => setChapter(Number(e.target.value))}
            style={{ ...selectStyle, width: 90 }}>
            {[1,2,3,4,5,6].map(n => (
              <option key={n} value={n}>CH{String(n).padStart(2,'0')}</option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          {/* 로컬-R2 동기화 */}
          <button onClick={handleSync} disabled={!seriesId || syncing} style={{
            ...btnBase,
            background: '#f1f3f7',
            color: syncing ? C.textMuted : C.textSub,
            border: `1px solid ${C.cardBorder}`,
            opacity: (!seriesId || syncing) ? 0.5 : 1,
          }}>
            {syncing ? '⟳ 동기화...' : '☁ 로컬-R2 동기화'}
          </button>

          {/* KR 합성 시작 */}
          <button onClick={handleRender}
            disabled={!seriesId || scenes.length === 0 || rendering}
            style={{
              ...btnBase,
              background: rendering
                ? 'rgba(37,99,235,0.35)'
                : 'linear-gradient(135deg,#1d4ed8 0%,#60a5fa 100%)',
              color: '#fff',
              opacity: (!seriesId || scenes.length === 0 || rendering) ? 0.5 : 1,
              boxShadow: rendering ? 'none' : '0 4px 18px rgba(37,99,235,0.4)',
              fontSize: 14, padding: '0 24px',
            }}
          >
            {rendering ? '⟳ 합성 중...' : '영상 조립 시작'}
          </button>
        </div>

        {/* ══ BODY ═══════════════════════════════════════════════════════════ */}
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 20px 40px' }}>

          {/* ── 씬 필름스트립 ───────────────────────────────────────────── */}
          <div style={{
            background: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 12, padding: '14px 0', marginBottom: 12,
            position: 'relative',
          }}>
            {/* 왼쪽 화살표 */}
            <button onClick={() => scrollStrip('left')} style={{
              position: 'absolute', left: 4, top: '42%',
              transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(255,255,255,0.95)',
              border: `1px solid ${C.cardBorder}`,
              borderRadius: 6, color: C.textSub,
              width: 28, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 13,
            }}>◀</button>

            {/* 스트립 */}
            <div ref={stripRef} style={{
              display: 'flex', gap: 10,
              overflowX: 'auto', overflowY: 'visible',
              paddingLeft: 40, paddingRight: 40, paddingBottom: 4,
              scrollbarWidth: 'none',
            }}>
              {loading ? (
                <div style={{
                  width: '100%', padding: '20px 0',
                  textAlign: 'center', color: C.textMuted, fontSize: 12,
                }}>
                  ⟳ 씬 로딩 중...
                </div>
              ) : !seriesId ? (
                <div style={{
                  width: '100%', padding: '20px 0',
                  textAlign: 'center', color: C.textMuted, fontSize: 12,
                }}>
                  시리즈를 선택하세요
                </div>
              ) : scenes.length === 0 ? (
                <div style={{
                  width: '100%', padding: '20px 0',
                  textAlign: 'center', color: C.textMuted, fontSize: 12,
                }}>
                  씬 없음 — 파이프라인을 먼저 실행하세요
                </div>
              ) : scenes.map((s, i) => (
                <SceneThumb
                  key={`${s.scene_code}-${i}`}
                  scene={s}
                  selected={selectedCode === s.scene_code}
                  onClick={() => setSelectedCode(
                    selectedCode === s.scene_code ? null : s.scene_code
                  )}
                />
              ))}
            </div>

            {/* 오른쪽 화살표 */}
            <button onClick={() => scrollStrip('right')} style={{
              position: 'absolute', right: 4, top: '42%',
              transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(255,255,255,0.95)',
              border: `1px solid ${C.cardBorder}`,
              borderRadius: 6, color: C.textSub,
              width: 28, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 13,
            }}>▶</button>
          </div>

          {/* ── 추천 효과음 / BGM ──────────────────────────────────────────── */}
          {(() => {
            const isCut     = !!selectedCode;
            const loading   = isCut ? cutAudioLoading : audioRecLoading;
            const dispSfx   = isCut ? cutSfxRecs : sfxRecs;
            const dispSfxKo = isCut ? cutSfxKoRecs : sfxKoRecs;
            const dispBgm   = isCut ? cutBgmRecs : bgmRecs;
            const cutLabel  = isCut
              ? selectedCode.replace(/^\d{8}_\d{6}_/, '')
              : '챕터 전체';
            return (
              <div style={{
                background: C.cardBg,
                border: `1px solid ${isCut ? 'rgba(124,58,237,0.35)' : C.cardBorder}`,
                borderRadius: 12, overflow: 'hidden', marginBottom: 12,
                transition: 'border-color 200ms',
              }}>
                {/* 헤더 */}
                <div style={{
                  padding: '5px 16px',
                  background: isCut ? 'rgba(124,58,237,0.06)' : 'transparent',
                  borderBottom: `1px solid ${C.cardBorder}`,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 10, color: isCut ? C.purple : C.textMuted, fontWeight: 700 }}>
                    추천 오디오
                  </span>
                  <span style={{
                    fontSize: 9, padding: '1px 7px', borderRadius: 20,
                    background: isCut ? '#f5f3ff' : '#f4f5f7',
                    color: isCut ? C.purple : C.textCaption,
                    border: `1px solid ${isCut ? '#ddd6fe' : C.cardBorder}`,
                    fontWeight: 600,
                  }}>
                    {cutLabel}
                  </span>
                  {loading && <span style={{ fontSize: 9, color: C.textMuted, fontStyle: 'italic' }}>분석 중...</span>}
                </div>

                {/* 추천 효과음 */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  padding: '8px 16px',
                  borderBottom: `1px solid ${C.cardBorder}`,
                  gap: 8, flexWrap: 'wrap', minHeight: 38,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textCaption, whiteSpace: 'nowrap', width: 64, flexShrink: 0 }}>효과음</span>
                  {loading ? null : dispSfx.length === 0 ? (
                    <span style={{ fontSize: 11, color: C.textMuted }}>—</span>
                  ) : dispSfx.map((sfx, i) => (
                    <a key={i} href={`https://freesound.org/search/?q=${encodeURIComponent(sfx)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        fontSize: 11, fontWeight: 600, color: '#7c3aed', background: '#f5f3ff',
                        padding: '3px 10px', borderRadius: 5, border: '1px solid #ddd6fe',
                        textDecoration: 'none', cursor: 'pointer', transition: 'background 120ms',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#ede9fe')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#f5f3ff')}
                    >
                      {sfx}
                      {dispSfxKo[i] && (
                        <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 500 }}>
                          {dispSfxKo[i]}
                        </span>
                      )}
                    </a>
                  ))}
                </div>

                {/* 추천 BGM — 씬 기준, 복사 편의 텍스트 */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  padding: '8px 16px',
                  gap: 8, flexWrap: 'wrap', minHeight: 38,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textCaption, whiteSpace: 'nowrap', width: 64, flexShrink: 0 }}>BGM</span>
                  {loading ? null : dispBgm.length === 0 ? (
                    <span style={{ fontSize: 11, color: C.textMuted }}>—</span>
                  ) : dispBgm.map((bgm, i) => (
                    <BgmCopyItem key={i} text={bgm} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── 통계 + 액션 버튼 ────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 8, flexWrap: 'wrap',
          }}>
            {/* 전체 컷 */}
            <div style={{
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              borderRadius: 10, padding: '7px 16px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 11, color: C.textCaption }}>전체 컷</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.purple, lineHeight: 1 }}>
                {totalCuts}
              </span>
            </div>

            {/* MP4 개수 */}
            <div style={{
              background: C.cardBg, border: `1px solid ${C.cardBorder}`,
              borderRadius: 10, padding: '7px 16px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 11, color: C.textCaption }}>MP4 개수</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.emerald, lineHeight: 1 }}>
                {mp4Count}
              </span>
            </div>

            <div style={{ flex: 1 }} />

            {/* KR 자막 합성 */}
            <button onClick={handleKrSubtitle} disabled={!seriesId || krMp4Loading} style={{
              ...btnBase,
              background: krMp4Loading ? 'rgba(124,58,237,0.3)' : 'linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%)',
              color: '#fff',
              opacity: (!seriesId || krMp4Loading) ? 0.55 : 1,
              boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
            }}>
              {krMp4Loading ? '⟳ 조회 중...' : 'KR 자막 합성'}
            </button>

            {/* EN SRT 생성 */}
            <button onClick={handleExport} disabled={!seriesId || exportLoading} style={{
              ...btnBase,
              background: exportLoading ? 'rgba(37,99,235,0.3)' : 'rgba(37,99,235,0.9)',
              color: '#fff',
              opacity: (!seriesId || exportLoading) ? 0.55 : 1,
              boxShadow: '0 2px 10px rgba(37,99,235,0.3)',
            }}>
              {exportLoading ? '⟳ 생성 중...' : 'EN- SRT 생성'}
            </button>

            {/* JP SRT 생성 */}
            <button onClick={handleExport} disabled={!seriesId || exportLoading} style={{
              ...btnBase,
              background: exportLoading ? 'rgba(185,28,28,0.3)' : 'rgba(185,28,28,0.9)',
              color: '#fff',
              opacity: (!seriesId || exportLoading) ? 0.55 : 1,
              boxShadow: '0 2px 10px rgba(185,28,28,0.3)',
            }}>
              JP- SRT 생성
            </button>

            {/* EN MP3 생성 (미구현) */}
            <button disabled title="준비 중" style={{
              ...btnBase,
              background: '#f1f3f7',
              color: C.textSub,
              border: `1px solid ${C.cardBorder}`,
              cursor: 'not-allowed', opacity: 0.65,
            }}>
              EN- MP3생성
            </button>

            {/* JP MP3 생성 (미구현) */}
            <button disabled title="준비 중" style={{
              ...btnBase,
              background: '#fff7ed',
              color: '#92400e',
              border: '1px solid #fed7aa',
              cursor: 'not-allowed', opacity: 0.7,
            }}>
              JP- MP3생성
            </button>
          </div>

          {/* 동기화 메시지 */}
          {syncMsg && (
            <div style={{
              marginTop: 10, padding: '8px 14px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 8, fontSize: 12, color: C.amber,
            }}>{syncMsg}</div>
          )}

          {/* 내보내기 메시지 */}
          {exportMsg && (
            <div style={{
              marginTop: 10, padding: '8px 14px',
              background: exportMsg.includes('완료') ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${exportMsg.includes('완료') ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: 8, fontSize: 12,
              color: exportMsg.includes('완료') ? C.emerald : C.red,
              wordBreak: 'break-all',
            }}>{exportMsg}</div>
          )}

          {/* 합성 결과 */}
          {result && (
            <div style={{
              marginTop: 14,
              background: result.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: 12, padding: '14px 18px',
            }}>
              <div style={{
                fontSize: 14, fontWeight: 800,
                color: result.ok ? C.emerald : C.red,
                marginBottom: 6,
              }}>
                {result.ok ? '✓ 합성 완료' : '✗ 합성 실패'}
              </div>
              {result.ok ? (
                <div style={{ fontSize: 12, color: C.textSub }}>
                  <span style={{ fontWeight: 700, color: C.text }}>{result.clips}</span>개 클립 합성
                  {' → '}
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.textMuted }}>
                    {result.output}
                  </span>
                  {result.missing && result.missing.length > 0 && (
                    <span style={{ color: C.amber, marginLeft: 10 }}>
                      누락 {result.missing.length}컷
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.red }}>{result.reason}</div>
              )}
            </div>
          )}

          {/* 렌더 로그 */}
          {log.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <LogPanel log={log} onDelete={deleteLog} />
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default function Mp4CombinePage() {
  return (
    <React.Suspense fallback={null}>
      <Mp4CombineInner />
    </React.Suspense>
  );
}
