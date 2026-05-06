// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Modal9x16 from '@/components/Modal9x16';
import { useSubtitleOverlay } from '@/hooks/useSubtitleOverlay';

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
  settings?: { keyframeProvider?: string; artStyle?: string; ttsGender?: 'female' | 'male' };
}

interface SceneParsed {
  id: string;           // v3_scenes.id (UUID) — 삭제 API 호출 시 사용
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
  kbMode: string;     // 'ken_burns' | 'hybrid' | '' — kenburns_service 마커
  ttsVoice: string;   // DB tts_voice 컬럼 (dialogue 컷 캐릭터 성우)
  storedTtsUrl: string; // DB tts_url 컬럼 (이미 생성된 TTS)
  sceneCharacters: string[]; // scene_meta.characters — 이 컷 등장인물
}

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
  const router = useRouter();

  // ── 시리즈 ────────────────────────────────────────────────────────────────
  const [seriesList, setSeriesList] = React.useState<SeriesSummary[]>([]);
  const [seriesId, setSeriesId]     = React.useState('');
  const [seriesInfo, setSeriesInfo] = React.useState<SeriesSummary | null>(null);

  // ── 씬/UI 상태 ──────────────────────────────────────────────────────────
  const [scenes, setScenes]           = React.useState<SceneParsed[]>([]);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [isPlaying, setIsPlaying]     = React.useState(false);
  const [loadingResult, setLoadingResult] = React.useState(false);
  const [ttsLoading, setTtsLoading]   = React.useState(false);
  const [ttsUrl, setTtsUrl]           = React.useState<string | null>(null);
  const [rawEditMode, setRawEditMode] = React.useState(false);
  const [rawEditText, setRawEditText] = React.useState('');
  const [ttsDoneSet, setTtsDoneSet]   = React.useState<Set<string>>(new Set());
  const [ttsDurationMap, setTtsDurationMap] = React.useState<Record<string, number>>({});
  const [imgAnim, setImgAnim]         = React.useState<'zoom' | 'slide' | null>(null);
  const [provider, setProvider]       = React.useState<'gemini' | 'pillow'>('gemini');
  const [promptText, setPromptText]   = React.useState('');
  const [regenLoading, setRegenLoading] = React.useState(false);
  const [promptLoading, setPromptLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [koTranslation, setKoTranslation] = React.useState('');
  const [translating, setTranslating] = React.useState(false);
  const [bgPromptText, setBgPromptText]         = React.useState('');
  const [bgUploadLoading, setBgUploadLoading]   = React.useState(false);
  const [gridPromptText, setGridPromptText]     = React.useState('');
  const [gridPromptLoading, setGridPromptLoading] = React.useState(false);
  const [gridCopied, setGridCopied]             = React.useState(false);
  const [lipsyncUploadLoading, setLipsyncUploadLoading] = React.useState(false);
  const [charPromptText, setCharPromptText] = React.useState('');
  const [pipelineStep, setPipelineStep] = React.useState('');
  const [ttsStartLoading, setTtsStartLoading] = React.useState(false);
  const [ttsGender, setTtsGender] = React.useState<'female' | 'male'>('female');
  const [kbLoading, setKbLoading] = React.useState(false);
  const [kbResult, setKbResult]   = React.useState<{processed:number;skipped:number;errors:string[]} | null>(null);
  const [kbSingleLoading, setKbSingleLoading] = React.useState(false);
  const [ttsBatchLoading, setTtsBatchLoading] = React.useState(false);
  const [ttsBatchMsg, setTtsBatchMsg]         = React.useState<string | null>(null);
  const [modal9x16Open, setModal9x16Open]     = React.useState(false);
  // 컷 삭제 로딩 상태 — 삭제 중인 컷 UUID를 저장 (버튼 비활성화용)
  const [deletingSceneId, setDeletingSceneId] = React.useState<string | null>(null);
  const [deleteMode, setDeleteMode]           = React.useState(false);
  const [mp4BtnHover, setMp4BtnHover]         = React.useState(false);
  // ── [임시] 폰트 테스트용 — 테스트 완료 후 삭제 ────────────────────────────
  const [previewFont, setPreviewFont] = React.useState(() => {
    try { return localStorage.getItem('ld_subtitle_font') || 'NotoSerifKR-Regular'; } catch { return 'NotoSerifKR-Regular'; }
  });

  // 마운트 시 전체 폰트 프리로드 → 선택 즉시 전환
  React.useEffect(() => {
    [
      'NotoSerifKR-Regular','NotoSerifKR-Black',
      'Pretendard-Regular','Pretendard-Medium',
      'PretendardJP-Regular','PretendardJP-SemiBold',
      'Montserrat-Regular','SeoulAlrim-Medium',
    ].forEach(f => document.fonts.load(`16px "${f}"`).catch(() => {}));
  }, []);

  // ── 자막 오버레이 hook ─────────────────────────────────────────────────────
  // 기존 인라인 charTimerRef + typingText + startTypingEffect + stopTypingEffect를
  // useSubtitleOverlay hook으로 통합. 16:9 기준 maxCharsPerLine=30 적용.
  const {
    displayText: typingText,
    stopCharTimer: stopTypingEffect,
    startTyping: startTypingHook,
    syncToAudio,
    subtitleBg, setSubtitleBg,
    subtitleY, subtitleUp, subtitleDown,
  } = useSubtitleOverlay('ld_subtitle_y', 'ld_subtitle_bg', 80);

  const audioRef        = React.useRef<HTMLAudioElement | null>(null);
  const videoRef        = React.useRef<HTMLVideoElement | null>(null);
  const playTimerRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgInputRef      = React.useRef<HTMLInputElement | null>(null);
  const lipsyncInputRef   = React.useRef<HTMLInputElement | null>(null);
  const gridUploadInputRef = React.useRef<HTMLInputElement | null>(null);
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

  // ── URL 파라미터 — 공식 라우터: ?series_id=... 필수 ─────────────────────
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('series_id');
    if (!sid) {
      // series_id 없으면 루트로 차단
      router.replace('/');
      return;
    }
    setSeriesId(sid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (s.settings?.ttsGender) setTtsGender(s.settings.ttsGender as 'female' | 'male');
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
          id: c.id,
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
          kbMode: (c as any).kb_mode || '',
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

        // output 폴더 → MP3/WAV duration 측정 + ttsDoneSet 보정
        const ofRes = await fetch(`${API}/series/${sid}/chapters/1/output-files`).catch(() => null);
        if (ofRes?.ok) {
          const of = await ofRes.json() as { tts_done: string[]; tts_durations: Record<string, number> };
          if (of.tts_done?.length) {
            setTtsDoneSet(prev => {
              const merged = new Set(prev);
              for (const code of of.tts_done) merged.add(code);
              return merged;
            });
          }
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
    // +0.5s 여백: 마지막 음절이 잘리지 않도록
    const actualDur = ttsDurationMap[sc?.sceneCode ?? ''];
    const sec = Math.max(2, (actualDur ?? sc?.estimatedSec ?? 4) + 0.5);
    playTimerRef.current = setTimeout(() => {
      setSelectedIdx(i => {
        if (i >= scenes.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, sec * 1000);
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  // ttsDurationMap이 업데이트(loadedmetadata)되면 타이머 재시작
  }, [isPlaying, selectedIdx, scenes, ttsDurationMap]);

  // ── 타이핑 자막 헬퍼 ─────────────────────────────────────────────────────
  // hook으로 통합됨 — stopTypingEffect / startTypingHook은 useSubtitleOverlay에서 제공

  // ── 씬 변경 시 TTS 초기화 + 프롬프트 조합 ────────────────────────────────
  React.useEffect(() => {
    setTtsLoading(false); setIsPlaying(false);
    setRawEditMode(false); setRawEditText('');
    setImgAnim(null); setCharPromptText('');
    stopTypingEffect();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute('src'); }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }

    const s = scenes[selectedIdx];
    if (!s || !seriesId) { setTtsUrl(null); setPromptText(''); setBgPromptText(''); return; }

    // DB에 저장된 TTS URL이 있으면 즉시 재생 가능하게 세팅
    setTtsUrl(s.storedTtsUrl || null);

    setPromptLoading(true);
    setPromptText('');
    setBgPromptText('');
    setKoTranslation('');
    fetch(`${API}/series/${seriesId}/scenes/${s.sceneCode}/compose-prompt`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.prompt)      setPromptText(d.prompt);
        if (d?.bg_prompt)   setBgPromptText(d.bg_prompt);
        if (d?.char_prompt) setCharPromptText(d.char_prompt);
        // 프롬프트 로드 완료 후 한국어 번역 요청
        const textToTranslate = d?.prompt || d?.bg_prompt || '';
        if (textToTranslate) {
          setTranslating(true);
          fetch(`${API}/series/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToTranslate }),
          })
            .then(r => r.ok ? r.json() : null)
            .then(t => { if (t?.korean) setKoTranslation(t.korean); })
            .catch(() => {})
            .finally(() => setTranslating(false));
        }
      })
      .catch(() => setPromptText(s.imageHint || ''))
      .finally(() => setPromptLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, seriesId, scenes.length]);

  // ── ?cut= URL 동기화 제거 — selectedIdx는 내부 state로만 관리 ──────────


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
  const togglePlay = () => {
    const audio = audioRef.current;
    const video = videoRef.current;
    const scene = scenes[selectedIdx];
    if (!audio || !ttsUrl || !scene?.text) return;
    if (isPlaying) {
      audio.pause(); video?.pause(); setIsPlaying(false); setImgAnim(null);
      stopTypingEffect();
    } else {
      const anim: 'zoom' | 'slide' = Math.random() < 0.5 ? 'zoom' : 'slide';
      setImgAnim(anim);
      if (video) { video.currentTime = 0; video.play().catch(() => {}); }
      setIsPlaying(true);
      const text = rawEditText || scene.text;
      // audio.timeupdate 기반 동기화 — TTS 속도와 정확히 일치
      const doPlay = () => {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        syncToAudio(audio, text);
      };
      // readyState < 2(HAVE_CURRENT_DATA) 이면 로드 후 재생 — cut=0 race condition 방지
      if (audio.readyState >= 2) {
        doPlay();
      } else {
        audio.load();
        audio.addEventListener('canplaythrough', doPlay, { once: true });
      }
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
      fd.append('text', rawEditText || scene.text);
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


  // ── 컷 삭제 ─────────────────────────────────────────────────────────────
  // HOOK 컷(isHook=true 또는 selectedIdx===0의 단독 컬럼)은 버튼 자체를 숨기므로
  // 여기서는 일반 컷만 처리한다. 백엔드에서도 HOOK 삭제 시 400 반환 (LD-001 이중 보호).
  const handleDeleteScene = async (targetScene: SceneParsed) => {
    // HOOK 컷 보호 — 프론트 1차 방어 (LD-001)
    if (targetScene.isHook || targetScene.sceneIndex === 0) return;
    if (!seriesId) return;
    if (!window.confirm('이 컷을 삭제하시겠습니까?')) return;

    setDeletingSceneId(targetScene.id);
    try {
      // chapter=1 고정 — 현재 키프레임 페이지는 챕터1만 표시 (local-scenes?chapter=1)
      const res = await fetch(
        `${API}/series/${seriesId}/chapters/1/scenes/${targetScene.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`삭제 실패: ${err.detail || res.status}`);
        return;
      }
      // 삭제 성공 → 전체 씬 목록 재로드 (scene_code 재번호화 반영)
      await loadAll(seriesId);
      // 선택 인덱스 경계 보정 — 마지막 컷이었으면 이전 컷으로 이동
      setSelectedIdx(prev => {
        const prevIdx = scenes.findIndex(s => s.id === targetScene.id);
        if (prevIdx < 0) return 0;
        // 재로드 후 scenes 길이는 아직 반영 전이므로 Math.max로 안전하게 처리
        return Math.max(0, prevIdx - (prevIdx >= scenes.length - 1 ? 1 : 0));
      });
    } catch (e) {
      console.error('[delete-scene]', e);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingSceneId(null);
    }
  };

  // ── Ken Burns 단일 컷 재생성 ────────────────────────────────────────────
  const handleKenBurnsSingle = async () => {
    const scene = scenes[selectedIdx];
    if (!seriesId || !scene || kbSingleLoading) return;
    setKbSingleLoading(true);
    try {
      const res = await fetch(`${API}/series/${seriesId}/scenes/${scene.sceneCode}/kenburns`, { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      console.log('[kenburns-single]', data);
      // 씬 목록 갱신 (새 mp4 반영)
      await loadAll(seriesId);
      // 캐시 버스팅: 동일 URL이어도 새 MP4 강제 로드
      const ts = Date.now();
      setScenes(prev => prev.map(sc =>
        sc.sceneCode === scene.sceneCode && sc.lipsyncUrl
          ? { ...sc, lipsyncUrl: sc.lipsyncUrl.replace(/[?&]t=\d+/, '') + '?t=' + ts }
          : sc
      ));
    } catch (e) { console.error('[kenburns-single]', e); }
    finally { setKbSingleLoading(false); }
  };

  // ── 챕터 내보내기 준비 — 전체 SRT 병합 + kr/en/jp 폴더 구성 ──────────────
  const handlePrepareExport = async () => {
    if (!seriesId || ttsBatchLoading) return;
    setTtsBatchLoading(true); setTtsBatchMsg(null);
    try {
      const res = await fetch(`${API}/series/${seriesId}/chapters/1/prepare-export`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setTtsBatchMsg(`실패: ${data.detail || res.status}`); return; }
      router.push(`/series/mp4combine?series_id=${seriesId}`);
    } catch (e) {
      setTtsBatchMsg('실패');
      console.error('[prepare-export]', e);
    } finally { setTtsBatchLoading(false); }
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

  // ── 4컷 그리드 프롬프트 — 세로 열 그룹(4컷) 변경 시 자동 로드 ───────────
  // 그룹 구조: UI 컷 격자의 열(column) 1개 = 연속 4컷 (index 0-3, 4-7, 8-11, ...)
  const [gridGroupCuts, setGridGroupCuts] = React.useState<string[]>([]);
  const [gridApiLoading, setGridApiLoading]       = React.useState(false);
  const [gridApiResult, setGridApiResult]         = React.useState<string | null>(null);
  const [gridUploadLoading, setGridUploadLoading] = React.useState(false);
  const prevGroupIndexRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!seriesId || scenes.length === 0) return;
    // LD-015 (2026-04-18): HOOK(scenes[0])은 단독 — 그룹 대상 아님
    // 정규 컷(scenes[1~]): 4컷 단위 그룹, HOOK 제외 후 offset +1
    if (selectedIdx === 0) { prevGroupIndexRef.current = null; return; }
    const regularIdx  = selectedIdx - 1;          // HOOK 제외 순번 (0-based)
    const groupIndex  = Math.floor(regularIdx / 4);
    if (prevGroupIndexRef.current === groupIndex) return;
    prevGroupIndexRef.current = groupIndex;

    const groupStart = groupIndex * 4 + 1;        // scenes 배열 기준 (scenes[0]=HOOK 건너뜀)
    const groupCuts = scenes.slice(groupStart, groupStart + 4);
    const groupCodes = groupCuts.map(c => c.sceneCode);
    setGridGroupCuts(groupCodes);
    setGridPromptText('');
    setGridPromptLoading(true);

    fetch(`${API}/series/${seriesId}/compose-grid-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_codes: groupCodes }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.grid_prompt) setGridPromptText(d.grid_prompt); })
      .catch(() => {})
      .finally(() => setGridPromptLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, seriesId, scenes.length]);

  // ── 4컷 API 생성 (NanoBanana Pro → 크롭 → R2 → DB 갱신) ─────────────────
  const handleGridApiGenerate = async () => {
    if (!seriesId || gridGroupCuts.length === 0 || gridApiLoading) return;
    setGridApiLoading(true);
    setGridApiResult(null);
    try {
      const res = await fetch(`${API}/series/${seriesId}/generate-grid-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_codes: gridGroupCuts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGridApiResult(`오류: ${data.detail || res.status}`);
        return;
      }
      setGridApiResult(`✓ ${data.cut_count}컷 생성 완료`);
      await loadAll(seriesId);  // 씬 목록 갱신 (새 keyframe_url 반영)
    } catch (e) {
      setGridApiResult(`오류: ${e}`);
    } finally {
      setGridApiLoading(false);
    }
  };

  // ── 4컷 그리드 이미지 업로드 ────────────────────────────────────────────
  const handleGridUpload = async (file: File) => {
    if (!seriesId || gridGroupCuts.length === 0 || gridUploadLoading) return;
    setGridUploadLoading(true);
    setGridApiResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scene_codes', JSON.stringify(gridGroupCuts));
      const res = await fetch(`${API}/series/${seriesId}/upload-grid-image`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setGridApiResult(`오류: ${data.detail || res.status}`);
        return;
      }
      setGridApiResult(`✓ ${data.cut_count}컷 업로드 완료`);
      await loadAll(seriesId);
    } catch (e) {
      setGridApiResult(`오류: ${e}`);
    } finally {
      setGridUploadLoading(false);
    }
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
  // narration: lipsyncUrl(MP삽입) 또는 bgUrl 또는 storedTtsUrl(TTS 완료) 있으면 완료
  const isDone = (s: SceneParsed) => {
    if (s.lipsyncUrl) return true;   // MP 삽입된 컷은 타입 무관하게 완료
    // dialogue / narration 공통: TTS(storedTtsUrl or ttsDoneSet) 있으면 완료
    if (s.storedTtsUrl || ttsDoneSet.has(s.sceneCode)) return true;
    if (s.type === 'dialogue') return false;  // dialogue는 TTS 없으면 미완료
    return !!s.bgUrl;  // narration: 배경 이미지만 있어도 완료
  };

  // ── 렌더 계산 ─────────────────────────────────────────────────────────────
  const scene    = scenes[selectedIdx] ?? null;
  const world    = seriesInfo?.world_data;
  const hasWorld = !!(world?.charAName || world?.charBName || world?.genre);

  const cutType       = scene?.type ?? 'narration';
  const sceneHasChars = scene?.hasChars ?? false;
  const doneCount     = scenes.filter(isDone).length;

  return (
    <>
    <div className="kf-page relative -mt-[82px]" style={{ background: '#f8f9fb', minHeight: '100vh' }}>
      <style>{`
        @keyframes kf-zoom      { from{transform:scale(1)} to{transform:scale(1.08)} }
        @keyframes kf-slide     { from{transform:scale(1.05) translateX(-3%)} to{transform:scale(1.05) translateX(3%)} }
        @keyframes kf-gen-pulse { 0%,100%{opacity:0.55; background-color:rgba(124,58,237,0.07)} 50%{opacity:1; background-color:rgba(124,58,237,0.18)} }
        @keyframes spin         { to{transform:rotate(360deg)} }
      `}</style>

      {/* 세계관 바 */}
      {hasWorld && (
        <div className="sticky z-50 border-b"
          style={{ top: '82px', background: 'rgba(237,233,254,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderColor: 'rgba(167,139,250,0.3)' }}>
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
                onClick={() => {
                  const next = ttsGender === 'female' ? 'male' : 'female';
                  setTtsGender(next);
                  if (seriesId) fetch(`${API}/series/${seriesId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: { ...seriesInfo?.settings, ttsGender: next } }),
                  }).catch(() => {});
                }}
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
          top: hasWorld ? '126px' : '82px',
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

            {/* 컷 삭제 모드 토글 */}
            {seriesId && (
              <button
                onClick={() => setDeleteMode(v => !v)}
                style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, flexShrink: 0,
                  border: `1px solid ${deleteMode ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.25)'}`,
                  background: deleteMode ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.06)',
                  color: deleteMode ? '#ef4444' : '#f87171',
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                {deleteMode ? '🗑 삭제 중…' : '🗑 컷 삭제'}
              </button>
            )}


            {/* MP4 합성 — SRT 생성 후 합성 페이지로 이동 */}
            {seriesId && scenes.length > 0 && (
              <button
                onClick={handlePrepareExport}
                disabled={ttsBatchLoading}
                onMouseEnter={() => setMp4BtnHover(true)}
                onMouseLeave={() => setMp4BtnHover(false)}
                style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, flexShrink: 0,
                  border: `1px solid ${ttsBatchLoading ? 'rgba(63,63,70,0.4)' : mp4BtnHover ? 'rgba(99,102,241,0.9)' : 'rgba(99,102,241,0.5)'}`,
                  background: ttsBatchLoading ? 'rgba(63,63,70,0.08)' : mp4BtnHover ? 'rgba(99,102,241,0.28)' : 'rgba(99,102,241,0.15)',
                  color: ttsBatchLoading ? '#52525b' : mp4BtnHover ? '#a5b4fc' : '#818cf8',
                  cursor: ttsBatchLoading ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.15s',
                  boxShadow: (!ttsBatchLoading && mp4BtnHover) ? '0 4px 14px rgba(99,102,241,0.35)' : '0 1px 3px #333333',
                }}>
                {ttsBatchLoading ? '⏳ 내보내기 중…' : '▶ MP4 합성'}
              </button>
            )}

          </div>
        </div>
      </div>

      {/* ── 공통 컨테이너: 컷 그리드 + 본문 ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '6px 16px 20px' }}>

        {/* 컷 그리드 — LD-015: HOOK 단독 컬럼 | 정규 컷 그리드 */}
        {scenes.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '6px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', marginBottom: 10, width: 'fit-content', margin: '0 auto 10px', display: 'flex', alignItems: 'flex-start', gap: 0 }}>

            {/* HOOK 단독 컬럼 (scenes[0]) */}
            {scenes[0] && (() => {
              const s = scenes[0];
              const isSel = selectedIdx === 0;
              const hasBg = !!s.bgUrl;
              const cutDone = isDone(s);
              const dotColor = cutDone ? '#22c55e' : '#9ca3af';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingRight: 6, marginRight: 6, borderRight: '2px dashed rgba(245,158,11,0.4)' }}>
                  <button onClick={() => { setIsPlaying(false); setSelectedIdx(0); }}
                    style={{ width: 110, height: 44, borderRadius: 5, border: isSel ? '2px solid #f59e0b' : '1px solid rgba(245,158,11,0.35)', cursor: 'pointer', position: 'relative', overflow: 'hidden', padding: 0, background: hasBg ? 'transparent' : (isSel ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.04)'), boxShadow: isSel ? '0 0 0 2px rgba(245,158,11,0.3)' : 'none', zIndex: isSel ? 1 : 0 }}>
                    {hasBg
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={s.bgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: isSel ? 1 : 0.6, filter: isSel ? 'none' : 'grayscale(100%)' }} />
                      : null}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, background: hasBg ? 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 60%)' : 'transparent' }}>
                      <span style={{ fontSize: 8, fontWeight: 900, color: '#f59e0b', fontFamily: "var(--font-en), 'Pretendard', sans-serif", lineHeight: 1 }}>HOOK</span>
                      <span style={{ fontSize: 10, color: hasBg ? 'rgba(255,255,255,0.85)' : '#b45309', fontFamily: "var(--font-en), 'Pretendard', sans-serif", lineHeight: 1 }}>{sceneCodeSuffix(s.sceneCode)}</span>
                    </div>
                    <div style={{ position: 'absolute', top: 2, right: 2 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', display: 'inline-block', background: dotColor }} />
                    </div>
                    <div style={{ position: 'absolute', bottom: 2, left: 2, display: 'flex', flexDirection: 'row', gap: 2 }}>
                      {s.lipsyncUrl && <span style={{ fontSize: 8, fontWeight: 700, color: '#fbbf24', background: 'rgba(0,0,0,0.72)', padding: '1px 3px', borderRadius: 2, lineHeight: 1.2 }}>{s.kbMode === 'ken_burns' ? 'K' : s.kbMode === 'hybrid' ? 'K+영상' : '영상'}</span>}
                      {(s.storedTtsUrl || ttsDoneSet.has(s.sceneCode)) && <span style={{ fontSize: 8, fontWeight: 700, color: '#6ee7b7', background: 'rgba(0,0,0,0.72)', padding: '1px 3px', borderRadius: 2, lineHeight: 1.2 }}>더빙</span>}
                    </div>
                  </button>
                  {/* 나머지 3행: 빈 칸 (높이 맞춤) */}
                  {[0, 1, 2].map(i => (
                    <div key={`hook-pad-${i}`} style={{ width: 110, height: 44, borderRadius: 5, background: 'rgba(245,158,11,0.03)', border: '1px dashed rgba(245,158,11,0.1)' }} />
                  ))}
                </div>
              );
            })()}

            {/* 정규 컷 그리드 (scenes[1~]: nc01부터) */}
            <div style={{ display: 'grid', gridTemplateRows: 'repeat(4, 44px)', gridAutoFlow: 'column', gridAutoColumns: '110px', gap: 3 }}>
              {scenes.slice(1).map((s, si) => {
                const actualSi = si + 1;
                const isSel = actualSi === selectedIdx;
                const hasBg = !!s.bgUrl;
                const cutDone = isDone(s);
                const dotColor = cutDone ? '#22c55e' : s.type === 'dialogue' ? '#3b82f6' : '#9ca3af';
                const label = sceneCodeSuffix(s.sceneCode);
                return (
                  // 컷 카드 — relative 컨테이너로 감싸 삭제 버튼 오버레이
                  <div key={s.id} style={{ position: 'relative', width: '100%', height: 44 }}>
                    <button onClick={() => { setIsPlaying(false); setSelectedIdx(actualSi); }}
                      style={{ width: '100%', height: 44, borderRadius: 5, border: isSel ? '3px solid #f59e0b' : cutDone ? '1px solid #86efac' : '1px solid #e5e7eb', cursor: 'pointer', transition: 'border-color 0.12s, box-shadow 0.12s', position: 'relative', overflow: 'hidden', padding: 0, background: hasBg ? 'transparent' : (isSel ? 'rgba(245,158,11,0.12)' : '#f9fafb'), boxShadow: isSel ? '0 0 0 3px rgba(245,158,11,0.5), inset 0 0 0 1px rgba(245,158,11,0.3)' : 'none', zIndex: isSel ? 1 : 0 }}>
                      {hasBg
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={s.bgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: isSel ? 1 : 0.6, filter: isSel ? 'none' : 'grayscale(100%)' }} />
                        : null}
                      {isSel && <div style={{ position: 'absolute', inset: 0, background: 'rgba(245,158,11,0.18)', pointerEvents: 'none' }} />}
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: hasBg ? 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)' : 'transparent' }}>
                        <span style={{ fontSize: 11, fontWeight: isSel ? 700 : 400, color: hasBg ? 'rgba(255,255,255,0.9)' : (isSel ? '#b45309' : '#9ca3af'), fontFamily: "var(--font-en), 'Pretendard', sans-serif", lineHeight: 1 }}>{label}</span>
                      </div>
                      <div style={{ position: 'absolute', top: 2, right: 2 }}>
                        {s.isHook && <span style={{ fontSize: 7, color: '#f59e0b', lineHeight: 1 }}>★</span>}
                        <span style={{ width: 5, height: 5, borderRadius: '50%', display: 'inline-block', background: dotColor }} />
                      </div>
                      <div style={{ position: 'absolute', bottom: 2, left: 2, display: 'flex', flexDirection: 'row', gap: 2 }}>
                        {s.lipsyncUrl && <span style={{ fontSize: 8, fontWeight: 700, color: '#fbbf24', background: 'rgba(0,0,0,0.72)', padding: '1px 3px', borderRadius: 2, lineHeight: 1.2 }}>{s.kbMode === 'ken_burns' ? 'K' : s.kbMode === 'hybrid' ? 'K+영상' : '영상'}</span>}
                        {(s.storedTtsUrl || ttsDoneSet.has(s.sceneCode)) && <span style={{ fontSize: 8, fontWeight: 700, color: '#6ee7b7', background: 'rgba(0,0,0,0.72)', padding: '1px 3px', borderRadius: 2, lineHeight: 1.2 }}>더빙</span>}
                      </div>
                    </button>
                    {/* 삭제 버튼 — deleteMode ON + HOOK 아닐 때만 노출 (LD-001 보호) */}
                    {deleteMode && !s.isHook && (
                      <button
                        title="이 컷 삭제"
                        disabled={deletingSceneId === s.id}
                        onClick={e => { e.stopPropagation(); handleDeleteScene(s); }}
                        style={{
                          position: 'absolute', top: 1, left: 1, zIndex: 10,
                          width: 14, height: 14, borderRadius: 3,
                          background: deletingSceneId === s.id ? 'rgba(150,50,50,0.7)' : 'rgba(239,68,68,0.82)',
                          border: 'none',
                          color: '#fff', fontSize: 8, fontWeight: 900,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: deletingSceneId === s.id ? 'default' : 'pointer',
                          lineHeight: 1, padding: 0,
                          opacity: isSel ? 1 : 0.7,
                          transition: 'opacity 0.15s, background 0.15s',
                        }}
                      >
                        {deletingSceneId === s.id ? '…' : '✕'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* 본문 */}
        <div style={{ display: 'flex', gap: 14 }}>

        {/* ── 왼쪽 60% ── */}
        <div style={{ flex: '0 0 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* 이미지/영상 뷰어 */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#1a1a2e', aspectRatio: '16/9', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            {scene?.lipsyncUrl ? (
              /* MP4 컷 — 무음 비디오 (▶ 버튼으로 MP3와 동시 재생) */
              <video
                ref={videoRef}
                key={scene.lipsyncUrl}
                src={scene.lipsyncUrl}
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

            {/* [임시] 폰트 선택 드롭다운 — 테스트 완료 후 삭제 (selectedIdx===0일 때만 표시) */}
            {selectedIdx === 0 && <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
              <select
                value={previewFont}
                onChange={e => {
                  setPreviewFont(e.target.value);
                  try { localStorage.setItem('ld_subtitle_font', e.target.value); } catch {}
                }}
                style={{
                  fontSize: 13, padding: '2px 8px', borderRadius: 5,
                  background: 'rgba(0,0,0,0.7)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer',
                }}
              >
                <option value="NotoSerifKR-Regular">NotoSerifKR Regular</option>
                <option value="NotoSerifKR-Black">NotoSerifKR Black</option>
                <option value="Pretendard-Regular">Pretendard Regular</option>
                <option value="Pretendard-Medium">Pretendard Medium</option>
                <option value="PretendardJP-Regular">PretendardJP Regular</option>
                <option value="PretendardJP-SemiBold">PretendardJP SemiBold</option>
                <option value="Montserrat-Regular">Montserrat Regular</option>
                <option value="SeoulAlrim-Medium">SeoulAlrim Medium</option>
              </select>
            </div>}

            {/* 자막 오버레이 — 16:9 (58번 문서 §12 기준) */}
            {typingText && (
              <div style={{
                position: 'absolute', bottom: `${100 - subtitleY}%`, left: '50%', transform: 'translateX(-50%)',
                maxWidth: '88%', textAlign: 'center',
                color: '#ffffff',
                fontFamily: `"${previewFont}", serif`,
                fontSize: 'clamp(13px, 1.6vw, 26px)',
                fontWeight: 400,
                lineHeight: 1.4,
                background: subtitleBg ? 'rgba(0,0,0,0.75)' : 'transparent',
                textShadow: subtitleBg ? 'none' : '0 1px 8px rgba(0,0,0,0.95)',
                padding: '6px 16px',
                borderRadius: 4,
                pointerEvents: 'none',
              }}>
                {typingText}
              </div>
            )}

            {scene && (
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <span style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: '#FFFFFF', fontSize: 12, fontWeight: 400, padding: '3px 10px', borderRadius: 6, fontFamily: "var(--font-en), 'Pretendard', sans-serif", border: '1px solid rgba(124,58,237,0.3)' }}>
                  {seriesInfo?.title
                    ? `${seriesInfo.title} - ${parseInt(scene.sceneCode.match(/ch(\d+)/i)?.[1] ?? '1')}화`
                    : scene.sceneCode || `S${String(selectedIdx + 1).padStart(2, '0')}`}
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

            {/* ── 자막 위치 ▲▼ — 왼쪽 (cut=0 전용) */}
            {selectedIdx === 0 && (
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => subtitleUp('')} title="자막 위로"
                  style={{ ...ctrlBtn(false), fontSize: 14 }}>▲</button>
                <button onClick={() => subtitleDown('')} title="자막 아래로"
                  style={{ ...ctrlBtn(false), fontSize: 14 }}>▼</button>
              </div>
            )}

            {/* ── 재생 버튼 그룹 — 프리뷰 중앙 */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              {/* 16:9 재생 */}
              <button onClick={togglePlay} title={isPlaying ? '일시정지' : '16:9 재생'} disabled={!ttsUrl}
                style={{ ...ctrlBtn(!ttsUrl), background: isPlaying ? 'rgba(124,58,237,0.55)' : 'rgba(30,20,60,0.75)', borderColor: isPlaying ? '#a78bfa' : 'rgba(124,58,237,0.35)', color: !ttsUrl ? '#4b5563' : '#a78bfa', flexDirection: 'column', width: 48, height: 48, fontSize: 9 }}>
                {isPlaying ? '⏸' : '▶'}
                <span style={{ fontSize: 8, marginTop: 2, opacity: 0.8 }}>16:9</span>
              </button>
              {/* 9:16 재생 */}
              {seriesId && scene && (
                <button onClick={() => setModal9x16Open(true)} title="9:16 미리보기"
                  style={{ ...ctrlBtn(false), background: 'rgba(30,20,60,0.75)', borderColor: 'rgba(245,158,11,0.5)', color: '#fbbf24', flexDirection: 'column', width: 48, height: 48, fontSize: 9 }}>
                  ▶
                  <span style={{ fontSize: 8, marginTop: 2, opacity: 0.8 }}>9:16</span>
                </button>
              )}
            </div>
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
              setIsPlaying(false); setImgAnim(null); stopTypingEffect();
            }}
            onPause={() => {
              videoRef.current?.pause();
              setIsPlaying(false); setImgAnim(null); stopTypingEffect();
            }}
            onPlay={() => setIsPlaying(true)}
            style={{ display: 'none' }}
          />

          {/* hidden file inputs */}
          <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBgUpload(f); e.target.value = ''; }} />
          <input ref={lipsyncInputRef} type="file" accept="video/mp4,video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLipsyncUpload(f); e.target.value = ''; }} />
          <input ref={gridUploadInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleGridUpload(f); e.target.value = ''; }} />

          {/* ── 전체 대본 뷰 — 현재 컷 영역 하이라이트 ── */}
          {scenes.length > 0 && (
            <div style={{
              background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
              overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em' }}>RAW 대본</span>
                <span style={{ fontSize: 10, color: '#d1d5db' }}>컷 {selectedIdx + 1} / {scenes.length}</span>
                <button
                  onClick={async () => {
                    if (rawEditMode) {
                      const sc = scenes[selectedIdx];
                      if (sc && rawEditText !== sc.text) {
                        await fetch(`${API}/series/${seriesId}/scenes/${sc.sceneCode}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ text: rawEditText }),
                        });
                        setScenes(prev => prev.map((s, i) => i === selectedIdx ? { ...s, text: rawEditText } : s));
                      }
                      setRawEditMode(false);
                    } else {
                      setRawEditText(scenes[selectedIdx]?.text || '');
                      setRawEditMode(true);
                    }
                  }}
                  style={{
                    marginLeft: 'auto', padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: rawEditMode ? '#d1fae5' : '#f3f4f6',
                    border: `1px solid ${rawEditMode ? '#6ee7b7' : '#e5e7eb'}`,
                    color: rawEditMode ? '#059669' : '#6b7280',
                    cursor: 'pointer',
                  }}>
                  {rawEditMode ? '✓ 완료' : '수정'}
                </button>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {scenes.map((s, si) => {
                  const isCurrent = si === selectedIdx;
                  return (
                    <div
                      key={s.id}
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
                          fontFamily: "var(--font-en), 'Pretendard', sans-serif",
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
                      {isCurrent && rawEditMode
                        ? <textarea
                            value={rawEditText}
                            onChange={e => setRawEditText(e.target.value)}
                            onClick={ev => ev.stopPropagation()}
                            rows={5}
                            style={{
                              width: '100%', boxSizing: 'border-box', resize: 'vertical',
                              fontSize: 12, lineHeight: 1.85, color: '#1f2937',
                              fontFamily: '"Noto Serif KR", serif',
                              border: '1px solid #a5b4fc', borderRadius: 6,
                              padding: '6px 8px', outline: 'none', background: '#fafafa',
                            }}
                          />
                        : <p style={{
                            fontSize: 12, lineHeight: 1.85, margin: 0,
                            color: isCurrent ? '#1f2937' : '#9ca3af',
                            fontWeight: isCurrent ? 500 : 400,
                            whiteSpace: 'pre-wrap',
                            fontFamily: '"Noto Serif KR", serif',
                          }}>
                            {isCurrent && rawEditText ? rawEditText : (s.text || '(대본 없음)')}
                          </p>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 오른쪽 40%: 버튼 + 프롬프트 ── */}
        <div style={{ flex: '0 0 40%', minWidth: 0 }}>
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
            padding: '10px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            position: 'sticky', top: (hasWorld ? 126 : 82) + 48 + 16,
            display: 'flex', flexDirection: 'column',
          }}>
            {/* ── 액션 버튼 그리드 ── */}
            {scene && (
              <div style={{ flexShrink: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  {/* TTS 생성 */}
                  <button
                    onClick={handleTts}
                    disabled={ttsLoading || !scene?.text}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 400,
                      background: ttsLoading ? '#f3f4f6' : ttsDoneSet.has(scene.sceneCode) ? '#f0fdf4' : '#eff6ff',
                      border: `1px solid ${ttsLoading ? '#e5e7eb' : ttsDoneSet.has(scene.sceneCode) ? '#bbf7d0' : '#bfdbfe'}`,
                      color: ttsLoading ? '#9ca3af' : ttsDoneSet.has(scene.sceneCode) ? '#15803d' : '#1d4ed8',
                      cursor: (ttsLoading || !scene?.text) ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}>
                    {ttsLoading ? '⏳ TTS 생성 중…' : '① TTS 생성'}
                  </button>
                  {/* 켄번스 재생성 */}
                  <button
                    onClick={handleKenBurnsSingle}
                    disabled={!scene || kbSingleLoading}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 400,
                      background: kbSingleLoading ? '#f3f4f6' : '#fefce8',
                      border: `1px solid ${kbSingleLoading ? '#e5e7eb' : '#fde68a'}`,
                      color: kbSingleLoading ? '#9ca3af' : '#92400e',
                      cursor: (scene && !kbSingleLoading) ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}>
                    {kbSingleLoading ? '⏳ 켄번스 생성 중…' : '② 켄번스 재생성'}
                  </button>
                  {/* MP4 교체 */}
                  <button
                    onClick={() => lipsyncInputRef.current?.click()}
                    disabled={!scene || lipsyncUploadLoading}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 400,
                      background: lipsyncUploadLoading ? '#6b7280' : '#ede9fe',
                      border: `1px solid ${lipsyncUploadLoading ? '#555555' : '#c4b5fd'}`,
                      color: lipsyncUploadLoading ? '#ffffff' : '#6d28d9',
                      cursor: (scene && !lipsyncUploadLoading) ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}>
                    <span style={{ fontSize: 12 }}>{lipsyncUploadLoading ? '⏳' : scene.lipsyncUrl ? '✅' : '🎬'}</span>
                    MP4 교체
                  </button>
                  {/* 이미지 교체 */}
                  <button
                    onClick={() => bgInputRef.current?.click()}
                    disabled={bgUploadLoading || !scene}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 400,
                      background: bgUploadLoading ? '#6b7280' : '#999999',
                      border: '1px solid #555555',
                      color: '#ffffff',
                      cursor: bgUploadLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}>
                    <span style={{ fontSize: 13 }}>{bgUploadLoading ? '⏳' : '🖼️'}</span>
                    이미지 교체
                  </button>
                  {/* API 사용 */}
                  <button
                    onClick={handleRegenKeyframe}
                    disabled={!scene || regenLoading}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 400,
                      background: regenLoading ? '#6b7280' : '#999999',
                      border: '1px solid #555555',
                      color: '#ffffff',
                      cursor: (scene && !regenLoading) ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}>
                    <span style={{ fontSize: 12 }}>{regenLoading ? '⏳' : '🤖'}</span>
                    API 사용
                  </button>
                  {/* 자막배경 토글 — cut=0에서만 표시 */}
                  {selectedIdx === 0 && (
                    <button
                      onClick={() => setSubtitleBg(!subtitleBg)}
                      style={{
                        padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 700,
                        background: subtitleBg ? 'rgba(124,58,237,0.18)' : 'rgba(30,20,60,0.06)',
                        border: `1px solid ${subtitleBg ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.2)'}`,
                        color: subtitleBg ? '#a78bfa' : '#6d28d9',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        transition: 'all 0.15s',
                      }}>
                      자막배경 {subtitleBg ? 'ON' : 'OFF'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── 4컷 그리드 영역 — HOOK 단독 컬럼은 제외 (LD-015) ── */}
            {scene && selectedIdx > 0 && (
              <div style={{ marginTop: 4 }}>
                {/* 4컷 API 생성 + 새로고침 + 업로드 버튼 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  <button
                    onClick={handleGridApiGenerate}
                    disabled={gridApiLoading || gridUploadLoading}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 900,
                      background: gridApiLoading ? 'rgba(107,114,128,0.05)' : 'rgba(99,102,241,0.07)',
                      border: `1px solid ${gridApiLoading ? 'rgba(107,114,128,0.18)' : 'rgba(99,102,241,0.28)'}`,
                      color: gridApiLoading ? '#9ca3af' : '#4f46e5',
                      cursor: (gridApiLoading || gridUploadLoading) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    {gridApiLoading
                      ? <><svg width={11} height={11} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="30 70" strokeLinecap="round"/></svg>생성 중...</>
                      : '🔲 4컷 API 생성'}
                  </button>
                  {/* 새로고침 */}
                  <button
                    onClick={() => { window.location.reload(); }}
                    title="새로고침 (Ctrl+Shift+R)"
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                      background: '#666666',
                      border: '1px solid #888888',
                      color: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#777777'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#666666'; }}
                  >
                    ↻ 새로고침
                  </button>
                  <button
                    onClick={() => gridUploadInputRef.current?.click()}
                    disabled={gridUploadLoading || gridApiLoading}
                    style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 900,
                      background: gridUploadLoading ? 'rgba(107,114,128,0.05)' : 'rgba(16,185,129,0.07)',
                      border: `1px solid ${gridUploadLoading ? 'rgba(107,114,128,0.18)' : 'rgba(16,185,129,0.28)'}`,
                      color: gridUploadLoading ? '#9ca3af' : '#059669',
                      cursor: (gridUploadLoading || gridApiLoading) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    {gridUploadLoading
                      ? <><svg width={11} height={11} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="30 70" strokeLinecap="round"/></svg>업로드 중...</>
                      : '📤 4컷 이미지 업로드'}
                  </button>
                </div>
                <div style={{ borderBottom: '1px solid rgba(0,0,0,0.1)', margin: '8px 0 4px' }} />
                {gridApiResult && (
                  <div style={{ fontSize: 10, color: gridApiResult.startsWith('✓') ? '#059669' : '#dc2626', marginTop: 4, paddingLeft: 2 }}>
                    {gridApiResult}
                  </div>
                )}
                {/* 4컷 그리드 프롬프트 — 항상 표시 (컷 선택 시 자동 로드) */}
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', paddingLeft: 2, flex: 1 }}>
                      4컷 그리드 프롬프트
                      {gridGroupCuts.length > 0 && (
                        <span style={{ fontWeight: 600, color: '#6b7280', marginLeft: 4 }}>
                          ({gridGroupCuts.map(c => c.replace(/^\d{8}_\d{6}_ch\d+/, '')).join(', ')})
                        </span>
                      )}
                    </span>
                    {gridPromptLoading && (
                      <svg width={10} height={10} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="30 70" strokeLinecap="round"/>
                      </svg>
                    )}
                    <button
                      onClick={() => {
                        if (!gridPromptText) return;
                        try {
                          navigator.clipboard.writeText(gridPromptText).then(() => {
                            setGridCopied(true); setTimeout(() => setGridCopied(false), 1500);
                          });
                        } catch {
                          const ta = document.createElement('textarea');
                          ta.value = gridPromptText; ta.style.position = 'fixed'; ta.style.opacity = '0';
                          document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                          document.body.removeChild(ta);
                          setGridCopied(true); setTimeout(() => setGridCopied(false), 1500);
                        }
                      }}
                      style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                        background: gridCopied ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.07)',
                        border: `1px solid ${gridCopied ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'}`,
                        color: '#059669', cursor: gridPromptText ? 'pointer' : 'default',
                        opacity: gridPromptText ? 1 : 0.35, transition: 'all 0.15s',
                      }}>
                      {gridCopied ? '복사됨 ✓' : '복사'}
                    </button>
                  </div>
                  <textarea
                    value={gridPromptLoading ? '' : gridPromptText}
                    onChange={e => setGridPromptText(e.target.value)}
                    placeholder={gridPromptLoading ? '⏳ 그리드 프롬프트 생성 중...' : '4컷 그리드 프롬프트'}
                    rows={6}
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d1fae5', borderRadius: 8, padding: '8px 10px', fontSize: 10, lineHeight: 1.7, color: '#374151', background: '#f0fdf4', resize: 'vertical', outline: 'none', fontFamily: 'inherit', opacity: gridPromptLoading ? 0.5 : 1 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#6ee7b7'; e.currentTarget.style.background = '#fff'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#d1fae5'; e.currentTarget.style.background = '#f0fdf4'; }}
                  />
                </div>
              </div>
            )}

            {/* ── 이미지 프롬프트 창 — 항상 하단 고정 ── */}
            {scene && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f6', flexShrink: 0 }}>
                {/* 헤더 */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#9ca3af', letterSpacing: '0.1em', paddingLeft: 2, flex: 1 }}>
                    {cutType === 'dialogue' ? '이미지 프롬프트' : '1컷 프롬프트'}
                    {scene && <span style={{ fontWeight: 600, color: '#6b7280', marginLeft: 6, fontSize: 16 }}>{sceneCodeSuffix(scene.sceneCode)}</span>}
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

                {/* 프롬프트 — dialogue: OTS 단일 / narration: 1컷 프롬프트 */}
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
                    rows={6} disabled={promptLoading}
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #333', borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, color: '#DDDDDD', background: '#000000', resize: 'vertical', outline: 'none', fontFamily: 'inherit', opacity: promptLoading ? 0.5 : 1 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a5b4fc'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#333'; }}
                  />
                )}

                {/* 한국어 번역 (Gemini 자동 번역) */}
                {(translating || koTranslation) && (
                  <div style={{
                    marginTop: 8, padding: '7px 10px',
                    background: '#f8fafc', border: '1px solid #e2e8f0',
                    borderRadius: 7,
                  }}>
                    <p style={{ fontSize: 11, color: translating ? '#94a3b8' : '#475569', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {translating ? '번역 중...' : koTranslation}
                    </p>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
        </div>{/* 본문 flex 끝 */}
      </div>{/* 공통 컨테이너 끝 */}

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
            <div style={{ marginTop: 4, fontSize: 10, color: '#9ca3af', fontFamily: "var(--font-en), 'Pretendard', sans-serif" }}>
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

    <Modal9x16
      isOpen={modal9x16Open}
      onClose={() => setModal9x16Open(false)}
      seriesId={seriesId}
      chapter={parseInt(scene?.sceneCode?.match(/ch(\d+)/i)?.[1] ?? '1', 10)}
      scene={scene ? { sceneCode: scene.sceneCode, text: scene.text, storedTtsUrl: scene.storedTtsUrl } : null}
    />
    </>
  );
}
