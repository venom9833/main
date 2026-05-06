/**
 * FlatCharacter — 평면 일러스트 캐릭터 (T포즈 파트 조립 + 관절 애니메이션)
 *
 * 파트 구성:
 *   head, body, arm_r, arm_l, leg_r, leg_l
 *
 * 좌표계:
 *   원본 이미지(64×86) 기준 config 좌표 → PART_SCALE=8 배 확대
 *   팔: T포즈(수평) → ±90° 회전으로 늘어뜨린 자세
 *
 * animMode:
 *   "idle"     — 팔 수직 유지
 *   "talk"     — 팔 흔들림 + 머리 bobbing
 *   "sit_talk" — 다리 꺾임 + 팔 흔들림
 */
import React from "react";
import { Img } from "remotion";

// a_body.jpeg 896×1200 기준 — 파트 이미 고해상도이므로 PART_SCALE=1
const PART_SCALE  = 1;
const CHAR_ORIG_W = 896;
const CHAR_ORIG_H = 1200;

// a_body_config.json 좌표 (896×1200 원본 픽셀 기준)
const CFG = {
  head:  { x1: 328, y1:  70, x2: 570, y2: 375 },
  body:  { x1: 330, y1: 350, x2: 570, y2: 1090 },
  arm_r: { x1:  10, y1: 355, x2: 375, y2: 455 },
  arm_l: { x1: 525, y1: 355, x2: 888, y2: 455 },
  leg_r: { x1: 330, y1: 780, x2: 450, y2: 1145 },
  leg_l: { x1: 448, y1: 780, x2: 572, y2: 1145 },
};

export interface FlatCharacterProps {
  /** R2 base URL — 뒤에 _{part}.png 자동 조합 */
  baseUrl: string;
  frame: number;
  animMode?: "idle" | "talk" | "sit_talk";
  flip?: boolean;
  /** 캐릭터 총 높이 px (기본 600) */
  displayH?: number;
}

export const FlatCharacter: React.FC<FlatCharacterProps> = ({
  baseUrl,
  frame,
  animMode = "talk",
  flip     = false,
  displayH = 600,
}) => {
  // 파트(×8 확대) → displayH 기준 최종 스케일
  const s  = displayH / (CHAR_ORIG_H * PART_SCALE);
  const px = (n: number) => n * PART_SCALE * s;

  const isTalk = animMode === "talk" || animMode === "sit_talk";
  const isSit  = animMode === "sit_talk";

  // Talk 애니메이션
  const freq     = 0.14;  // 팔 진동 주기
  // 팔: 아주 작은 흔들림 ±5°
  const swingR   = isTalk ? Math.sin(frame * freq) * 5 : 0;
  const swingL   = isTalk ? Math.sin(frame * freq + Math.PI) * 5 : 0;
  // 머리: 천천히 좌우로 흔들기 ±10° (느린 주기)
  const headTilt = isTalk ? Math.sin(frame * 0.04) * 10 : 0;

  // 팔: T포즈 기준 90° 회전으로 늘어뜨리기
  // CSS rotate: CW(+) → right→down, left→up
  // arm_r tip이 왼쪽 → 아래로 내리려면 CCW(-) 90°
  const armRAngle = -(90 + swingR);
  // arm_l tip이 오른쪽 → 아래로 내리려면 CW(+) 90°
  const armLAngle = +(90 + swingL);

  // Sit: 다리 앞으로 꺾기
  const legRAngle = isSit ? -70 : 0;
  const legLAngle = isSit ?  70 : 0;

  const u = (part: string) => `${baseUrl}_${part}.png`;

  const canvasW = px(CHAR_ORIG_W);
  const canvasH = px(CHAR_ORIG_H);

  // 절대위치 + 회전 스타일 헬퍼
  const abs = (
    x1: number, y1: number, x2: number, y2: number,
    origin: string,
    rotate: number,
    extra?: React.CSSProperties,
  ): React.CSSProperties => ({
    position:        "absolute",
    left:            px(x1),
    top:             px(y1),
    width:           px(x2 - x1),
    height:          px(y2 - y1),
    transformOrigin: origin,
    transform:       `rotate(${rotate}deg)`,
    imageRendering:  "pixelated",
    ...extra,
  });

  return (
    <div style={{
      position:       "relative",
      width:          canvasW,
      height:         canvasH,
      transform:      flip ? "scaleX(-1)" : undefined,
      imageRendering: "pixelated",
    }}>
      {/* 몸통 */}
      <Img src={u("body")} style={abs(
        CFG.body.x1, CFG.body.y1, CFG.body.x2, CFG.body.y2,
        "center center", 0,
      )} />

      {/* 오른팔 (화면 왼쪽) — right edge = 어깨 피벗, CW */}
      <Img src={u("arm_r")} style={abs(
        CFG.arm_r.x1, CFG.arm_r.y1, CFG.arm_r.x2, CFG.arm_r.y2,
        "100% 50%", armRAngle,
      )} />

      {/* 왼팔 (화면 오른쪽) — left edge = 어깨 피벗, CCW */}
      <Img src={u("arm_l")} style={abs(
        CFG.arm_l.x1, CFG.arm_l.y1, CFG.arm_l.x2, CFG.arm_l.y2,
        "0% 50%", armLAngle,
      )} />

      {/* 오른다리 (화면 왼쪽) — 위쪽 끝 = hip 피벗 */}
      <Img src={u("leg_r")} style={abs(
        CFG.leg_r.x1, CFG.leg_r.y1, CFG.leg_r.x2, CFG.leg_r.y2,
        "50% 0%", legRAngle,
      )} />

      {/* 왼다리 (화면 오른쪽) */}
      <Img src={u("leg_l")} style={abs(
        CFG.leg_l.x1, CFG.leg_l.y1, CFG.leg_l.x2, CFG.leg_l.y2,
        "50% 0%", legLAngle,
      )} />

      {/* 머리 — bottom center = 목 피벗 */}
      <Img src={u("head")} style={abs(
        CFG.head.x1, CFG.head.y1, CFG.head.x2, CFG.head.y2,
        "bottom center", headTilt,
      )} />
    </div>
  );
};
