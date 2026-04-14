'use client';

import React from 'react';

const API = 'http://localhost:8001/api/v1';

interface CastMember {
  id: string;
  name: string;
  role: string;
}

interface CharacterDetail {
  id: string;
  name: string;
  role?: string;
  personality?: string;
  speaking_style?: string;
  speaking_examples?: string[];
  situations?: string[];
  relationships?: Record<string, string>;
  // 이미지 생성용 외형 데이터
  fal_identity_prompt?: string;
  wardrobe?: Record<string, { wardrobe_prompt?: string }>;
  body_prompt?: string;
  style_prompt?: string;
}

interface SeriesSummary {
  id: string;
  title?: string;
  topic?: string;
  world_data?: {
    charAName?: string; charBName?: string;
    genre?: string; style?: string;
    fullCast?: CastMember[];
  };
  settings?: { keyframeProvider?: string; artStyle?: string };
}

interface SceneParsed {
  index: number;
  sceneIndex: number;
  cutIndex: number;
  sceneCode: string;
  text: string;
  imageHint: string;
  isHook: boolean;
  estimatedSec: number;
  imageUrl: string;   // keyframe_url 또는 빈문자열
  status: string;
  // 타입 분기용
  type: 'narration' | 'dialogue';
  hasChars: boolean;
  speaker: string;
  bgUrl: string;
  charUrl: string;
  lipsyncUrl: string;
  ttsVoice: string;   // DB tts_voice 컬럼 (dialogue 컷 캐릭터 성우)
  storedTtsUrl: string; // DB tts_url 컬럼 (이미 생성된 TTS)
  sceneCharacters: string[]; // scene_meta.characters — 이 컷 등장인물
}

const SUBTITLE_STEP = 5;

/** "20260413_095022_ch01s07hc04" → "s07hc04" */
function sceneCodeSuffix(code: string): string {
  return code.replace(/^\d{8}_\d{6}_ch\d+/, '') || code;
}

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

export default function KeyframePage() {
  // ── 시리즈 ────────────────────────────────────────────────────────────────
  const [seriesList, setSeriesList] = React.useState<SeriesSummary[]>([]);
  const [seriesId, setSeriesId]     = React.useState('');
  const [seriesInfo, setSeriesInfo] = React.useState<SeriesSummary | null>(null);

  // ── 씬/UI 상태 ──────────────────────────────────────────────────────────
  const [scenes, setScenes]           = React.useState<SceneParsed[]>([]);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [subtitleY, setSubtitleY]     = React.useState(80);
  const [subtitleBg, setSubtitleBg]   = React.useState(() => localStorage.getItem('ld_subtitle_bg') === '1');
  const [isPlaying, setIsPlaying]     = React.useState(false);
  const [loadingResult, setLoadingResult] = React.useState(false);
  const [ttsLoading, setTtsLoading]   = React.useState(false);
  const [ttsUrl, setTtsUrl]           = React.useState<string | null>(null);
  const [ttsDoneSet, setTtsDoneSet]   = React.useState<Set<string>>(new Set());
  const [ttsDurationMap, setTtsDurationMap] = React.useState<Record<string, number>>({});
  const [displayText, setDisplayText] = React.useState('');
  const [isTyping, setIsTyping]       = React.useState(false);  // 자막 애니메이션 독립 상태
  const [imgAnim, setImgAnim]         = React.useState<'zoom' | 'slide' | null>(null);
  const [provider, setProvider]       = React.useState<'gemini' | 'pillow'>('gemini');
  const [promptText, setPromptText]   = React.useState('');
  const [regenLoading, setRegenLoading] = React.useState(false);
  const [promptLoading, setPromptLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [bgPromptText, setBgPromptText]         = React.useState('');
  const [bgUploadLoading, setBgUploadLoading]   = React.useState(false);
  const [lipsyncUploadLoading, setLipsyncUploadLoading] = React.useState(false);
  const [charPromptText, setCharPromptText] = React.useState('');
  const [pipelineStep, setPipelineStep] = React.useState('');
  const [ttsStartLoading, setTtsStartLoading] = React.useState(false);
  const [ttsGender, setTtsGender] = React.useState<'female' | 'male'>('female');
  const [kbLoading, setKbLoading] = React.useState(false);
  const [kbResult, setKbResult]   = React.useState<{processed:number;skipped:number;errors:string[]} | null>(null);
  const [confirmedCuts, setConfirmedCuts] = React.useState<Set<string>>(new Set());

  const audioRef        = React.useRef<HTMLAudioElement | null>(null);
  const videoRef        = React.useRef<HTMLVideoElement | null>(null);
  const charTimerRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const playTimerRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgInputRef      = React.useRef<HTMLInputElement | null>(null);
  const lipsyncInputRef = React.useRef<HTMLInputElement | null>(null);
  const scriptRowRef    = React.useRef<HTMLDivElement | null>(null);
  const chatEndRef      = React.useRef<HTMLDivElement | null>(null);

  // ── 챗봇 상태 ─────────────────────────────────────────────────────────────
  const [chatOpen, setChatOpen]         = React.useState(false);
  const [chatMessages, setChatMessages] = React.useState<{role:'user'|'model'|'auto'; content:string}[]>([]);
  const [chatInput, setChatInput]       = React.useState('');
  const [chatStreaming, setChatStreaming] = React.useState(false);
  const [charDetailMap, setCharDetailMap] = React.useState<Record<string, CharacterDetail>>({});
  const [promptApplied, setPromptApplied] = React.useState<number | null>(null);
  const lastAnalyzedKey = React.useRef<string>(''); // "seriesId:cutIdx" 중복 방지

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

  // ── 캐릭터 상세 정보 로드 — 시리즈 화풍에 맞는 style 파라미터 사용 ──────────
  React.useEffect(() => {
    const artStyle = seriesInfo?.settings?.artStyle ?? 'masako';
    fetch(`${API}/characters?style=${encodeURIComponent(artStyle)}`)
      .then(r => r.ok ? r.json() : [])
      .then((list: CharacterDetail[]) => {
        const map: Record<string, CharacterDetail> = {};
        for (const c of list) {
          if (c.name) map[c.name] = c;
        }
        setCharDetailMap(map);
      })
      .catch(() => {});
  }, [seriesInfo?.settings?.artStyle]);

  // ── 확정 컷 localStorage 복원 ─────────────────────────────────────────────
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('ld_confirmed_cuts');
      if (stored) setConfirmedCuts(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  // ── URL 파라미터 ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('series_id');
    if (sid) setSeriesId(sid);
  }, []);

  // ── 파이프라인 상태 로드 ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (!seriesId) return;
    fetch(`${API}/series/${seriesId}/status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.pipeline_step) setPipelineStep(d.pipeline_step); })
      .catch(() => {});
  }, [seriesId]);

  const handleStartTts = async () => {
    if (!seriesId || ttsStartLoading) return;
    setTtsStartLoading(true);
    try {
      await fetch(`${API}/series/${seriesId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'tts' }),
      });
      setPipelineStep('tts');
    } catch { /* ignore */ }
    finally { setTtsStartLoading(false); }
  };

  // ── 시리즈 선택 시 로드 ────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!seriesId) return;
    setScenes([]); setSelectedIdx(0);
    loadAll(seriesId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const loadAll = async (sid: string) => {
    setLoadingResult(true);
    try {
      const sRes = await fetch(`${API}/series/${sid}`).catch(() => null);
      if (sRes?.ok) {
        const s: SeriesSummary = await sRes.json();
        setSeriesInfo(s);
        const p = s.settings?.keyframeProvider;
        if (p === 'pillow' || p === 'gemini') setProvider(p);
      }

      const cRes = await fetch(`${API}/series/${sid}/chapters/1/local-scenes`).catch(() => null);
      if (cRes?.ok) {
        const cuts: {
          id: string; scene_index: number; scene_code: string; cut_index: number;
          is_hook: boolean; text: string; image_hint: string; keyframe_url?: string; status: string;
          type?: string; scene_meta?: { characters?: string[] }; speaker?: string;
          bg_url?: string; char_url?: string; lipsync_url?: string; tts_voice?: string; tts_url?: string;
        }[] = await cRes.json();

        const list: SceneParsed[] = cuts.map((c, i) => ({
          index: i + 1,
          sceneIndex: c.scene_index,
          cutIndex: c.cut_index,
          sceneCode: c.scene_code,
          text: c.text || '',
          imageHint: c.image_hint || '',
          isHook: c.is_hook,
          estimatedSec: Math.max(2, (c.text || '').length / 8),
          imageUrl: c.keyframe_url || c.bg_url || '',
          status: c.status || 'pending',
          type: (c.type === 'dialogue' ? 'dialogue' : 'narration') as 'narration' | 'dialogue',
          hasChars: Array.isArray(c.scene_meta?.characters) && (c.scene_meta!.characters!.length > 0),
          speaker: c.speaker || '',
          bgUrl: c.bg_url || '',
          charUrl: c.char_url || '',
          lipsyncUrl: c.lipsync_url || '',
          ttsVoice: c.tts_voice || '',
          storedTtsUrl: c.tts_url || '',
          sceneCharacters: Array.isArray(c.scene_meta?.characters) ? c.scene_meta!.characters as string[] : [],
        }));
        setScenes(list);
        // 초기 선택 컷(index 0)의 저장된 TTS URL 즉시 적용
        setTtsUrl(list[0]?.storedTtsUrl || null);

        // 로컬 MP3 존재 여부를 ttsDoneSet으로 반영
        const doneFromLocal = new Set(list.filter(s => !!s.storedTtsUrl).map(s => s.sceneCode));
        if (doneFromLocal.size) setTtsDoneSet(doneFromLocal);

        // output 폴더 → MP3 duration 측정 (ttsDoneSet은 위에서 이미 처리)
        const ofRes = await fetch(`${API}/series/${sid}/chapters/1/output-files`).catch(() => null);
        if (ofRes?.ok) {
          const of = await ofRes.json() as { tts_done: string[]; tts_durations: Record<string, number> };
          if (of.tts_durations && Object.keys(of.tts_durations).length) setTtsDurationMap(of.tts_durations);
        }
      }
    } finally {
      setLoadingResult(false);
    }
  };


  // ── 슬라이드쇼 ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!isPlaying || !scenes.length) return;
    const sc = scenes[selectedIdx];
    // 실제 TTS 재생 길이 우선 — 없으면 텍스트 기반 추정치
    const actualDur = ttsDurationMap[sc?.sceneCode ?? ''];
    const sec = Math.max(2, actualDur ?? sc?.estimatedSec ?? 4);
    playTimerRef.current = setTimeout(() => {
      setSelectedIdx(i => {
        if (i >= scenes.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, sec * 1000);
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  // ttsDurationMap이 업데이트(loadedmetadata)되면 타이머 재시작
  }, [isPlaying, selectedIdx, scenes, ttsDurationMap]);

  // ── 씬 변경 시 TTS 초기화 + 프롬프트 조합 ────────────────────────────────
  React.useEffect(() => {
    setTtsLoading(false); setIsPlaying(false); setIsTyping(false);
    setDisplayText(''); setImgAnim(null); setCharPromptText('');
    if (charTimerRef.current) { clearInterval(charTimerRef.current); charTimerRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }

    const s = scenes[selectedIdx];
    if (!s || !seriesId) { setTtsUrl(null); setPromptText(''); setBgPromptText(''); return; }

    // 컷별 저장된 자막 Y 위치 복원 (localStorage 기반)
    try {
      const map = localStorage.getItem('ld_subtitle_y_map');
      const parsed = map ? JSON.parse(map) : {};
      setSubtitleY(parsed[s.sceneCode] !== undefined ? parsed[s.sceneCode] : 80);
    } catch { setSubtitleY(80); }

    // DB에 저장된 TTS URL이 있으면 즉시 재생 가능하게 세팅
    setTtsUrl(s.storedTtsUrl || null);

    setPromptLoading(true);
    setPromptText('');
    setBgPromptText('');
    fetch(`${API}/series/${seriesId}/scenes/${s.sceneCode}/compose-prompt`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.prompt)      setPromptText(d.prompt);
        if (d?.bg_prompt)   setBgPromptText(d.bg_prompt);
        if (d?.char_prompt) setCharPromptText(d.char_prompt);
      })
      .catch(() => setPromptText(s.imageHint || ''))
      .finally(() => setPromptLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, seriesId]);

  // ── 대본 뷰 — 선택 컷으로 자동 스크롤 ────────────────────────────────────
  React.useEffect(() => {
    scriptRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedIdx]);

  // ── 챗봇 메시지 끝으로 스크롤 ────────────────────────────────────────────
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── 챗봇 컨텍스트 빌더 ──────────────────────────────────────────────────
  const buildChatContext = React.useCallback((s: SceneParsed | null) => {
    if (!s) return null;
    const chars = s.sceneCharacters.length > 0
      ? s.sceneCharacters
      : (seriesInfo?.world_data?.fullCast ?? []).map(c => c.name).slice(0, 4);
    const characterDetails: Record<string, object> = {};
    for (const name of chars) {
      const d = charDetailMap[name];
      if (d) characterDetails[name] = {
        personality: d.personality, speaking_style: d.speaking_style,
        speaking_examples: d.speaking_examples, situations: d.situations,
        relationships: d.relationships, fal_identity_prompt: d.fal_identity_prompt,
        wardrobe: d.wardrobe, body_prompt: d.body_prompt, style_prompt: d.style_prompt,
      };
    }
    return {
      sceneCode: s.sceneCode, type: s.type,
      speaker: s.speaker, text: s.text,
      imageHint: s.imageHint,
      seriesTitle: seriesInfo?.title,
      genre: seriesInfo?.world_data?.genre,
      sceneCharacters: s.sceneCharacters,
      fullCast: seriesInfo?.world_data?.fullCast ?? [],
      characterDetails: Object.keys(characterDetails).length > 0 ? characterDetails : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesInfo, charDetailMap]);

  // ── 공용 스트리밍 함수 ───────────────────────────────────────────────────
  const streamChat = React.useCallback(async (
    apiMessages: {role: string; content: string}[],
    context: object | null,
    onChunk: (t: string) => void,
    onError: (e: string) => void,
  ) => {
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, context }),
    });
    if (!res.body) throw new Error('no body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try { const { t } = JSON.parse(raw); onChunk(t); } catch { /* ignore */ }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 자동 분석 ─────────────────────────────────────────────────────────────
  const autoAnalyze = React.useCallback(async (s: SceneParsed) => {
    if (chatStreaming) return;
    const analysisMsg = s.type === 'dialogue'
      ? `이 컷 자동 분석 — 화자: ${s.speaker}, 대본: "${s.text}"\n대본과 이미지 힌트의 불일치(전화 통화 여부 포함)를 확인하고, 개선된 이미지 프롬프트를 제안해줘. fal_identity_prompt 반드시 사용.`
      : `이 나레이션 컷 자동 분석 — 대본: "${s.text.slice(0, 100)}${s.text.length > 100 ? '...' : ''}"\n현재 이미지 힌트를 평가하고 더 나은 배경 이미지 프롬프트를 제안해줘.`;

    const autoLabel = { role: 'auto' as const, content: `🔍 ${sceneCodeSuffix(s.sceneCode)} 자동 분석` };
    setChatMessages([autoLabel, { role: 'model', content: '' }]);
    setChatStreaming(true);
    try {
      await streamChat(
        [{ role: 'user', content: analysisMsg }],
        buildChatContext(s),
        (t) => setChatMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + t };
          return copy;
        }),
        (e) => setChatMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: e }; return c; }),
      );
    } catch (e) {
      console.error('[autoAnalyze]', e);
      setChatMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: '분석 오류' }; return c; });
    } finally {
      setChatStreaming(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatStreaming, streamChat, buildChatContext]);

  // ── 컷 변경 시 자동 분석 트리거 ──────────────────────────────────────────
  React.useEffect(() => {
    const s = scenes[selectedIdx];
    if (!chatOpen || !s || chatStreaming) return;
    const key = `${seriesId}:${selectedIdx}`;
    if (lastAnalyzedKey.current === key) return;
    lastAnalyzedKey.current = key;
    autoAnalyze(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, selectedIdx, scenes]);

  // ── 챗봇 메시지 전송 ─────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim() || chatStreaming) return;
    // 'auto' 메시지는 API에 포함하지 않음
    const history = chatMessages.filter(m => m.role !== 'auto');
    const userMsg = { role: 'user' as const, content: chatInput.trim() };
    const next = [...history, userMsg];
    // 'auto' 레이블 + user + 빈 model 메시지
    setChatMessages(prev => {
      const kept = prev.filter(m => m.role === 'auto');
      return [...kept, ...next, { role: 'model', content: '' }];
    });
    setChatInput('');
    setChatStreaming(true);
    try {
      await streamChat(
        next.map(m => ({ role: m.role, content: m.content })),
        buildChatContext(scene),
        (t) => setChatMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + t };
          return copy;
        }),
        (e) => setChatMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: e }; return c; }),
      );
    } catch (e) {
      console.error('[chat]', e);
      setChatMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: '오류가 발생했습니다.' }; return c; });
    } finally {
      setChatStreaming(false);
    }
  };

  // ── TTS duration 측정 — ttsUrl 변경 시 audioRef.loadedmetadata로 감지 ────
  React.useEffect(() => {
    if (!ttsUrl || !audioRef.current || !scene) return;
    const audio = audioRef.current;
    const sceneCode = scene.sceneCode;
    const handle = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setTtsDurationMap(prev => ({ ...prev, [sceneCode]: Math.round(audio.duration * 10) / 10 }));
      }
    };
    if (isFinite(audio.duration) && audio.duration > 0) {
      handle();
    } else {
      audio.addEventListener('loadedmetadata', handle, { once: true });
    }
    return () => audio.removeEventListener('loadedmetadata', handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsUrl]);

  // ── TTS ──────────────────────────────────────────────────────────────────
  const stopCharTimer = () => {
    if (charTimerRef.current) { clearInterval(charTimerRef.current); charTimerRef.current = null; }
    setIsTyping(false); setDisplayText('');
  };

  const startTyping = (text: string, durationSec: number) => {
    stopCharTimer(); setDisplayText(''); setIsTyping(true);

    // 마침표·느낌표·물음표 뒤에서 분리 → 문장 단위 순차 표시 (지나간 문장은 지움)
    const parts: string[] = [];
    let buf = '';
    for (const ch of Array.from(text)) {
      buf += ch;
      if ('.!?。！？'.includes(ch)) {
        const s = buf.trim();
        if (s) parts.push(s);
        buf = '';
      }
    }
    if (buf.trim()) parts.push(buf.trim());
    if (parts.length === 0) return;

    const totalChars = Array.from(text).length;
    const msPerChar = Math.max(30, (durationSec * 1000) / totalChars);

    let partIdx = 0;
    let charIdx = 0;

    charTimerRef.current = setInterval(() => {
      if (partIdx >= parts.length) { stopCharTimer(); return; }
      const partChars = Array.from(parts[partIdx]);
      charIdx++;
      setDisplayText(partChars.slice(0, charIdx).join(''));
      if (charIdx >= partChars.length) {
        partIdx++;
        charIdx = 0;
        setDisplayText(''); // 문장 완료 → 즉시 지우고 다음 문장 시작
        if (partIdx >= parts.length) stopCharTimer();
      }
    }, msPerChar);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    const video = videoRef.current;
    const scene = scenes[selectedIdx];
    if (!audio || !ttsUrl || !scene?.text) return;
    if (isPlaying) {
      audio.pause(); video?.pause(); stopCharTimer(); setIsPlaying(false); setImgAnim(null);
    } else {
      const anim: 'zoom' | 'slide' = Math.random() < 0.5 ? 'zoom' : 'slide';
      setImgAnim(anim); setDisplayText('');
      // MP3 재생
      audio.currentTime = 0; audio.play().catch(() => {});
      // MP4 무음 동시 재생
      if (video) { video.currentTime = 0; video.play().catch(() => {}); }
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
      // 음성 결정: dialogue=DB tts_voice(캐릭터 성우), narration=Supertone 나레이션 성우
      const rawVoice = scene.type === 'dialogue' && scene.ttsVoice ? scene.ttsVoice : '';
      const voice = rawVoice
        ? rawVoice
        : ttsGender === 'male' ? 'st:ab7cd18e645b54d7536e0f:neutral' : 'st:195e1922033a6168f0c90f:neutral';
      const fd = new FormData();
      fd.append('text', scene.text);
      fd.append('voice', voice);
      fd.append('series_id', seriesId);
      fd.append('scene_code', scene.sceneCode);
      const res = await fetch(`${API}/tts`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('TTS 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setTtsUrl(url);
      setTtsDoneSet(prev => new Set([...prev, scene.sceneCode]));
    } catch (e) { console.error('[TTS]', e); }
    finally { setTtsLoading(false); }
  };


  // ── Ken Burns 일괄 생성 ──────────────────────────────────────────────────
  const handleKenBurnsBatch = async () => {
    if (!seriesId || kbLoading) return;
    setKbLoading(true); setKbResult(null);
    try {
      const res = await fetch(`${API}/series/${seriesId}/chapters/1/kenburns-batch`, { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setKbResult(data);
      // 처리된 컷이 있으면 씬 목록 갱신
      if (data.processed > 0) await loadAll(seriesId);
    } catch (e) { console.error('[kenburns-batch]', e); }
    finally { setKbLoading(false); }
  };

  // ── 단일 컷 Gemini 재생성 ────────────────────────────────────────────────
  const handleRegenKeyframe = async () => {
    const s = scenes[selectedIdx];
    if (!s || !seriesId || regenLoading) return;
    setRegenLoading(true);
    try {
      const res = await fetch(
        `${API}/series/${seriesId}/scenes/${s.sceneCode}/keyframe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText || null, provider }),
        }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.keyframe_url) {
        setScenes(prev => prev.map((sc, i) =>
          i === selectedIdx ? { ...sc, imageUrl: data.keyframe_url, imageHint: promptText || sc.imageHint } : sc
        ));
      }
    } catch (e) {
      console.error('[regen-keyframe]', e);
    } finally {
      setRegenLoading(false);
    }
  };

  // ── 배경 업로드 ──────────────────────────────────────────────────────────
  const handleBgUpload = async (file: File) => {
    if (!seriesId || !scene) return;
    setBgUploadLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target', 'bg');
      const res = await fetch(
        `${API}/series/${seriesId}/scenes/${scene.sceneCode}/upload`,
        { method: 'POST', body: fd }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const url = data.bg_url || '';
      if (url) {
        setScenes(prev => prev.map((s, i) =>
          i === selectedIdx ? { ...s, imageUrl: url, bgUrl: url } : s
        ));
      }
    } catch (e) { console.error('[bg-upload]', e); }
    finally { setBgUploadLoading(false); }
  };

  // ── 립씽크 MP4 업로드 ────────────────────────────────────────────────────
  const handleLipsyncUpload = async (file: File) => {
    if (!seriesId || !scene) return;
    setLipsyncUploadLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target', 'lipsync');
      const res = await fetch(
        `${API}/series/${seriesId}/scenes/${scene.sceneCode}/upload`,
        { method: 'POST', body: fd }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const url = data.lipsync_url || '';
      if (url) {
        setScenes(prev => prev.map((s, i) =>
          i === selectedIdx ? { ...s, lipsyncUrl: url } : s
        ));
      }
    } catch (e) { console.error('[lipsync-upload]', e); }
    finally { setLipsyncUploadLoading(false); }
  };


  // ── 완료 판정 ──────────────────────────────────────────────────────────────
  // dialogue: lipsyncUrl 있으면 완료
  // narration: lipsyncUrl(MP삽입) 또는 bgUrl 있으면 완료
  const isDone = (s: SceneParsed) => {
    if (s.lipsyncUrl) return true;   // MP 삽입된 컷은 타입 무관하게 완료
    if (s.type === 'dialogue') return false;
    return !!s.bgUrl;
  };

  // ── 렌더 계산 ─────────────────────────────────────────────────────────────
  const scene    = scenes[selectedIdx] ?? null;
  const world    = seriesInfo?.world_data;
  const hasWorld = !!(world?.charAName || world?.charBName || world?.genre);

  const isConfirmed = confirmedCuts.has(scene?.sceneCode ?? '');

  // 컷별 자막 Y 위치 — localStorage('ld_subtitle_y_map') 기반
  const getSubtitleYMap = (): Record<string, number> => {
    try { const s = localStorage.getItem('ld_subtitle_y_map'); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  };
  const saveSubtitleY = (code: string, y: number) => {
    try {
      const map = getSubtitleYMap(); map[code] = y;
      localStorage.setItem('ld_subtitle_y_map', JSON.stringify(map));
    } catch {}
  };

  // 확정된 컷은 ▲▼ 잠금, 위치값 localStorage에 기록
  const subtitleUp = () => {
    if (!scene || isConfirmed) return;
    setSubtitleY(y => { const next = Math.max(0, y - SUBTITLE_STEP); saveSubtitleY(scene.sceneCode, next); return next; });
  };
  const subtitleDown = () => {
    if (!scene || isConfirmed) return;
    setSubtitleY(y => { const next = Math.min(100, y + SUBTITLE_STEP); saveSubtitleY(scene.sceneCode, next); return next; });
  };

  const subtitleStyle: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0,
    top: `${subtitleY}%`, transform: 'translateY(-50%)',
    padding: '12px 56px', transition: 'top 0.15s ease',
  };

  const cutType       = scene?.type ?? 'narration';
  const sceneHasChars = scene?.hasChars ?? false;
  const doneCount     = scenes.filter(isDone).length;

  return (
    <div className="relative -mt-[56px]" style={{ background: '#f8f9fb', minHeight: '100vh' }}>
      <style>{`
        @keyframes kf-zoom      { from{transform:scale(1)} to{transform:scale(1.08)} }
        @keyframes kf-slide     { from{transform:scale(1.05) translateX(-3%)} to{transform:scale(1.05) translateX(3%)} }
        @keyframes kf-gen-pulse { 0%,100%{opacity:0.55; background-color:rgba(124,58,237,0.07)} 50%{opacity:1; background-color:rgba(124,58,237,0.18)} }
        @keyframes spin         { to{transform:rotate(360deg)} }
      `}</style>

      {/* 세계관 바 */}
      {hasWorld && (
        <div className="sticky z-50 border-b"
          style={{ top: '56px', background: 'rgba(237,233,254,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderColor: 'rgba(167,139,250,0.3)' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
              {seriesInfo?.title && (
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 900, color: '#6d28d9', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  {seriesInfo.title}
                </span>
              )}
              {world?.genre && <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 500 }}>· {world.genre}</span>}
              {world?.charAName && world?.charBName && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#7c3aed', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900 }}>A</span>
                  {world.charAName}
                  <span style={{ color: '#c4b5fd' }}>↔</span>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900 }}>B</span>
                  {world.charBName}
                </span>
              )}
              {/* 성우 성별 토글 — 컷1에서만 표시 */}
              {selectedIdx === 0 && <button
                type="button"
                onClick={() => setTtsGender(g => g === 'female' ? 'male' : 'female')}
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px 3px 6px', borderRadius: 999,
                  background: ttsGender === 'male' ? 'rgba(59,130,246,0.1)' : 'rgba(236,72,153,0.1)',
                  border: `1px solid ${ttsGender === 'male' ? 'rgba(59,130,246,0.3)' : 'rgba(236,72,153,0.3)'}`,
                  color: ttsGender === 'male' ? '#1d4ed8' : '#9d174d',
                  fontSize: 11, fontWeight: 900, cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}>
                <span style={{ fontSize: 14 }}>{ttsGender === 'male' ? '👨' : '👩'}</span>
                나레이션
                <span style={{ fontWeight: 900 }}>{ttsGender === 'male' ? '남' : '여'}</span>
                <span style={{
                  position: 'relative', width: 24, height: 14, borderRadius: 999, flexShrink: 0,
                  background: ttsGender === 'male' ? '#3b82f6' : '#ec4899',
                  transition: 'background 0.2s ease', display: 'inline-block',
                }}>
                  <span style={{
                    position: 'absolute', top: 2,
                    left: ttsGender === 'male' ? 11 : 2,
                    width: 10, height: 10, borderRadius: '50%',
                    background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s ease', display: 'block',
                  }} />
                </span>
              </button>}
            </div>
          </div>
        </div>
      )}

      {/* 툴바 */}
      <div className="sticky z-50 border-b"
        style={{
          top: hasWorld ? '100px' : '56px',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderColor: 'rgba(15,23,42,0.08)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, flexWrap: 'nowrap' }}>

            {/* 뱃지 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ background: '#6366f1', color: 'white', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 900, letterSpacing: '0.06em' }}>AI</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>키프레임</span>
            </div>
            <div style={{ width: 1, height: 16, background: '#e5e7eb', flexShrink: 0 }} />

            {/* 시리즈 선택 */}
            <select value={seriesId} onChange={e => setSeriesId(e.target.value)}
              style={{ fontSize: 11, color: '#374151', fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: 'white', cursor: 'pointer', maxWidth: 200, flexShrink: 0 }}>
              <option value="">— 시리즈 선택 —</option>
              {seriesList.map(s => (
                <option key={s.id} value={s.id}>{s.title || s.topic || s.id.slice(0, 8)}</option>
              ))}
            </select>

            {/* Provider 선택 */}
            {(['gemini', 'pillow'] as const).map(p => (
              <button key={p} onClick={() => setProvider(p)} style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, flexShrink: 0,
                border: `1px solid ${provider === p ? 'rgba(99,102,241,0.5)' : '#e5e7eb'}`,
                background: provider === p ? 'rgba(99,102,241,0.08)' : 'white',
                color: provider === p ? '#6366f1' : '#9ca3af',
                cursor: 'pointer',
              }}>
                {p === 'gemini' ? '✨ Gemini' : '🎨 Pillow'}
              </button>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                {scenes.length > 0 ? `컷 ${scenes.length}개 · ${provider} · 16:9` : ''}
                {loadingResult && <span style={{ marginLeft: 8, color: '#a78bfa' }}> 로딩 중...</span>}
              </span>
            </div>

            {/* TTS 시작 버튼 — awaiting_tts 상태일 때만 표시 */}
            {seriesId && pipelineStep === 'awaiting_tts' && (
              <button onClick={handleStartTts} disabled={ttsStartLoading} style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, flexShrink: 0,
                border: '1px solid rgba(16,185,129,0.5)',
                background: ttsStartLoading ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.12)',
                color: ttsStartLoading ? '#6ee7b7' : '#059669',
                cursor: ttsStartLoading ? 'default' : 'pointer',
              }}>
                {ttsStartLoading ? '시작 중…' : '▶ TTS 시작'}
              </button>
            )}
            {seriesId && pipelineStep === 'tts' && (
              <span style={{ fontSize: 11, color: '#059669', fontWeight: 700, flexShrink: 0 }}>TTS 생성 중…</span>
            )}

            {/* Ken Burns 일괄 생성 버튼 */}
            {seriesId && (
              <button onClick={handleKenBurnsBatch} disabled={kbLoading} style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, flexShrink: 0,
                border: `1px solid ${kbLoading ? '#e5e7eb' : 'rgba(124,58,237,0.4)'}`,
                background: kbLoading ? '#f3f4f6' : 'rgba(124,58,237,0.08)',
                color: kbLoading ? '#9ca3af' : '#7c3aed',
                cursor: kbLoading ? 'default' : 'pointer',
              }}>
                {kbLoading ? '⏳ Ken Burns 생성 중…' : '🎬 Ken Burns 일괄'}
              </button>
            )}
            {kbResult && (
              <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0,
                color: kbResult.errors.length ? '#dc2626' : '#059669' }}>
                ✓ {kbResult.processed}개 생성 / {kbResult.skipped}개 스킵
                {kbResult.errors.length > 0 && ` / ⚠️ ${kbResult.errors.length}개 오류`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 40px', display: 'flex', gap: 24 }}>

        {/* ── 왼쪽 60% ── */}
        <div style={{ flex: '0 0 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 이미지/영상 뷰어 */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#1a1a2e', aspectRatio: '16/9', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            {scene?.lipsyncUrl ? (
              /* MP4 컷 — 무음 비디오 (▶ 버튼으로 MP3와 동시 재생) */
              <video
                ref={videoRef}
                key={scene.lipsyncUrl}
                src={scene.lipsyncUrl}
                loop
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (scene?.bgUrl || scene?.imageUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={scene.bgUrl || scene.imageUrl} alt=""
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

            {/* 이미지 생성 중 오버레이 */}
            {regenLoading && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(10,8,25,0.72)',
                backdropFilter: 'blur(4px)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: '3px solid rgba(167,139,250,0.2)',
                  borderTopColor: '#a78bfa',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>이미지 생성 중...</span>
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
              {scene && ttsDurationMap[scene.sceneCode] ? (
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 400 }}>
                  {ttsDurationMap[scene.sceneCode]}s
                </span>
              ) : null}
            </div>

            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={subtitleUp}   title="자막 위로"    disabled={subtitleY <= 0 || isConfirmed}   style={ctrlBtn(subtitleY <= 0 || isConfirmed)}>▲</button>
              <button onClick={subtitleDown} title="자막 아래로"  disabled={subtitleY >= 100 || isConfirmed} style={ctrlBtn(subtitleY >= 100 || isConfirmed)}>▼</button>
              <button onClick={togglePlay}   title={isPlaying ? '일시정지' : '재생'} disabled={!ttsUrl}
                style={{ ...ctrlBtn(!ttsUrl), background: isPlaying ? 'rgba(124,58,237,0.55)' : 'rgba(30,20,60,0.75)', borderColor: isPlaying ? '#a78bfa' : 'rgba(124,58,237,0.35)', color: !ttsUrl ? '#4b5563' : '#a78bfa' }}>
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>

            {/* 자막 overlay — 재생 중에만 표시, 문장 단위로 순차 노출 */}
            {isTyping && displayText && (
              <div style={subtitleStyle}>
                <p style={{
                  fontSize: 14, color: 'white', fontWeight: 600, lineHeight: 1.75,
                  margin: 0, textAlign: 'center', fontFamily: '"Noto Serif KR", serif',
                  textShadow: subtitleBg ? 'none' : '0 1px 6px rgba(0,0,0,0.9)',
                  whiteSpace: 'pre-wrap',
                  ...(subtitleBg ? { background: 'rgba(0,0,0,0.82)', borderRadius: 6, padding: '6px 12px' } : {}),
                }}>
                  {displayText}
                </p>
              </div>
            )}
          </div>

          {/* HINT + 대본 */}
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
            onEnded={() => {
              videoRef.current?.pause();
              if (videoRef.current) videoRef.current.currentTime = 0;
              setIsPlaying(false); setImgAnim(null);
              // 자막 타이머는 자연히 완료될 때까지 유지 (stopCharTimer는 타이머 완료 시 자동 호출)
            }}
            onPause={() => {
              videoRef.current?.pause();
              setIsPlaying(false); setImgAnim(null);
              // 명시적 일시정지(togglePlay)에서만 stopCharTimer 호출 — 여기서는 호출 안 함
            }}
            onPlay={() => setIsPlaying(true)}
            style={{ display: 'none' }}
          />

          {/* hidden file inputs */}
          <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBgUpload(f); e.target.value = ''; }} />
          <input ref={lipsyncInputRef} type="file" accept="video/mp4,video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLipsyncUpload(f); e.target.value = ''; }} />

          {/* 액션 버튼 — 타입별 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {(() => {
              const ttsDone = ttsDoneSet.has(scene?.sceneCode ?? '');
              const confirmed = confirmedCuts.has(scene?.sceneCode ?? '');
              const ttsBtn = { label: ttsLoading ? '생성 중…' : ttsDone ? 'TTS 재생성' : 'TTS 생성', icon: ttsLoading ? '⏳' : '🎙️', bg: ttsLoading ? '#f3f4f6' : ttsDone ? '#f0fdf4' : '#eff6ff', border: ttsLoading ? '#e5e7eb' : ttsDone ? '#bbf7d0' : '#bfdbfe', color: ttsLoading ? '#9ca3af' : ttsDone ? '#15803d' : '#1d4ed8', onClick: handleTts, disabled: ttsLoading || !scene?.text, badge: ttsDone };
              if (cutType === 'dialogue') return [
                ttsBtn,
                { label: regenLoading ? '생성 중…' : '이미지 교체', icon: regenLoading ? '⏳' : '🖼️', bg: '#f5f3ff', border: '#ddd6fe', color: '#6d28d9', onClick: handleRegenKeyframe, disabled: regenLoading || !scene || confirmed },
                { label: lipsyncUploadLoading ? '업로드 중…' : '립씽크 업로드', icon: lipsyncUploadLoading ? '⏳' : '🎬', bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', onClick: () => lipsyncInputRef.current?.click(), disabled: lipsyncUploadLoading || !scene || confirmed },
              ];
              if (sceneHasChars) return [
                ttsBtn,
                { label: bgUploadLoading ? '업로드 중…' : (scene?.bgUrl ? '배경 교체' : '배경 업로드'), icon: bgUploadLoading ? '⏳' : '⬆️', bg: scene?.bgUrl ? '#f0fdf4' : '#fff7ed', border: scene?.bgUrl ? '#bbf7d0' : '#fed7aa', color: scene?.bgUrl ? '#15803d' : '#c2410c', onClick: () => bgInputRef.current?.click(), disabled: bgUploadLoading || !scene || confirmed },
                { label: regenLoading ? '생성 중…' : '이미지 생성', icon: regenLoading ? '⏳' : '✨', bg: '#f5f3ff', border: '#ddd6fe', color: '#6d28d9', onClick: handleRegenKeyframe, disabled: regenLoading || !scene || confirmed },
              ];
              return [
                ttsBtn,
                { label: bgUploadLoading ? '업로드 중…' : '배경 업로드', icon: bgUploadLoading ? '⏳' : '⬆️', bg: '#fff7ed', border: '#fed7aa', color: '#c2410c', onClick: () => bgInputRef.current?.click(), disabled: bgUploadLoading || !scene || confirmed },
                { label: '—', icon: '🎞️', bg: '#f9fafb', border: '#e5e7eb', color: '#d1d5db', onClick: () => {}, disabled: true },
              ];
            })().map(({ label, icon, bg, border, color, onClick, disabled, badge }: { label: string; icon: string; bg: string; border: string; color: string; onClick: () => void; disabled: boolean; badge?: boolean }) => (
              <button key={label} onClick={onClick} disabled={disabled} style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: bg, border: `1px solid ${border}`,
                color, fontSize: 12, fontWeight: 700,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                position: 'relative',
              }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                {label}
                {badge && <span style={{
                  position: 'absolute', top: 4, right: 6,
                  background: '#059669', color: '#fff',
                  borderRadius: 999, fontSize: 9, fontWeight: 900,
                  padding: '1px 5px', lineHeight: 1.6,
                }}>✓</span>}
              </button>
            ))}
          </div>

          {/* 옵션 토글 행: 자막배경 | API사용 | MP삽입 */}
          <div style={{ display: 'flex', gap: 6 }}>
            {/* 자막배경 */}
            <button type="button" onClick={() => setSubtitleBg(v => {
                const next = !v;
                // 컷1에서 변경한 설정을 기본값으로 저장 → 이후 컷/세션에서 유지
                if (selectedIdx === 0) localStorage.setItem('ld_subtitle_bg', next ? '1' : '0');
                return next;
              })}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: subtitleBg ? '#1f2937' : '#f3f4f6',
                border: `1px solid ${subtitleBg ? '#374151' : '#e5e7eb'}`,
                cursor: 'pointer', transition: 'all 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <span style={{ fontSize: 11 }}>⬛</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: subtitleBg ? '#d1d5db' : '#6b7280' }}>자막배경</span>
              <span style={{ position: 'relative', width: 22, height: 13, borderRadius: 999, flexShrink: 0, background: subtitleBg ? '#4b5563' : '#d1d5db', transition: 'background 0.2s ease', display: 'inline-block' }}>
                <span style={{ position: 'absolute', top: 1.5, left: subtitleBg ? 10 : 1.5, width: 10, height: 10, borderRadius: '50%', background: subtitleBg ? '#e5e7eb' : '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.2s ease', display: 'block' }} />
              </span>
            </button>

            {/* API사용 — Gemini 이미지 생성 */}
            <button
              disabled={!scene || regenLoading || confirmedCuts.has(scene?.sceneCode ?? '')}
              onClick={handleRegenKeyframe}
              title={scene ? `컷 ${selectedIdx + 1} — ${provider} 이미지 생성` : '컷을 선택하세요'}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: regenLoading ? '#f3f4f6' : (scene ? '#eff6ff' : '#f9fafb'),
                border: `1px solid ${regenLoading ? '#e5e7eb' : (scene ? '#bfdbfe' : '#e5e7eb')}`,
                color: regenLoading ? '#9ca3af' : (scene ? '#1d4ed8' : '#d1d5db'),
                fontSize: 11, fontWeight: 700,
                cursor: (scene && !regenLoading) ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <span style={{ fontSize: 12 }}>{regenLoading ? '⏳' : '🤖'}</span>
              {regenLoading ? '생성 중...' : 'API사용'}
            </button>

            {/* MP삽입 — 현재 컷에 MP4 클립 업로드 */}
            <button
              disabled={!scene || lipsyncUploadLoading || confirmedCuts.has(scene?.sceneCode ?? '')}
              onClick={() => lipsyncInputRef.current?.click()}
              title={scene ? `컷 ${selectedIdx + 1} — MP4 클립 삽입` : '컷을 선택하세요'}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: lipsyncUploadLoading ? '#f3f4f6' : (scene?.lipsyncUrl ? '#f0fdf4' : (scene ? '#fdf4ff' : '#f9fafb')),
                border: `1px solid ${lipsyncUploadLoading ? '#e5e7eb' : (scene?.lipsyncUrl ? '#bbf7d0' : (scene ? '#e9d5ff' : '#e5e7eb'))}`,
                color: lipsyncUploadLoading ? '#9ca3af' : (scene?.lipsyncUrl ? '#15803d' : (scene ? '#7c3aed' : '#d1d5db')),
                fontSize: 11, fontWeight: 700,
                cursor: (scene && !lipsyncUploadLoading) ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <span style={{ fontSize: 12 }}>{lipsyncUploadLoading ? '⏳' : (scene?.lipsyncUrl ? '✅' : '🎬')}</span>
              {lipsyncUploadLoading ? '업로드 중...' : (scene?.lipsyncUrl ? 'MP교체' : 'MP삽입')}
            </button>
          </div>

          {/* 컷 확정 버튼 — 확정 후 편집 잠금, 재생만 허용 */}
          {scene && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              {confirmedCuts.has(scene.sceneCode) ? (
                <span style={{
                  fontSize: 11, fontWeight: 900, color: '#059669',
                  background: 'rgba(5,150,105,0.09)', border: '1px solid rgba(5,150,105,0.3)',
                  borderRadius: 8, padding: '7px 16px',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  ✓ {scene.sceneCode} 확정됨
                </span>
              ) : (
                <button
                  onClick={() => {
                    saveSubtitleY(scene.sceneCode, subtitleY); // 현재 자막 위치 고정
                    const next = new Set([...confirmedCuts, scene.sceneCode]);
                    setConfirmedCuts(next);
                    try { localStorage.setItem('ld_confirmed_cuts', JSON.stringify([...next])); } catch {}
                  }}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 900,
                    background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.28)',
                    color: '#4f46e5', cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  📌 {scene.sceneCode} 확정
                </button>
              )}
            </div>
          )}

          {/* ── 전체 대본 뷰 — 현재 컷 영역 하이라이트 ── */}
          {scenes.length > 0 && (
            <div style={{
              background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
              overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em' }}>RAW 대본</span>
                <span style={{ fontSize: 10, color: '#d1d5db' }}>컷 {selectedIdx + 1} / {scenes.length}</span>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {scenes.map((s, si) => {
                  const isCurrent = si === selectedIdx;
                  return (
                    <div
                      key={s.sceneCode}
                      ref={isCurrent ? scriptRowRef : null}
                      onClick={() => { setIsPlaying(false); setSelectedIdx(si); }}
                      style={{
                        padding: '9px 14px',
                        background: isCurrent ? 'rgba(245,158,11,0.07)' : 'transparent',
                        borderLeft: `3px solid ${isCurrent ? '#f59e0b' : 'transparent'}`,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        borderBottom: '1px solid #f9fafb',
                      }}
                    >
                      {/* 컷 헤더: 씬코드 + 타입 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 900, letterSpacing: '0.06em',
                          color: isCurrent ? '#b45309' : '#d1d5db',
                          fontFamily: 'monospace',
                        }}>
                          {sceneCodeSuffix(s.sceneCode)}
                        </span>
                        {s.isHook && (
                          <span style={{ fontSize: 8, fontWeight: 900, color: '#f59e0b' }}>HOOK</span>
                        )}
                        <span style={{
                          fontSize: 9, fontWeight: 700,
                          color: s.type === 'dialogue' ? '#3b82f6' : '#9ca3af',
                        }}>
                          {s.type === 'dialogue' ? `💬 ${s.speaker || '대사'}` : '나레이션'}
                        </span>
                      </div>
                      {/* 대본 텍스트 */}
                      <p style={{
                        fontSize: 12, lineHeight: 1.85, margin: 0,
                        color: isCurrent ? '#1f2937' : '#9ca3af',
                        fontWeight: isCurrent ? 500 : 400,
                        whiteSpace: 'pre-wrap',
                        fontFamily: '"Noto Serif KR", serif',
                      }}>
                        {s.text || '(대본 없음)'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 오른쪽 40%: 컷 그리드 + 프롬프트 ── */}
        <div style={{ flex: '0 0 40%', minWidth: 0 }}>
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
            padding: '16px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            position: 'sticky', top: (hasWorld ? 100 : 56) + 48 + 16,
            maxHeight: `calc(100vh - ${(hasWorld ? 100 : 56) + 48 + 32}px)`,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* 컷 목록 헤더 */}
            <div style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', marginBottom: 12, paddingLeft: 2, flexShrink: 0 }}>
              컷 목록 · {scenes.length}개{seriesId ? ' · ch1' : ''}
            </div>

            {/* 컷 그리드 — 내부 스크롤 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                  const hasBg = !!s.bgUrl;
                  const needsChar = s.hasChars && s.type !== 'dialogue';
                  const cutDone = isDone(s);
                  // 도트: 초록=완료 / 파란=대사씬 / 회색=미시작
                  const dotColor = cutDone
                    ? '#22c55e'
                    : s.type === 'dialogue'
                      ? '#3b82f6'
                      : '#9ca3af';
                  return (
                    <button key={si} onClick={() => { setIsPlaying(false); setSelectedIdx(si); }}
                      style={{
                        width: '100%', aspectRatio: '16/9', borderRadius: 7,
                        border: isSel
                          ? '2px solid #f59e0b'
                          : cutDone ? '1px solid #86efac' : '1px solid #e5e7eb',
                        cursor: 'pointer', transition: 'border-color 0.12s, transform 0.1s',
                        position: 'relative', overflow: 'hidden', padding: 0, background: 'transparent',
                        transform: isSel ? 'scale(1.03)' : 'scale(1)',
                        boxShadow: isSel ? '0 0 0 2px rgba(245,158,11,0.4)' : 'none',
                        zIndex: isSel ? 1 : 0,
                      }}>
                      {/* 썸네일 — bgUrl 이미지 / MP 삽입 시 🎬 배지 */}
                      {hasBg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.bgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : null}
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: hasBg
                          ? 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)'
                          : 'transparent',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                        padding: '0 6px 4px',
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.3, color: hasBg ? '#fff' : (isSel ? '#b45309' : '#9ca3af') }}>
                          <span style={{ display: 'block' }}>{si + 1}</span>
                          <span style={{ display: 'block', opacity: 0.75, fontSize: 11 }}>{sceneCodeSuffix(s.sceneCode)}</span>
                        </span>
                      </div>
                      {/* 우상단: hook 별 + MP배지 + 타입 도트 */}
                      <div style={{ position: 'absolute', top: 3, right: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                        {s.isHook && <span style={{ fontSize: 8, color: '#f59e0b', lineHeight: 1 }}>★</span>}
                        {s.lipsyncUrl && <span style={{ fontSize: 7, fontWeight: 900, color: '#7c3aed', lineHeight: 1, background: 'rgba(124,58,237,0.15)', padding: '1px 3px', borderRadius: 3 }}>MP</span>}
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                          background: dotColor,
                        }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>

            {/* ── 이미지 프롬프트 창 — 항상 하단 고정 ── */}
            {scene && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f6', flexShrink: 0 }}>
                {/* 헤더 */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', paddingLeft: 2, flex: 1 }}>
                    {cutType === 'dialogue' ? '이미지 프롬프트' : '배경 프롬프트'}
                  </span>
                  <button
                    onClick={() => {
                      if (!promptText) return;
                      try {
                        navigator.clipboard.writeText(promptText).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }).catch(() => {
                          const ta = document.createElement('textarea');
                          ta.value = promptText;
                          ta.style.position = 'fixed'; ta.style.opacity = '0';
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      } catch {
                        const ta = document.createElement('textarea');
                        ta.value = promptText;
                        ta.style.position = 'fixed'; ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }
                    }}
                    title="프롬프트 복사"
                    style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                      background: copied ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.07)',
                      border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.2)'}`,
                      color: copied ? '#059669' : '#6366f1',
                      cursor: promptText ? 'pointer' : 'default',
                      opacity: promptText ? 1 : 0.35, transition: 'all 0.15s',
                    }}
                  >
                    {copied ? '복사됨 ✓' : '복사'}
                  </button>
                  <span style={{
                    fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                    background: cutType === 'dialogue' ? 'rgba(249,115,22,0.1)'
                              : sceneHasChars          ? 'rgba(99,102,241,0.1)'
                              : 'rgba(156,163,175,0.15)',
                    color: cutType === 'dialogue' ? '#ea580c'
                         : sceneHasChars          ? '#4f46e5'
                         : '#6b7280',
                    border: `1px solid ${cutType === 'dialogue' ? 'rgba(249,115,22,0.3)'
                           : sceneHasChars ? 'rgba(99,102,241,0.25)' : 'rgba(156,163,175,0.3)'}`,
                  }}>
                    {cutType === 'dialogue' ? '💬 DIALOGUE' : sceneHasChars ? '👤 NARRATION' : '🎞️ KEN BURNS'}
                  </span>
                </div>

                {/* 프롬프트 — dialogue: OTS 단일 / narration: 배경 프롬프트 */}
                {cutType === 'dialogue' ? (
                  <textarea
                    value={promptLoading ? '' : promptText}
                    onChange={e => setPromptText(e.target.value)}
                    placeholder={promptLoading ? '⏳ 프롬프트 생성 중...' : 'OTS 합성 프롬프트'}
                    rows={10} disabled={promptLoading}
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, color: '#374151', background: '#f9fafb', resize: 'vertical', outline: 'none', fontFamily: 'inherit', opacity: promptLoading ? 0.5 : 1 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a5b4fc'; e.currentTarget.style.background = '#fff'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
                  />
                ) : (
                  <textarea
                    value={promptLoading ? '' : bgPromptText}
                    onChange={e => setBgPromptText(e.target.value)}
                    placeholder={promptLoading ? '⏳ 프롬프트 생성 중...' : '배경 이미지 프롬프트 — 복사 후 외부 생성 → 업로드'}
                    rows={10} disabled={promptLoading}
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, color: '#374151', background: '#f9fafb', resize: 'vertical', outline: 'none', fontFamily: 'inherit', opacity: promptLoading ? 0.5 : 1 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a5b4fc'; e.currentTarget.style.background = '#fff'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
                  />
                )}

                {/* 생성/업로드 버튼 — 타입별 */}
                {cutType === 'dialogue' ? (
                  <button
                    onClick={handleRegenKeyframe}
                    disabled={regenLoading || !scene}
                    style={{
                      marginTop: 8, width: '100%',
                      padding: '8px 0', borderRadius: 8,
                      background: regenLoading ? '#f3f4f6' : 'rgba(249,115,22,0.08)',
                      border: `1px solid ${regenLoading ? '#e5e7eb' : 'rgba(249,115,22,0.35)'}`,
                      color: regenLoading ? '#d1d5db' : '#c2410c',
                      fontSize: 11, fontWeight: 800,
                      cursor: regenLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      transition: 'all 0.15s',
                    }}>
                    {regenLoading
                      ? <><span style={{ fontSize: 12 }}>⏳</span> 생성 중...</>
                      : <><span style={{ fontSize: 12 }}>✨</span> 이미지 생성</>
                    }
                  </button>
                ) : (
                  <button
                    onClick={() => bgInputRef.current?.click()}
                    disabled={bgUploadLoading || !scene}
                    style={{
                      marginTop: 8, width: '100%',
                      padding: '8px 0', borderRadius: 8,
                      background: bgUploadLoading ? '#f3f4f6' : 'rgba(194,65,12,0.07)',
                      border: `1px solid ${bgUploadLoading ? '#e5e7eb' : 'rgba(194,65,12,0.3)'}`,
                      color: bgUploadLoading ? '#d1d5db' : '#c2410c',
                      fontSize: 11, fontWeight: 800,
                      cursor: (bgUploadLoading || !scene) ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      transition: 'all 0.15s',
                    }}>
                    {bgUploadLoading
                      ? <><span style={{ fontSize: 12 }}>⏳</span> 업로드 중...</>
                      : <><span style={{ fontSize: 12 }}>⬆️</span> 배경 업로드</>
                    }
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 챗봇 토글 버튼 ── */}
      <button
        onClick={() => setChatOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 28,
          right: chatOpen ? 404 : 20,
          zIndex: 300, width: 48, height: 48, borderRadius: '50%',
          background: chatOpen ? '#4f46e5' : 'rgba(79,70,229,0.92)',
          color: 'white', border: 'none',
          boxShadow: '0 4px 20px rgba(79,70,229,0.35)',
          cursor: 'pointer', fontSize: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'right 0.3s ease',
        }}
        title={chatOpen ? '닫기' : 'Gemini 어시스턴트'}
      >
        {chatOpen ? '✕' : '💬'}
      </button>

      {/* ── 챗봇 슬라이딩 패널 ── */}
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 384, zIndex: 200,
        transform: chatOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
        display: 'flex', flexDirection: 'column',
        background: '#fafafa',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.1)',
        borderLeft: '1px solid #e5e7eb',
      }}>
        {/* 헤더 */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>✨</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#1f2937' }}>Gemini 어시스턴트</span>
            <button
              onClick={() => {
                lastAnalyzedKey.current = '';
                setChatMessages([]);
                if (scene) autoAnalyze(scene);
              }}
              style={{ marginLeft: 'auto', fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
              재분석
            </button>
          </div>
          {scene && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
              {sceneCodeSuffix(scene.sceneCode)} · {scene.type === 'dialogue' ? `💬 ${scene.speaker || '대사'}` : '나레이션'}
            </div>
          )}
        </div>

        {/* 메시지 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chatMessages.map((m, i) => {
            // ── 자동 분석 레이블 ──
            if (m.role === 'auto') {
              return (
                <div key={i} style={{
                  alignSelf: 'center', fontSize: 10, color: '#6b7280',
                  background: '#f3f4f6', borderRadius: 20,
                  padding: '3px 12px', border: '1px solid #e5e7eb',
                }}>
                  {m.content}
                </div>
              );
            }
            const isLastStreaming = chatStreaming && i === chatMessages.length - 1;
            const isApplyable = m.role === 'model' && !isLastStreaming && m.content.length > 80;
            const isApplied = promptApplied === i;
            return (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
                {m.role === 'model' && (
                  <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 3, paddingLeft: 2 }}>Gemini</div>
                )}
                <div style={{
                  padding: '9px 12px',
                  borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.role === 'user' ? '#4f46e5' : 'white',
                  color: m.role === 'user' ? 'white' : '#1f2937',
                  border: m.role === 'model' ? '1px solid #e5e7eb' : 'none',
                  fontSize: 12, lineHeight: 1.75, whiteSpace: 'pre-wrap',
                  boxShadow: m.role === 'model' ? '0 1px 4px rgba(0,0,0,0.04)' : 'none',
                }}>
                  {m.content || (isLastStreaming
                    ? <span style={{ opacity: 0.5 }}>▍</span>
                    : '')}
                </div>
                {isApplyable && (
                  <button
                    onClick={() => {
                      setPromptText(m.content);
                      setPromptApplied(i);
                      setTimeout(() => setPromptApplied(null), 2000);
                    }}
                    style={{
                      marginTop: 4, padding: '3px 10px',
                      fontSize: 10, borderRadius: 6,
                      background: isApplied ? '#10b981' : '#f3f4f6',
                      color: isApplied ? 'white' : '#6b7280',
                      border: `1px solid ${isApplied ? '#10b981' : '#e5e7eb'}`,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {isApplied ? '✓ 프롬프트 적용됨' : '↳ 프롬프트로 적용'}
                  </button>
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* 입력 영역 */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid #e5e7eb', background: 'white', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="질문 입력… (Enter 전송 / Shift+Enter 줄바꿈)"
              disabled={chatStreaming}
              rows={4}
              style={{
                flex: 1, resize: 'none', padding: '10px 12px',
                borderRadius: 8, border: '1px solid #e5e7eb',
                fontSize: 14, lineHeight: 1.7, outline: 'none',
                fontFamily: 'inherit', background: chatStreaming ? '#f9fafb' : 'white',
              }}
            />
            <button
              onClick={sendChat}
              disabled={chatStreaming || !chatInput.trim()}
              style={{
                width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                background: (chatStreaming || !chatInput.trim()) ? '#e5e7eb' : '#4f46e5',
                color: (chatStreaming || !chatInput.trim()) ? '#9ca3af' : 'white',
                border: 'none', cursor: (chatStreaming || !chatInput.trim()) ? 'default' : 'pointer',
                fontSize: 16, fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {chatStreaming ? '⏳' : '↑'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
