/**
 * Remotion Composition 등록 — LinkDrop V3
 * 렌더 시 durationInFrames / fps는 render.mjs에서 동적 주입
 */
import { Composition, registerRoot } from "remotion";
import { ParallaxScene } from "./ParallaxScene";
import { NarrationMouthScene } from "./NarrationMouthScene";
import { PixiSpriteScene } from "./PixiSpriteScene";
import { PuppetDialogueScene } from "./PuppetDialogueScene";
import { PuppetRoomDialogueScene } from "./PuppetRoomDialogueScene";
import { MinecraftDialogueScene } from "./MinecraftDialogueScene";
import { FlatCharacterScene } from "./FlatCharacterScene";

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ParallaxScene"
        component={ParallaxScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          bgUrl: "",
          charUrl: "",
          audioUrl: "",
        }}
      />
      <Composition
        id="NarrationMouthScene"
        component={NarrationMouthScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          bgUrl: "",
          charUrl: "",
          audioUrl: "",
          mouthCxRatio: 0.5,
          mouthCyRatio: 0.25,
          mouthWRatio: 0.09,
          mouthHRatio: 0.05,
        }}
      />
      <Composition
        id="PixiSpriteScene"
        component={PixiSpriteScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          bgUrl:    "",
          idleUrl:  "",
          blinkUrl: "",
          talkUrl:  "",
          audioUrl: "",
        }}
      />
      <Composition
        id="PuppetDialogueScene"
        component={PuppetDialogueScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          bgUrl: "",
          charA: { url: "", mouthXRatio: 0.5, mouthYRatio: 0.19, mouthWRatio: 0.28, mouthHRatio: 0.04 },
          charB: { url: "", mouthXRatio: 0.5, mouthYRatio: 0.19, mouthWRatio: 0.28, mouthHRatio: 0.04 },
          audioUrl: "",
        }}
      />
      <Composition
        id="PuppetRoomDialogueScene"
        component={PuppetRoomDialogueScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          bgImageUrl: "",
          charA: { url: "", mouthXRatio: 0.47, mouthYRatio: 0.19, mouthWRatio: 0.07, mouthHRatio: 0.03 },
          charB: { url: "", mouthXRatio: 0.50, mouthYRatio: 0.21, mouthWRatio: 0.07, mouthHRatio: 0.03 },
          audioUrl: "",
          charDisplayH: 750,
          room: {
            backWallColor: "#1e2a3a",
            wallColor:     "#2a3040",
            vanishXRatio:  0.5,
            vanishYRatio:  0.5,
            backWallScale: 0.55,
          },
        }}
      />
      <Composition
        id="MinecraftDialogueScene"
        component={MinecraftDialogueScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          charABase: "",
          charBBase: "",
          audioUrl:  "",
          charDisplayH: 768,
          room: {
            backWallColor: "#1e2a3a",
            wallColor:     "#2a3040",
            vanishXRatio:  0.5,
            vanishYRatio:  0.5,
            backWallScale: 0.55,
          },
        }}
      />
      <Composition
        id="FlatCharacterScene"
        component={FlatCharacterScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          charBase:   "",
          audioUrl:   "",
          bgUrl:      "",
          animMode:   "talk",
          upperBody:  true,
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
