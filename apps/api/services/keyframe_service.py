# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
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
    import json
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data,settings").eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}
    s = res.data.get("settings") or {}
    art_style: str = s.get("artStyle", "polystyle")
    palette = _ART_PALETTES.get(art_style, _ART_PALETTES["default"])

    # 캐릭터 portrait R2 URL 조회용 데이터 로드
    _svc_dir = Path(__file__).parent.parent
    _chars_dir = _svc_dir / "data" / "characters"
    _idx_path = _chars_dir / "_index.json"
    _name_to_id: dict[str, str] = {}
    if _idx_path.exists():
        with open(_idx_path, encoding="utf-8") as f:
            _name_to_id = {c["name"]: c["id"] for c in json.load(f).get("characters", [])}

    def _resolve_portraits(scene_meta: dict) -> list[str]:
        # 씬에 등장하는 캐릭터들의 의상 참조 이미지 경로(또는 URL) 목록을 반환한다
        urls = []
        _portraits_dir = _chars_dir / "portraits"  # 로컬 portrait PNG 저장 폴더
        for char_name in (scene_meta or {}).get("characters") or []:
            char_id = _name_to_id.get(char_name)
            if not char_id:
                continue
            # 1순위: 로컬 portrait 파일 (의상 기준 이미지 — 네트워크 없이 빠르게 로드)
            local_png = _portraits_dir / f"{char_id}_polystyle.png"
            if local_png.exists():
                urls.append(str(local_png))
                continue
            # 2순위: polystyle JSON reference_url (로컬 파일 없을 때 R2 URL 폴백)
            style_path = _chars_dir / f"{char_id}_polystyle.json"
            if style_path.exists():
                import json as _json2
                data = _json2.loads(style_path.read_text(encoding="utf-8"))
                ref_url = data.get("reference_url", "")
                if ref_url:
                    urls.append(ref_url)
        return urls

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,image_hint,is_hook,scene_meta")
        .eq("series_id", series_id)
        .eq("status", "pending")
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return {"ok": True, "note": "처리할 씬 없음"}

    from image_backends.pillow_backend import PillowBackend
    from image_backends.gemini_backend import GeminiBackend
    provider = (res.data.get("settings") or {}).get("keyframeProvider", None)
    if provider == "gemini":
        backend_instance = GeminiBackend()
    elif provider == "pillow":
        backend_instance = PillowBackend()
    else:
        backend_instance = get_image_backend()
    queue = get_image_queue()
    palette_name = _palette_name_from_colors(palette)

    async def _gen(scene: dict) -> bytes:
        portrait_urls = _resolve_portraits(scene.get("scene_meta") or {})
        return await backend_instance.generate(
            scene.get("image_hint") or "",
            art_style=art_style,
            is_hook=scene.get("is_hook", False),
            portrait_urls=portrait_urls,
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
