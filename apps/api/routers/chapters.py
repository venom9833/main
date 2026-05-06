# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""챕터 라우터 — 조회 / 승인 / 재생성"""
import asyncio
import os
import tempfile
import time
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional
from core.database import get_supabase

router = APIRouter(prefix="/api/v1/series", tags=["chapters"])


# ── 자막 스타일 엔드포인트 ────────────────────────────────────────────────────
# 이 경로는 /{series_id}/... 패턴보다 먼저 정의해야 literal string이 우선 매칭됨.

@router.get("/subtitle-style")
async def get_subtitle_style():
    """자막 스타일 JSON 반환 — subtitle_style.json 단일 진실원.

    keyframe 프리뷰 CSS와 FFmpeg 번인을 동기화하기 위해 프론트엔드가 이 값을 참조한다.
    GET /api/v1/series/subtitle-style
    """
    import json as _json
    style_path = Path(__file__).parent.parent / "data" / "subtitle_style.json"
    return _json.loads(style_path.read_text(encoding="utf-8"))


class PatchChapterRequest(BaseModel):
    content: Optional[str] = None
    meta: Optional[dict] = None


class PatchCutRequest(BaseModel):
    type: Optional[str] = None
    speaker: Optional[str] = None
    text: Optional[str] = None


class RegenKeyframeRequest(BaseModel):
    prompt: Optional[str] = None   # 없으면 DB image_hint 사용
    provider: Optional[str] = None  # "gemini" | "pillow" | None → series 설정 사용


@router.get("/{series_id}/chapters")
async def list_chapters(series_id: str):
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("*")
        .eq("series_id", series_id)
        .order("chapter")
        .execute()
    )
    return res.data


@router.get("/{series_id}/chapters/{chapter}")
async def get_chapter(series_id: str, chapter: int):
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("*")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(404, f"챕터 {chapter} 없음")
    return res.data


@router.patch("/{series_id}/chapters/{chapter}")
async def patch_chapter(series_id: str, chapter: int, req: PatchChapterRequest):
    db = get_supabase()
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").update(patch)
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    return {"ok": True}


@router.post("/{series_id}/chapters/{chapter}/approve")
async def approve_chapter(series_id: str, chapter: int, background_tasks: BackgroundTasks):
    db = get_supabase()
    # 챕터 승인 마킹
    await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .update({"approved": True})
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    # 챕터 대본 → wiki 자동 갱신 (백그라운드)
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("content")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    content = (res.data or {}).get("content", "")
    if content:
        from services.wiki_service import auto_update_wiki
        background_tasks.add_task(auto_update_wiki, series_id, chapter, content)

    return {"ok": True, "series_id": series_id, "chapter": chapter}


@router.post("/{series_id}/chapters/{chapter}/regenerate")
async def regenerate_chapter(series_id: str, chapter: int, background_tasks: BackgroundTasks):
    """챕터 1개만 재생성"""
    db = get_supabase()
    await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .update({"approved": False, "content": None})
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    from services.script_service import regenerate_chapter as _regen
    background_tasks.add_task(_regen, series_id, chapter)
    return {"ok": True, "regenerating": chapter}


@router.post("/{series_id}/revise-script")
async def revise_script(series_id: str, background_tasks: BackgroundTasks):
    """전체 대본 교정 — 기존 스토리 유지, 규칙 위반(대사 30%·짧은 대사)만 수정"""
    from services.script_service import revise_all_chapters
    background_tasks.add_task(revise_all_chapters, series_id)
    return {"ok": True, "message": "대본 교정 시작"}


@router.post("/{series_id}/chapters/{chapter}/harvest")
async def harvest_sentences(series_id: str, chapter: int):
    """대본에서 명문 후보 3개 추출 — writing_guide 수집용"""
    db = get_supabase()
    ch_res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("content")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    if not ch_res.data or not ch_res.data.get("content"):
        raise HTTPException(404, "대본 없음")

    content = ch_res.data["content"]
    from services.gemini_helper import call_gemini
    import json as _json

    prompt = (
        f"다음 대본에서 글쓰기 원칙을 가장 잘 구현한 문장 3개를 추출하라.\n\n"
        f"## 대본\n{content}\n\n"
        "추출 기준 (우선순위순):\n"
        "1. 감정을 신체·행동으로만 표현한 문장 (감정 단어 없음)\n"
        "2. 소품·공간 디테일로 인물 상태를 드러낸 문장\n"
        "3. '재빨리/천천히/조용히/세게' 등 수식어로 심리를 전달한 행동 문장\n"
        "4. 결의를 선언 없이 구체적 행동으로 표현한 문장\n\n"
        "출력: 순수 JSON 배열만. 마크다운 코드블록 없이.\n"
        '[{"sentence": "원문 그대로", "reason": "어느 원칙의 구현인지 한 줄"}, ...]'
    )

    raw = await call_gemini(prompt, max_tokens=800, temperature=0.1)

    try:
        clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        candidates = _json.loads(clean)
        if not isinstance(candidates, list):
            raise ValueError
    except Exception:
        raise HTTPException(500, "후보 파싱 실패")

    return {"candidates": candidates[:3]}


@router.post("/{series_id}/chapters/{chapter}/restructure")
async def restructure_scenes(series_id: str, chapter: int):
    """기존 대본 원문으로 씬/컷 구조만 재생성 (대본 재작성 없음)"""
    db = get_supabase()

    # 대본 원문 로드
    ch_res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("content")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    if not ch_res.data or not ch_res.data.get("content"):
        raise HTTPException(404, f"챕터 {chapter} 대본 없음")
    narrative = ch_res.data["content"]

    # world_data + settings 로드
    s_res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data, series_code, settings")
        .eq("id", series_id)
        .single()
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "시리즈 없음")
    world = s_res.data.get("world_data") or {}
    series_code = s_res.data.get("series_code")
    _settings: dict = s_res.data.get("settings") or {}
    _art_style: str = _settings.get("artStyle", "polystyle")
    _guest_cast: dict = world.get("guest_cast") or {}

    # Gemini 구조화 호출
    from services.script_service import _build_structure_prompt, _parse_scenes_json, _save_scenes, _absorb_dialogue_cuts
    from services.gemini_helper import call_gemini

    structure_prompt = _build_structure_prompt(narrative, world, chapter)
    structure_raw = await call_gemini(structure_prompt, max_tokens=8000, temperature=0.3)

    # 기존 씬 삭제 후 새 씬 저장
    scenes = _parse_scenes_json(structure_raw, chapter, world)
    scenes = await _absorb_dialogue_cuts(scenes, chapter)  # Pass 2: 대사 흡수
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .delete()
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    await _save_scenes(db, series_id, chapter, scenes, series_code,
                       art_style=_art_style, guest_cast=_guest_cast)

    return {"ok": True, "scene_count": len(scenes)}


@router.get("/{series_id}/chapters/{chapter}/scenes")
async def get_scenes(series_id: str, chapter: int):
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("*")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index")
        .order("cut_index")
        .execute()
    )
    return res.data


@router.patch("/{series_id}/scenes/{scene_code}")
async def patch_cut(series_id: str, scene_code: str, req: PatchCutRequest):
    """컷 타입/화자 수정 (narration ↔ dialogue 전환 등)"""
    db = get_supabase()
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    if "type" in patch and patch["type"] not in ("narration", "dialogue"):
        raise HTTPException(400, "type은 narration 또는 dialogue만 허용")
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .update(patch)
        .eq("series_id", series_id)
        .eq("scene_code", scene_code)
        .execute()
    )
    return {"ok": True}


@router.post("/{series_id}/scenes/{scene_code}/keyframe")
async def regen_keyframe(series_id: str, scene_code: str, req: RegenKeyframeRequest):
    """단일 컷 키프레임 Gemini/Pillow 재생성 — 편집된 프롬프트로 이미지 교체"""
    db = get_supabase()

    # 씬 조회 (scene_code 중복 대비 limit 1)
    scene_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,image_hint")
        .eq("series_id", series_id)
        .eq("scene_code", scene_code)
        .limit(1)
        .execute()
    )
    rows = scene_res.data or []
    if not rows:
        raise HTTPException(404, "씬을 찾을 수 없습니다")
    scene = rows[0]

    # 시리즈 설정 (artStyle, keyframeProvider, series_code)
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("settings,series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    settings = (ser_res.data or {}).get("settings") or {}
    art_style = settings.get("artStyle", "polystyle")

    # provider 우선순위: req.provider > series.settings.keyframeProvider > "gemini"
    provider = req.provider or settings.get("keyframeProvider", "gemini")

    # 프롬프트: req.prompt > DB image_hint
    hint = req.prompt or scene.get("image_hint") or ""

    # image_hint를 요청 프롬프트로 갱신 (prompt가 있을 때)
    if req.prompt is not None:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes")
            .update({"image_hint": req.prompt})
            .eq("id", scene["id"])
            .execute()
        )

    # 백엔드 선택
    if provider == "gemini":
        from image_backends.gemini_backend import GeminiBackend
        backend = GeminiBackend()
    else:
        from image_backends.pillow_backend import PillowBackend
        backend = PillowBackend()

    try:
        png_bytes = await backend.generate(hint, art_style=art_style)
    except Exception as e:
        raise HTTPException(500, f"이미지 생성 실패: {e}")

    # 로컬 출력 폴더에 저장 — ch##s##nc## 정규화 파일명
    try:
        from pathlib import Path
        from services.grid_crop_service import _normalize_scene_code as _norm
        _chapter = scene.get("chapter", 1)
        _file_code = _norm(scene_code)
        _out_dir = (
            Path(__file__).parent.parent.parent.parent
            / "output" / series_code / f"ch{_chapter:02d}"
        )
        _out_dir.mkdir(parents=True, exist_ok=True)
        (_out_dir / f"{_file_code}.png").write_bytes(png_bytes)

        # PNG 저장 후 Ken Burns 자동 갱신 (overwrite=True: 새 이미지 반영)
        async def _auto_kenburns_regen():
            try:
                from services.kenburns_service import single_kenburns
                r = await single_kenburns(series_id, scene_code, db, overwrite=True)
                print(f"[regen-kenburns] {scene_code} → {r}")
            except Exception as _kb_e:
                print(f"[regen-kenburns] 실패 (무시): {_kb_e}")
        asyncio.create_task(_auto_kenburns_regen())
    except Exception as _e:
        print(f"[keyframe] 로컬 저장 실패 (무시): {_e}")

    # R2 업로드
    from services.keyframe_service import _save_keyframe
    await _save_keyframe(series_id, scene, png_bytes, db)

    # 갱신된 keyframe_url 반환
    updated = await asyncio.to_thread(
        lambda: db.table("v3_scenes").select("keyframe_url").eq("id", scene["id"]).single().execute()
    )
    return {"ok": True, "keyframe_url": (updated.data or {}).get("keyframe_url")}


@router.post("/{series_id}/scenes/{scene_code}/char-keyframe")
async def gen_char_keyframe(series_id: str, scene_code: str):
    """캐릭터 누끼 이미지 생성 — char_prompt → Gemini → R2 → char_url 저장

    narration + 캐릭터 1명 컷 전용 (production=split).
    """
    from services.char_keyframe_service import generate_char_keyframe
    try:
        return await generate_char_keyframe(series_id, scene_code)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"캐릭터 이미지 생성 실패: {e}")


@router.get("/{series_id}/scenes/{scene_code}/compose-prompt")
async def compose_image_prompt(series_id: str, scene_code: str):
    """씬 이미지 프롬프트 — 캐릭터 JSON + 화풍 규칙 기반 조합 (Gemini 0회)

    반환 필드:
      prompt        — 기존 합성 프롬프트 (호환성 유지)
      negative_prompt
      art_style
      cut_type      — "narration" | "dialogue"
      has_chars     — 캐릭터 등장 여부
      speaker       — dialogue 화자 이름 (없으면 "")
      bg_prompt     — 배경 전용 프롬프트 (사용자 수동 생성용)
      char_prompt   — 캐릭터 누끼 전용 프롬프트 (API 자동생성용)
    """
    db = get_supabase()

    def _fetch_scene():
        return db.table("v3_scenes") \
            .select("image_prompt,image_hint,scene_meta,type,speaker") \
            .eq("series_id", series_id) \
            .eq("scene_code", scene_code) \
            .execute()

    scene_res = await asyncio.to_thread(_fetch_scene)
    rows = scene_res.data or []
    if not rows:
        raise HTTPException(404, "씬을 찾을 수 없습니다")
    scene = rows[0]

    def _fetch_settings():
        return db.table("v3_series") \
            .select("settings,world_data") \
            .eq("id", series_id) \
            .execute()

    ser_res = await asyncio.to_thread(_fetch_settings)
    ser_rows = ser_res.data or []
    ser_row: dict = ser_rows[0] if ser_rows else {}
    settings: dict = ser_row.get("settings") or {}
    art_style: str = settings.get("artStyle", "polystyle")
    guest_cast: dict = (ser_row.get("world_data") or {}).get("guest_cast") or {}

    from services.prompt_composer import (
        build_cut_image_prompt,
        build_cut_negative_prompt,
        build_bg_prompt,
        build_char_prompt,
    )

    cut_type   = (scene.get("type") or "narration").lower()
    char_names = (scene.get("scene_meta") or {}).get("characters") or []
    has_chars  = len(char_names) > 0
    speaker    = (scene.get("speaker") or "").strip()

    # production: 이미지 제작 방식
    # animation_type: Remotion 렌더링 방식
    if cut_type == "dialogue":
        production     = "composite"   # OTS 합성 단일 이미지 — 사용자 수동
        animation_type = "lipsync"
    elif len(char_names) == 1:
        production     = "split"       # 배경(수동) + 캐릭터 1명 누끼(API) → parallax
        animation_type = "parallax"
    elif len(char_names) >= 2:
        production     = "composite"   # 캐릭터 포함 합성 이미지 — 사용자 수동 → Ken Burns
        animation_type = "ken_burns"
    else:
        production     = "bg_only"     # 배경만 — 사용자 수동 → Ken Burns
        animation_type = "ken_burns"

    from services.translate_hint import translate_if_korean

    # 번역 선행: build_cut_image_prompt 호출 전에 image_hint_en + bg_context_en 모두 주입
    scene["image_hint_en"] = await translate_if_korean(scene.get("image_hint") or "")
    _sm = scene.get("scene_meta") or {}
    # time_of_day는 prompt_composer._translate_time_of_day()가 결정론적으로 처리 — 여기선 제외
    _bg_parts = [p for p in [
        _sm.get("scene_hint") or "",
        _sm.get("location") or "",
        _sm.get("atmosphere") or "",
    ] if p]
    _bg_hint_raw = ", ".join(_bg_parts)
    _bg_context_en = await translate_if_korean(_bg_hint_raw)
    scene["bg_context_en"] = _bg_context_en

    prompt      = build_cut_image_prompt(scene, art_style, guest_cast=guest_cast)
    negative    = build_cut_negative_prompt(scene, art_style, guest_cast=guest_cast)

    # bg_prompt: scene_meta 기반으로 캐릭터 없이 순수 배경 묘사만 구성
    _bg_scene = {
        "image_hint": _bg_hint_raw,
        "image_hint_en": _bg_context_en,
        "scene_meta": {"characters": []},
    }
    bg_prompt = build_bg_prompt(_bg_scene, art_style)

    # build_char_prompt 내부에서 1인 narration 아닐 경우 "" 반환
    char_prompt = build_char_prompt(scene, art_style, guest_cast=guest_cast)

    return {
        "prompt":          prompt,         # 기존 호환성 유지
        "negative_prompt": negative,
        "art_style":       art_style,
        "cut_type":        cut_type,       # "narration" | "dialogue"
        "has_chars":       has_chars,
        "speaker":         speaker,
        "production":      production,     # "split" | "composite" | "bg_only"
        "animation_type":  animation_type, # "parallax" | "ken_burns" | "lipsync"
        "bg_prompt":       bg_prompt,      # split/bg_only — 사용자 수동 생성용
        "char_prompt":     char_prompt,    # split 전용 — 캐릭터 누끼 API 자동생성용
        "_debug_char_names":  char_names,
        "_debug_gemini_error": None,
    }


@router.post("/{series_id}/scenes/{scene_code}/upload")
async def upload_scene_asset(
    series_id: str,
    scene_code: str,
    file: UploadFile = File(...),
    target: str = Form("bg"),   # "bg" | "lipsync" | "char"
):
    """씬 자산 업로드 — 배경 이미지 / 립씽크 MP4 / 캐릭터 누끼

    target: "bg"      → bg_url 갱신 (narration 배경)
            "lipsync" → lipsync_url 갱신 (dialogue MP4)
            "char"    → char_url 갱신 (캐릭터 누끼 PNG)
    파일은 R2에 저장하고 URL을 반환한다.
    """
    from services.tts_service import _upload_r2

    db = get_supabase()

    # 씬 존재 확인 + 기존 URL 조회 (교체 시 R2 구버전 삭제용)
    col_map = {"bg": "bg_url", "lipsync": "lipsync_url", "char": "char_url"}
    col = col_map.get(target)
    select_cols = f"id,{col}" if col else "id"
    scene_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select(select_cols)
        .eq("series_id", series_id)
        .eq("scene_code", scene_code)
        .limit(1)
        .execute()
    )
    rows = scene_res.data or []
    if not rows:
        raise HTTPException(404, "씬을 찾을 수 없습니다")
    scene_row = rows[0]
    scene_id = scene_row["id"]
    old_url: str = scene_row.get(col, "") or "" if col else ""

    # 파일 bytes 읽기
    file_bytes = await file.read()
    filename   = file.filename or "upload"
    suffix     = Path(filename).suffix.lower() or (".mp4" if target == "lipsync" else ".png")

    # R2 키 — 타임스탬프 포함으로 교체 업로드 시 브라우저 캐시 무효화
    ts = int(time.time())
    r2_key = f"series/{series_id}/scenes/{scene_code}/{target}_{ts}{suffix}"

    # 임시 파일에 저장 후 R2 업로드
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        url = await asyncio.to_thread(_upload_r2, tmp_path, r2_key)
    finally:
        os.unlink(tmp_path)

    # 구버전 R2 파일 삭제 (비동기, 실패해도 무시)
    if old_url and old_url != url:
        try:
            from urllib.parse import urlparse
            from core.config import settings as _cfg
            import boto3
            old_key = urlparse(old_url).path.lstrip("/")
            def _delete_old():
                s3 = boto3.client(
                    "s3",
                    endpoint_url=_cfg.R2_ENDPOINT,
                    aws_access_key_id=_cfg.R2_ACCESS_KEY_ID,
                    aws_secret_access_key=_cfg.R2_SECRET_ACCESS_KEY,
                )
                s3.delete_object(Bucket=_cfg.R2_BUCKET, Key=old_key)
            await asyncio.to_thread(_delete_old)
        except Exception as _e:
            print(f"[upload] 구버전 R2 삭제 실패 (무시): {_e}")

    # DB 컬럼 갱신
    if col:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes")
            .update({col: url})
            .eq("id", scene_id)
            .execute()
        )

    return {"ok": True, f"{target}_url": url}


@router.post("/{series_id}/chapters/{chapter}/scenes/{scene_index}/retry")
async def retry_scene(series_id: str, chapter: int, scene_index: int, background_tasks: BackgroundTasks):
    """씬 1개 재시도 (tts + render)"""
    db = get_supabase()
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .update({"status": "pending", "error_detail": None})
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .eq("scene_index", scene_index)
        .execute()
    )
    return {"ok": True}


@router.get("/{series_id}/chapters/{chapter}/output-files")
async def get_output_files(series_id: str, chapter: int):
    """output 폴더 파일 목록 반환 — TTS(.mp3) / 이미지(.png) 완료 여부 + duration 확인용"""
    from pathlib import Path
    import ffmpeg

    def _mp3_duration(path: Path) -> float | None:
        try:
            probe = ffmpeg.probe(str(path))
            return round(float(probe["format"]["duration"]), 1)
        except Exception:
            return None

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    if not out_dir.exists():
        return {"files": [], "tts_done": [], "tts_durations": {}, "img_done": []}
    files    = [f.name for f in out_dir.iterdir() if f.is_file()]
    mp3_files = [f for f in out_dir.iterdir() if f.is_file() and f.suffix == ".mp3"]
    wav_files = [f for f in out_dir.iterdir() if f.is_file() and f.suffix == ".wav"]
    img_done  = [f.stem for f in out_dir.iterdir() if f.is_file() and f.suffix == ".png"]

    # duration 병렬 측정 (mp3 우선, wav 폴백)
    durations: dict[str, float] = {}
    for f in mp3_files:
        dur = await asyncio.to_thread(_mp3_duration, f)
        if dur is not None:
            durations[f.stem] = dur
    for f in wav_files:
        if f.stem not in durations:  # mp3가 없는 경우에만
            dur = await asyncio.to_thread(_mp3_duration, f)
            if dur is not None:
                durations[f.stem] = dur

    # mp3 + wav 스템 합집합 → TTS 완료 목록
    tts_done = list({f.stem for f in mp3_files} | {f.stem for f in wav_files})
    return {"files": files, "tts_done": tts_done, "tts_durations": durations, "img_done": img_done}


@router.get("/{series_id}/chapters/{chapter}/local-scenes")
async def get_local_scenes(series_id: str, chapter: int):
    """DB v3_scenes 기반 씬 목록 반환 — 로컬 파일 존재 시 URL 덮어씀 (소스 오브 트루스: DB)

    # ─────────────────────────────────────────────────────────────────────────
    # TODO(개발 완료 후 R2 전환):
    #   현재는 개발 편의를 위해 PNG / MP3 / MP4 모두 로컬 파일 서버에서 서빙한다.
    #   전체 개발 완료 후 로컬 파일 체크 없이 DB R2 URL 만 반환:
    #     sc["bg_url"]       = row.get("bg_url")
    #     sc["lipsync_url"]  = row.get("lipsync_url")
    #     sc["tts_url"]      = row.get("tts_url")
    #     sc["keyframe_url"] = row.get("keyframe_url")
    #   local-file 엔드포인트와 함께 제거한다.
    # ─────────────────────────────────────────────────────────────────────────
    """
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    base = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{chapter}/local-file"

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("*")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index")
        .order("cut_index")
        .execute()
    )
    rows = scenes_res.data or []

    result = []
    for row in rows:
        scene_code = row.get("scene_code") or ""
        if not scene_code:
            continue
        # ★ 53번 설계: HOOK은 scene_index=0·원본 위치 2곳에 동일 scene_code → 중복 제거 금지

        norm = _normalize_scene_code(scene_code)
        has_png = (out_dir / f"{norm}.png").exists()
        has_mp4 = (out_dir / f"{norm}.mp4").exists()
        has_mp3 = (out_dir / f"{norm}.mp3").exists()
        has_wav = (out_dir / f"{norm}.wav").exists()
        kb_marker = out_dir / f"{norm}.kb_mode"
        kb_mode = kb_marker.read_text().strip() if kb_marker.exists() else None

        local_png = f"{base}/{norm}/png" if has_png else None
        # DB R2 URL 우선, 없으면 로컬 폴백 (bg / lipsync / char 동일 패턴)
        db_lipsync = row.get("lipsync_url") or ""
        resolved_lipsync = db_lipsync if db_lipsync else (f"{base}/{norm}/mp4" if has_mp4 else None)
        db_bg = row.get("bg_url") or ""
        resolved_bg = db_bg if db_bg else local_png
        db_char = row.get("char_url") or ""
        resolved_char = db_char if db_char else None
        result.append({
            "id":               row["id"],
            "series_id":        row["series_id"],
            "chapter":          row["chapter"],
            "scene_index":      row["scene_index"],
            "cut_index":        row["cut_index"],
            "scene_code":       scene_code,
            "text":             row.get("text") or "",
            "image_hint":       row.get("image_hint") or "",
            "image_prompt":     row.get("image_prompt") or "",
            "is_hook":          row.get("is_hook", False),
            "type":             row.get("type") or "narration",
            "speaker":          row.get("speaker"),
            "tts_voice":        row.get("tts_voice"),
            "scene_meta":       row.get("scene_meta") or {},
            "sub_scenes":       row.get("sub_scenes") or [],
            "status":           row.get("status") or "pending",
            "error_detail":     row.get("error_detail"),
            "created_at":       row.get("created_at"),
            "duration_seconds": row.get("duration_seconds"),
            "render_type":      row.get("render_type"),
            "animation_type":   row.get("animation_type"),
            "production":       row.get("production"),
            "bg_url":           resolved_bg,
            "keyframe_url":     local_png,
            "lipsync_url":      resolved_lipsync,
            "kb_mode":          kb_mode,
            "tts_url":          f"{base}/{norm}/mp3" if has_mp3 else (f"{base}/{norm}/wav" if has_wav else None),
            "char_url":         resolved_char,
            "wav_url":          row.get("wav_url"),
            "kling_clip_url":   row.get("kling_clip_url"),
        })

    return result


@router.get("/{series_id}/chapters/{chapter}/local-file/{scene_code}/{ext}")
async def get_local_file(series_id: str, chapter: int, scene_code: str, ext: str):
    """로컬 output 폴더 파일 서빙 (png / mp4 / mp3 / wav)

    # TODO(개발 완료 후 R2 전환):
    #   이 엔드포인트는 개발 중 로컬 파일을 직접 서빙하기 위한 임시 라우터다.
    #   전체 개발 완료 후 모든 에셋은 R2 Public URL 로 직접 참조하며,
    #   이 엔드포인트와 local-scenes 엔드포인트는 함께 제거한다.
    """
    from fastapi.responses import FileResponse as _FR

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"

    media_types = {"png": "image/png", "mp4": "video/mp4", "mp3": "audio/mpeg", "wav": "audio/wav"}
    if ext not in media_types:
        raise HTTPException(status_code=400, detail="Invalid extension")

    file_path = out_dir / f"{scene_code}.{ext}"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="파일 없음")

    return _FR(str(file_path), media_type=media_types[ext],
               headers={"Cache-Control": "no-cache, no-store"})


@router.get("/{series_id}/chapters/{chapter}/tts/{scene_code}")
async def get_tts_file(series_id: str, chapter: int, scene_code: str):
    """로컬 저장된 TTS MP3 파일 스트리밍"""
    from fastapi.responses import FileResponse
    from pathlib import Path
    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    from services.grid_crop_service import _normalize_scene_code as _norm
    file_code = _norm(scene_code)
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    mp3_path = out_dir / f"{file_code}.mp3"
    if not mp3_path.exists():
        raise HTTPException(status_code=404, detail="TTS 파일 없음")
    return FileResponse(str(mp3_path), media_type="audio/mpeg",
                        filename=f"{file_code}.mp3")


@router.post("/{series_id}/sync-local")
async def sync_local_to_db(series_id: str):
    """로컬 output 폴더의 mp3/mp4 파일을 DB tts_url / lipsync_url 로 강제 동기화.

    파일명(=정규화 scene_code)으로 DB 레코드를 찾아 로컬 서빙 URL을 저장한다.
    기존 33개처럼 로컬엔 있지만 DB가 NULL인 컷을 일괄 백필할 때 사용.
    """
    import re as _re
    from pathlib import Path as _Path

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    output_root = _Path(__file__).parent.parent.parent.parent / "output" / series_code

    if not output_root.exists():
        return {"ok": True, "tts_synced": 0, "mp4_synced": 0, "note": "output 폴더 없음"}

    tts_synced = 0
    mp4_synced = 0
    _SC_PAT = _re.compile(r"^ch\d+s\d+nc\d+$")

    for ch_dir in sorted(output_root.glob("ch*")):
        if not ch_dir.is_dir():
            continue
        ch_m = _re.search(r"ch(\d+)", ch_dir.name)
        if not ch_m:
            continue
        ch_num = int(ch_m.group(1))

        for mp3_file in sorted(ch_dir.glob("*.mp3")):
            sc = mp3_file.stem
            if not _SC_PAT.match(sc):
                continue
            url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{ch_num}/tts/{sc}"
            _sc, _url = sc, url
            await asyncio.to_thread(
                lambda: db.table("v3_scenes")
                .update({"tts_url": _url})
                .eq("series_id", series_id)
                .eq("scene_code", _sc)
                .execute()
            )
            tts_synced += 1

        for mp4_file in sorted(ch_dir.glob("*.mp4")):
            sc = mp4_file.stem
            if not _SC_PAT.match(sc):
                continue
            url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{ch_num}/local-file/{sc}/mp4"
            _sc, _url = sc, url
            await asyncio.to_thread(
                lambda: db.table("v3_scenes")
                .update({"lipsync_url": _url})
                .eq("series_id", series_id)
                .eq("scene_code", _sc)
                .neq("type", "dialogue")
                .execute()
            )
            mp4_synced += 1

    return {"ok": True, "tts_synced": tts_synced, "mp4_synced": mp4_synced}


@router.post("/{series_id}/chapters/{chapter}/sync-to-r2")
async def sync_chapter_to_r2(series_id: str, chapter: int):
    """로컬 ch{N}/ 전체 파일 → R2 업로드 → DB URL 최소 갱신.

    대상 (재귀 스캔):
      PNG  → keyframe_url
      MP3  → tts_url
      SRT  → srt_url
      MP4  → lipsync_url  (ch{N}_final.mp4 제외)
      OGG  → R2 업로드만, DB 컬럼 없음 (sfx/bed 공유 에셋)
    R2 키: {series_code}/ch{chapter:02d}/{ch_dir 기준 상대경로}
    """
    from pathlib import Path as _Path
    from services.tts_service import _upload_r2
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()

    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser.data or {}).get("series_code") or series_id

    output_root = _Path(__file__).parent.parent.parent.parent / "output"
    ch_dir = output_root / series_code / f"ch{chapter:02d}"
    if not ch_dir.exists():
        return {"ok": False, "reason": f"로컬 폴더 없음: ch{chapter:02d}"}

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,scene_code")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    stem_map: dict[str, str] = {
        _normalize_scene_code(s["scene_code"]): s["id"]
        for s in (scenes_res.data or [])
    }

    _VALID_EXTS = {".png", ".mp3", ".srt", ".mp4", ".ogg"}

    def _resolve_field(stem: str, ext: str) -> "str | None":
        """파일 stem+ext → DB 필드명. None = R2 업로드만(DB 갱신 없음)."""
        if ext == ".png":  return "keyframe_url"
        if ext == ".srt":  return "srt_url"
        if ext == ".ogg":  return None
        if ext == ".mp4":
            return "clean_url" if stem.endswith("_clean") else "lipsync_url"
        if ext == ".mp3":
            return "sfx_url" if stem.endswith("_sfx") else "tts_url"
        return None

    def _base_stem(stem: str) -> str:
        """_clean / _sfx 접미사 제거 → scene stem_map 조회용."""
        for suffix in ("_clean", "_sfx"):
            if stem.endswith(suffix):
                return stem[: -len(suffix)]
        return stem

    uploaded = 0
    skipped = 0
    errors: list[str] = []

    for f in sorted(ch_dir.rglob("*")):
        if f.is_dir():
            continue
        ext = f.suffix.lower()
        if ext not in _VALID_EXTS:
            skipped += 1
            continue
        if f.stem.endswith("_final"):
            skipped += 1
            continue

        rel = f.relative_to(ch_dir).as_posix()
        # OGG: 공용 에셋 → sfx/... (시리즈 prefix 없음)
        # 나머지: 시리즈 콘텐츠 → {series_code}/ch{N:02d}/...
        if ext == ".ogg":
            r2_key = rel
        else:
            r2_key = f"{series_code}/ch{chapter:02d}/{rel}"
        field = _resolve_field(f.stem, ext)

        is_asset = ext == ".ogg"
        try:
            _f_str, _key, _asset = str(f), r2_key, is_asset
            url = await asyncio.to_thread(_upload_r2, _f_str, _key, assets=_asset)
        except Exception as e:
            errors.append(f"{rel}: {e}")
            continue

        if field:
            scene_id = stem_map.get(_base_stem(f.stem))
            if scene_id:
                _sid, _fld, _url = scene_id, field, url
                await asyncio.to_thread(
                    lambda: db.table("v3_scenes").update({_fld: _url}).eq("id", _sid).execute()
                )

        uploaded += 1
        print(f"  [r2] {r2_key}")

    return {"ok": True, "uploaded": uploaded, "skipped": skipped, "errors": errors}


@router.post("/{series_id}/chapters/{chapter}/tts-batch-local")
async def tts_batch_local(series_id: str, chapter: int):
    """나레이션 컷 전체 TTS 재생성 → 로컬 MP3 + SRT 저장 + DB tts_url 갱신.

    edge-tts만 사용 (word_events 제공 → SRT 타이밍 확보).
    dialogue 컷은 건너뜀 (캐릭터 성우 보존).
    """
    import pathlib as _pl
    import tempfile as _tf
    from services.tts_service import _edge_tts, _make_srt, _FEMALE_VOICE, _MALE_VOICE
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()

    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code,settings").eq("id", series_id).single().execute()
    )
    ser_data = ser_res.data or {}
    series_code = ser_data.get("series_code") or series_id
    tts_gender = (ser_data.get("settings") or {}).get("ttsGender", "female")
    narrator_voice = _MALE_VOICE if tts_gender == "male" else _FEMALE_VOICE

    out_dir = _pl.Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,scene_code,text,type")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .neq("type", "dialogue")
        .order("scene_index").order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []

    done = 0
    errors: list[dict] = []
    for s in scenes:
        sc = s.get("scene_code") or ""
        text = (s.get("text") or "").strip()
        if not sc or not text:
            continue
        file_code = _normalize_scene_code(sc)
        mp3_path = out_dir / f"{file_code}.mp3"
        srt_path = out_dir / f"{file_code}.srt"
        try:
            with _tf.TemporaryDirectory() as tmp:
                tmp_mp3 = _pl.Path(tmp) / "out.mp3"
                word_events = await _edge_tts(text, str(tmp_mp3), voice=narrator_voice)
                audio_bytes = tmp_mp3.read_bytes()
            mp3_path.write_bytes(audio_bytes)
            _make_srt(word_events, str(srt_path))
            tts_url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{chapter}/tts/{sc}"
            _sc_cap, _url_cap = sc, tts_url
            await asyncio.to_thread(
                lambda: db.table("v3_scenes")
                .update({"tts_url": _url_cap})
                .eq("series_id", series_id)
                .eq("scene_code", _sc_cap)
                .execute()
            )
            done += 1
            print(f"  [tts-batch] {file_code} ({len(word_events)}단어)")
        except Exception as e:
            errors.append({"scene_code": sc, "error": str(e)})
            print(f"  [tts-batch] {file_code} 실패: {e}")

    return {"ok": True, "done": done, "errors": errors}


@router.post("/{series_id}/chapters/{chapter}/kenburns-batch")
async def kenburns_batch(series_id: str, chapter: int, overwrite: bool = False):
    """MP3 + 이미지 → Ken Burns MP4 일괄 자동 생성 (사용자 개입 없음)"""
    from services.kenburns_service import batch_kenburns
    db = get_supabase()
    result = await batch_kenburns(series_id, chapter, db, overwrite=overwrite)
    return result


@router.post("/{series_id}/scenes/{scene_code}/kenburns")
async def kenburns_single(series_id: str, scene_code: str):
    """단일 컷 Ken Burns 재생성 — 현재 PNG + MP3로 즉시 재빌드 (overwrite=True)"""
    from services.kenburns_service import single_kenburns
    db = get_supabase()
    result = await single_kenburns(series_id, scene_code, db, overwrite=True)

    # 켄번스 성공 후 DB lipsync_url → 로컬 서빙 URL로 갱신
    if result.get("ok"):
        import re as _re
        from services.grid_crop_service import _normalize_scene_code as _norm
        ch_m = _re.search(r"ch(\d+)", scene_code)
        ch_num = int(ch_m.group(1)) if ch_m else 1
        file_code_k = _norm(scene_code)
        local_mp4_url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{ch_num}/local-file/{file_code_k}/mp4"
        await asyncio.to_thread(
            lambda: db.table("v3_scenes")
            .update({"lipsync_url": local_mp4_url})
            .eq("series_id", series_id)
            .eq("scene_code", scene_code)
            .neq("type", "dialogue")  # dialogue lipsync는 보존
            .execute()
        )

    return result


class GridPromptRequest(BaseModel):
    scene_codes: list[str]

class GridGenerateRequest(BaseModel):
    scene_codes: list[str]   # 4컷 scene_code 리스트 (그룹 순서 유지)


class RenderRequest(BaseModel):
    """MP4 합성 요청 파라미터.

    resolution: "16:9" → 1920×1080 가로형 (기본값)
                "9:16" → 1080×1920 세로형 (쇼츠/릴스용 Center Crop)
    """
    resolution: str = "16:9"


@router.post("/{series_id}/compose-grid-prompt")
async def compose_grid_prompt(series_id: str, body: GridPromptRequest):
    """씬 내 c01~c04 컷을 1장 그리드 이미지로 생성하기 위한 통합 프롬프트 조합.

    기존 컷별 compose-prompt와 별개 기능 — 기존 로직 교체 아님.
    각 컷의 build_cut_image_prompt 결과를 2x2 패널 레이아웃으로 합친다.
    """
    import asyncio
    from services.prompt_composer import build_cut_image_prompt
    from services.translate_hint import translate_if_korean

    db = get_supabase()
    scene_codes = body.scene_codes[:4]  # 최대 4컷

    # 시리즈 설정 (art_style)
    def _fetch_settings():
        return db.table("v3_series") \
            .select("settings,world_data") \
            .eq("id", series_id) \
            .execute()

    ser_res = await asyncio.to_thread(_fetch_settings)
    ser_row: dict = (ser_res.data or [{}])[0]
    settings: dict = ser_row.get("settings") or {}
    art_style: str = settings.get("artStyle", "polystyle")
    guest_cast: dict = (ser_row.get("world_data") or {}).get("guest_cast") or {}

    # art_style base_style_prompt 로드
    import json, os
    _styles_path = os.path.join(os.path.dirname(__file__), "..", "data", "art_styles.json")
    with open(_styles_path, encoding="utf-8") as f:
        _styles = json.load(f)
    base_style = (_styles.get(art_style) or _styles.get("polystyle")).get("base_style_prompt", "")

    # 각 scene_code별 씬 데이터 조회
    def _fetch_scenes():
        return db.table("v3_scenes") \
            .select("image_hint,scene_meta,type,speaker,scene_code,char_url") \
            .eq("series_id", series_id) \
            .in_("scene_code", scene_codes) \
            .execute()

    scenes_res = await asyncio.to_thread(_fetch_scenes)
    rows_map = {r["scene_code"]: r for r in (scenes_res.data or [])}

    # 캐릭터 레퍼런스 portrait 수집 — 로컬 파일 우선, R2 URL 폴백
    # scene_meta.characters → _index.json char_id → portraits/{char_id}_polystyle.png (또는 JSON reference_url)
    from pathlib import Path as _Path
    _chars_dir = _Path(__file__).parent.parent / "data" / "characters"
    _portraits_dir = _chars_dir / "portraits"  # 로컬 portrait PNG 저장 폴더
    _idx_path = _chars_dir / "_index.json"
    with open(_idx_path, encoding="utf-8") as _f:
        _index_data = json.load(_f)
    _name_to_id: dict[str, str] = {c["name"]: c["id"] for c in _index_data.get("characters", [])}

    _seen_char_ids: set[str] = set()
    char_portrait_urls: list[str] = []
    for sc in scene_codes:
        row = rows_map.get(sc) or {}
        characters = (row.get("scene_meta") or {}).get("characters") or []
        for char_name in characters:
            char_id = _name_to_id.get(char_name)
            if not char_id or char_id in _seen_char_ids:
                continue
            # 1순위: 로컬 portrait 파일 (네트워크 없이 빠르게 로드)
            local_png = _portraits_dir / f"{char_id}_polystyle.png"
            if local_png.exists():
                _seen_char_ids.add(char_id)
                char_portrait_urls.append(str(local_png))
                continue
            # 2순위: polystyle JSON reference_url (로컬 파일 없을 때 R2 URL 폴백)
            style_path = _chars_dir / f"{char_id}_polystyle.json"
            if style_path.exists():
                style_data = json.loads(style_path.read_text(encoding="utf-8"))
                ref_url = style_data.get("reference_url", "")
                if ref_url:
                    _seen_char_ids.add(char_id)
                    char_portrait_urls.append(ref_url)

    char_urls: list[str] = []  # 하위 호환 유지 (현재 미사용)

    # scene_codes 순서 유지하며 패널 프롬프트 조립
    panel_labels = ["upper-left", "upper-right", "lower-left", "lower-right"]
    panel_parts: list[str] = []
    processed_codes: list[str] = []

    def _strip_style(prompt: str) -> str:
        """패널 프롬프트에서 base_style 토큰 제거 — 그리드 상단에 1회만 배치"""
        stripped = prompt.replace(", " + base_style, "").replace(base_style + ", ", "").replace(base_style, "")
        return stripped.strip().strip(",").strip()

    for i, sc in enumerate(scene_codes):
        label = panel_labels[i]
        row = rows_map.get(sc)
        if row:
            row["image_hint_en"] = await translate_if_korean(row.get("image_hint") or "")
            _row_sm = row.get("scene_meta") or {}
            # time_of_day는 prompt_composer._translate_time_of_day()가 결정론적 처리 — 여기선 제외
            _row_bg_raw = ", ".join([p for p in [
                _row_sm.get("scene_hint") or "",
                _row_sm.get("location") or "",
                _row_sm.get("atmosphere") or "",
            ] if p])
            row["bg_context_en"] = await translate_if_korean(_row_bg_raw)
            cut_prompt = _strip_style(build_cut_image_prompt(row, art_style, guest_cast=guest_cast))
            panel_parts.append(f"{label}: {cut_prompt}")
            processed_codes.append(sc)
        else:
            panel_parts.append(f"{label}: empty scene, same background atmosphere")

    # 3컷 씬 — 빈 4번째 패널 채우기
    while len(panel_parts) < 4:
        panel_parts.append(f"{panel_labels[len(panel_parts)]}: empty scene, same background atmosphere")

    grid_prompt = (
        f"{base_style},\n"
        "single seamless 16:9 cinematic image, "
        "four continuous moments from the same story world, "
        "each area shows one unified still moment — no split composition within any area,\n"
        + ",\n".join(panel_parts) + ",\n"
        "consistent lighting and color palette throughout, "
        "no text, no watermark, no border, no frame, no dividing line, "
        "no grid, no separator, no dark edge, no split screen within panels"
    )

    return {
        "grid_prompt":         grid_prompt,
        "cut_count":           len(processed_codes),
        "scene_codes":         processed_codes,
        "art_style":           art_style,
        "char_urls":           char_urls,            # 하위 호환 (현재 빈 리스트)
        "char_portrait_urls":  char_portrait_urls,  # R2 portrait public URL
    }


@router.post("/{series_id}/upload-grid-image")
async def upload_grid_image(
    series_id: str,
    file: UploadFile = File(...),
    scene_codes: str = Form(...),   # JSON 배열 문자열 "[\"ch01s01nc02\", ...]"
):
    """업로드된 4컷 그리드 이미지 → 크롭 → R2 저장 → keyframe_url 업데이트.

    generate-grid-image 와 동일한 3~4단계만 실행 (AI 생성 없음).
    """
    import asyncio, json, re

    codes: list[str] = json.loads(scene_codes)[:4]
    if not codes:
        raise HTTPException(400, "scene_codes 필요")

    grid_bytes = await file.read()

    from services.grid_crop_service import crop_grid, save_grid_to_r2

    db = get_supabase()

    def _fetch_series_code():
        res = db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
        return (res.data or {}).get("series_code") or ""

    series_code = await asyncio.to_thread(_fetch_series_code)

    _sc = codes[0]
    _m = re.search(r"ch(\d+)s(\d+)", _sc, re.IGNORECASE)
    _ch = int(_m.group(1)) if _m else 1
    _si = int(_m.group(2)) if _m else 0
    await asyncio.to_thread(save_grid_to_r2, grid_bytes, series_id, _ch, _si)

    crop_results = await asyncio.to_thread(
        lambda: crop_grid(grid_bytes, series_id, codes, series_code=series_code)
    )

    def _update_keyframe(scene_code_orig: str, url: str):
        db.table("v3_scenes") \
          .update({"keyframe_url": url, "bg_url": url}) \
          .eq("series_id", series_id) \
          .eq("scene_code", scene_code_orig) \
          .execute()

    for orig_code, cr in zip(codes, crop_results):
        await asyncio.to_thread(_update_keyframe, orig_code, cr.url)

    return {
        "status":    "ok",
        "cut_count": len(crop_results),
        "results":   [cr.to_dict() for cr in crop_results],
    }


@router.post("/{series_id}/generate-grid-image")
async def generate_grid_image(series_id: str, body: GridGenerateRequest):
    """4컷 그리드 이미지 생성 → 크롭 → R2 저장 → keyframe_url 업데이트.

    파이프라인:
      1. compose-grid-prompt 로 그리드 프롬프트 조합
      2. NanoBanana Pro (gemini-3-pro-image-preview) 호출 → grid PNG 16:9
      3. grid_crop_service.crop_grid() → 4개 이미지 R2 업로드
      4. v3_scenes.keyframe_url 업데이트

    파일명 규칙: ch##s##nc## (타임스탬프 prefix 없음)
    """
    import asyncio, re
    from core.config import settings

    scene_codes = body.scene_codes[:4]
    if not scene_codes:
        raise HTTPException(400, "scene_codes 필요 (최대 4개)")

    # ── 1. 그리드 프롬프트 조합 ──────────────────────────────────────
    grid_data = await compose_grid_prompt(series_id, GridPromptRequest(scene_codes=scene_codes))
    grid_prompt      = grid_data["grid_prompt"]
    art_style        = grid_data["art_style"]
    portrait_urls    = grid_data.get("char_portrait_urls") or []

    # ── 2a. 캐릭터 레퍼런스 이미지 — 로컬 파일 직접 읽기 또는 R2 URL 다운로드 ──
    import urllib.request as _urlreq
    from pathlib import Path as _PathRef
    ref_images: list[tuple[bytes, str]] = []  # (bytes, mime_type)
    for path_or_url in portrait_urls:
        try:
            p = _PathRef(path_or_url)
            if p.exists():
                # 로컬 파일이면 직접 읽기 (네트워크 불필요)
                mime = "image/png" if str(path_or_url).endswith(".png") else "image/jpeg"
                ref_images.append((p.read_bytes(), mime))
            else:
                # 로컬 파일 없으면 R2 URL에서 다운로드
                with _urlreq.urlopen(path_or_url, timeout=10) as resp:
                    ref_images.append((resp.read(), "image/png"))
        except Exception:
            pass

    # ── 2b. Gemini 이미지 생성 호출 ───────────────────────────────────
    def _call_nanobanana(ref_imgs: list[tuple[bytes, str]]) -> bytes:
        from google import genai as gai
        from google.genai import types
        from google.genai.types import GenerateContentConfig
        from google.genai.errors import ClientError

        from core.gemini_key_rotator import get_image_api_key
        client = gai.Client(api_key=get_image_api_key())

        style_lock = (
            "STRICT ART STYLE OVERRIDE — ignore any art style visible in reference images: "
            "render ONLY in low-poly hard polygon mesh illustration, "
            "all surfaces flat facets NO gradients NO smooth shading NO photorealism, "
            "chibi 3-head proportion characters. "
            "Reference images are for character IDENTITY ONLY, not art style."
        )
        # 텍스트 프롬프트 먼저, portrait 레퍼런스 나중 — 스타일 지시가 시각 레퍼런스보다 우선
        if ref_imgs:
            contents: list = [style_lock + "\n\n" + grid_prompt] + [
                types.Part.from_bytes(data=img_bytes, mime_type=mime_type)
                for img_bytes, mime_type in ref_imgs
            ]
        else:
            contents = grid_prompt

        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=contents,
                config=GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            )
        except ClientError as e:
            status = getattr(e, "status_code", None) or getattr(e, "code", None)
            if status == 429 or "RESOURCE_EXHAUSTED" in str(e):
                raise HTTPException(429, "Gemini API 요청 한도 초과 (429). 잠시 후 다시 시도해주세요.")
            raise HTTPException(502, f"Gemini API 오류: {e}")
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower() or "resource_exhausted" in str(e).lower():
                raise HTTPException(429, "Gemini API 요청 한도 초과 (429). 잠시 후 다시 시도해주세요.")
            raise

        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return part.inline_data.data  # PNG bytes
        raise RuntimeError("Gemini 이미지 생성 응답에 이미지 없음")

    try:
        grid_bytes: bytes = await asyncio.to_thread(_call_nanobanana, ref_images)
    except HTTPException:
        raise
    except Exception as e:
        if "429" in str(e) or "quota" in str(e).lower() or "resource_exhausted" in str(e).lower():
            raise HTTPException(429, "Gemini API 요청 한도 초과 (429). 잠시 후 다시 시도해주세요.")
        raise HTTPException(500, f"이미지 생성 실패: {e}")

    # ── 3. 크롭 → 1920×1080 리사이즈 → R2 + 로컬 저장 ─────────────
    from services.grid_crop_service import crop_grid, save_grid_to_r2

    db = get_supabase()

    # series_code 조회 (로컬 output 경로: OUTPUT_ROOT/{series_code}/ch{N}/)
    def _fetch_series_code():
        res = db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
        return (res.data or {}).get("series_code") or ""

    series_code = await asyncio.to_thread(_fetch_series_code)

    # 그리드 원본 R2 저장 (디버깅용)
    _sc = scene_codes[0]
    _m = re.search(r"ch(\d+)s(\d+)", _sc, re.IGNORECASE)
    _ch  = int(_m.group(1)) if _m else 1
    _si  = int(_m.group(2)) if _m else 0
    await asyncio.to_thread(save_grid_to_r2, grid_bytes, series_id, _ch, _si)

    crop_results = await asyncio.to_thread(
        lambda: crop_grid(grid_bytes, series_id, scene_codes, series_code=series_code)
    )

    # ── 4. v3_scenes keyframe_url 업데이트 ─────────────────────────

    def _update_keyframe(scene_code_orig: str, url: str):
        db.table("v3_scenes") \
          .update({"keyframe_url": url, "bg_url": url}) \
          .eq("series_id", series_id) \
          .eq("scene_code", scene_code_orig) \
          .execute()

    for orig_code, cr in zip(scene_codes, crop_results):
        await asyncio.to_thread(_update_keyframe, orig_code, cr.url)

    return {
        "status":      "ok",
        "cut_count":   len(crop_results),
        "art_style":   art_style,
        "results": [cr.to_dict() for cr in crop_results],
    }


# ── 챕터 최종 MP4 렌더 ────────────────────────────────────────────────────────

@router.post("/{series_id}/chapters/{chapter}/render")
async def render_chapter_mp4(
    series_id: str,
    chapter: int,
    req: Optional[RenderRequest] = None,
):
    """챕터 단위 최종 MP4 합성.

    3단계 파이프라인:
      1. 로컬 output 폴더에서 scene_code 순 mp4 수집
      2. 각 클립 표준화 재인코딩 (resolution 따라 16:9 or 9:16)
      3. concat (-c copy) → ch{N}_final.mp4
      4. kr/en/jp 폴더에 각각 복사 → lang_outputs 반환

    req.resolution: "16:9"(기본) 또는 "9:16"(세로형)
    """
    from services.render_service import render_chapter
    # req가 없을 때(Body 생략 요청)도 기본값 "16:9" 사용
    resolution = req.resolution if req else "16:9"
    result = await render_chapter(series_id, chapter, resolution=resolution)
    if not result.get("ok"):
        raise HTTPException(500, result.get("reason", "렌더 실패"))
    return result


@router.get("/{series_id}/chapters/{chapter}/scenes/{scene_code}/preview")
async def preview_mp4(series_id: str, chapter: int, scene_code: str):
    """단일 컷 16:9 원본 mp4 직접 스트리밍 (FFmpeg 변환 없음)."""
    from fastapi.responses import FileResponse as _FR
    from services.render_service import OUTPUT_ROOT
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"
    norm_code = _normalize_scene_code(scene_code)
    src = out_dir / f"{norm_code}.mp4"
    if not src.exists():
        raise HTTPException(404, f"mp4 없음: {src.name}")
    return _FR(str(src), media_type="video/mp4", headers={"Cache-Control": "no-cache, no-store"})


@router.get("/{series_id}/chapters/{chapter}/scenes/{scene_code}/preview-9x16")
async def preview_9x16(series_id: str, chapter: int, scene_code: str, refresh: bool = False):
    """단일 컷 9:16 Center Crop 미리보기.

    source: output/{series_code}/ch{N}/{scene_code}.mp4
    output: output/{series_code}/ch{N}/{scene_code}_9x16.mp4
    자막은 프론트엔드 오버레이로 처리.
    refresh=true: 캐시 파일 무시하고 재생성
    """
    from fastapi.responses import FileResponse as _FR
    from services.render_service import _normalize_clip_9x16, OUTPUT_ROOT
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()

    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"

    norm_code = _normalize_scene_code(scene_code)
    src = out_dir / f"{norm_code}.mp4"
    if not src.exists():
        raise HTTPException(404, f"원본 mp4 없음: {src.name}")

    dst = out_dir / f"{norm_code}_9x16.mp4"
    if dst.exists() and not refresh:
        return _FR(str(dst), media_type="video/mp4",
                   headers={"Cache-Control": "no-cache, no-store"})

    try:
        await asyncio.to_thread(_normalize_clip_9x16, src, dst)
    except Exception as e:
        raise HTTPException(500, f"9:16 변환 실패: {e}")

    return _FR(str(dst), media_type="video/mp4",
               headers={"Cache-Control": "no-cache, no-store"})


# ── 컷 삭제 ────────────────────────────────────────────────────────────────────

@router.delete("/{series_id}/chapters/{chapter}/scenes/{scene_id}")
async def delete_scene(series_id: str, chapter: int, scene_id: str):
    """컷(씬) 1개를 UUID로 삭제하고, 뒤에 오는 컷들의 cut_index와 scene_code를 재번호화한다.

    처리 순서:
      1. 대상 컷 조회 (is_hook, scene_index, cut_index, scene_code 확보)
      2. LD-001: HOOK 컷 삭제 요청 시 400 에러 반환
      3. 대상 컷 DB에서 DELETE
      4. 같은 시리즈/챕터/scene_index에서 cut_index가 더 큰 컷들을 역순으로
         cut_index -= 1, scene_code nc{N} → nc{N-1} 치환
      5. 로컬 파일 rename: old_scene_code.{ext} → new_scene_code.{ext}
         (mp4, png, mp3, wav, _9x16.mp4, .kb_mode) — 파일 없으면 skip
      6. {"ok": True, "deleted": scene_code, "renumbered": N} 반환

    주의: scene_id는 v3_scenes.id (UUID) — scene_code 기반 아님 (LD-001 HOOK 중복 충돌 방지)
    """
    import re
    from services.grid_crop_service import _normalize_scene_code

    db = get_supabase()

    # ── 1. 대상 컷 조회 ────────────────────────────────────────────────────────
    row_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,scene_code,scene_index,cut_index,is_hook")
        .eq("id", scene_id)
        .single()
        .execute()
    )
    if not row_res.data:
        raise HTTPException(404, "컷을 찾을 수 없습니다")

    row        = row_res.data
    is_hook    = row.get("is_hook", False)
    scene_index = row["scene_index"]
    cut_index   = row["cut_index"]
    scene_code  = row["scene_code"]

    # ── 2. LD-001: HOOK 컷 삭제 금지 ──────────────────────────────────────────
    # HOOK 컷은 scene_index=0 복사본 + 원본 위치 2개로 영상 설계의 핵심 (LD-001)
    if is_hook or scene_index == 0:
        raise HTTPException(
            400,
            "HOOK 컷은 삭제할 수 없습니다 (LD-001: HOOK 컷 2회 등장 설계 보호)"
        )

    # ── 3. 대상 컷 DB 삭제 ────────────────────────────────────────────────────
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .delete()
        .eq("id", scene_id)
        .execute()
    )

    # ── 4. 뒤에 오는 컷들 cut_index 재번호화 ──────────────────────────────────
    # 같은 series_id / chapter / scene_index에서 삭제한 컷보다 cut_index가 큰 것들
    after_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,scene_code,cut_index")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .eq("scene_index", scene_index)
        .gt("cut_index", cut_index)
        .order("cut_index", desc=True)   # 역순: 충돌 없이 하나씩 당김
        .execute()
    )
    after_rows = after_res.data or []

    # series_code 조회 (로컬 output 경로 계산용)
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("series_code")
        .eq("id", series_id)
        .single()
        .execute()
    )
    series_code_val = (ser_res.data or {}).get("series_code") or series_id
    out_dir = (
        Path(__file__).parent.parent.parent.parent
        / "output" / series_code_val / f"ch{chapter:02d}"
    )

    renumbered = 0
    for r in after_rows:
        old_code     = r["scene_code"]
        old_cut_idx  = r["cut_index"]
        new_cut_idx  = old_cut_idx - 1

        # scene_code에서 nc{N} 부분을 nc{N-1}로 치환 (끝부분 기준 정규식)
        # 예: ch01s02nc05 → ch01s02nc04
        new_code = re.sub(
            r"nc(\d+)$",
            lambda m: f"nc{int(m.group(1)) - 1:02d}",
            old_code,
        )

        # DB 업데이트
        await asyncio.to_thread(
            lambda r_id=r["id"], nc=new_cut_idx, nsc=new_code: (
                db.table("v3_scenes")
                .update({"cut_index": nc, "scene_code": nsc})
                .eq("id", r_id)
                .execute()
            )
        )

        # ── 5. 로컬 파일 rename (best-effort) ─────────────────────────────────
        # 지원 확장자: .png / .mp3 / .wav / .mp4 / _9x16.mp4 / .kb_mode
        old_norm = _normalize_scene_code(old_code)
        new_norm = _normalize_scene_code(new_code)

        rename_pairs = [
            (out_dir / f"{old_norm}.png",        out_dir / f"{new_norm}.png"),
            (out_dir / f"{old_norm}.mp3",        out_dir / f"{new_norm}.mp3"),
            (out_dir / f"{old_norm}.wav",        out_dir / f"{new_norm}.wav"),
            (out_dir / f"{old_norm}.mp4",        out_dir / f"{new_norm}.mp4"),
            (out_dir / f"{old_norm}_9x16.mp4",   out_dir / f"{new_norm}_9x16.mp4"),
            (out_dir / f"{old_norm}.kb_mode",    out_dir / f"{new_norm}.kb_mode"),
        ]
        for src_path, dst_path in rename_pairs:
            try:
                if src_path.exists():
                    src_path.rename(dst_path)
            except Exception as _fe:
                # 파일 조작 실패는 로그만 남기고 계속 진행 (best-effort)
                print(f"[delete-scene] 파일 rename 실패 (무시): {src_path} → {dst_path}: {_fe}")

        renumbered += 1

    return {"ok": True, "deleted": scene_code, "renumbered": renumbered}


# ── KR MP4 목록 조회 (자막 합성 대상 확인용) ──────────────────────────────────

@router.get("/{series_id}/chapters/{chapter}/kr-mp4-list")
async def list_kr_mp4(series_id: str, chapter: int):
    """kr 폴더의 MP4 파일 목록 반환 — 자막 합성 대상 선택 팝업용."""
    from services.render_service import OUTPUT_ROOT

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    kr_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}" / "kr"

    if not kr_dir.exists():
        return {"files": [], "kr_dir": str(kr_dir)}

    files = []
    for f in sorted(kr_dir.glob("*.mp4")):
        name = f.name
        # _orig 백업파일·(KR) 번인 결과물 제외 — 자막 합성 대상은 원본만 노출
        if name.endswith("_orig.mp4") or "(KR)" in name:
            continue
        if "9-16" in name:
            resolution = "9:16"
        elif "16-9" in name:
            resolution = "16:9"
        else:
            resolution = "unknown"
        files.append({
            "name": name,
            "path": str(f),
            "resolution": resolution,
            "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
        })

    return {"files": files, "kr_dir": str(kr_dir)}


# ── KR 자막 번인 (덮어쓰기) ────────────────────────────────────────────────────

class BurnSubtitlesRequest(BaseModel):
    mp4_filename: str              # kr 폴더 내 MP4 파일명
    font_name:   str  = "NotoSerifKR-Regular"  # keyframe cut=0 폰트 선택값
    subtitle_y:  int  = 80                      # 0~100, 위에서 내려오는 % 위치
    subtitle_bg: bool = False                   # True=박스 배경, False=아웃라인


@router.post("/{series_id}/chapters/{chapter}/burn-subtitles")
async def burn_kr_subtitles(series_id: str, chapter: int, req: BurnSubtitlesRequest):
    """KR MP4에 SRT 자막 번인 → {stem}(KR).mp4 신규 생성.

    1. kr 폴더에서 *_kr.srt 탐색 — 없으면 DB에서 생성
    2. burn_subtitles(원본mp4, srt, tmp) FFmpeg 실행
    3. tmp → {stem}(KR).mp4 저장 (원본 유지, 덮어쓰기 없음)
    """
    import re as _re
    import shutil
    import subprocess

    from services.render_service import OUTPUT_ROOT
    from services.srt_service import burn_subtitles, merge_chapter_srt, wrap_srt

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    kr_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}" / "kr"

    mp4_path = kr_dir / req.mp4_filename
    if not mp4_path.exists():
        raise HTTPException(404, f"MP4 없음: {req.mp4_filename}")

    # 원본에서 직접 번인 — 출력은 {stem}(KR).mp4 신규 파일 (원본 불변)
    stem = mp4_path.stem
    out_mp4_path = kr_dir / f"{stem}(KR).mp4"
    src_path = mp4_path

    # 해상도 감지 → 줄당 최대 글자수 — subtitle_style.json wrapMaxChars 참조 (하드코딩 금지)
    import json as _json
    _style_json_path = Path(__file__).parent.parent / "data" / "subtitle_style.json"
    _style_data = _json.loads(_style_json_path.read_text(encoding="utf-8"))
    _wrap_chars = _style_data.get("wrapMaxChars", {})
    max_chars = _wrap_chars.get("9:16", 25) if "9-16" in req.mp4_filename else _wrap_chars.get("16:9", 30)

    # SRT 탐색 → 없으면 DB에서 즉시 생성
    srt_candidates = sorted(kr_dir.glob("*_kr.srt"))
    if srt_candidates:
        srt_path = srt_candidates[0]
        raw_srt = srt_path.read_text(encoding="utf-8")
    else:
        raw_srt = await merge_chapter_srt(series_id, chapter)
        if not raw_srt:
            raise HTTPException(422, "SRT 없음 — 씬 텍스트 또는 duration_seconds 없음")
        base_code = _re.sub(r"_ch\d+.*$", "", series_code)
        kr_dir.mkdir(parents=True, exist_ok=True)
        srt_path = kr_dir / f"{base_code}_kr.srt"
        srt_path.write_text(raw_srt, encoding="utf-8")

    # 줄 래핑 적용 후 임시 SRT 파일에 저장
    wrapped_srt = wrap_srt(raw_srt, max_chars)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".srt", delete=False, dir=kr_dir, encoding="utf-8"
    ) as tsrt:
        tsrt.write(wrapped_srt)
        wrapped_srt_path = Path(tsrt.name)

    # 임시 파일에 번인 → {stem}(KR).mp4로 이동
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=kr_dir) as tmp:
        tmp_path = Path(tmp.name)

    try:
        await asyncio.to_thread(
            burn_subtitles, src_path, wrapped_srt_path, tmp_path,
            font_name=req.font_name,
            subtitle_y=req.subtitle_y,
            subtitle_bg=req.subtitle_bg,
        )
        shutil.move(str(tmp_path), str(out_mp4_path))
    except subprocess.CalledProcessError as e:
        tmp_path.unlink(missing_ok=True)
        stderr = (e.stderr or b"").decode(errors="replace")
        raise HTTPException(500, f"자막 번인 실패: {stderr[-400:]}")
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(500, f"자막 번인 실패: {e}")
    finally:
        wrapped_srt_path.unlink(missing_ok=True)

    return {
        "ok": True,
        "mp4": str(out_mp4_path),
        "srt": str(srt_path),
        "size_mb": round(out_mp4_path.stat().st_size / (1024 * 1024), 1),
    }


# ── 챕터 내보내기 준비 (전체 SRT + kr/en/jp 폴더) ─────────────────────────────

@router.post("/{series_id}/chapters/{chapter}/prepare-export")
async def prepare_export(series_id: str, chapter: int):
    """KR SRT 생성 + kr 폴더 저장, en/jp 빈 폴더 생성.

    파일명: {날짜_시간}_kr.srt  (series_code에서 _ch... 제거)
    en/jp 폴더는 빈 폴더만 생성 (번역은 별도 단계).
    """
    import re as _re
    from services.srt_service import merge_chapter_srt
    from services.render_service import OUTPUT_ROOT

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id

    ch_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"

    kr_srt = await merge_chapter_srt(series_id, chapter)
    if not kr_srt:
        raise HTTPException(422, "SRT 없음 — 씬 텍스트 또는 duration 없음")

    # 파일명: "20260413_095022_ch01s04hc05" → "20260413_095022_kr.srt"
    base_code = _re.sub(r'_ch\d+.*$', '', series_code)
    srt_filename = f"{base_code}_kr.srt"

    kr_folder = ch_dir / "kr"
    kr_folder.mkdir(parents=True, exist_ok=True)
    (kr_folder / srt_filename).write_text(kr_srt, encoding="utf-8")

    # en/jp 빈 폴더만 생성
    for lang in ("en", "jp"):
        (ch_dir / lang).mkdir(parents=True, exist_ok=True)

    return {
        "ok": True,
        "chapter": chapter,
        "kr_srt": str(kr_folder / srt_filename),
        "output_dir": str(ch_dir),
    }


# ─── 추천 영문 검색어 생성 ──────────────────────────────────────────────────────

class SearchTermsRequest(BaseModel):
    text: str
    image_hint: str = ""


@router.post("/{series_id}/scenes/{scene_code}/search-terms")
async def get_search_terms(series_id: str, scene_code: str, req: SearchTermsRequest):
    """컷 텍스트 + 이미지 힌트 → 스톡 영상/이미지 검색용 영문 검색어 3개 반환.
    # 🟢 FREE-LLM: Cerebras→NVIDIA→OpenRouter→Gemini-Free 체인 (LD-011)
    """
    from services.gemini_helper import call_free_llm

    prompt = (
        "You are a stock footage search expert for Korean drama scenes.\n\n"
        f"Korean scene text: {req.text}\n"
        f"Korean image hint: {req.image_hint}\n\n"
        "Generate exactly 3 short English search terms (2-5 words each) "
        "suitable for finding stock photos or videos.\n"
        "Output ONLY the 3 terms separated by | with no extra text.\n"
        "Example: rainy city night|woman near window|melancholic alley lights"
    )
    try:
        raw = (await call_free_llm(prompt, max_tokens=80, temperature=0.4)).strip()
        terms = [t.strip() for t in raw.split("|") if t.strip()][:3]
        if not terms:
            terms = [t.strip().lstrip("0123456789.-) ") for t in raw.splitlines() if t.strip()][:3]
        return {"terms": terms}
    except Exception:
        return {"terms": []}


# ─── 챕터 추천 효과음 / BGM ────────────────────────────────────────────────────

@router.post("/{series_id}/chapters/{chapter}/recommend-audio")
async def recommend_audio(series_id: str, chapter: int):
    """챕터 씬 텍스트 분석 → 추천 효과음(sfx) + BGM 키워드 각 3개.
    # 🟢 FREE-LLM: Cerebras→NVIDIA→OpenRouter→Gemini-Free 체인 (LD-011)
    """
    from services.gemini_helper import call_free_llm, extract_json

    db = get_supabase()
    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("text, image_hint, type")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .neq("scene_index", 0)   # HOOK 복사본 제외 (LD-001)
        .order("scene_index")
        .order("cut_index")
        .execute()
    )
    rows = scenes_res.data or []
    if not rows:
        return {"sfx": [], "bgm": []}

    # 씬 텍스트 요약 (최대 600자)
    texts = " / ".join(r.get("text", "")[:60] for r in rows[:10])

    prompt = (
        "You are a Korean drama sound designer.\n\n"
        f"Chapter scenes summary: {texts}\n\n"
        "Recommend:\n"
        "- sfx: 3 specific sound effect keywords in English (e.g. 'rain on window', 'elevator ding', 'crowd murmur')\n"
        "- sfx_ko: Korean translation of each sfx item (same order, e.g. '창문 빗소리', '엘리베이터 소리', '군중 웅성거림')\n"
        "- bgm: 3 BGM recommendations in Korean mood+genre format (e.g. '잔잔한 피아노 발라드', '긴박한 현악', '밝은 경쾌한 트로트')\n\n"
        'Output ONLY valid JSON: {"sfx":["...","...","..."],"sfx_ko":["...","...","..."],"bgm":["...","...","..."]}'
    )
    try:
        raw = await call_free_llm(prompt, max_tokens=150, temperature=0.4)
        data = extract_json(raw)
        if isinstance(data, dict):
            sfx    = [s.strip() for s in (data.get("sfx")    or []) if s.strip()][:3]
            sfx_ko = [s.strip() for s in (data.get("sfx_ko") or []) if s.strip()][:3]
            bgm    = [s.strip() for s in (data.get("bgm")    or []) if s.strip()][:3]
            return {"sfx": sfx, "sfx_ko": sfx_ko, "bgm": bgm}
    except Exception:
        pass
    return {"sfx": [], "sfx_ko": [], "bgm": []}


# ─── 컷 단위 추천 효과음 / BGM ─────────────────────────────────────────────────

@router.post("/{series_id}/chapters/{chapter}/scenes/{scene_code}/recommend-audio")
async def recommend_audio_scene(series_id: str, chapter: int, scene_code: str):
    """SFX(컷 기준, 영어) + BGM(씬 기준, 한국어 분위기+장르).
    # 🟢 FREE-LLM: Cerebras→NVIDIA→OpenRouter→Gemini-Free 체인 (LD-011)
    """
    from services.gemini_helper import call_free_llm, extract_json

    db = get_supabase()

    # 현재 컷 정보 (scene_index 포함)
    res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("text,image_hint,type,scene_index")
        .eq("series_id", series_id)
        .eq("scene_code", scene_code)
        .limit(1)
        .execute()
    )
    row = (res.data or [{}])[0]
    text       = (row.get("text") or "").strip()
    image_hint = (row.get("image_hint") or "").strip()
    scene_idx  = row.get("scene_index")
    if not text:
        return {"sfx": [], "bgm": []}

    # BGM: 씬 내 전체 컷 텍스트 수집
    scene_texts = text
    if scene_idx is not None:
        scene_res = await asyncio.to_thread(
            lambda: db.table("v3_scenes")
            .select("text")
            .eq("series_id", series_id)
            .eq("chapter", chapter)
            .eq("scene_index", scene_idx)
            .order("cut_index")
            .execute()
        )
        scene_texts = " ".join(
            r.get("text", "")[:80] for r in (scene_res.data or []) if r.get("text")
        )

    sfx_prompt = (
        "You are a Korean drama sound designer.\n\n"
        f"Cut text: {text[:200]}\n"
        f"Visual hint: {image_hint[:100]}\n\n"
        "Recommend 3 specific sound effect keywords in English for THIS CUT.\n"
        "Also provide Korean translation of each sfx item (same order).\n"
        'Output ONLY valid JSON: {"sfx":["...","...","..."],"sfx_ko":["...","...","..."]}'
    )
    bgm_prompt = (
        "당신은 한국 드라마 음악 감독입니다.\n\n"
        f"씬 내용: {scene_texts[:400]}\n\n"
        "이 씬에 어울리는 배경음악(BGM) 3개를 추천해 주세요.\n"
        "형식: 분위기+장르 (한국어, 예: 잔잔한 피아노 발라드 / 밝은 경쾌한 트로트 / 긴박한 현악)\n"
        "각 항목은 10자 이내, 복사하기 쉬운 짧은 텍스트로 작성하세요.\n"
        'Output ONLY valid JSON: {"bgm":["...","...","..."]}'
    )

    sfx: list[str] = []
    sfx_ko: list[str] = []
    bgm: list[str] = []
    try:
        raw = await call_free_llm(sfx_prompt, max_tokens=120, temperature=0.4)
        d = extract_json(raw)
        if isinstance(d, dict):
            sfx    = [s.strip() for s in (d.get("sfx")    or []) if s.strip()][:3]
            sfx_ko = [s.strip() for s in (d.get("sfx_ko") or []) if s.strip()][:3]
    except Exception:
        pass
    try:
        raw = await call_free_llm(bgm_prompt, max_tokens=120, temperature=0.4)
        d = extract_json(raw)
        if isinstance(d, dict):
            bgm = [s.strip() for s in (d.get("bgm") or []) if s.strip()][:3]
    except Exception:
        pass
    return {"sfx": sfx, "sfx_ko": sfx_ko, "bgm": bgm}
