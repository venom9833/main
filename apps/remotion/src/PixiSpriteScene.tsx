/**
 * PixiSpriteScene — PixiJS 기반 스프라이트 애니메이션
 *
 * 레이어 구성:
 *  ① 배경 이미지 (Ken Burns pan)
 *  ② PixiJS canvas — 비 파티클 (ParticleContainer)
 *  ③ 캐릭터 스프라이트 (3 상태: idle / blink / talk)
 *     + 호흡 효과 (scale y sin wave)
 *  ④ 오디오
 *
 * Remotion 호환 패턴:
 *  - PixiJS init (async) → delayRender / continueRender
 *  - 프레임별 갱신 → useEffect([frame]) + renderer.render()
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface PixiSpriteSceneProps {
  bgUrl: string;
  /** 캐릭터 3 상태 URL */
  idleUrl: string;
  blinkUrl: string;
  talkUrl: string;
  audioUrl: string;
  /** 오디오 총 길이 (초) — 말하는 구간 계산용 */
  durationSec?: number;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const CHAR_W = 560;
const CHAR_H = 760;
const CHAR_RIGHT = 80;

const BLINK_INTERVAL = 90; // 3초 마다 (30fps)
const BLINK_DURATION = 6;  // 0.2초

type SpriteState = "idle" | "blink" | "talk";

/** 프레임 번호 → 스프라이트 상태 결정 */
function getSpriteState(frame: number): SpriteState {
  // 말하기: sine wave > 0.5 → talk
  const talkPhase = Math.sin(frame * 0.28);
  if (talkPhase > 0.5) return "talk";

  // 깜빡임: 주기적
  const blinkPhase = frame % BLINK_INTERVAL;
  if (blinkPhase < BLINK_DURATION) return "blink";

  return "idle";
}

export const PixiSpriteScene: React.FC<PixiSpriteSceneProps> = ({
  bgUrl,
  idleUrl,
  blinkUrl,
  talkUrl,
  audioUrl,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // PixiJS canvas ref + app ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef   = useRef<any>(null); // PIXI.Application
  const rainRef  = useRef<any[]>([]);  // 빗방울 스프라이트 배열

  // delayRender handle — PixiJS 비동기 초기화 완료까지 Remotion 대기
  const [handle]  = useState(() => delayRender("PixiJS 초기화"));
  const [ready, setReady] = useState(false);

  // ── PixiJS 초기화 (1회) ────────────────────────────────────────────────────
  useEffect(() => {
    let destroyed = false;

    (async () => {
      try {
        const PIXI = await import("pixi.js");

        if (destroyed || !canvasRef.current) {
          continueRender(handle);
          return;
        }

        const app = new PIXI.Application();
        await app.init({
          canvas: canvasRef.current,
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          preference: "webgl",
          autoDensity: false,
          resolution: 1,
        });

        // ── 비 파티클 설정 ──────────────────────────────────────────────────
        // 흰 원형 텍스처 동적 생성
        const gfx = new PIXI.Graphics();
        gfx.circle(0, 0, 1.5).fill({ color: 0xb4d4ff, alpha: 0.55 });
        const dropTex = app.renderer.generateTexture(gfx);
        gfx.destroy();

        const NUM_DROPS = 180;
        const drops: any[] = [];

        for (let i = 0; i < NUM_DROPS; i++) {
          const sp = new PIXI.Sprite(dropTex);
          sp.anchor.set(0.5);
          sp.width  = 1.5 + Math.random() * 1.5;
          sp.height = 10  + Math.random() * 20;
          sp.x = Math.random() * width;
          sp.y = Math.random() * height;
          sp.alpha = 0.3 + Math.random() * 0.4;
          app.stage.addChild(sp);
          drops.push({
            sp,
            speed: 8 + Math.random() * 6,
            drift: 0.5 + Math.random() * 1.0,
            // 초기 위상 (프레임 0 기준 y 오프셋)
            initY: Math.random() * height,
          });
        }

        appRef.current  = app;
        rainRef.current = drops;
        setReady(true);
        continueRender(handle);
      } catch (e) {
        console.error("PixiJS 초기화 실패", e);
        continueRender(handle);
      }
    })();

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(false);
        appRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 프레임별 PixiJS 갱신 ──────────────────────────────────────────────────
  useEffect(() => {
    const app = appRef.current;
    if (!app || !ready) return;

    const drops = rainRef.current;
    drops.forEach(({ sp, speed, drift, initY }) => {
      // 결정론적 위치: (initY + frame * speed) % height
      const y = (initY + frame * speed) % height;
      const x = sp.x + drift * 0.016; // 미세 드리프트
      sp.y = y;
      sp.x = ((x + width) % width);
    });

    // 명시적 렌더
    (app.renderer as any).render(app.stage);
  }, [frame, ready, height, width]);

  // ── 캐릭터 상태 ───────────────────────────────────────────────────────────
  const spriteState = getSpriteState(frame);

  // 호흡 효과: y축 미세 파동
  const breatheY = Math.sin(frame * 0.06) * 4;
  // 배경 Ken Burns
  const progress  = frame / Math.max(durationInFrames - 1, 1);
  const bgScale   = interpolate(progress, [0, 1], [1.0, 1.04]);

  const charLeft = width  - CHAR_W - CHAR_RIGHT;
  const charTop  = height - CHAR_H + breatheY;

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

      {/* ② PixiJS 비 파티클 캔버스 */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0 }}
        />
      </AbsoluteFill>

      {/* ③ 캐릭터 스프라이트 — 상태별 표시 */}
      {(["idle", "blink", "talk"] as SpriteState[]).map((state) => (
        <Img
          key={state}
          src={state === "idle" ? idleUrl : state === "blink" ? blinkUrl : talkUrl}
          style={{
            position: "absolute",
            left:    charLeft,
            top:     charTop,
            width:   CHAR_W,
            height:  CHAR_H,
            objectFit: "contain",
            objectPosition: "bottom center",
            opacity: spriteState === state ? 1 : 0,
            transition: "opacity 0.05s",
          }}
        />
      ))}

      {/* ④ 오디오 */}
      <Audio src={audioUrl} />

    </AbsoluteFill>
  );
};
