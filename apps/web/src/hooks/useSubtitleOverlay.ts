// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import React from 'react';

const _STEP = 5;

// ─── 공개 인터페이스 ───────────────────────────────────────────────────────────
// startTyping의 세 번째 인자(maxCharsPerLine)가 추가됨
// 16:9 기본값 = 30자, 9:16 = 25자
export interface SubtitleOverlay {
  subtitleY: number;
  subtitleBg: boolean;
  displayText: string;
  isTyping: boolean;
  stopCharTimer: () => void;
  startTyping: (text: string, durationSec: number, maxCharsPerLine?: number) => void;
  syncToAudio: (audio: HTMLAudioElement, text: string) => void;
  subtitleUp: (sceneCode: string) => void;
  subtitleDown: (sceneCode: string) => void;
  setSubtitleBg: (value: boolean) => void;
  loadSubtitleY: (sceneCode: string) => void;
}

/**
 * 자막 오버레이 공유 훅.
 * keyframe(16:9)과 keyframe-9x16(9:16) 양쪽에서 동일 로직 사용.
 * Y 위치는 cut=0에서 전역 설정 후 고정 — 씬별 저장 없음.
 *
 * @param yKey     localStorage 키 — 전역 단일 Y 위치 값
 * @param bgKey    localStorage 키 — 자막 배경 토글
 * @param defaultY 기본 Y 위치 (0~100%)
 */
export function useSubtitleOverlay(
  yKey: string,
  bgKey: string,
  defaultY = 80,
): SubtitleOverlay {
  const [subtitleY, _setY]   = React.useState(defaultY);
  const [subtitleBg, _setBg] = React.useState(false);
  const [displayText, setDisplayText] = React.useState('');
  const [isTyping, setIsTyping]       = React.useState(false);

  // setTimeout 반환값 타입으로 변경 — clearTimeout과 일치시킴
  const timerRef      = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCleanup  = React.useRef<(() => void) | null>(null);

  // bg 설정 초기 로드 (SSR 안전: useEffect 안에서만 localStorage 접근)
  React.useEffect(() => {
    try { if (localStorage.getItem(bgKey) === '1') _setBg(true); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 타이머를 중지하고 자막을 지운다.
  // clearInterval → clearTimeout으로 변경 (setTimeout 체인 방식 사용)
  const stopCharTimer = React.useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (audioCleanup.current) { audioCleanup.current(); audioCleanup.current = null; }
    setIsTyping(false); setDisplayText('');
  }, []);

  /**
   * 자막 타이핑 표시 (청크 단위 char-by-char).
   *
   * 텍스트를 N자 이하 청크로 분절 후 각 청크를 한 글자씩 타이핑.
   * 청크 타이핑 완료 → remainMs 대기 → 빈화면 50ms → 다음 청크.
   *
   * 분절 우선순위: 문장부호(.!?,。！？) > 공백 > 강제 컷
   * 역탐색 범위: maxCharsPerLine 위치에서 최대 10자 앞까지
   *
   * @param text           표시할 전체 자막 텍스트
   * @param durationSec    오디오 총 재생 시간(초) — 청크별 속도 계산에 사용
   * @param maxCharsPerLine 한 줄 최대 글자 수 (16:9=30, 9:16=25)
   */
  const startTyping = React.useCallback((
    text: string,
    durationSec: number,
    maxCharsPerLine = 30,
  ) => {
    stopCharTimer();
    setDisplayText('');
    setIsTyping(true);

    // ── 청크 분절 ────────────────────────────────────────────────────────────
    const PUNCTS = new Set([...'.!?,。！？']);
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      const chars = Array.from(remaining);
      if (chars.length <= maxCharsPerLine) {
        chunks.push(remaining);
        break;
      }
      let splitAt = maxCharsPerLine;
      for (let i = maxCharsPerLine; i >= maxCharsPerLine - 10 && i > 0; i--) {
        if (PUNCTS.has(chars[i]) || chars[i] === ' ') {
          splitAt = i + 1;
          break;
        }
      }
      chunks.push(chars.slice(0, splitAt).join('').trim());
      remaining = chars.slice(splitAt).join('').trim();
    }

    const filtered = chunks.filter(c => c.length > 0);
    if (filtered.length === 0) { setIsTyping(false); return; }

    // ── 청크별 타이핑 시간 계산 ───────────────────────────────────────────────
    const totalChars  = Math.max(1, Array.from(text).length);
    const msTotalSafe = Math.max(1000, durationSec * 1000);

    // ── 청크 단위 char-by-char 타이핑 ────────────────────────────────────────
    // scheduleNext → 청크의 각 글자를 charSpeed 간격으로 순차 표시
    //             → 마지막 글자 후 remainMs 대기 → 빈화면 → 다음 청크
    let idx = 0;
    const scheduleNext = () => {
      if (idx >= filtered.length) { stopCharTimer(); return; }
      const chunk      = filtered[idx++];
      const chunkChars = Array.from(chunk);
      const chunkLen   = chunkChars.length;

      // 이 청크에 할당된 시간 (비율 기반, 최소 0.8초)
      const chunkDur  = (chunkLen / totalChars) * msTotalSafe;
      const showMs    = Math.max(800, chunkDur);
      // 타이핑에 80%, 정지 표시에 20% 할당; 글자당 최소 40ms
      const charSpeed = Math.max(40, Math.floor((showMs * 0.8) / chunkLen));
      const remainMs  = Math.max(150, showMs - charSpeed * chunkLen);

      let charIdx = 0;
      const typeChar = () => {
        charIdx++;
        setDisplayText(chunkChars.slice(0, charIdx).join(''));
        if (charIdx < chunkLen) {
          timerRef.current = setTimeout(typeChar, charSpeed);
        } else {
          // 마지막 글자 타이핑 완료 → remainMs 후 클리어 → 다음 청크
          timerRef.current = setTimeout(() => {
            setDisplayText('');
            timerRef.current = setTimeout(scheduleNext, 50);
          }, remainMs);
        }
      };
      typeChar();
    };

    scheduleNext();
  }, [stopCharTimer]);

  // ── Y 위치 헬퍼 ──────────────────────────────────────────────────────────────
  const _getY = React.useCallback((): number => {
    try {
      const val = localStorage.getItem(yKey);
      return val !== null ? Number(val) : defaultY;
    } catch { return defaultY; }
  }, [yKey, defaultY]);

  const loadSubtitleY = React.useCallback((_sceneCode: string) => {
    _setY(_getY());
  }, [_getY]);

  const subtitleUp = React.useCallback((_sceneCode: string) => {
    _setY(prev => {
      const next = Math.max(0, prev - _STEP);
      try { localStorage.setItem(yKey, String(next)); } catch {}
      return next;
    });
  }, [yKey]);

  const subtitleDown = React.useCallback((_sceneCode: string) => {
    _setY(prev => {
      const next = Math.min(100, prev + _STEP);
      try { localStorage.setItem(yKey, String(next)); } catch {}
      return next;
    });
  }, [yKey]);

  const setSubtitleBg = React.useCallback((value: boolean) => {
    _setBg(value);
    try { localStorage.setItem(bgKey, value ? '1' : '0'); } catch {}
  }, [bgKey]);

  // TTS 오디오 timeupdate에 자막을 직접 동기화 — 청크 단위 전환 + 글자 등장
  const syncToAudio = React.useCallback((audio: HTMLAudioElement, text: string, maxCharsPerLine = 30) => {
    stopCharTimer();
    if (!text.trim()) return;
    setIsTyping(true);

    // ── 텍스트를 maxCharsPerLine 이하 청크로 분절 ──────────────────────────
    const PUNCTS = new Set([...'.!?,。！？']);
    const chunks: string[] = [];
    let remaining = text.trim();
    while (remaining.length > 0) {
      const chars = Array.from(remaining);
      if (chars.length <= maxCharsPerLine) { chunks.push(remaining); break; }
      let splitAt = maxCharsPerLine;
      for (let i = maxCharsPerLine; i >= maxCharsPerLine - 10 && i > 0; i--) {
        if (PUNCTS.has(chars[i]) || chars[i] === ' ') { splitAt = i + 1; break; }
      }
      chunks.push(chars.slice(0, splitAt).join('').trim());
      remaining = chars.slice(splitAt).join('').trim();
    }
    const filtered = chunks.filter(c => c.length > 0);
    if (filtered.length === 0) { setIsTyping(false); return; }

    // ── 청크별 시작 시간 비율 계산 (글자 수 기준) ─────────────────────────
    const totalChars = Array.from(text).length;
    let cumChars = 0;
    const chunkStarts: number[] = filtered.map(c => {
      const ratio = cumChars / totalChars;
      cumChars += Array.from(c).length;
      return ratio; // 0.0 ~ 1.0
    });

    const onUpdate = () => {
      if (!isFinite(audio.duration) || audio.duration <= 0) return;
      const progress = audio.currentTime / audio.duration;

      // 현재 progress에 해당하는 청크 찾기
      let chunkIdx = filtered.length - 1;
      for (let i = 0; i < chunkStarts.length - 1; i++) {
        if (progress < chunkStarts[i + 1]) { chunkIdx = i; break; }
      }

      const chunk = filtered[chunkIdx];
      const chunkStart = chunkStarts[chunkIdx];
      const chunkEnd = chunkIdx + 1 < chunkStarts.length ? chunkStarts[chunkIdx + 1] : 1.0;
      const chunkProgress = chunkEnd > chunkStart
        ? Math.min(1, (progress - chunkStart) / (chunkEnd - chunkStart))
        : 1;

      const chars = Array.from(chunk);
      const n = Math.min(chars.length, Math.floor(chars.length * chunkProgress));
      setDisplayText(chars.slice(0, n).join(''));
    };

    const onEnded = () => {
      audio.removeEventListener('timeupdate', onUpdate);
      audio.removeEventListener('ended', onEnded);
      audioCleanup.current = null;
      setDisplayText(''); setIsTyping(false);
    };
    audio.addEventListener('timeupdate', onUpdate);
    audio.addEventListener('ended', onEnded);
    audioCleanup.current = () => {
      audio.removeEventListener('timeupdate', onUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [stopCharTimer]);

  return {
    subtitleY, subtitleBg, displayText, isTyping,
    stopCharTimer, startTyping, syncToAudio,
    subtitleUp, subtitleDown,
    setSubtitleBg, loadSubtitleY,
  };
}
