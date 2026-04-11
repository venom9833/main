"""챕터 라우터 — 조회 / 승인 / 재생성"""
import asyncio
from fastapi import APIRouter, BackgroundTasks, HTTPException
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

    # world_data 로드
    s_res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data, series_code")
        .eq("id", series_id)
        .single()
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "시리즈 없음")
    world = s_res.data.get("world_data") or {}
    series_code = s_res.data.get("series_code")

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
    await _save_scenes(db, series_id, chapter, scenes, series_code)

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
