"""캐릭터 누끼 이미지 생성 서비스

흐름:
  char_prompt (build_char_prompt 결과) → Gemini 이미지 생성 → PNG bytes → R2 업로드 → char_url 저장

모델: gemini-2.0-flash-exp-image-generation (기존 GeminiBackend와 동일)
배경: char_prompt에 'on plain white background' 포함 → 흰 배경 단일 이미지로 생성
"""
import asyncio
import tempfile
from pathlib import Path
from core.config import settings
from core.database import get_supabase
from services.tts_service import _upload_r2


async def generate_char_keyframe(series_id: str, scene_code: str) -> dict:
    """char_prompt → Gemini 이미지 생성 → R2 업로드 → char_url 갱신"""
    db = get_supabase()

    # ── 씬 조회 ──────────────────────────────────────────────────────────────
    scene_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,scene_meta,type,speaker")
        .eq("series_id", series_id)
        .eq("scene_code", scene_code)
        .limit(1)
        .execute()
    )
    rows = scene_res.data or []
    if not rows:
        raise ValueError("씬을 찾을 수 없습니다")
    scene = rows[0]

    # dialogue 컷은 캐릭터 누끼 불필요
    if (scene.get("type") or "").lower() == "dialogue":
        raise ValueError("dialogue 컷은 캐릭터 누끼 생성 대상이 아닙니다")

    # ── 시리즈 설정 + world_data ───────────────────────────────────────────
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("settings,world_data")
        .eq("id", series_id)
        .single()
        .execute()
    )
    ser_data = ser_res.data or {}
    art_style = (ser_data.get("settings") or {}).get("artStyle", "masako")
    guest_cast = (ser_data.get("world_data") or {}).get("guest_cast") or {}

    # ── char_prompt 조합 ──────────────────────────────────────────────────
    from services.prompt_composer import build_char_prompt
    char_prompt = build_char_prompt(scene, art_style, guest_cast=guest_cast)
    if not char_prompt:
        raise ValueError("캐릭터 누끼 프롬프트를 생성할 수 없습니다 (캐릭터 1명 narration 컷만 지원)")

    # ── Gemini 이미지 생성 ───────────────────────────────────────────────
    png_bytes = await asyncio.wait_for(
        asyncio.to_thread(_generate_char_image_sync, char_prompt),
        timeout=90.0,
    )

    # ── R2 업로드 ─────────────────────────────────────────────────────────
    scene_id = scene["id"]
    r2_key = (
        f"v3/{series_id}/chars/"
        f"scene_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}_char.png"
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        png_path = Path(tmpdir) / "char.png"
        png_path.write_bytes(png_bytes)
        char_url = await asyncio.to_thread(_upload_r2, str(png_path), r2_key)

    # ── DB 갱신 ───────────────────────────────────────────────────────────
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .update({"char_url": char_url})
        .eq("id", scene_id)
        .execute()
    )

    return {"ok": True, "char_url": char_url}


def _generate_char_image_sync(char_prompt: str) -> bytes:
    """Google AI SDK → 이미지 bytes 반환 (동기, asyncio.to_thread용)"""
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=settings.GOOGLE_API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=char_prompt,
        config=genai_types.GenerateContentConfig(
            response_modalities=["IMAGE"],
        ),
    )
    for part in (response.candidates or [{}])[0].get("content", {}).get("parts", []) if False else \
                (response.candidates[0].content.parts if response.candidates else []):
        if part.inline_data:
            return part.inline_data.data

    raise RuntimeError("Gemini 캐릭터 이미지 생성 실패 — 응답에 이미지 없음")
