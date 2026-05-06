/**
 * NarrationMouthScene — 나래이션 캐릭터 입모양 애니메이션
 *
 * 구성:
 *  - 배경 이미지 (전체 화면, 미세 ken-burns)
 *  - 캐릭터 cutout PNG (우측 하단 고정)
 *  - 입 오버레이: sine wave 리듬으로 뻐끔거림 (CORS 불필요)
 *  - 오디오 재생
 *
 * Note: useAudioData는 R2 CORS 미설정으로 차단됨
 *       → sine wave 0.3rad/frame ≈ 1.4Hz 뻐끔거림으로 대체
 */
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface NarrationMouthSceneProps {
  bgUrl: string;
  charUrl: string;
  audioUrl: string;
  /** 입 중심 X 비율 (캐릭터 이미지 너비 기준, 0~1) */
  mouthCxRatio: number;
  /** 입 중심 Y 비율 (캐릭터 이미지 높이 기준, 0~1) */
  mouthCyRatio: number;
  /** 입 너비 비율 */
  mouthWRatio: number;
  /** 입 최대 열림 높이 비율 */
  mouthHRatio: number;
}

// 캐릭터 표시 크기 (px) — 1920x1080 기준
const CHAR_DISPLAY_H = 820;
const CHAR_DISPLAY_W = 820;
const CHAR_RIGHT_OFFSET = 60;

// 입 열림 최대 높이 (px)
const MOUTH_MAX_OPEN_PX = 40;
const MOUTH_MIN_HEIGHT_PX = 2;

export const NarrationMouthScene: React.FC<NarrationMouthSceneProps> = ({
  bgUrl,
  charUrl,
  audioUrl,
  mouthCxRatio,
  mouthCyRatio,
  mouthWRatio,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // ── sine wave 입 애니메이션 ──────────────────────────────────
  // 약 1.4Hz (30fps × 0.3rad ≈ 1.43 cycle/sec) — 자연스러운 말하기 속도
  // Math.abs()로 항상 양수(0~1), 제곱으로 닫힘 시간 길게 = 더 자연스러움
  const sineVal = Math.abs(Math.sin(frame * 0.3));
  const mouthOpen = Math.pow(sineVal, 1.5); // 0~1

  // ── 배경 ken-burns ──────────────────────────────────────────
  const progress = frame / Math.max(durationInFrames - 1, 1);
  const bgScale = interpolate(progress, [0, 1], [1.0, 1.03]);

  // ── 캐릭터 화면 좌표 ─────────────────────────────────────────
  const charLeft = width - CHAR_DISPLAY_W - CHAR_RIGHT_OFFSET;
  const charTop = height - CHAR_DISPLAY_H;

  // ── 입 오버레이 좌표 ─────────────────────────────────────────
  const mouthScreenX = charLeft + CHAR_DISPLAY_W * mouthCxRatio;
  const mouthScreenY = charTop  + CHAR_DISPLAY_H * mouthCyRatio;
  const mouthDisplayW  = CHAR_DISPLAY_W * mouthWRatio;
  const mouthCurrentH  = MOUTH_MIN_HEIGHT_PX + mouthOpen * (MOUTH_MAX_OPEN_PX - MOUTH_MIN_HEIGHT_PX);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* ① 배경 */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={bgUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${bgScale})`,
            transformOrigin: "center center",
          }}
        />
      </AbsoluteFill>

      {/* ② 캐릭터 cutout (우측 하단) */}
      <Img
        src={charUrl}
        style={{
          position: "absolute",
          left: charLeft,
          top: charTop,
          width: CHAR_DISPLAY_W,
          height: CHAR_DISPLAY_H,
          objectFit: "contain",
          objectPosition: "bottom center",
        }}
      />

      {/* ③ 입 오버레이 — 어두운 타원이 sine wave로 뻐끔거림 */}
      <div
        style={{
          position: "absolute",
          left: mouthScreenX - mouthDisplayW / 2,
          top: mouthScreenY - mouthCurrentH / 2,
          width: mouthDisplayW,
          height: mouthCurrentH,
          backgroundColor: "#150505",
          borderRadius: "50%",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8)",
        }}
      />

      {/* ④ 오디오 */}
      <Audio src={audioUrl} />
    </AbsoluteFill>
  );
};
