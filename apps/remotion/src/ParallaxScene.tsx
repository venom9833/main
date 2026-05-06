/**
 * ParallaxScene — 2-레이어 패럴랙스 렌더링
 *
 * 62번 §6 Step 5 설계 기준:
 *   배경: 좌→우 슬로우 슬라이드 (±5% = 96px)
 *   캐릭터: 중앙 하단 기준 슬로우 줌인 (1.0 → 1.08)
 *
 * inputProps:
 *   bgUrl    — 배경 이미지 URL (R2 public URL)
 *   charUrl  — 캐릭터 누끼 PNG URL (rembg RGBA)
 *   audioUrl — TTS MP3 URL
 */
import { AbsoluteFill, Audio, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  bgUrl: string;
  charUrl: string;
  audioUrl: string;
}

export const ParallaxScene: React.FC<Props> = ({ bgUrl, charUrl, audioUrl }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / Math.max(durationInFrames - 1, 1); // 0 → 1

  // ─── 배경: 좌→우 슬로우 슬라이드 (±5%) ─────────────────────────────────
  // 110% 너비로 스케일 후 x를 0% → 10% 이동
  const bgX = interpolate(progress, [0, 1], [-5, 5]);

  // ─── 캐릭터: 슬로우 줌인 (1.0 → 1.08), transformOrigin center bottom ────
  const charScale = interpolate(progress, [0, 1], [1.0, 1.08]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* 배경: 110% 너비, 좌→우 슬라이드 */}
      <Img
        src={bgUrl}
        style={{
          position: "absolute",
          width: "110%",
          height: "100%",
          objectFit: "cover",
          left: `${bgX}%`,
          top: 0,
        }}
      />

      {/* 캐릭터 누끼: 중앙 하단 기준 줌인 */}
      <Img
        src={charUrl}
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: `translateX(-50%) scale(${charScale})`,
          transformOrigin: "center bottom",
          maxHeight: "100%",
          maxWidth: "100%",
          objectFit: "contain",
        }}
      />

      {/* TTS 오디오 */}
      <Audio src={audioUrl} />
    </AbsoluteFill>
  );
};
