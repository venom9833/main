import asyncio
import io
from image_backends.base import ImageBackend


class PillowBackend(ImageBackend):
    async def generate(
        self,
        hint: str,
        width: int = 1920,
        height: int = 1080,
        **kwargs,
    ) -> bytes:
        art_style = kwargs.get("art_style", "polystyle")
        is_hook = kwargs.get("is_hook", False)

        from image_backends.registry import get_art_style_config
        cfg = get_art_style_config(art_style)
        palette = [tuple(c) for c in cfg.get("pillow_palette", [[15, 12, 30], [50, 35, 75]])]
        accent  = tuple(cfg.get("pillow_accent", [160, 100, 200]))

        return await asyncio.to_thread(
            self._sync_generate, hint, width, height, palette, accent, is_hook
        )

    def _sync_generate(
        self,
        hint: str,
        width: int,
        height: int,
        palette: list,
        accent: tuple,
        is_hook: bool,
    ) -> bytes:
        from PIL import Image, ImageDraw, ImageFilter
        import textwrap

        c1, c2 = palette[0], palette[1]
        img = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(img)

        # 그라데이션
        for y in range(height):
            t = y / height
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # HOOK 씬: 화풍 악센트 컬러 테두리
        if is_hook:
            border = 8
            draw.rectangle(
                [border, border, width - border, height - border],
                outline=accent,
                width=border,
            )

        # 이미지 힌트 텍스트 오버레이 (하단 반투명 바)
        if hint:
            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            bar_top = int(height * 0.72)
            overlay_draw.rectangle([(0, bar_top), (width, height)], fill=(0, 0, 0, 160))
            img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
            draw = ImageDraw.Draw(img)

            try:
                from PIL import ImageFont
                font = ImageFont.load_default(size=36)
            except Exception:
                font = None

            wrapped = textwrap.fill(hint[:120], width=60)
            text_y = bar_top + 30
            if font:
                draw.text((width // 2, text_y), wrapped, fill=(220, 220, 220), font=font, anchor="mt")
            else:
                draw.text((80, text_y), wrapped, fill=(220, 220, 220))

        img = img.filter(ImageFilter.GaussianBlur(radius=1))

        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
