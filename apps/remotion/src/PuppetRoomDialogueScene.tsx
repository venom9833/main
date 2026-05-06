/**
 * PuppetRoomDialogueScene — 원근 방 배경 + 인형극 대화 씬
 *
 * PuppetDialogueScene과 동일한 캐릭터 레이아웃 + 입 오버레이를 사용하되,
 * 배경을 flat 이미지 대신 RoomBackground(원근 방 5폴리곤)로 교체.
 *
 * 기존 PuppetDialogueScene은 수정 없이 유지됨 — 이 컴포지션은 테스트용.
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
import { RoomBackground, RoomBackgroundProps } from "./RoomBackground";
import { MouthOverlay } from "./PuppetDialogueScene";
import type { CharacterConfig } from "./PuppetDialogueScene";

export interface PuppetRoomDialogueSceneProps {
  /** 뒷벽 이미지 URL (없으면 단색) */
  bgImageUrl?: string;
  charA: CharacterConfig;
  charB: CharacterConfig;
  audioUrl: string;
  /** 캐릭터 표시 높이 (px, 1920x1080 기준) */
  charDisplayH?: number;
  /** 원근 방 배경 파라미터 */
  room?: RoomBackgroundProps;
}

const MOUTH_FREQ = 0.28;

export const PuppetRoomDialogueScene: React.FC<PuppetRoomDialogueSceneProps> = ({
  bgImageUrl,
  charA,
  charB,
  audioUrl,
  charDisplayH = 750,
  room = {},
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const ASPECT = 0.6;
  const charW  = charDisplayH * ASPECT;

  // ── 슬라이드 인 ──────────────────────────────────────────────────────────
  const slideA = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const slideB = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });

  const charAFinalLeft = 60;
  const charALeft = interpolate(slideA, [0, 1], [-charW - 20, charAFinalLeft]);

  const charBFinalLeft = width - charW - 60;
  const charBLeft = interpolate(slideB, [0, 1], [width + 20, charBFinalLeft]);

  const charTop = height - charDisplayH;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>

      {/* ① 원근 방 배경 */}
      <RoomBackground
        bgImageUrl={bgImageUrl}
        kenBurns={true}
        {...room}
      />

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
