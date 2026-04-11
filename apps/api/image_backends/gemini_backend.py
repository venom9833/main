import asyncio
import os
from image_backends.base import ImageBackend


class GeminiBackend(ImageBackend):
    async def generate(self, hint: str, width: int = 1920, height: int = 1080, **kwargs) -> bytes:
        art_style = kwargs.get("art_style", "masako")
        return await asyncio.to_thread(self._sync_generate, hint, art_style)

    def _sync_generate(self, hint: str, art_style: str) -> bytes:
        from google import genai
        from google.genai import types as genai_types
        from image_backends.registry import get_art_style_config

        cfg = get_art_style_config(art_style)
        style_prompt = cfg.get("base_style_prompt", "")
        negative_prompt = cfg.get("negative_prompt", "")
        bg_suffix = cfg.get("bg_prompt_suffix", "no people, empty scene")

        full_prompt = (
            f"16:9 cinematic background image. No text. {bg_suffix}. "
            f"Scene: {hint}. Style: {style_prompt}. "
            f"Avoid: {negative_prompt}"
        )

        client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY", ""))
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp-image-generation",
            contents=full_prompt,
            config=genai_types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return part.inline_data.data
        raise RuntimeError("Gemini 이미지 생성 실패")
