'use client';

import React from 'react';
import { useParams } from 'next/navigation';

const API = 'http://localhost:8001/api/v1';

interface SceneItem {
  index: number;
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
  const { id: seriesId } = useParams<{ id: string }>();
  const [scenes, setScenes]           = React.useState<SceneItem[]>([]);
  const [seriesTitle, setSeriesTitle] = React.useState('');
  const [artStyle, setArtStyle]       = React.useState('애니풍');
  const [chapter, setChapter]         = React.useState(1);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [subtitleY, setSubtitleY]     = React.useState(80);
  const [subtitleBg, setSubtitleBg]   = React.useState(false);
  const [isPlaying, setIsPlaying]     = React.useState(false);
  const [loadingScenes, setLoadingScenes] = React.useState(true);
  const [folders, setFolders]         = React.useState<{folder: string; frame_count: number; datetime: string; db_series_id?: string}[]>([]);
  const [selectedFolder, setSelectedFolder] = React.useState('');
  const [generating, setGenerating]   = React.useState(false);
  const [genStatus, setGenStatus]     = React.useState('');
  const [jobId, setJobId]             = React.useState('');
  const [ttsLoading, setTtsLoading]   = React.useState(false);
  const [ttsUrl, setTtsUrl]           = React.useState<string | null>(null);
  const [displayText, setDisplayText] = React.useState('');
  const [imgAnim, setImgAnim]         = React.useState<'zoom' | 'slide' | null>(null);
  const audioRef    = React.useRef<HTMLAudioElement | null>(null);
  const charTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const knownFrames  = React.useRef<Set<string>>(new Set());

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────

  // 시리즈 정보 + 씬 데이터 로드
  React.useEffect(() => {
    if (!seriesId) return;
    const load = async () => {
      setLoadingScenes(true);
      try {
        // 시리즈 기본 정보
        const sRes = await fetch(`${API}/series/${seriesId}`);
        if (sRes.ok) {
          const s = await sRes.json();
          setSeriesTitle(s.title || s.topic || '');
        }
        // 챕터1 씬/컷 로드
        await loadScenesForChapter(chapter);
        // 폴더 목록
        await loadFolders();
      } finally {
        setLoadingScenes(false);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const loadScenesForChapter = async (ch: number) => {
    const res = await fetch(`${API}/series/${seriesId}/chapters/${ch}/scenes`);
    if (!res.ok) return;
    const cuts: {
      scene_index: number; scene_code: string; cut_index: number;
      is_hook: boolean; text: string; image_hint: string; type: string;
    }[] = await res.json();

    // scene_index별로 그룹화
    const map = new Map<number, typeof cuts>();
    for (const c of cuts) {
      if (!map.has(c.scene_index)) map.set(c.scene_index, []);
      map.get(c.scene_index)!.push(c);
    }

    const sceneList: SceneItem[] = [];
    for (const [si, sc] of Array.from(map.entries()).sort(([a], [b]) => a - b)) {
      const first = sc[0];
      const allText = sc.map(c => c.text).filter(Boolean).join('\n');
      const sec = Math.max(2, allText.length / 8);
      sceneList.push({
        index: si,
        sceneCode: first.scene_code,
        text: allText,
        imageHint: first.image_hint || '',
        isHook: first.is_hook,
        estimatedSec: sec,
        imageUrl: '',
        status: 'pending',
      });
    }
    setScenes(sceneList);
    setSelectedIdx(0);
    knownFrames.current.clear();
  };

  const loadFolders = async () => {
    const res = await fetch(`${API}/keyframe-nlm/folders`).catch(() => null);
    if (!res?.ok) return;
    const all: {folder: string; frame_count: number; datetime: string; db_series_id?: string}[] = await res.json();
    // 현재 시리즈 폴더 우선 정렬
    const mine = all.filter(f => f.db_series_id === seriesId);
    const others = all.filter(f => f.db_series_id !== seriesId);
    setFolders([...mine, ...others]);
    if (mine.length > 0 && !selectedFolder) {
      setSelectedFolder(mine[0].folder);
      loadFolderImages(mine[0].folder);
    }
  };

  const loadFolderImages = async (folder: string) => {
    const res = await fetch(`${API}/keyframe-nlm/folder/${encodeURIComponent(folder)}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    if (data.frames?.length) {
      injectFrames(data.frames);
      if (data.art_style) setArtStyle(data.art_style);
    }
  };

  // 폴더 드롭다운 변경
  const prevFolderRef = React.useRef('');
  React.useEffect(() => {
    if (!selectedFolder || selectedFolder === prevFolderRef.current) return;
    prevFolderRef.current = selectedFolder;
    loadFolderImages(selectedFolder);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder]);

  // ── 이미지 주입 ─────────────────────────────────────────────────────────────

  const injectFrames = React.useCallback((frames: string[]) => {
    const newOnes = frames.filter(f => !knownFrames.current.has(f));
    if (!newOnes.length) return;
    newOnes.forEach(f => knownFrames.current.add(f));
    setScenes(prev => {
      const next = [...prev];
      newOnes.forEach(url => {
        const m = url.match(/frame_(\d+)\.png/);
        if (!m) return;
        const num = parseInt(m[1], 10);
        const idx = num - 1;
        if (idx >= 0 && idx < next.length) {
          next[idx] = { ...next[idx], imageUrl: url, status: 'done' };
        }
      });
      return next;
    });
  }, []);

  // ── NLM 생성 ─────────────────────────────────────────────────────────────────

  const stopPoll = React.useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  React.useEffect(() => () => stopPoll(), [stopPoll]);

  const handleGenerate = React.useCallback(async () => {
    if (generating || !seriesId) return;
    knownFrames.current.clear();
    setGenerating(true);
    setGenStatus('파이프라인 시작 중...');
    try {
      const res = await fetch(
        `${API}/keyframe-nlm/start/${seriesId}?chapter=${chapter}&art_style=${encodeURIComponent(artStyle)}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!data.job_id) throw new Error('job_id 없음');
      setJobId(data.job_id);

      stopPoll();
      pollTimerRef.current = setInterval(async () => {
        try {
          const sRes = await fetch(`${API}/keyframe-nlm/status/${data.job_id}`);
          const job = await sRes.json();
          setGenStatus(job.message ?? '');
          if (job.frames?.length) injectFrames(job.frames);
          if (job.status === 'done') {
            stopPoll();
            setGenerating(false);
            setGenStatus(`완료 — ${job.frames?.length ?? 0}장`);
            await loadFolders();
          } else if (job.status === 'error') {
            stopPoll();
            setGenerating(false);
            setGenStatus(`오류: ${job.error}`);
          }
        } catch { /* ignore */ }
      }, 5000);
    } catch (e) {
      setGenerating(false);
      setGenStatus(`시작 실패: ${e}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, seriesId, chapter, artStyle, stopPoll, injectFrames]);

  // ── 챕터 변경 ───────────────────────────────────────────────────────────────

  const handleChapterChange = async (ch: number) => {
    setChapter(ch);
    setSelectedIdx(0);
    await loadScenesForChapter(ch);
  };

  // ── 슬라이드쇼 ─────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!isPlaying || scenes.length === 0) return;
    const sec = Math.max(2, scenes[selectedIdx]?.estimatedSec ?? 4);
    const t = setTimeout(() => {
      setSelectedIdx(i => {
        if (i >= scenes.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, sec * 1000);
    return () => clearTimeout(t);
  }, [isPlaying, selectedIdx, scenes]);

  // ── 씬 변경 시 TTS 초기화 ──────────────────────────────────────────────────
  React.useEffect(() => {
    setTtsUrl(null);
    setTtsLoading(false);
    setIsPlaying(false);
    setDisplayText('');
    setImgAnim(null);
    if (charTimerRef.current) clearInterval(charTimerRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
  }, [selectedIdx]);

  // ── 타이핑 효과 ─────────────────────────────────────────────────────────────
  const stopCharTimer = () => {
    if (charTimerRef.current) { clearInterval(charTimerRef.current); charTimerRef.current = null; }
  };

  const startTyping = (text: string, durationSec: number) => {
    stopCharTimer();
    setDisplayText('');
    const chars = Array.from(text);
    const intervalMs = Math.max(30, (durationSec * 1000) / chars.length);
    let idx = 0;
    charTimerRef.current = setInterval(() => {
      idx++;
      setDisplayText(chars.slice(0, idx).join(''));
      if (idx >= chars.length) stopCharTimer();
    }, intervalMs);
  };

  // ── 오디오 재생 토글 ────────────────────────────────────────────────────────
  const togglePlay = () => {
    const audio = audioRef.current;
    const scene = scenes[selectedIdx];
    if (!audio || !ttsUrl || !scene?.text) return;
    if (isPlaying) {
      audio.pause();
      stopCharTimer();
      setIsPlaying(false);
      setImgAnim(null);
    } else {
      const anim: 'zoom' | 'slide' = Math.random() < 0.5 ? 'zoom' : 'slide';
      setImgAnim(anim);
      setDisplayText('');
      audio.currentTime = 0;
      audio.play().catch(() => {});
      const go = () => {
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 4;
        startTyping(scene.text, dur);
      };
      if (isFinite(audio.duration) && audio.duration > 0) go();
      else audio.addEventListener('loadedmetadata', go, { once: true });
      setIsPlaying(true);
    }
  };

  // ── TTS 생성 ─────────────────────────────────────────────────────────────────
  const handleTts = async () => {
    const scene = scenes[selectedIdx];
    if (!scene?.text || ttsLoading) return;
    setTtsLoading(true);
    setTtsUrl(null);
    setIsPlaying(false);
    try {
      const fd = new FormData();
      fd.append('text', scene.text);
      fd.append('voice', 'ko-KR-SunHiNeural');
      fd.append('folder', selectedFolder);
      fd.append('scene_num', String(selectedIdx + 1));
      const res = await fetch(`${API}/keyframe-nlm/tts`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('TTS 실패');
      const blob = await res.blob();
      setTtsUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error('[TTS]', e);
    } finally {
      setTtsLoading(false);
    }
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  const scene = scenes[selectedIdx] ?? null;
  const subtitleUp   = () => setSubtitleY(y => Math.max(0, y - SUBTITLE_STEP));
  const subtitleDown = () => setSubtitleY(y => Math.min(100, y + SUBTITLE_STEP));
  const COL_SIZE = 10;
  const cols = Math.max(1, Math.ceil(scenes.length / COL_SIZE));

  const subtitleStyle: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0,
    top: `${subtitleY}%`,
    transform: 'translateY(-50%)',
    padding: '12px 56px',
    transition: 'top 0.15s ease',
  };

  return (
    <div style={{ background: '#f8f9fb', minHeight: '100vh', fontFamily: "'Pretendard', sans-serif" }}>
      <style>{`
        @keyframes kf-zoom { from { transform: scale(1); } to { transform: scale(1.08); } }
        @keyframes kf-slide { from { transform: scale(1.05) translateX(-3%); } to { transform: scale(1.05) translateX(3%); } }
      `}</style>

      {/* 툴바 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(15,23,42,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
            {/* 뒤로가기 */}
            <a href={`/series/${seriesId}`} style={{
              fontSize: 12, color: '#6b7280', textDecoration: 'none',
              padding: '4px 8px', borderRadius: 6,
              border: '1px solid #e5e7eb',
            }}>
              ← 대본
            </a>
            <div style={{ width: 1, height: 16, background: '#e5e7eb' }} />

            {/* NLM 배지 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#7c3aed', color: 'white', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 900, letterSpacing: '0.06em' }}>NLM</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>키프레임</span>
              {seriesTitle && <span style={{ fontSize: 11, color: '#9ca3af' }}>— {seriesTitle}</span>}
            </div>
            <div style={{ width: 1, height: 16, background: '#e5e7eb' }} />

            {/* 챕터 선택 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>챕터</span>
              {[1, 2, 3, 4, 5, 6].map(ch => (
                <button key={ch} onClick={() => handleChapterChange(ch)}
                  style={{
                    width: 26, height: 26, borderRadius: 6, border: 'none',
                    background: chapter === ch ? '#7c3aed' : '#f3f4f6',
                    color: chapter === ch ? '#fff' : '#6b7280',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>{ch}</button>
              ))}
            </div>
            <div style={{ width: 1, height: 16, background: '#e5e7eb' }} />

            {/* 화풍 선택 */}
            <select value={artStyle} onChange={e => setArtStyle(e.target.value)}
              style={{ fontSize: 11, color: '#374151', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: 'white', cursor: 'pointer' }}>
              <option value="애니풍">애니풍</option>
              <option value="실사풍">실사풍</option>
            </select>

            {/* 폴더 드롭다운 */}
            {folders.length > 0 && (
              <select value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}
                style={{ fontSize: 11, color: '#374151', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: 'white', cursor: 'pointer', maxWidth: 260 }}>
                {folders.map(f => (
                  <option key={f.folder} value={f.folder}>
                    {f.db_series_id === seriesId ? '★ ' : ''}{f.datetime} · {f.frame_count}장
                  </option>
                ))}
              </select>
            )}

            <span style={{ fontSize: 11, color: '#9ca3af', flex: 1 }}>
              {loadingScenes ? '씬 로딩 중...' : `씬 ${scenes.length}개 · ch${chapter}`}
            </span>

            {genStatus && (
              <span style={{ fontSize: 10, color: generating ? '#7c3aed' : '#6b7280', fontWeight: 600 }}>
                {generating && '⚡ '}{genStatus}
              </span>
            )}

            <button
              onClick={handleGenerate}
              disabled={generating || loadingScenes || scenes.length === 0}
              style={{
                padding: '5px 16px', borderRadius: 8, border: 'none',
                background: generating
                  ? 'linear-gradient(135deg, #9ca3af, #6b7280)'
                  : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: 'white', fontSize: 12, fontWeight: 800,
                cursor: (generating || loadingScenes) ? 'default' : 'pointer',
                boxShadow: generating ? 'none' : '0 2px 12px rgba(124,58,237,0.35)',
                opacity: (generating || loadingScenes || scenes.length === 0) ? 0.7 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {generating ? '⏳ 생성 중...' : '🎞️ NLM 생성 시작'}
            </button>
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px 40px', display: 'flex', gap: 24 }}>

        {/* ── 왼쪽 60% ── */}
        <div style={{ flex: '0 0 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 이미지 뷰어 */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#1a1a2e', aspectRatio: '16/9', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            {scene?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={scene.imageUrl} alt=""
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  transformOrigin: 'center center',
                  animation: imgAnim === 'zoom' ? 'kf-zoom 8s ease-in-out forwards'
                    : imgAnim === 'slide' ? 'kf-slide 8s ease-in-out forwards' : 'none',
                }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: 48, opacity: 0.12 }}>🎞️</span>
                {!loadingScenes && scenes.length === 0 && (
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>
                    대본에서 챕터 {chapter}의 씬을 먼저 생성하세요
                  </span>
                )}
              </div>
            )}

            {/* 씬 코드 배지 */}
            {scene && (
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <span style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: '#a78bfa', fontSize: 10, fontWeight: 900, padding: '3px 10px', borderRadius: 6, fontFamily: "var(--font-en), 'Pretendard', sans-serif", border: '1px solid rgba(124,58,237,0.3)' }}>
                  {scene.sceneCode}
                  {scene.isHook && <span style={{ marginLeft: 6, color: '#f59e0b' }}>HOOK</span>}
                </span>
              </div>
            )}

            {/* 자막 위치 배지 */}
            <div style={{ position: 'absolute', top: 10, right: 10 }}>
              <span style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#9ca3af', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)' }}>
                자막 {subtitleY}%
              </span>
            </div>

            {/* 좌측 컨트롤 */}
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={subtitleUp} disabled={subtitleY <= 0} style={ctrlBtn(subtitleY <= 0)}>▲</button>
              <button onClick={subtitleDown} disabled={subtitleY >= 100} style={ctrlBtn(subtitleY >= 100)}>▼</button>
              <button onClick={togglePlay} disabled={!ttsUrl}
                style={{ ...ctrlBtn(!ttsUrl), background: isPlaying ? 'rgba(124,58,237,0.55)' : 'rgba(30,20,60,0.75)', borderColor: isPlaying ? '#a78bfa' : 'rgba(124,58,237,0.35)', color: !ttsUrl ? '#4b5563' : '#a78bfa' }}>
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>

            {/* 자막 */}
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
                <p style={{ fontSize: 13, lineHeight: 1.9, color: '#374151', margin: 0, whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif KR", "Pretendard", serif' }}>
                  {scene.text || '(대본 없음)'}
                </p>
              </div>
            </div>
          )}

          {/* hidden 오디오 */}
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

          {/* 옵션 토글 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              onClick={() => setSubtitleBg(v => !v)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: subtitleBg ? '#1f2937' : '#f3f4f6',
                border: `1px solid ${subtitleBg ? '#374151' : '#e5e7eb'}`,
                cursor: 'pointer', transition: 'all 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 12 }}>⬛</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: subtitleBg ? '#d1d5db' : '#6b7280' }}>자막배경</span>
              <span style={{ position: 'relative', width: 24, height: 14, borderRadius: 999, background: subtitleBg ? '#4b5563' : '#d1d5db', display: 'inline-block', transition: 'background 0.2s ease' }}>
                <span style={{ position: 'absolute', top: 2, left: subtitleBg ? 11 : 2, width: 10, height: 10, borderRadius: '50%', background: subtitleBg ? '#e5e7eb' : '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.2s ease', display: 'block' }} />
              </span>
            </button>
          </div>
        </div>

        {/* ── 오른쪽 40%: 씬 그리드 ── */}
        <div style={{ flex: '0 0 40%', minWidth: 0 }}>
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
            padding: '16px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            position: 'sticky', top: 64,
          }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', marginBottom: 12, paddingLeft: 2 }}>
              씬 목록 · {scenes.length}개 · ch{chapter}
            </div>

            {loadingScenes ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <span style={{ fontSize: 12, color: '#d1d5db' }}>로딩 중...</span>
              </div>
            ) : scenes.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <span style={{ fontSize: 12, color: '#d1d5db' }}>씬 없음</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cols, 3)}, 1fr)`, gap: 5 }}>
                {Array.from({ length: Math.min(cols, 3) }, (_, colIdx) => (
                  <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: '#d1d5db', textAlign: 'center', paddingBottom: 4 }}>
                      씬 {colIdx * COL_SIZE + 1}~{Math.min((colIdx + 1) * COL_SIZE, scenes.length)}
                    </div>
                    {Array.from({ length: COL_SIZE }, (_, rowIdx) => {
                      const sceneIdx = colIdx * COL_SIZE + rowIdx;
                      if (sceneIdx >= scenes.length) return <div key={rowIdx} style={{ height: 32 }} />;
                      const s = scenes[sceneIdx];
                      const isSelected = sceneIdx === selectedIdx;
                      return (
                        <button key={rowIdx}
                          onClick={() => { setIsPlaying(false); setSelectedIdx(sceneIdx); }}
                          style={{
                            width: '100%', height: 32, borderRadius: 7,
                            border: isSelected ? '1.5px solid #f59e0b' : '1px solid #e5e7eb',
                            background: isSelected ? '#fef3c7' : s.imageUrl ? '#f0fdf4' : '#fafafa',
                            color: isSelected ? '#b45309' : s.imageUrl ? '#15803d' : '#6b7280',
                            fontSize: 11, fontWeight: isSelected ? 900 : 600,
                            cursor: 'pointer', transition: 'all 0.12s',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}>
                          {s.imageUrl && !isSelected && <span style={{ fontSize: 8, color: '#4ade80' }}>●</span>}
                          씬 {sceneIdx + 1}
                          {s.isHook && <span style={{ fontSize: 8, color: '#f59e0b' }}>★</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
