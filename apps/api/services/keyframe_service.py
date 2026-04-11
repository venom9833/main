"""키프레임 서비스 — Pillow 그라데이션 키프레임 생성 + R2 업로드"""
import asyncio
import io
import tempfile
from pathlib import Path
from core.config import settings
from core.database import get_supabase
from services.tts_service import _upload_r2
from image_backends.registry import get_image_backend
from agent.generation_queue import get_image_queue

# 화풍별 그라데이션 팔레트 (V2 art_styles 기반)
_ART_PALETTES: dict[str, list[tuple[int, int, int]]] = {
    "default":    [(15, 15, 35), (45, 25, 80)],
    "noir":       [(10, 10, 10), (40, 20, 20)],
    "romance":    [(80, 20, 40), (160, 60, 80)],
    "thriller":   [(5, 15, 25), (20, 40, 60)],
    "office":     [(20, 30, 50), (50, 70, 100)],
}

# palette colors → name 역조회 (backend에 palette 이름 전달용)
_PALETTE_REVERSE: dict[str, str] = {
    str(v): k for k, v in _ART_PALETTES.items()
}


def _palette_name_from_colors(palette: list) -> str:
    return _PALETTE_REVERSE.get(str(palette), "default")


async def run_keyframe(series_id: str) -> dict:
    """전체 씬 키프레임 병렬 생성"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data,settings").eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}
    s = res.data.get("settings") or {}
    # artStyle: masako(기본) or real — art_styles.json 정의
    art_style: str = s.get("artStyle", "masako")
    # pillow 폴백용 팔레트 (art_styles.json에서 읽으면 되지만 로컬 폴백도 유지)
    palette = _ART_PALETTES.get(art_style, _ART_PALETTES["default"])

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,image_hint,is_hook")
        .eq("series_id", series_id)
        .eq("status", "pending")
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return {"ok": True, "note": "처리할 씬 없음"}

    # series.settings.keyframeProvider 우선, 없으면 IMAGE_PROVIDER 환경변수 폴백
    from image_backends.pillow_backend import PillowBackend
    from image_backends.gemini_backend import GeminiBackend
    provider = (res.data.get("settings") or {}).get("keyframeProvider", None)
    if provider == "gemini":
        backend_instance = GeminiBackend()
    elif provider == "pillow":
        backend_instance = PillowBackend()
    else:
        backend_instance = get_image_backend()  # IMAGE_PROVIDER 환경변수 기준
    queue = get_image_queue()
    palette_name = _palette_name_from_colors(palette)

    async def _gen(scene: dict) -> bytes:
        return await backend_instance.generate(
            scene.get("image_hint") or "",
            art_style=art_style,
            is_hook=scene.get("is_hook", False),
        )

    tasks = [
        queue.enqueue(
            f"{series_id}_ch{s['chapter']}_s{s['scene_index']}",
            _gen,
            s,
            priority=s["scene_index"],
        )
        for s in scenes
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # R2 업로드 및 DB 갱신 (이미지 bytes → R2 → DB)
    for scene, result in zip(scenes, results):
        if isinstance(result, Exception):
            await asyncio.to_thread(
                lambda sid=scene["id"], e=result: db.table("v3_scenes").update({
                    "status": "failed",
                    "error_detail": f"키프레임 실패: {e}",
                }).eq("id", sid).execute()
            )
            continue
        await _save_keyframe(series_id, scene, result, db)

    return {"ok": True, "scenes": len(scenes)}


async def _save_keyframe(series_id: str, scene: dict, png_bytes: bytes, db):
    """PNG bytes → R2 업로드 → DB 갱신"""
    scene_id = scene["id"]
    with tempfile.TemporaryDirectory() as tmpdir:
        png_path = Path(tmpdir) / f"scene_{scene_id}.png"
        png_path.write_bytes(png_bytes)
        r2_key = f"v3/{series_id}/keyframes/scene_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}.png"
        url = await asyncio.to_thread(_upload_r2, str(png_path), r2_key)

    await asyncio.to_thread(
        lambda: db.table("v3_scenes").update({
            "keyframe_url": url,
            "status": "keyframe_done",
        }).eq("id", scene_id).execute()
    )


def _make_pillow_frame(
    hint: str,
    palette: list[tuple[int, int, int]],
    is_hook: bool = False,
    width: int = 1920,
    height: int = 1080,
) -> bytes:
    """Pillow 그라데이션 + 텍스트 오버레이 키프레임 생성"""
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

    # HOOK 씬: 강조 테두리
    if is_hook:
        border = 8
        draw.rectangle([border, border, width - border, height - border],
                       outline=(180, 80, 80), width=border)

    # 이미지 힌트 텍스트 오버레이 (하단 40% 반투명 바)
    if hint:
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        bar_top = int(height * 0.72)
        overlay_draw.rectangle([(0, bar_top), (width, height)], fill=(0, 0, 0, 160))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

        # 텍스트 (폰트 없으면 기본 폰트 사용)
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

    # 블러 (배경 부드럽게)
    img = img.filter(ImageFilter.GaussianBlur(radius=1))

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
