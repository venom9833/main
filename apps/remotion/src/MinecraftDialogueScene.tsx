/**
 * MinecraftDialogueScene — 원근 방 배경 + 마인크래프트 캐릭터 대화 씬
 *
 * 구성:
 *  ① RoomBackground (SVG 5폴리곤 원근 방)
 *  ② MinecraftCharacter A (좌측 spring 슬라이드 인)
 *  ③ MinecraftCharacter B (우측 spring 슬라이드 인, flip)
 *  ④ Audio
 *
 * animMode 별 동작:
 *   talk     — 팔 강조 제스처 + 머리 bobbing
 *   sit      — 의자 착석 (허벅지 수평 + 종아리 수직)
 *   sit_talk — 앉아서 말하기
 *   idle     — 미세 흔들림
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { RoomBackground, RoomBackgroundProps } from "./RoomBackground";
import { MinecraftCharacter } from "./MinecraftCharacter";

export interface MinecraftDialogueSceneProps {
  charABase: string;
  charBBase: string;
  audioUrl: string;
  charDisplayH?: number;
  animModeA?: "idle" | "talk" | "sit" | "sit_talk";
  animModeB?: "idle" | "talk" | "sit" | "sit_talk";
  room?: RoomBackgroundProps;
}

export const MinecraftDialogueScene: React.FC<MinecraftDialogueSceneProps> = ({
  charABase,
  charBBase,
  audioUrl,
  charDisplayH = 768,
  animModeA    = "talk",
  animModeB    = "sit_talk",
  room         = {},
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const charW   = charDisplayH * (384 / 768);
  const charTop = height - charDisplayH;

  // ── 슬라이드 인 ──────────────────────────────────────────────────────
  const slideA  = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const slideB  = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });

  const charALeft = interpolate(slideA, [0, 1], [-charW - 20, 40]);
  const charBLeft = interpolate(slideB, [0, 1], [width + 20, width - charW - 40]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>

      {/* ① 원근 방 배경 */}
      <RoomBackground kenBurns={true} {...room} />

      {/* ② 캐릭터 A */}
      <div style={{ position: "absolute", left: charALeft, top: charTop }}>
        <MinecraftCharacter
          baseUrl={charABase}
          frame={frame}
          animMode={animModeA}
          displayH={charDisplayH}
        />
      </div>

      {/* ③ 캐릭터 B (좌우 반전) */}
      <div style={{ position: "absolute", left: charBLeft, top: charTop }}>
        <MinecraftCharacter
          baseUrl={charBBase}
          frame={frame}
          animMode={animModeB}
          flip={true}
          displayH={charDisplayH}
        />
      </div>

      {/* ④ 오디오 */}
      <Audio src={audioUrl} />

    </AbsoluteFill>
  );
};
