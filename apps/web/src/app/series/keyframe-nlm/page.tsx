'use client';

import React from 'react';

const API = 'http://localhost:8001/api/v1';

interface SeriesSummary {
  id: string;
  title?: string;
  topic?: string;
  world_data?: {
    charAName?: string;
    charBName?: string;
    genre?: string;
    style?: string;
  };
}

interface SceneParsed {
  index: number;       // 컷 순서 (1-based)
  sceneIndex: number;  // 씬 번호 (context용)
  cutIndex: number;    // 씬 내 컷 번호
  sceneCode: string;
  text: string;
  imageHint: string;
  isHook: boolean;
  estimatedSec: number;
  imageUrl: string;
  status: string;
}

const SUBTITLE_STEP = 5;

function ctrlBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: 8,
    background: 'rgba(30,20,60,0.72)',
    backdropFilter: 'blur(8px)',
    border: `1px solid rgba(124,58,237,${disabled ? '0.12' : '0.4'})`,
    color: disabled ? 'rgba(167,139,250,0.2)' : '#a78bfa',
    fontSize: 12, fontWeight: 900,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'all 0.15s',
  };
}

export default function KeyframeNlmPage() {
  // ── 시리즈 ────────────────────────────────────────────────────────────────
  const [seriesList, setSeriesList]   = React.useState<SeriesSummary[]>([]);
  const [seriesId, setSeriesId]       = React.useState('');
  const [seriesInfo, setSeriesInfo]   = React.useState<SeriesSummary | null>(null);

  // ── 씬/UI 상태 ──────────────────────────────────────────────────────────
  const [scenes, setScenes]             = React.useState<SceneParsed[]>([]);
  const [artStyle]                      = React.useState('애니풍');
  const [selectedIdx, setSelectedIdx]   = React.useState(0);
  const [subtitleY, setSubtitleY]       = React.useState(80);
  const [subtitleBg, setSubtitleBg]     = React.useState(false);
  const [isPlaying, setIsPlaying]       = React.useState(false);
  const [loadingResult, setLoadingResult] = React.useState(false);
  const [folders, setFolders]           = React.useState<{ folder: string; db_series_id?: string; frame_count: number; created_at?: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = React.useState('');
  const [generating, setGenerating]     = React.useState(false);
  const [genStatus, setGenStatus]       = React.useState('');
  const [regenLoading, setRegenLoading] = React.useState(false);
  const [nbStatuses, setNbStatuses]     = React.useState<{label:string; status:string}[]>([]);
  const [selectedNb, setSelectedNb]     = React.useState<string | null>(null);  // 선택된 노트북 앱 label
  const [nbAssignments, setNbAssignments] = React.useState<Record<string, {status:string; cuts:string; batch:number}>>({});
  const nbPollRef   = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [ttsLoading, setTtsLoading]     = React.useState(false);
  const [ttsUrl, setTtsUrl]             = React.useState<string | null>(null);
  const [displayText, setDisplayText]   = React.useState('');
  const [imgAnim, setImgAnim]           = React.useState<'zoom' | 'slide' | null>(null);

  const audioRef        = React.useRef<HTMLAudioElement | null>(null);
  const charTimerRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const playTimerRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const knownFrames     = React.useRef<Set<string>>(new Set());
  const autoSelectedRef = React.useRef(false);  // 첫 이미지 자동 선택 완료 여부

  // ── 시리즈 목록 로드 ──────────────────────────────────────────────────────
  React.useEffect(() => {
    fetch(`${API}/series`)
      .then(r => r.ok ? r.json() : [])
      .then((list: SeriesSummary[]) => {
        setSeriesList(list);
        if (list.length === 1) setSeriesId(list[0].id);
      })
      .catch(() => {});
  }, []);

  // ── 시리즈 선택 시 데이터 로드 ────────────────────────────────────────────
  React.useEffect(() => {
    if (!seriesId) return;
    fetch(`${API}/series/${seriesId}`)
      .then(r => r.ok ? r.json() : null)
      .then(s => { if (s) setSeriesInfo(s); })
      .catch(() => {});

    setScenes([]); setSelectedIdx(0);
    knownFrames.current.clear();
    loadAll(seriesId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const loadAll = async (sid: string) => {
    setLoadingResult(true);
    try {
      // 1. 컷 로드 (챕터1) — 씬 그룹화 없이 컷 단위 그대로
      const sRes = await fetch(`${API}/series/${sid}/chapters/1/scenes`).catch(() => null);
      if (sRes?.ok) {
        const cuts: { scene_index: number; scene_code: string; cut_index: number; is_hook: boolean; text: string; image_hint: string }[] = await sRes.json();
        const list: SceneParsed[] = cuts.map((c, i) => ({
          index: i + 1,
          sceneIndex: c.scene_index,
          cutIndex: c.cut_index,
          sceneCode: c.scene_code,
          text: c.text || '',
          imageHint: c.image_hint || '',
          isHook: c.is_hook,
          estimatedSec: Math.max(2, (c.text || '').length / 8),
          imageUrl: '',
          status: 'pending',
        }));
        setScenes(list);
      }

      // 2. 폴더 목록
      const fRes = await fetch(`${API}/keyframe-nlm/folders`).catch(() => null);
      if (fRes?.ok) {
        const all: typeof folders = await fRes.json();
        const mine   = all.filter(f => f.db_series_id === sid);
        const others = all.filter(f => f.db_series_id !== sid);
        const merged = [...mine, ...others];
        setFolders(merged);
        if (mine.length > 0) {
          setSelectedFolder(mine[0].folder);
          applyFolder(mine[0].folder);
        }
      }
    } finally {
      setLoadingResult(false);
    }
  };

  // ── 폴더 이미지 적용 ────────────────────────────────────────────────────
  const applyFolder = async (folder: string) => {
    const res = await fetch(`${API}/keyframe-nlm/folder/${encodeURIComponent(folder)}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    if (data.frames?.length) injectFrames(data.frames);
  };

  const prevFolderRef = React.useRef('');
  React.useEffect(() => {
    if (!selectedFolder || selectedFolder === prevFolderRef.current) return;
    prevFolderRef.current = selectedFolder;
    applyFolder(selectedFolder);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder]);

  // ── 이미지 주입 (sceneCode 기준) ────────────────────────────────────────
  const injectFrames = React.useCallback((frames: string[]) => {
    const newOnes = frames.filter(f => !knownFrames.current.has(f));
    if (!newOnes.length) return;
    newOnes.forEach(f => knownFrames.current.add(f));
    setScenes(prev => {
      const next = [...prev];
      newOnes.forEach(url => {
        const fileParam = new URLSearchParams(url.split('?')[1] ?? '').get('file') ?? '';
        const code = fileParam.replace(/\.(png|jpg|jpeg)$/i, '');
        const idx = next.findIndex(s => s.sceneCode === code);
        if (idx >= 0) next[idx] = { ...next[idx], imageUrl: `${API}${url}`, status: 'done' };
      });
      return next;
    });
  }, []);

  // ── 폴링 ─────────────────────────────────────────────────────────────────
  const stopPoll = React.useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);
  React.useEffect(() => () => stopPoll(), [stopPoll]);

  // ── 노트북 상태 폴링 (생성 중에만 5초 간격) ──────────────────────────────
  const stopNbPoll = React.useCallback(() => {
    if (nbPollRef.current) { clearInterval(nbPollRef.current); nbPollRef.current = null; }
  }, []);

  const fetchNbStatuses = React.useCallback(async () => {
    try {
      const res = await fetch(`${API}/keyframe-nlm/notebook-status`);
      if (!res.ok) return;
      const data: {label:string; status:string}[] = await res.json();
      setNbStatuses(data);
      // 모든 노트북이 idle/completed/failed 이면 폴링 중단
      const allDone = data.every(nb => ['idle','completed','failed','error'].includes(nb.status));
      if (allDone) stopNbPoll();
    } catch { /* ignore */ }
  }, [stopNbPoll]);

  React.useEffect(() => {
    if (generating) {
      fetchNbStatuses();  // 즉시 1회 조회
      nbPollRef.current = setInterval(fetchNbStatuses, 5000);
    } else {
      stopNbPoll();
    }
    return stopNbPoll;
  }, [generating, fetchNbStatuses, stopNbPoll]);

  // ── 폴링 시작 (대본 페이지에서 job_id와 함께 넘어오거나 내부 호출) ────────
  const startPolling = React.useCallback((jobId: string, sid: string) => {
    stopPoll();
    let consecutiveErrors = 0;
    pollTimerRef.current = setInterval(async () => {
      try {
        const sRes = await fetch(`${API}/keyframe-nlm/status/${jobId}`);
        if (!sRes.ok) throw new Error(`HTTP ${sRes.status}`);
        const job = await sRes.json();
        consecutiveErrors = 0;

        setGenStatus(job.message ?? '');
        if (job.frames?.length) injectFrames(job.frames);
        if (job.nb_assignments) setNbAssignments(job.nb_assignments);

        if (job.status === 'done') {
          stopPoll(); setGenerating(false);
          setGenStatus(`완료 — ${job.frames?.length ?? 0}장`);
          if (sid) loadAll(sid);
        } else if (job.status === 'error') {
          stopPoll(); setGenerating(false);
          setGenStatus(`오류: ${job.error ?? '알 수 없음'}`);
        }
      } catch {
        consecutiveErrors++;
        // 5회 연속 실패 시 폴링 중단
        if (consecutiveErrors >= 5) {
          stopPoll(); setGenerating(false);
          setGenStatus('서버 연결 끊김 — 폴링 중단');
        }
      }
    }, 2000);  // 2초마다 — 이미지 실시간 반영
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPoll, injectFrames]);

  // ── NLM 재생성 (초기화 상태 노트북에 프롬프트 일괄 주입) ─────────────────
  const handleRegen = React.useCallback(async () => {
    if (!seriesId || regenLoading || generating) return;
    setRegenLoading(true);
    try {
      const res = await fetch(
        `${API}/keyframe-nlm/start/${seriesId}?chapter=1&art_style=${encodeURIComponent(artStyle)}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const jobId: string = data.job_id ?? '';
      if (!jobId) throw new Error('job_id 없음');

      // 이전 폴링 초기화 후 재시작
      knownFrames.current.clear();
      autoSelectedRef.current = false;
      setNbAssignments({});
      setGenerating(true);
      setGenStatus('재생성 중...');
      startPolling(jobId, seriesId);
    } catch (e) {
      console.error('[Regen]', e);
      setGenStatus(`재생성 실패: ${e instanceof Error ? e.message : '알 수 없음'}`);
    } finally {
      setRegenLoading(false);
    }
  }, [seriesId, regenLoading, generating, artStyle, startPolling]);

  // ── URL 파라미터 읽기 (대본 페이지 → 이 페이지로 넘어올 때) ─────────────
  // 대본 페이지: router.push(`/series/keyframe-nlm?series_id=${sid}&job_id=${jid}`)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('series_id');
    const jid = params.get('job_id');
    if (sid) setSeriesId(sid);
    if (jid) {
      setGenerating(true);
      setGenStatus('생성 중...');
      startPolling(jid, sid ?? '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 슬라이드쇼 ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!isPlaying || !scenes.length) return;
    const sec = Math.max(2, scenes[selectedIdx]?.estimatedSec ?? 4);
    playTimerRef.current = setTimeout(() => {
      setSelectedIdx(i => {
        if (i >= scenes.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, sec * 1000);
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  }, [isPlaying, selectedIdx, scenes]);

  // ── 씬 변경 시 TTS 초기화 ────────────────────────────────────────────────
  React.useEffect(() => {
    setTtsUrl(null); setTtsLoading(false); setIsPlaying(false);
    setDisplayText(''); setImgAnim(null);
    if (charTimerRef.current) clearInterval(charTimerRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
  }, [selectedIdx]);

  // ── 생성 중 첫 이미지 확보 시 자동 선택 ────────────────────────────────────
  React.useEffect(() => {
    if (!generating || autoSelectedRef.current) return;
    // 현재 선택된 씬에 이미 이미지가 있으면 이미 OK
    if (scenes[selectedIdx]?.imageUrl) { autoSelectedRef.current = true; return; }
    // 이미지가 확보된 첫 번째 씬으로 자동 이동
    const firstDone = scenes.findIndex(s => s.imageUrl);
    if (firstDone >= 0) {
      setSelectedIdx(firstDone);
      autoSelectedRef.current = true;
    }
  }, [scenes, generating, selectedIdx]);

  const stopCharTimer = () => {
    if (charTimerRef.current) { clearInterval(charTimerRef.current); charTimerRef.current = null; }
  };

  const startTyping = (text: string, durationSec: number) => {
    stopCharTimer(); setDisplayText('');
    const chars = Array.from(text);
    const intervalMs = Math.max(30, (durationSec * 1000) / chars.length);
    let i = 0;
    charTimerRef.current = setInterval(() => {
      i++; setDisplayText(chars.slice(0, i).join(''));
      if (i >= chars.length) stopCharTimer();
    }, intervalMs);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    const scene = scenes[selectedIdx];
    if (!audio || !ttsUrl || !scene?.text) return;
    if (isPlaying) {
      audio.pause(); stopCharTimer(); setIsPlaying(false); setImgAnim(null);
    } else {
      const anim: 'zoom' | 'slide' = Math.random() < 0.5 ? 'zoom' : 'slide';
      setImgAnim(anim); setDisplayText('');
      audio.currentTime = 0; audio.play().catch(() => {});
      const go = () => {
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 4;
        startTyping(scene.text, dur);
      };
      if (isFinite(audio.duration) && audio.duration > 0) go();
      else audio.addEventListener('loadedmetadata', go, { once: true });
      setIsPlaying(true);
    }
  };

  const handleTts = async () => {
    const scene = scenes[selectedIdx];
    if (!scene?.text || ttsLoading) return;
    setTtsLoading(true); setTtsUrl(null); setIsPlaying(false);
    try {
      const fd = new FormData();
      fd.append('text', scene.text);
      fd.append('voice', 'ko-KR-SunHiNeural');
      fd.append('folder', selectedFolder);
      fd.append('scene_num', String(selectedIdx + 1));
      const res = await fetch(`${API}/keyframe-nlm/tts`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('TTS 실패');
      setTtsUrl(URL.createObjectURL(await res.blob()));
    } catch (e) { console.error('[TTS]', e); }
    finally { setTtsLoading(false); }
  };

  // ── 렌더 계산 ─────────────────────────────────────────────────────────────
  const scene    = scenes[selectedIdx] ?? null;
  const world    = seriesInfo?.world_data;
  const hasWorld = !!(world?.charAName || world?.charBName || world?.genre);

  const subtitleUp   = () => setSubtitleY(y => Math.max(0, y - SUBTITLE_STEP));
  const subtitleDown = () => setSubtitleY(y => Math.min(100, y + SUBTITLE_STEP));

  const subtitleStyle: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0,
    top: `${subtitleY}%`, transform: 'translateY(-50%)',
    padding: '12px 56px', transition: 'top 0.15s ease',
  };

  return (
    <div className="relative -mt-[56px]" style={{ background: '#f8f9fb', minHeight: '100vh' }}>
      <style>{`
        @keyframes kf-zoom      { from{transform:scale(1)} to{transform:scale(1.08)} }
        @keyframes kf-slide     { from{transform:scale(1.05) translateX(-3%)} to{transform:scale(1.05) translateX(3%)} }
        @keyframes kf-gen-pulse { 0%,100%{opacity:0.55; background-color:rgba(124,58,237,0.07)} 50%{opacity:1; background-color:rgba(124,58,237,0.18)} }
      `}</style>

      {/* 세계관 바 */}
      {hasWorld && (
        <div className="sticky z-50 border-b"
          style={{ top: '56px', background: 'rgba(237,233,254,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderColor: 'rgba(167,139,250,0.3)' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
              {seriesInfo?.title && (
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 900, color: '#6d28d9', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  {seriesInfo.title}
                </span>
              )}
              {world?.genre && <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 500 }}>· {world.genre}</span>}
              {world?.charAName && world?.charBName && (
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#7c3aed', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900 }}>A</span>
                  {world.charAName}
                  <span style={{ color: '#c4b5fd' }}>↔</span>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900 }}>B</span>
                  {world.charBName}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 툴바 */}
      <div className="sticky z-50 border-b"
        style={{
          top: hasWorld ? '100px' : '56px',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderColor: 'rgba(15,23,42,0.08)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, flexWrap: 'nowrap' }}>
            {/* NLM 키프레임 뱃지 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ background: '#7c3aed', color: 'white', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 900, letterSpacing: '0.06em' }}>NLM</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>키프레임</span>
            </div>
            <div style={{ width: 1, height: 16, background: '#e5e7eb', flexShrink: 0 }} />

            {/* 시리즈 선택 */}
            <select value={seriesId} onChange={e => setSeriesId(e.target.value)}
              style={{ fontSize: 11, color: '#374151', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: 'white', cursor: 'pointer', maxWidth: 180, flexShrink: 0 }}>
              <option value="">— 시리즈 선택 —</option>
              {seriesList.map(s => (
                <option key={s.id} value={s.id}>{s.title || s.topic || s.id.slice(0, 8)}</option>
              ))}
            </select>

            {/* 폴더 드롭다운 */}
            {folders.length > 0 && (
              <select value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}
                style={{ fontSize: 11, color: '#374151', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: 'white', cursor: 'pointer', maxWidth: 260, flexShrink: 0 }}>
                {folders.map(f => (
                  <option key={f.folder} value={f.folder}>
                    {f.db_series_id === seriesId ? '★ ' : ''}
                    {f.created_at ? f.created_at.slice(0, 16).replace('T', ' ') : f.folder.slice(0, 8)}
                    {' · '}{f.frame_count}장
                  </option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                {scenes.length > 0 ? `컷 ${scenes.length}개 · ${artStyle} · 16:9` : ''}
                {loadingResult && <span style={{ marginLeft: 8, color: '#a78bfa' }}> 로딩 중...</span>}
              </span>

              {/* NLM 재생성 버튼 — 시리즈 선택 + 컷 있을 때만 표시 */}
              {seriesId && scenes.length > 0 && (
                <button
                  onClick={handleRegen}
                  disabled={regenLoading || generating}
                  title="초기화 상태 노트북LM에 프롬프트 일괄 주입 후 재생성"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 11px', borderRadius: 7, flexShrink: 0,
                    background: (regenLoading || generating) ? '#f3f4f6' : 'rgba(124,58,237,0.08)',
                    border: `1px solid ${(regenLoading || generating) ? '#e5e7eb' : 'rgba(124,58,237,0.35)'}`,
                    color: (regenLoading || generating) ? '#d1d5db' : '#7c3aed',
                    fontSize: 11, fontWeight: 800,
                    cursor: (regenLoading || generating) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    animation: regenLoading ? 'kf-gen-pulse 1.2s ease-in-out infinite' : 'none',
                  }}>
                  <span style={{ fontSize: 12 }}>📓</span>
                  {regenLoading ? '주입 중...' : 'NLM 재생성'}
                </button>
              )}
            </div>

            {/* 노트북 상태 뱃지 (생성 중 / 완료 후) */}
            {nbStatuses.length > 0 && (
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                {nbStatuses.map(nb => {
                  const cfg: Record<string, {bg:string; color:string; dot:string}> = {
                    in_progress: { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', dot: '⚡' },
                    completed:   { bg: 'rgba(16,185,129,0.10)', color: '#059669', dot: '✓'  },
                    failed:      { bg: 'rgba(239,68,68,0.10)',  color: '#dc2626', dot: '✗'  },
                    error:       { bg: 'rgba(239,68,68,0.10)',  color: '#dc2626', dot: '!'  },
                    idle:        { bg: '#f3f4f6',               color: '#9ca3af', dot: '·'  },
                    unknown:     { bg: '#f3f4f6',               color: '#9ca3af', dot: '?'  },
                  };
                  const s = cfg[nb.status] ?? cfg.unknown;
                  return (
                    <div key={nb.label} title={`${nb.label}: ${nb.status}`}
                      style={{
                        padding: '2px 6px', borderRadius: 5, fontSize: 9, fontWeight: 900,
                        background: s.bg, color: s.color,
                        display: 'flex', alignItems: 'center', gap: 2,
                        animation: nb.status === 'in_progress' ? 'kf-gen-pulse 1.5s ease-in-out infinite' : 'none',
                        border: `1px solid ${nb.status === 'in_progress' ? 'rgba(124,58,237,0.3)' : 'transparent'}`,
                      }}>
                      <span style={{ fontSize: 8 }}>{s.dot}</span>
                      {nb.label}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 생성 진행 카운터 */}
            {generating && scenes.length > 0 && (() => {
              const done = scenes.filter(s => s.imageUrl).length;
              const pct  = Math.round((done / scenes.length) * 100);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <div style={{ width: 80, height: 4, borderRadius: 2, background: '#e5e7eb', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #7c3aed, #6366f1)', transition: 'width 0.3s ease', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {done}/{scenes.length}
                  </span>
                </div>
              );
            })()}

            {genStatus && (
              <span style={{ fontSize: 10, color: generating ? '#7c3aed' : '#6b7280', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {generating && '⚡ '}
                {genStatus}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 본문 1400px 가운데 정렬 */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px 40px', display: 'flex', gap: 24 }}>

        {/* ── 왼쪽 60% ── */}
        <div style={{ flex: '0 0 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 이미지 뷰어 */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#1a1a2e', aspectRatio: '16/9', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            {scene?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={scene.imageUrl} alt=""
                style={{
                  width: '100%', height: '100%', objectFit: 'cover', transformOrigin: 'center center',
                  animation: imgAnim === 'zoom' ? 'kf-zoom 8s ease-in-out forwards'
                    : imgAnim === 'slide' ? 'kf-slide 8s ease-in-out forwards' : 'none',
                }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: 48, opacity: 0.12 }}>🎞️</span>
                {!seriesId && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>시리즈를 선택하세요</span>}
                {seriesId && scenes.length === 0 && !loadingResult && (
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>챕터1 컷을 먼저 생성하세요</span>
                )}
              </div>
            )}

            {scene && (
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <span style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: '#a78bfa', fontSize: 10, fontWeight: 900, padding: '3px 10px', borderRadius: 6, fontFamily: 'monospace', border: '1px solid rgba(124,58,237,0.3)' }}>
                  {scene.sceneCode || `S${String(selectedIdx + 1).padStart(2, '0')}`}
                  {scene.isHook && <span style={{ marginLeft: 6, color: '#f59e0b' }}>HOOK</span>}
                </span>
              </div>
            )}

            <div style={{ position: 'absolute', top: 10, right: 10 }}>
              <span style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#9ca3af', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)' }}>
                자막 {subtitleY}%
              </span>
            </div>

            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={subtitleUp} title="자막 위로" disabled={subtitleY <= 0} style={ctrlBtn(subtitleY <= 0)}>▲</button>
              <button onClick={subtitleDown} title="자막 아래로" disabled={subtitleY >= 100} style={ctrlBtn(subtitleY >= 100)}>▼</button>
              <button onClick={togglePlay} title={isPlaying ? '일시정지' : '재생'} disabled={!ttsUrl}
                style={{ ...ctrlBtn(!ttsUrl), background: isPlaying ? 'rgba(124,58,237,0.55)' : 'rgba(30,20,60,0.75)', borderColor: isPlaying ? '#a78bfa' : 'rgba(124,58,237,0.35)', color: !ttsUrl ? '#4b5563' : '#a78bfa' }}>
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>

            {scene?.text && (
              <div style={subtitleStyle}>
                <p style={{
                  fontSize: 14, color: 'white', fontWeight: 600, lineHeight: 1.75,
                  margin: 0, textAlign: 'center', fontFamily: '"Noto Serif KR", serif',
                  textShadow: subtitleBg ? 'none' : '0 1px 6px rgba(0,0,0,0.9)',
                  whiteSpace: 'pre-wrap',
                  ...(subtitleBg ? { background: 'rgba(0,0,0,0.82)', borderRadius: 6, padding: '6px 12px' } : {}),
                }}>
                  {isPlaying ? displayText : scene.text}
                </p>
              </div>
            )}
          </div>

          {/* 힌트 + 대본 박스 */}
          {scene && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              {scene.imageHint && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid #fde8e8', background: '#fff5f5', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#dc2626', background: '#fee2e2', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.06em', flexShrink: 0, marginTop: 1 }}>HINT</span>
                  <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, lineHeight: 1.6 }}>{scene.imageHint}</span>
                </div>
              )}
              <div style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 13, lineHeight: 1.9, color: '#374151', margin: 0, whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif KR", "Gmarket Sans", serif' }}>
                  {scene.text || '(대본 없음)'}
                </p>
              </div>
            </div>
          )}

          <audio
            ref={audioRef}
            src={ttsUrl ?? undefined}
            onEnded={() => { setIsPlaying(false); stopCharTimer(); setImgAnim(null); setDisplayText(scene?.text ?? ''); }}
            onPause={() => { setIsPlaying(false); stopCharTimer(); setImgAnim(null); }}
            onPlay={() => setIsPlaying(true)}
            style={{ display: 'none' }}
          />

          {/* 액션 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: ttsLoading ? '생성 중…' : '음성 TTS 생성', icon: ttsLoading ? '⏳' : '🎙️', bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8', onClick: handleTts, disabled: ttsLoading || !scene?.text },
              { label: '이미지 교체', icon: '🖼️', bg: '#f5f3ff', border: '#ddd6fe', color: '#6d28d9', onClick: () => {}, disabled: false },
              { label: 'MP4 교체',   icon: '🎬', bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', onClick: () => {}, disabled: false },
            ].map(({ label, icon, bg, border, color, onClick, disabled }) => (
              <button key={label} onClick={onClick} disabled={disabled} style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: bg, border: `1px solid ${border}`,
                color, fontSize: 12, fontWeight: 700,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {/* 옵션 토글 행 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {/* 자막배경 토글 */}
            {([
              { key: 'subtitleBg', icon: '⬛', label: '자막배경', value: subtitleBg, onToggle: () => setSubtitleBg(v => !v) },
            ] as { key: string; icon: string; label: string; value: boolean; onToggle: () => void }[]).map(opt => (
              <button key={opt.key} type="button" role="switch" aria-checked={opt.value} onClick={opt.onToggle}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10,
                  background: opt.value ? '#1f2937' : '#f3f4f6',
                  border: `1px solid ${opt.value ? '#374151' : '#e5e7eb'}`,
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                <span style={{ fontSize: 12 }}>{opt.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: opt.value ? '#d1d5db' : '#6b7280' }}>{opt.label}</span>
                <span style={{ position: 'relative', width: 24, height: 14, borderRadius: 999, flexShrink: 0, background: opt.value ? '#4b5563' : '#d1d5db', transition: 'background 0.2s ease', display: 'inline-block' }}>
                  <span style={{ position: 'absolute', top: 2, left: opt.value ? 11 : 2, width: 10, height: 10, borderRadius: '50%', background: opt.value ? '#e5e7eb' : '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.2s ease', display: 'block' }} />
                </span>
              </button>
            ))}

            {/* API사용 — 컷 선택 시 활성 */}
            {(() => {
              const enabled = !!scene;
              return (
                <button
                  disabled={!enabled}
                  onClick={() => { /* TODO: API로 선택 컷 이미지 재생성 */ }}
                  title={enabled ? `컷 ${selectedIdx + 1} — API로 이미지 재생성` : '컷을 선택하세요'}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10,
                    background: enabled ? '#eff6ff' : '#f9fafb',
                    border: `1px solid ${enabled ? '#bfdbfe' : '#e5e7eb'}`,
                    color: enabled ? '#1d4ed8' : '#d1d5db',
                    fontSize: 11, fontWeight: 700,
                    cursor: enabled ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  <span style={{ fontSize: 13 }}>🤖</span>
                  API사용
                  {enabled && (
                    <span style={{ fontSize: 9, fontWeight: 900, background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4 }}>
                      컷{selectedIdx + 1}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* NLM재사용 — 컷 + 노트북 앱 모두 선택 시 활성 */}
            {(() => {
              const enabled = !!scene && !!selectedNb;
              return (
                <button
                  disabled={!enabled}
                  onClick={() => { /* TODO: 선택 NLM으로 선택 컷 이미지 재생성 */ }}
                  title={
                    !scene ? '컷을 선택하세요'
                    : !selectedNb ? '노트북 앱을 선택하세요'
                    : `컷 ${selectedIdx + 1} — ${selectedNb}으로 재생성`
                  }
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10,
                    background: enabled ? 'rgba(124,58,237,0.07)' : '#f9fafb',
                    border: `1px solid ${enabled ? 'rgba(124,58,237,0.3)' : '#e5e7eb'}`,
                    color: enabled ? '#7c3aed' : '#d1d5db',
                    fontSize: 11, fontWeight: 700,
                    cursor: enabled ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  <span style={{ fontSize: 13 }}>📓</span>
                  NLM재사용
                  {enabled && (
                    <span style={{ fontSize: 9, fontWeight: 900, background: 'rgba(124,58,237,0.12)', color: '#7c3aed', padding: '1px 5px', borderRadius: 4 }}>
                      {selectedNb}
                    </span>
                  )}
                </button>
              );
            })()}
          </div>
        </div>

        {/* ── 오른쪽 40%: 씬 그리드 ── */}
        <div style={{ flex: '0 0 40%', minWidth: 0 }}>
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
            padding: '16px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            position: 'sticky', top: (hasWorld ? 100 : 56) + 48 + 16,
            maxHeight: `calc(100vh - ${(hasWorld ? 100 : 56) + 48 + 32}px)`,
            overflowY: 'auto',
          }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', marginBottom: 12, paddingLeft: 2 }}>
              컷 목록 · {scenes.length}개{seriesId ? ' · ch1' : ''}
            </div>

            {!seriesId ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <span style={{ fontSize: 12, color: '#d1d5db' }}>시리즈를 선택하세요</span>
              </div>
            ) : scenes.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <span style={{ fontSize: 12, color: '#d1d5db' }}>{loadingResult ? '로딩 중...' : '컷 없음'}</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateRows: 'repeat(10, auto)', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 5 }}>
                {scenes.map((s, si) => {
                  const isSel = si === selectedIdx;
                  return (
                    <button key={si} onClick={() => { setIsPlaying(false); setSelectedIdx(si); }}
                      style={{
                        width: '100%', aspectRatio: '16/9', borderRadius: 7,
                        border: isSel ? '2px solid #f59e0b' : s.imageUrl ? '1px solid #86efac' : '1px solid #e5e7eb',
                        cursor: 'pointer', transition: 'border-color 0.12s, transform 0.1s',
                        position: 'relative', overflow: 'hidden', padding: 0, background: 'transparent',
                        animation: generating && !s.imageUrl ? 'kf-gen-pulse 1.8s ease-in-out infinite' : 'none',
                        transform: isSel ? 'scale(1.03)' : 'scale(1)',
                        boxShadow: isSel ? '0 0 0 2px rgba(245,158,11,0.4)' : 'none',
                        zIndex: isSel ? 1 : 0,
                      }}>
                      {s.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt="" style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                        }} />
                      )}
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: s.imageUrl
                          ? 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)'
                          : (generating ? 'transparent' : '#f9fafb'),
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                        padding: '0 6px 4px',
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 900, lineHeight: 1, color: s.imageUrl ? '#fff' : (isSel ? '#b45309' : '#9ca3af') }}>
                          {si + 1}
                        </span>
                        {s.isHook && <span style={{ fontSize: 9, color: '#f59e0b', lineHeight: 1 }}>★</span>}
                      </div>
                      {generating && !s.imageUrl && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(124,58,237,0.4)' }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 노트북LM 앱 상태 리스트 ── */}
          {(() => {
            const NB_LABELS = ['앱1','앱2','앱3','앱4','앱5','앱6'];
            const getStatus = (label: string) => {
              const assignment = nbAssignments[label];
              const nb = nbStatuses.find(n => n.label === label);
              return assignment?.status ?? nb?.status ?? 'idle';
            };
            const idleCount    = NB_LABELS.filter(l => { const s = getStatus(l); return s === 'idle' || s === 'unknown'; }).length;
            const queuedCount  = NB_LABELS.filter(l => getStatus(l) === 'queued').length;
            const workingCount = NB_LABELS.filter(l => getStatus(l) === 'in_progress').length;
            const doneCount    = NB_LABELS.filter(l => getStatus(l) === 'completed').length;
            const errorCount   = NB_LABELS.filter(l => { const s = getStatus(l); return s === 'error' || s === 'failed'; }).length;

            return (
              <div style={{
                background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
                padding: '14px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                marginTop: 10,
              }}>
                {/* 헤더: 라벨 + 가용 현황 요약 */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', paddingLeft: 2, flex: 1 }}>
                    NOTEBOOKLM 앱 상태
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {workingCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                        background: 'rgba(124,58,237,0.1)', color: '#6d28d9', border: '1px solid rgba(124,58,237,0.25)',
                      }}>
                        제작중 {workingCount}
                      </span>
                    )}
                    {queuedCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                        background: 'rgba(167,139,250,0.12)', color: '#7c3aed', border: '1px solid rgba(167,139,250,0.3)',
                      }}>
                        대기중 {queuedCount}
                      </span>
                    )}
                    {doneCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                        background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)',
                      }}>
                        완료 {doneCount}
                      </span>
                    )}
                    {idleCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                        background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
                      }}>
                        대기 {idleCount}
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                        background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
                      }}>
                        오류 {errorCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* 앱 목록 */}
                {NB_LABELS.map((label, i) => {
                  const nb         = nbStatuses.find(n => n.label === label);
                  const assignment = nbAssignments[label];
                  const status     = assignment?.status ?? nb?.status ?? 'idle';
                  const isSel      = selectedNb === label;

                  // 가용 여부
                  const isWorking = status === 'in_progress';
                  const isQueued  = status === 'queued';   // 곧 시작될 예고 상태
                  const isError   = status === 'error' || status === 'failed';
                  const isDone    = status === 'completed';
                  const isIdle    = !isWorking && !isQueued && !isError && !isDone;

                  // 왼쪽 세로 스트라이프 색상
                  const stripeColor = isWorking ? '#7c3aed'
                    : isQueued   ? '#a78bfa'   // 연보라 — 곧 시작
                    : isError    ? '#ef4444'
                    : isDone     ? '#10b981'
                    : '#d1d5db';

                  // 행 배경
                  const rowBg = isSel      ? 'rgba(124,58,237,0.09)'
                    : isWorking ? 'rgba(124,58,237,0.04)'
                    : isQueued  ? 'rgba(167,139,250,0.05)'
                    : isError   ? 'rgba(239,68,68,0.04)'
                    : isDone    ? 'rgba(16,185,129,0.04)'
                    : '#fafafa';

                  // 상태 텍스트
                  let statusText: string;
                  let statusColor: string;
                  let statusBg: string;
                  if (isWorking) {
                    statusText  = assignment ? `${assignment.cuts} 제작중` : '제작중';
                    statusColor = '#6d28d9';
                    statusBg    = 'rgba(124,58,237,0.1)';
                  } else if (isQueued) {
                    statusText  = assignment ? `${assignment.cuts} 대기중` : '대기중';
                    statusColor = '#7c3aed';
                    statusBg    = 'rgba(167,139,250,0.12)';
                  } else if (isError) {
                    statusText  = '오류 · 사용불가';
                    statusColor = '#dc2626';
                    statusBg    = 'rgba(239,68,68,0.08)';
                  } else if (isDone) {
                    statusText  = assignment ? `${assignment.cuts} 완료` : '완료';
                    statusColor = '#059669';
                    statusBg    = 'rgba(16,185,129,0.1)';
                  } else {
                    statusText  = '대기';
                    statusColor = '#9ca3af';
                    statusBg    = '#f3f4f6';
                  }

                  return (
                    <button
                      key={label}
                      onClick={() => setSelectedNb(prev => prev === label ? null : label)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                        padding: '8px 10px 8px 0', borderRadius: 9, marginBottom: 5,
                        background: rowBg,
                        border: isSel ? '1.5px solid #7c3aed' : '1px solid transparent',
                        boxShadow: isSel ? '0 0 0 2px rgba(124,58,237,0.15)' : 'none',
                        animation: isWorking ? 'kf-gen-pulse 1.8s ease-in-out infinite' : 'none',
                        transition: 'background 0.2s, border-color 0.2s',
                        cursor: 'pointer', textAlign: 'left',
                        opacity: isError ? 0.6 : 1,
                        overflow: 'hidden',
                        position: 'relative',
                      }}>

                      {/* 왼쪽 컬러 스트라이프 */}
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                        borderRadius: '9px 0 0 9px',
                        background: stripeColor,
                        transition: 'background 0.2s',
                      }} />

                      {/* 왼쪽 여백 (스트라이프 4px + 간격 8px) */}
                      <div style={{ width: 12, flexShrink: 0 }} />

                      {/* 번호 뱃지 */}
                      <div style={{
                        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                        background: isSel ? '#7c3aed'
                          : isWorking ? '#7c3aed'
                          : isQueued  ? '#a78bfa'
                          : isError   ? '#ef4444'
                          : isDone    ? '#10b981'
                          : '#d1d5db',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 900,
                        color: '#fff',
                        transition: 'background 0.2s',
                      }}>
                        {i + 1}
                      </div>

                      {/* 레이블 */}
                      <span style={{
                        fontSize: 11, fontWeight: isSel ? 900 : 700,
                        color: isError ? '#9ca3af' : isSel ? '#6d28d9' : '#374151',
                        flex: 1,
                        textDecoration: isError ? 'line-through' : 'none',
                      }}>
                        노트북LM {label}
                      </span>

                      {/* 선택됨 표시 */}
                      {isSel && (
                        <span style={{
                          fontSize: 9, fontWeight: 900, color: '#7c3aed',
                          background: 'rgba(124,58,237,0.12)', padding: '1px 6px', borderRadius: 4,
                        }}>
                          선택
                        </span>
                      )}

                      {/* 상태 뱃지 */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 9px', borderRadius: 999,
                        background: statusBg,
                        flexShrink: 0,
                        fontWeight: 800, fontSize: 10, color: statusColor,
                        whiteSpace: 'nowrap',
                      }}>
                        {isWorking && <span style={{ fontSize: 9 }}>⚡</span>}
                        {isQueued  && <span style={{ fontSize: 9 }}>◷</span>}
                        {isError   && <span style={{ fontSize: 9 }}>✗</span>}
                        {isDone    && <span style={{ fontSize: 9 }}>✓</span>}
                        {isIdle    && <span style={{ fontSize: 11 }}>·</span>}
                        {statusText}
                      </div>
                    </button>
                  );
                })}

                {/* 상태 미조회 시 안내 */}
                {nbStatuses.length === 0 && Object.keys(nbAssignments).length === 0 && (
                  <p style={{ fontSize: 11, color: '#d1d5db', textAlign: 'center', margin: '8px 0 4px' }}>
                    생성 시작 시 상태가 표시됩니다
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
