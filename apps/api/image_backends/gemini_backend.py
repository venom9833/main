import asyncio
from image_backends.base import ImageBackend
from core.config import settings


_GEMINI_TIMEOUT = 90.0  # Gemini 이미지 생성 최대 대기 (초) — 초과 시 RuntimeError


class GeminiBackend(ImageBackend):
    async def generate(self, hint: str, width: int = 1920, height: int = 1080, **kwargs) -> bytes:
        art_style = kwargs.get("art_style", "polystyle")
        portrait_urls: list[str] = kwargs.get("portrait_urls") or []
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._sync_generate, hint, art_style, portrait_urls),
                timeout=_GEMINI_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(f"Gemini 이미지 생성 타임아웃 ({_GEMINI_TIMEOUT}초 초과)")

    def _sync_generate(self, hint: str, art_style: str, portrait_urls: list[str] | None = None) -> bytes:
        import urllib.request
        from google import genai
        from google.genai import types as genai_types
        from image_backends.registry import get_art_style_config

        cfg = get_art_style_config(art_style)
        style_prompt = cfg.get("base_style_prompt", "")
        negative_prompt = cfg.get("negative_prompt", "")
        bg_suffix = cfg.get("bg_prompt_suffix", "no people, empty scene")

        style_lock = (
            "STRICT ART STYLE OVERRIDE — ignore any art style visible in reference images: "
            "render ONLY in low-poly hard polygon mesh illustration, "
            "all surfaces flat facets NO gradients NO smooth shading NO photorealism, "
            "chibi 3-head proportion characters. "
            "Reference images are for character IDENTITY ONLY, not art style."
        )
        full_prompt = (
            f"{style_lock} "
            "Single frozen still frame, one unified cinematic moment. "
            "No split composition, no top-bottom divide, no montage layout. "
            f"16:9 cinematic image. No text. {bg_suffix}. "
            f"Scene: {hint}. Style: {style_prompt}. "
            f"Avoid: {negative_prompt}, split screen, panel divide, composite layout"
        )

        from core.gemini_key_rotator import get_image_api_key
        client = genai.Client(api_key=get_image_api_key())

        if portrait_urls:
            portrait_parts = []
            from pathlib import Path as _Path
            for path_or_url in portrait_urls:
                try:
                    p = _Path(path_or_url)
                    if p.exists():
                        img_bytes = p.read_bytes()
                    else:
                        with urllib.request.urlopen(path_or_url, timeout=10) as resp:
                            img_bytes = resp.read()
                    mime = "image/png" if str(path_or_url).endswith(".png") else "image/jpeg"
                    portrait_parts.append(
                        genai_types.Part.from_bytes(data=img_bytes, mime_type=mime)
                    )
                except Exception:
                    pass
            # 텍스트 프롬프트 먼저, portrait 레퍼런스 나중 — 스타일 텍스트가 시각 레퍼런스보다 우선 읽히도록
            contents: list = [full_prompt] + portrait_parts if portrait_parts else full_prompt
        else:
            contents = full_prompt

        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=contents,
                config=genai_types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            )
        except Exception as e:
            msg = str(e)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower():
                raise RuntimeError(f"Gemini 429 요청 한도 초과 — 잠시 후 재시도: {e}")
            raise
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return self._crop_16_9(part.inline_data.data)
        raise RuntimeError("Gemini 이미지 생성 실패")

    @staticmethod
    def _crop_16_9(png_bytes: bytes, width: int = 1920, height: int = 1080) -> bytes:
        """생성된 이미지를 16:9(1920×1080)으로 중앙 크롭 + 리사이즈"""
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        w, h = img.size
        target_ratio = width / height  # 16/9
        current_ratio = w / h
        if current_ratio > target_ratio:
            # 너무 넓음 → 좌우 크롭
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))
        elif current_ratio < target_ratio:
            # 너무 높음(세로) → 상하 크롭
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        img = img.resize((width, height), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
