/**
 * RoomBackground — 원근 방(Perspective Room) 배경
 *
 * 5개 SVG 폴리곤으로 구성:
 *   뒷벽 (foreignObject + Img, ken-burns 선택)
 *   상/하/좌/우 측벽 (단색 polygon)
 *
 * 모든 좌표는 1920×1080 기준.
 * backWallScale / vanishXRatio / vanishYRatio 로 원근감 조정 가능.
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface RoomBackgroundProps {
  /** 뒷벽 이미지 URL (없으면 backWallColor 단색) */
  bgImageUrl?: string;
  /** 뒷벽 단색 폴백 (bgImageUrl 없을 때) */
  backWallColor?: string;
  /** 측벽 4면 단색 */
  wallColor?: string;
  /** 소실점 X 비율 (0~1, 기본 0.5 = 중앙) */
  vanishXRatio?: number;
  /** 소실점 Y 비율 (0~1, 기본 0.5 = 중앙) */
  vanishYRatio?: number;
  /** 뒷벽이 화면 크기 대비 차지하는 비율 (기본 0.55) */
  backWallScale?: number;
  /** 뒷벽에 ken-burns 줌인 효과 적용 여부 (기본 true) */
  kenBurns?: boolean;
}

export const RoomBackground: React.FC<RoomBackgroundProps> = ({
  bgImageUrl,
  backWallColor = "#1e2a3a",
  wallColor     = "#2a3040",
  vanishXRatio  = 0.5,
  vanishYRatio  = 0.5,
  backWallScale = 0.55,
  kenBurns      = true,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, durationInFrames } = useVideoConfig();

  // ── 좌표 계산 ─────────────────────────────────────────────────────────────
  const bwW = W * backWallScale;
  const bwH = H * backWallScale;
  const VL  = W * vanishXRatio - bwW / 2;
  const VR  = VL + bwW;
  const VT  = H * vanishYRatio - bwH / 2;
  const VB  = VT + bwH;

  // ── ken-burns (뒷벽 이미지에만) ────────────────────────────────────────────
  const progress = frame / Math.max(durationInFrames - 1, 1);
  const bgScale  = kenBurns ? interpolate(progress, [0, 1], [1.0, 1.05]) : 1.0;

  // ── 폴리곤 포인트 ─────────────────────────────────────────────────────────
  const topWall    = `0,0 ${W},0 ${VR},${VT} ${VL},${VT}`;
  const bottomWall = `0,${H} ${VL},${VB} ${VR},${VB} ${W},${H}`;
  const leftWall   = `0,0 ${VL},${VT} ${VL},${VB} 0,${H}`;
  const rightWall  = `${W},0 ${W},${H} ${VR},${VB} ${VR},${VT}`;

  // 측벽 명암 변화: 상/하 약간 밝게, 좌/우 약간 어둡게
  const wallColorTop    = wallColor;
  const wallColorBottom = wallColor;
  const wallColorLeft   = shadeColor(wallColor, -15);
  const wallColorRight  = shadeColor(wallColor, -10);

  return (
    <AbsoluteFill>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", top: 0, left: 0 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── 뒷벽 (이미지 or 단색) ───────────────────────────────────────── */}
        {bgImageUrl ? (
          <foreignObject x={VL} y={VT} width={bwW} height={bwH} style={{ overflow: "hidden" }}>
            <div
              style={{
                width: bwW,
                height: bwH,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <Img
                src={bgImageUrl}
                style={{
                  position:  "absolute",
                  width:     "100%",
                  height:    "100%",
                  objectFit: "cover",
                  transform: `scale(${bgScale})`,
                  transformOrigin: "center center",
                }}
              />
            </div>
          </foreignObject>
        ) : (
          <rect x={VL} y={VT} width={bwW} height={bwH} fill={backWallColor} />
        )}

        {/* ── 측벽 4면 ────────────────────────────────────────────────────── */}
        <polygon points={topWall}    fill={wallColorTop}    />
        <polygon points={bottomWall} fill={wallColorBottom} />
        <polygon points={leftWall}   fill={wallColorLeft}   />
        <polygon points={rightWall}  fill={wallColorRight}  />
      </svg>
    </AbsoluteFill>
  );
};

// ── 색상 밝기 조정 헬퍼 ────────────────────────────────────────────────────────
function shadeColor(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const num   = parseInt(clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
