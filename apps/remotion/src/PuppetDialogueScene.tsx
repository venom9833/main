/**
 * PuppetDialogueScene — 인형극 구조 대화 씬
 *
 * 구성:
 *  ① 2D 배경 이미지 (fullscreen)
 *  ② 캐릭터A (좌측) — spring 슬라이드 인 + sine 입 오버레이
 *  ③ 캐릭터B (우측) — spring 슬라이드 인 + sine 입 오버레이
 *  ④ 오디오
 *
 * 입 좌표: 원본 이미지 기준 비율(0~1)로 지정 → 표시 크기에 맞게 자동 스케일
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface CharacterConfig {
  url: string;
  /** 입 중심 X 비율 (원본 이미지 폭 기준 0~1) */
  mouthXRatio: number;
  /** 입 중심 Y 비율 (원본 이미지 높이 기준 0~1) */
  mouthYRatio: number;
  /** 입 폭 비율 */
  mouthWRatio: number;
  /** 입 최대 열림 높이 비율 */
  mouthHRatio: number;
  /** 좌우 반전 여부 */
  flip?: boolean;
}

export interface PuppetDialogueSceneProps {
  bgUrl: string;
  charA: CharacterConfig;
  charB: CharacterConfig;
  audioUrl: string;
  /** 캐릭터 표시 높이 (px, 1920x1080 기준) */
  charDisplayH?: number;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const ENTRANCE_FRAMES = 18; // 0.6초 슬라이드 인
const MOUTH_FREQ      = 0.28; // ~1.3Hz 입 뻐끔 주기

export function MouthOverlay({
  charLeft,
  charTop,
  charW,
  charH,
  cfg,
  frame,
  side,
}: {
  charLeft: number;
  charTop: number;
  charW: number;
  charH: number;
  cfg: CharacterConfig;
  frame: number;
  side: "left" | "right";
}) {
  const sineVal  = Math.abs(Math.sin(frame * MOUTH_FREQ));
  const mouthOpen = Math.pow(sineVal, 1.4); // 0~1

  const MOUTH_MAX_H = charH * cfg.mouthHRatio;
  const MOUTH_MIN_H = 2;
  const mouthH = MOUTH_MIN_H + mouthOpen * (MOUTH_MAX_H - MOUTH_MIN_H);
  const mouthW = charW * cfg.mouthWRatio;

  // 원본 이미지 비율 → 화면 좌표
  // flip 적용 시 X 대칭
  const rawX = cfg.flip
    ? charLeft + charW * (1 - cfg.mouthXRatio)
    : charLeft + charW * cfg.mouthXRatio;
  const rawY = charTop + charH * cfg.mouthYRatio;

  return (
    <div
      style={{
        position: "absolute",
        left:   rawX - mouthW / 2,
        top:    rawY - mouthH / 2,
        width:  mouthW,
        height: mouthH,
        backgroundColor: "#1a0808",
        borderRadius: "50%",
        boxShadow: "inset 0 1px 4px rgba(0,0,0,0.9)",
      }}
    />
  );
}

export const PuppetDialogueScene: React.FC<PuppetDialogueSceneProps> = ({
  bgUrl,
  charA,
  charB,
  audioUrl,
  charDisplayH = 750,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // 원본 이미지 종횡비 가정 300:500 = 0.6
  const ASPECT = 0.6;
  const charW  = charDisplayH * ASPECT;

  // ── 슬라이드 인 (spring) ──────────────────────────────────────────────────
  const slideA = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const slideB = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });

  // A: 왼쪽 → 최종 위치
  const charAFinalLeft = 60;
  const charALeft = interpolate(slideA, [0, 1], [-charW - 20, charAFinalLeft]);

  // B: 오른쪽 → 최종 위치
  const charBFinalLeft = width - charW - 60;
  const charBLeft = interpolate(slideB, [0, 1], [width + 20, charBFinalLeft]);

  // 캐릭터 상단 (화면 하단 기준)
  const charTop = height - charDisplayH;

  // ── 배경 ken-burns ──────────────────────────────────────────────────────────
  const { durationInFrames } = useVideoConfig();
  const progress = frame / Math.max(durationInFrames - 1, 1);
  const bgScale  = interpolate(progress, [0, 1], [1.0, 1.03]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>

      {/* ① 배경 */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={bgUrl}
          style={{
            width: "100%", height: "100%",
            objectFit: "cover",
            transform: `scale(${bgScale})`,
            transformOrigin: "center center",
          }}
        />
      </AbsoluteFill>

      {/* ② 캐릭터 A (좌측) */}
      <Img
        src={charA.url}
        style={{
          position:  "absolute",
          left:      charALeft,
          top:       charTop,
          width:     charW,
          height:    charDisplayH,
          objectFit: "contain",
          objectPosition: "bottom center",
          transform: charA.flip ? "scaleX(-1)" : undefined,
        }}
      />
      <MouthOverlay
        charLeft={charALeft} charTop={charTop}
        charW={charW} charH={charDisplayH}
        cfg={charA} frame={frame} side="left"
      />

      {/* ③ 캐릭터 B (우측) */}
      <Img
        src={charB.url}
        style={{
          position:  "absolute",
          left:      charBLeft,
          top:       charTop,
          width:     charW,
          height:    charDisplayH,
          objectFit: "contain",
          objectPosition: "bottom center",
          transform: charB.flip ? "scaleX(-1)" : undefined,
        }}
      />
      <MouthOverlay
        charLeft={charBLeft} charTop={charTop}
        charW={charW} charH={charDisplayH}
        cfg={charB} frame={frame} side="right"
      />

      {/* ④ 오디오 */}
      <Audio src={audioUrl} />

    </AbsoluteFill>
  );
};
