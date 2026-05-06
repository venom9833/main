/**
 * MinecraftCharacter — 8파트 조립 + 관절 애니메이션
 *
 * 파트 구성 (총 8개):
 *   head, body, arm_r, arm_l
 *   leg_r_upper, leg_r_lower, leg_l_upper, leg_l_lower
 *
 * animMode:
 *   "idle"     — 미세 흔들림
 *   "talk"     — 팔 강조 제스처 + 머리 bobbing
 *   "sit"      — 허벅지 수평 + 종아리 수직 (의자 착석)
 *   "sit_talk" — sit 자세 + talk 팔/머리 애니메이션
 *
 * 파트 비율 (×24 스케일 기준):
 *   head:        192×192  (8×8 픽셀)
 *   body:        192×288  (8×12 픽셀)
 *   arm_r/l:     96×288   (4×12 픽셀)
 *   leg_upper/lower: 96×144 각 (4×6 픽셀)
 */
import React from "react";
import { Img } from "remotion";

export interface MinecraftCharacterProps {
  /** R2 base URL — 뒤에 _{part}.png 자동 조합 */
  baseUrl: string;
  frame: number;
  animMode?: "idle" | "talk" | "sit" | "sit_talk";
  /** 좌우 반전 */
  flip?: boolean;
  /** 캐릭터 총 높이 px (기본 768) */
  displayH?: number;
}

export const MinecraftCharacter: React.FC<MinecraftCharacterProps> = ({
  baseUrl,
  frame,
  animMode = "talk",
  flip     = false,
  displayH = 768,
}) => {
  // ── 크기 계산 ─────────────────────────────────────────────────────────
  const scale    = displayH / 768;
  const headH    = 192 * scale;
  const bodyH    = 288 * scale;
  const armW     = 96  * scale;
  const bodyW    = 192 * scale;
  const upperH   = 144 * scale;   // 허벅지
  const lowerH   = 144 * scale;   // 종아리
  const totalW   = armW + bodyW + armW;  // 384 * scale

  const isSit    = animMode === "sit"      || animMode === "sit_talk";
  const isTalk   = animMode === "talk"     || animMode === "sit_talk";

  // ── Talk 애니메이션 ────────────────────────────────────────────────────
  const talkFreq   = 0.20;
  const baseSwing  = isTalk ? Math.sin(frame * talkFreq) * 18 : 0;

  // 강조 제스처: 75프레임(2.5초) 주기로 오른팔 크게 들기
  const emphasisPhase = isTalk ? (frame % 75) / 75 : 0;
  const emphasis      = emphasisPhase < 0.4
    ? Math.sin(emphasisPhase * Math.PI / 0.4) * 38
    : 0;

  const armRAngle = -(baseSwing + emphasis);
  const armLAngle =  baseSwing;

  // 머리 bobbing (talk)
  const headTilt = isTalk ? Math.sin(frame * talkFreq * 1.5) * 4 : 0;

  // 몸통 미세 기울임 (talk)
  const bodyTilt = isTalk ? Math.sin(frame * talkFreq * 0.7) * 1.5 : 0;

  // idle 미세 흔들림
  const idleSway = animMode === "idle" ? Math.sin(frame * 0.06) * 3 : 0;

  // ── Sit 애니메이션 ─────────────────────────────────────────────────────
  // 허벅지: hip 기준 앞으로 82도 회전 → 수평
  // 종아리: 무릎 기준 수직 아래 유지 (회전 없음)
  const thighAngle = isSit ? -82 : 0;  // 음수 = 앞쪽(viewer 방향)

  // 앉을 때 종아리 위치: 허벅지 끝(무릎)에서 아래로
  // hip → knee 벡터가 82도 회전 → knee 좌표 계산
  const kneeOffsetX = isSit ? upperH * Math.sin((82 * Math.PI) / 180) : 0;
  const kneeOffsetY = isSit ? upperH * Math.cos((82 * Math.PI) / 180) : upperH;

  // sit 시 전체 캐릭터를 약간 위로 올려 발판 보이게 (선택)
  const sitLift = isSit ? upperH * 0.5 : 0;

  // ── URL 헬퍼 ──────────────────────────────────────────────────────────
  const u = (part: string) => `${baseUrl}_${part}.png`;

  // ── 공통 스타일 ───────────────────────────────────────────────────────
  const px = (n: number) => n;

  const containerStyle: React.CSSProperties = {
    position:       "relative",
    width:          totalW,
    height:         displayH,
    transform:      `${flip ? "scaleX(-1) " : ""}translateY(${-sitLift}px)`,
    imageRendering: "pixelated",
  };

  // abs 위치 helper
  const abs = (
    left: number, top: number,
    w: number, h: number,
    origin: string,
    rotate: number,
    extra?: React.CSSProperties,
  ): React.CSSProperties => ({
    position:        "absolute",
    left:            px(left),
    top:             px(top),
    width:           px(w),
    height:          px(h),
    transformOrigin: origin,
    transform:       `rotate(${rotate}deg)`,
    imageRendering:  "pixelated",
    ...extra,
  });

  return (
    <div style={containerStyle}>

      {/* ── 오른팔 (화면 왼쪽, 어깨 기준 회전) ── */}
      <Img src={u("arm_r")} style={abs(
        0, headH, armW, bodyH, "top center", armRAngle + idleSway,
      )} />

      {/* ── 왼팔 (화면 오른쪽, 반대 위상) ── */}
      <Img src={u("arm_l")} style={abs(
        armW + bodyW, headH, armW, bodyH, "top center", armLAngle + idleSway,
      )} />

      {/* ── 몸통 ── */}
      <Img src={u("body")} style={abs(
        armW, headH, bodyW, bodyH, "center center", bodyTilt,
      )} />

      {/* ── 머리 (bobbing/tilt) ── */}
      <Img src={u("head")} style={{
        position:       "absolute",
        left:           px(armW),
        top:            px(0),
        width:          px(bodyW),
        height:         px(headH),
        transformOrigin:"bottom center",
        transform:      `rotate(${headTilt + idleSway}deg)`,
        imageRendering: "pixelated",
      }} />

      {/* ── 오른 허벅지 (화면 왼쪽, hip 기준 회전) ── */}
      <Img src={u("leg_r_upper")} style={abs(
        armW, headH + bodyH, armW, upperH, "top center", -thighAngle,
      )} />

      {/* ── 오른 종아리 (무릎 기준, sit 시 위치 이동) ── */}
      <Img src={u("leg_r_lower")} style={{
        position:       "absolute",
        left:           px(isSit ? armW - kneeOffsetX : armW),
        top:            px(headH + bodyH + kneeOffsetY),
        width:          px(armW),
        height:         px(lowerH),
        transformOrigin:"top center",
        transform:      `rotate(0deg)`,
        imageRendering: "pixelated",
      }} />

      {/* ── 왼 허벅지 (화면 오른쪽) ── */}
      <Img src={u("leg_l_upper")} style={abs(
        armW + bodyW - armW, headH + bodyH, armW, upperH, "top center", thighAngle,
      )} />

      {/* ── 왼 종아리 ── */}
      <Img src={u("leg_l_lower")} style={{
        position:       "absolute",
        left:           px(isSit ? armW + bodyW - armW + kneeOffsetX : armW + bodyW - armW),
        top:            px(headH + bodyH + kneeOffsetY),
        width:          px(armW),
        height:         px(lowerH),
        transformOrigin:"top center",
        transform:      `rotate(0deg)`,
        imageRendering: "pixelated",
      }} />

    </div>
  );
};
