// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import React from 'react';
import { useSubtitleOverlay } from '@/hooks/useSubtitleOverlay';

const API = 'http://localhost:8001/api/v1';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  seriesId: string;
  chapter: number;
  scene: {
    sceneCode: string;
    text: string;
    storedTtsUrl: string;
  } | null;
}


export default function Modal9x16({ isOpen, onClose, seriesId, chapter, scene }: Props) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [ttsUrl, setTtsUrl]       = React.useState<string | null>(null);
  const [videoReady, setVideoReady] = React.useState(false);

  const {
    subtitleY, subtitleBg, displayText, isTyping,
    stopCharTimer, startTyping, loadSubtitleY,
  } = useSubtitleOverlay('ld_subtitle_y', 'ld_subtitle_bg', 80);

  // 9:16 자막 Y = 16:9 자막 Y에서 ▲ 2칸 위 (각 5%, 총 10%)
  const subtitleY9x16 = Math.max(0, subtitleY - 10);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // 씬 변경 / 모달 열릴 때 초기화
  React.useEffect(() => {
    if (!isOpen || !scene) {
      stopCharTimer();
      setIsPlaying(false);
      setVideoReady(false);
      return;
    }
    stopCharTimer();
    setIsPlaying(false);
    setVideoReady(false);
    loadSubtitleY(scene.sceneCode);
    setTtsUrl(scene.storedTtsUrl || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scene?.sceneCode]);

  // ESC 닫기
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const togglePlay = () => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !ttsUrl || !scene?.text) return;
    if (isPlaying) {
      audio.pause(); video?.pause(); stopCharTimer(); setIsPlaying(false);
    } else {
      audio.currentTime = 0; audio.play().catch(() => {});
      if (video) { video.currentTime = 0; video.play().catch(() => {}); }
      const go = () => {
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 4;
        startTyping(scene.text, dur, 25); // 9:16 기준 최대 25자 1줄
        setIsPlaying(true);
      };
      if (isFinite(audio.duration) && audio.duration > 0) go();
      else audio.addEventListener('loadedmetadata', go, { once: true });
    }
  };

  if (!isOpen || !scene) return null;

  const videoSrc = `${API}/series/${seriesId}/chapters/${chapter}/scenes/${scene.sceneCode}/preview`;

  const subtitleStyle: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0,
    top: `${subtitleY9x16}%`, transform: 'translateY(-50%)',
    padding: '12px 16px', transition: 'top 0.15s ease',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* 모달 본문 — 클릭 버블 차단 */}
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: -14, right: -14, zIndex: 10,
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(30,20,60,0.9)',
            border: '1px solid rgba(124,58,237,0.5)',
            color: '#a78bfa', fontSize: 14, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >✕</button>

        {/* 9:16 플레이어 */}
        <div style={{
          position: 'relative', borderRadius: 16, overflow: 'hidden',
          background: '#000',
          height: 'min(88vh, 680px)',
          aspectRatio: '9/16',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
          {/* 로딩 스피너 */}
          {!videoReady && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#000',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '3px solid rgba(167,139,250,0.2)',
                borderTopColor: '#a78bfa',
                animation: 'spin 0.8s linear infinite',
              }} />
            </div>
          )}

          {/* 1:1 center crop — 상하 21.875% 검은 여백, 중앙 56.25% 정사각 영상 */}
          <div style={{
            position: 'absolute',
            width: '100%', height: '56.25%',
            top: '21.875%', left: 0,
            overflow: 'hidden',
            display: videoReady ? 'block' : 'none',
          }}>
            <video
              ref={videoRef}
              src={videoSrc}
              muted
              playsInline
              loop
              onCanPlay={() => setVideoReady(true)}
              style={{
                position: 'absolute',
                height: '100%', width: 'auto',
                left: '50%', transform: 'translateX(-50%)',
              }}
            />
          </div>

          {/* 씬 코드 배지 */}
          <div style={{ position: 'absolute', top: 10, left: 10 }}>
            <span style={{
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
              color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 6,
              border: '1px solid rgba(124,58,237,0.3)',
            }}>
              {scene.sceneCode.replace(/^\d{8}_\d{6}_ch\d+/, '') || scene.sceneCode}
            </span>
          </div>

          {/* 재생 버튼 — 화면 중앙 */}
          {!isPlaying && (
            <button
              onClick={togglePlay}
              disabled={!ttsUrl}
              title="재생"
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 64, height: 64, borderRadius: '50%',
                background: ttsUrl ? 'rgba(124,58,237,0.75)' : 'rgba(30,20,60,0.4)',
                border: `2px solid ${ttsUrl ? '#a78bfa' : 'rgba(124,58,237,0.15)'}`,
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: ttsUrl ? 'pointer' : 'default',
                boxShadow: ttsUrl ? '0 0 24px rgba(124,58,237,0.5)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill={ttsUrl ? '#fff' : 'rgba(255,255,255,0.2)'}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </button>
          )}
          {/* 일시정지 버튼 — 재생 중일 때만 노출, 화면 중앙 */}
          {isPlaying && (
            <button
              onClick={togglePlay}
              title="일시정지"
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(124,58,237,0.4)',
                border: '2px solid rgba(167,139,250,0.5)',
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                opacity: 0.7,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                <rect x="5" y="3" width="4" height="18" rx="1" />
                <rect x="15" y="3" width="4" height="18" rx="1" />
              </svg>
            </button>
          )}


          {/* 자막 overlay */}
          {isTyping && displayText && (
            <div style={subtitleStyle}>
              {/* 자막 스타일 — 9:16 (58번 문서 §12 기준) */}
              <p style={{
                fontSize: 15, color: 'white', fontWeight: 400, lineHeight: 1.4,
                margin: 0, textAlign: 'center',
                fontFamily: '"Noto Serif KR", serif',
                textShadow: subtitleBg ? 'none' : '0 1px 8px rgba(0,0,0,0.95)',
                whiteSpace: 'nowrap',      // 최대 25자 1줄 표시 (분절은 hook에서 처리)
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(subtitleBg ? { background: 'rgba(0,0,0,0.82)', borderRadius: 6, padding: '6px 12px' } : {}),
              }}>
                {displayText}
              </p>
            </div>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={ttsUrl ?? undefined}
        onEnded={() => {
          videoRef.current?.pause();
          if (videoRef.current) videoRef.current.currentTime = 0;
          setIsPlaying(false);
          stopCharTimer();
        }}
      />
    </div>
  );
}
