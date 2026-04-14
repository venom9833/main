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


class PatchChapterRequest(BaseModel):
    content: Optional[str] = None
    meta: Optional[dict] = None


class PatchCutRequest(BaseModel):
    type: Optional[str] = None
    speaker: Optional[str] = None


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
    _art_style: str = _settings.get("artStyle", "masako")
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
    art_style = settings.get("artStyle", "masako")

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

    # 로컬 출력 폴더에 저장 — img_api_c{cut_index:02d}.png
    try:
        from pathlib import Path
        _chapter = scene.get("chapter", 1)
        _cut_idx = scene.get("cut_index", 1)
        _out_dir = (
            Path(__file__).parent.parent.parent.parent
            / "output" / series_code / f"ch{_chapter:02d}"
        )
        _out_dir.mkdir(parents=True, exist_ok=True)
        (_out_dir / f"img_api_c{_cut_idx:02d}.png").write_bytes(png_bytes)
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
    art_style: str = settings.get("artStyle", "masako")
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

    prompt      = build_cut_image_prompt(scene, art_style, guest_cast=guest_cast)
    negative    = build_cut_negative_prompt(scene, art_style, guest_cast=guest_cast)

    # bg_prompt: scene_meta 기반으로 캐릭터 없이 순수 배경 묘사만 구성
    # image_hint는 regen_keyframe 호출 시 덮어써지므로 사용하지 않음
    _sm = scene.get("scene_meta") or {}
    _bg_parts = [p for p in [
        _sm.get("scene_hint") or "",
        _sm.get("location") or "",
        _sm.get("time_of_day") or "",
        _sm.get("atmosphere") or "",
    ] if p]
    _bg_scene = {"image_hint": ", ".join(_bg_parts), "scene_meta": {"characters": []}}
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
    img_done  = [f.stem for f in out_dir.iterdir() if f.is_file() and f.suffix == ".png"]

    # duration 병렬 측정
    durations: dict[str, float] = {}
    for f in mp3_files:
        dur = await asyncio.to_thread(_mp3_duration, f)
        if dur is not None:
            durations[f.stem] = dur

    tts_done = [f.stem for f in mp3_files]
    return {"files": files, "tts_done": tts_done, "tts_durations": durations, "img_done": img_done}


@router.get("/{series_id}/chapters/{chapter}/local-scenes")
async def get_local_scenes(series_id: str, chapter: int):
    """로컬 output 폴더의 ch{N}.json 기반 씬 목록 반환 — 로컬 파일 존재 시 URL 덮어씀"""
    import json as _json

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    json_path = out_dir / f"ch{chapter:02d}.json"

    if not json_path.exists():
        return []

    scenes = _json.loads(json_path.read_text(encoding="utf-8-sig"))  # utf-8-sig: BOM 자동 제거
    base = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{chapter}/local-file"

    result = []
    seen_codes: set = set()
    for sc in scenes:
        code = sc.get("scene_code", "")
        if not code:
            continue

        # 동일 scene_code 중복 제거 (HOOK 씬이 JSON에 2번 등장하는 경우)
        if code in seen_codes:
            continue
        seen_codes.add(code)

        has_png = (out_dir / f"{code}.png").exists()
        has_mp4 = (out_dir / f"{code}.mp4").exists()
        has_mp3 = (out_dir / f"{code}.mp3").exists()

        # 로컬 파일이 있으면 URL 덮어쓰기, 없으면 None
        sc["bg_url"]       = f"{base}/{code}/png" if has_png else None
        sc["lipsync_url"]  = f"{base}/{code}/mp4" if has_mp4 else None
        sc["tts_url"]      = f"{base}/{code}/mp3" if has_mp3 else None
        sc["keyframe_url"] = None
        sc["char_url"]     = None
        result.append(sc)

    return result


@router.get("/{series_id}/chapters/{chapter}/local-file/{scene_code}/{ext}")
async def get_local_file(series_id: str, chapter: int, scene_code: str, ext: str):
    """로컬 output 폴더 파일 서빙 (png / mp4 / mp3)"""
    from fastapi.responses import FileResponse as _FR

    db = get_supabase()
    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"

    media_types = {"png": "image/png", "mp4": "video/mp4", "mp3": "audio/mpeg"}
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
    out_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
    mp3_path = out_dir / f"{scene_code}.mp3"
    if not mp3_path.exists():
        raise HTTPException(status_code=404, detail="TTS 파일 없음")
    return FileResponse(str(mp3_path), media_type="audio/mpeg",
                        filename=f"{scene_code}.mp3")


@router.post("/{series_id}/chapters/{chapter}/kenburns-batch")
async def kenburns_batch(series_id: str, chapter: int, overwrite: bool = False):
    """MP3 + 이미지 → Ken Burns MP4 일괄 자동 생성 (사용자 개입 없음)"""
    from services.kenburns_service import batch_kenburns
    db = get_supabase()
    result = await batch_kenburns(series_id, chapter, db, overwrite=overwrite)
    return result
