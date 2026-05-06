/**
 * FlatCharacterScene — 평면 일러스트 캐릭터 1인 씬
 *
 * upperBody=true (기본값) 시 상반신만 표시:
 *   charDisplayH=1620 으로 키워서 허리(y780/1200) 위만 화면에 나오게 배치
 *
 * 사용:
 *   node render.mjs \
 *     --composition FlatCharacterScene \
 *     --charBase https://.../mc_a_body \
 *     --bgUrl   https://.../swing_f1.png \
 *     --audioUrl https://... \
 *     --durationSec 4 \
 *     --out /tmp/flat_test.mp4
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
import { FlatCharacter } from "./FlatCharacter";

export interface FlatCharacterSceneProps {
  charBase: string;
  audioUrl: string;
  bgUrl?: string;
  animMode?: "idle" | "talk" | "sit_talk";
  /** true(기본) = 상반신만, false = 전신 */
  upperBody?: boolean;
}

export const FlatCharacterScene: React.FC<FlatCharacterSceneProps> = ({
  charBase,
  audioUrl,
  bgUrl,
  animMode    = "talk",
  upperBody   = true,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // 상반신 모드: charDisplayH를 키워서 허리 아래가 화면 밖으로
  // 1200px 원본에서 허리(y=780)가 화면 하단에 오도록:
  //   displayH * (780/1200) ≈ height  →  displayH ≈ height * 1200/780 ≈ 1.538 * height
  const charDisplayH = upperBody
    ? Math.round(height * (1200 / 780))  // ≈ 1662 @ 1080p
    : 800;

  // 머리 상단이 화면 y=30 에 오도록 top 오프셋 계산
  // 머리 y1 = 70 / 1200 * charDisplayH
  const headTopInChar = (70 / 1200) * charDisplayH;
  const charTop = upperBody ? 30 - headTopInChar : height - charDisplayH;

  const charW = charDisplayH * (896 / 1200);

  // 슬라이드 인 (좌→중앙)
  const slide    = spring({ frame, fps, config: { damping: 18, stiffness: 100 } });
  const charLeft = interpolate(slide, [0, 1], [-charW - 20, width / 2 - charW / 2]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a2e", overflow: "hidden" }}>
      {/* 배경 */}
      {bgUrl ? (
        <Img
          src={bgUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#1a1a2e" }} />
      )}

      {/* 캐릭터 */}
      <div style={{ position: "absolute", left: charLeft, top: charTop }}>
        <FlatCharacter
          baseUrl={charBase}
          frame={frame}
          animMode={animMode}
          displayH={charDisplayH}
        />
      </div>

      <Audio src={audioUrl} />
    </AbsoluteFill>
  );
};
