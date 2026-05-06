/**
 * render.mjs — LinkDrop V3 Remotion 렌더 스크립트
 *
 * 사용법 (Python subprocess 또는 직접 호출):
 *   node render.mjs \
 *     --composition ParallaxScene \
 *     --bgUrl https://... \
 *     --charUrl https://... \
 *     --audioUrl https://... \
 *     --durationSec 8.5 \
 *     --out /tmp/clip.mp4
 *
 * 출력: { ok: true, out: "/tmp/clip.mp4", frames: 285 }  (JSON to stdout)
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI 인자 파싱 ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const m = process.argv[i].match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
    else {
      const kv = process.argv[i].match(/^--(\w+)$/);
      if (kv) args[kv[1]] = process.argv[++i];
    }
  }
  return args;
}

const args = parseArgs();
const {
  composition = "ParallaxScene",
  bgUrl,
  charUrl,
  audioUrl,
  durationSec,
  out,
  // NarrationMouthScene 전용
  mouthCxRatio,
  mouthCyRatio,
  mouthWRatio,
  mouthHRatio,
  // PixiSpriteScene 전용
  idleUrl,
  blinkUrl,
  talkUrl,
  // PuppetDialogueScene 전용
  charAUrl,
  charBUrl,
  charAMouthXRatio,
  charAMouthYRatio,
  charBMouthXRatio,
  charBMouthYRatio,
  charDisplayH,
  // PuppetRoomDialogueScene 전용 (원근 방 배경)
  bgImageUrl,
  roomVanishX,
  roomVanishY,
  roomBackWallScale,
  roomWallColor,
  roomBackWallColor,
  // MinecraftDialogueScene 전용
  charABase,
  charBBase,
  // FlatCharacterScene 전용
  charBase,
} = args;

const isPixiScene      = composition === "PixiSpriteScene";
const isPuppetScene    = composition === "PuppetDialogueScene";
const isRoomScene      = composition === "PuppetRoomDialogueScene";
const isMinecraftScene = composition === "MinecraftDialogueScene";
const isFlatScene      = composition === "FlatCharacterScene";

if (!audioUrl || !durationSec || !out) {
  console.error(JSON.stringify({ ok: false, error: "필수 인자 누락: --audioUrl --durationSec --out" }));
  process.exit(1);
}
if (!isPuppetScene && !isPixiScene && !isRoomScene && !isMinecraftScene && !isFlatScene && !charUrl) {
  console.error(JSON.stringify({ ok: false, error: "필수 인자 누락: --charUrl" }));
  process.exit(1);
}
if ((isPuppetScene || isRoomScene) && (!charAUrl || !charBUrl)) {
  console.error(JSON.stringify({ ok: false, error: "PuppetScene: --charAUrl --charBUrl 필요" }));
  process.exit(1);
}
if (isMinecraftScene && (!charABase || !charBBase)) {
  console.error(JSON.stringify({ ok: false, error: "MinecraftDialogueScene: --charABase --charBBase 필요" }));
  process.exit(1);
}
if (isPixiScene && (!idleUrl || !blinkUrl || !talkUrl)) {
  console.error(JSON.stringify({ ok: false, error: "PixiSpriteScene: --idleUrl --blinkUrl --talkUrl 필요" }));
  process.exit(1);
}
if (isPuppetScene && (!charAUrl || !charBUrl)) {
  console.error(JSON.stringify({ ok: false, error: "PuppetDialogueScene: --charAUrl --charBUrl 필요" }));
  process.exit(1);
}

const FPS = 30;
const durationInFrames = Math.ceil(parseFloat(durationSec) * FPS) + FPS; // +1초 여유

// ── 번들 캐시 디렉토리 (재실행 시 재사용) ────────────────────────────────
const bundleCacheDir = path.join(__dirname, ".bundle-cache");
if (!fs.existsSync(bundleCacheDir)) fs.mkdirSync(bundleCacheDir, { recursive: true });

async function main() {
  try {
    process.stderr.write("[Remotion] 번들링 시작...\n");
    const bundleLocation = await bundle({
      entryPoint: path.join(__dirname, "src", "index.tsx"),
      outDir: bundleCacheDir,
      onProgress: (p) => {
        if (p % 20 === 0) process.stderr.write(`[Remotion] 번들 ${p}%\n`);
      },
    });
    process.stderr.write("[Remotion] 번들 완료. 렌더 시작...\n");

    // 시스템 Chrome 사용 (자동 다운로드 불필요)
    const CHROME_PATHS = [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ];
    const browserExecutable = CHROME_PATHS.find((p) => fs.existsSync(p)) ?? undefined;
    if (browserExecutable) {
      process.stderr.write(`[Remotion] Chrome: ${browserExecutable}\n`);
    }

    // composition별 inputProps 구성
    const baseProps = { bgUrl, charUrl, audioUrl };
    let inputProps;
    if (composition === "NarrationMouthScene") {
      inputProps = {
        ...baseProps,
        mouthCxRatio: parseFloat(mouthCxRatio ?? "0.5"),
        mouthCyRatio: parseFloat(mouthCyRatio ?? "0.25"),
        mouthWRatio:  parseFloat(mouthWRatio  ?? "0.09"),
        mouthHRatio:  parseFloat(mouthHRatio  ?? "0.05"),
      };
    } else if (composition === "PixiSpriteScene") {
      inputProps = { bgUrl, idleUrl, blinkUrl, talkUrl, audioUrl };
    } else if (composition === "PuppetDialogueScene") {
      inputProps = {
        bgUrl, audioUrl,
        charDisplayH: charDisplayH ? parseInt(charDisplayH, 10) : 750,
        charA: {
          url:          charAUrl,
          mouthXRatio:  parseFloat(charAMouthXRatio ?? "0.47"),
          mouthYRatio:  parseFloat(charAMouthYRatio ?? "0.19"),
          mouthWRatio:  0.07,
          mouthHRatio:  0.03,
        },
        charB: {
          url:          charBUrl,
          mouthXRatio:  parseFloat(charBMouthXRatio ?? "0.50"),
          mouthYRatio:  parseFloat(charBMouthYRatio ?? "0.21"),
          mouthWRatio:  0.07,
          mouthHRatio:  0.03,
        },
      };
    } else if (composition === "PuppetRoomDialogueScene") {
      inputProps = {
        bgImageUrl: bgImageUrl ?? bgUrl ?? "",
        audioUrl,
        charDisplayH: charDisplayH ? parseInt(charDisplayH, 10) : 750,
        charA: {
          url:         charAUrl,
          mouthXRatio: parseFloat(charAMouthXRatio ?? "0.47"),
          mouthYRatio: parseFloat(charAMouthYRatio ?? "0.19"),
          mouthWRatio: 0.07,
          mouthHRatio: 0.03,
        },
        charB: {
          url:         charBUrl,
          mouthXRatio: parseFloat(charBMouthXRatio ?? "0.50"),
          mouthYRatio: parseFloat(charBMouthYRatio ?? "0.21"),
          mouthWRatio: 0.07,
          mouthHRatio: 0.03,
        },
        room: {
          vanishXRatio:  parseFloat(roomVanishX       ?? "0.5"),
          vanishYRatio:  parseFloat(roomVanishY       ?? "0.5"),
          backWallScale: parseFloat(roomBackWallScale ?? "0.55"),
          wallColor:     roomWallColor     ?? "#2a3040",
          backWallColor: roomBackWallColor ?? "#1e2a3a",
        },
      };
    } else if (composition === "MinecraftDialogueScene") {
      inputProps = {
        charABase,
        charBBase,
        audioUrl,
        charDisplayH: charDisplayH ? parseInt(charDisplayH, 10) : 768,
        room: {
          vanishXRatio:  parseFloat(roomVanishX       ?? "0.5"),
          vanishYRatio:  parseFloat(roomVanishY       ?? "0.5"),
          backWallScale: parseFloat(roomBackWallScale ?? "0.55"),
          wallColor:     roomWallColor     ?? "#2a3040",
          backWallColor: roomBackWallColor ?? "#1e2a3a",
        },
      };
    } else if (composition === "FlatCharacterScene") {
      inputProps = {
        charBase,
        audioUrl,
        bgUrl:      bgUrl ?? bgImageUrl ?? "",
        animMode:   args.animMode ?? "talk",
        upperBody:  args.upperBody !== "false",
      };
    } else {
      inputProps = baseProps;
    }

    const comp = await selectComposition({
      serveUrl: bundleLocation,
      id: composition,
      inputProps,
      browserExecutable,
    });

    await renderMedia({
      composition: {
        ...comp,
        durationInFrames,
        fps: FPS,
        width: 1920,
        height: 1080,
      },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: out,
      inputProps,
      browserExecutable,
      concurrency: Math.max(1, os.cpus().length - 1),
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 10 === 0) process.stderr.write(`[Remotion] 렌더 ${pct}%\n`);
      },
    });

    console.log(JSON.stringify({ ok: true, out, frames: durationInFrames }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err) }));
    process.exit(1);
  }
}

main();
