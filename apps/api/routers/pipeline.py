"""파이프라인 CRUD + 실행 트리거"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from core.database import get_supabase
from agent.orchestrator import run_pipeline
from agent.state_machine import PipelineStep, APPROVAL_TRANSITIONS
from agent.event_bus import event_bus

router = APIRouter(prefix="/api/v1/series", tags=["series"])


class CreateSeriesRequest(BaseModel):
    topic: str
    settings: Optional[dict] = None


class PatchSeriesRequest(BaseModel):
    world_data: Optional[dict] = None
    settings: Optional[dict] = None
    title: Optional[str] = None


class ApproveStepRequest(BaseModel):
    userSecrets: Optional[dict] = None  # {char_id: "비밀 내용"} — 캐스팅 확정 시 투입


class CastReassignRequest(BaseModel):
    charA_id: str
    charB_id: str


class TranslateRequest(BaseModel):
    text: str


@router.post("")
async def create_series(req: CreateSeriesRequest, background_tasks: BackgroundTasks):
    db = get_supabase()
    res = db.table("v3_series").insert({
        "topic": req.topic,
        "title": req.topic,
        "status": "draft",
        "pipeline_step": "idle",
        "world_data": {},
        "settings": req.settings or {},
    }).execute()
    series = res.data[0]
    # 소스 업로드 게이트에서 대기 (파이프라인 첫 진입점)
    background_tasks.add_task(run_pipeline, series["id"], PipelineStep.AWAITING_SOURCE_UPLOAD)
    return series


@router.get("")
async def list_series(status: Optional[str] = None):
    db = get_supabase()
    q = db.table("v3_series").select("*").order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    return q.execute().data


@router.post("/translate")
async def translate_to_korean(req: TranslateRequest):
    """영어 이미지 프롬프트 → 한국어 번역 (Gemini)"""
    from services.gemini_helper import call_gemini
    if not req.text or not req.text.strip():
        return {"korean": ""}
    result = await call_gemini(
        prompt=f"다음 영어 이미지 프롬프트를 자연스러운 한국어로 번역하라. 번역문만 출력하고 다른 말은 하지 마라.\n\n{req.text.strip()}",
        system_instruction="You are a professional translator. Output only the Korean translation, nothing else.",
        max_tokens=512,
        temperature=0.3,
    )
    return {"korean": result.strip()}


@router.get("/{series_id}")
async def get_series(series_id: str):
    db = get_supabase()
    res = db.table("v3_series").select("*").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    return res.data


@router.patch("/{series_id}")
async def patch_series(series_id: str, req: PatchSeriesRequest):
    db = get_supabase()
    patch = {k: v for k, v in req.model_dump().items() if v is not None}

    # JSON 객체 필드는 덮어쓰지 않고 기존 값에 merge
    json_fields = [f for f in ("settings", "world_data") if f in patch]
    if json_fields:
        cur = db.table("v3_series").select(", ".join(json_fields)).eq("id", series_id).single().execute()
        for f in json_fields:
            existing = (cur.data or {}).get(f) or {}
            patch[f] = {**existing, **patch[f]}

    db.table("v3_series").update(patch).eq("id", series_id).execute()
    return {"ok": True}


@router.post("/{series_id}/run")
async def run_series(series_id: str, background_tasks: BackgroundTasks):
    db = get_supabase()
    res = db.table("v3_series").select("pipeline_step").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    step = PipelineStep(res.data["pipeline_step"])
    background_tasks.add_task(run_pipeline, series_id, step)
    return {"ok": True, "step": step}


class WorldDataPatchRequest(BaseModel):
    world_data: dict


@router.patch("/{series_id}/world")
async def patch_world(series_id: str, req: WorldDataPatchRequest):
    """세계관 필드 부분 업데이트 — awaiting_world_approval 단계에서 사용자 편집"""
    db = get_supabase()
    res = db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    current = res.data.get("world_data") or {}
    current.update(req.world_data)
    db.table("v3_series").update({"world_data": current}).eq("id", series_id).execute()
    return {"ok": True, "world_data": current}


@router.get("/{series_id}/cast-details")
async def get_cast_details(series_id: str):
    """fullCastDetails가 없는 기존 시리즈용 — fullCast ID로 상세 정보 즉시 조합"""
    from services.casting_service import _build_full_cast_details, _load_index, _load_detail
    db = get_supabase()
    res = db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    world = res.data.get("world_data") or {}

    # fullCastDetails가 이미 있으면 그대로 반환
    if world.get("fullCastDetails"):
        return {"details": world["fullCastDetails"]}

    # fullCast(id 목록)로 재조합
    full_cast = world.get("fullCast") or []
    if not full_cast:
        return {"details": []}

    index = {c["id"]: c for c in _load_index()}
    cast = []
    for fc in full_cast:
        char_id = fc.get("id", "")
        base = index.get(char_id, {"id": char_id, "name": fc.get("name", ""), "role": fc.get("role", "")})
        cast.append(base)

    details = _build_full_cast_details(cast)

    # 저장해서 다음 호출 시 빠르게
    world["fullCastDetails"] = details
    db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()

    return {"details": details}


@router.post("/{series_id}/regen/casting")
async def regen_casting(series_id: str):
    """캐스팅 재생성 — 기존 cast 데이터를 초기화하고 casting_service를 즉시 재실행.

    awaiting_casting_approval 단계에서만 호출 가능.
    완료 후 새 fullCastDetails를 반환한다.
    """
    from services.casting_service import run_casting
    db = get_supabase()
    res = db.table("v3_series").select("pipeline_step,world_data").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")

    current_step = res.data.get("pipeline_step", "")
    if current_step != PipelineStep.AWAITING_CASTING_APPROVAL.value:
        raise HTTPException(400, f"캐스팅 재생성은 awaiting_casting_approval 단계에서만 가능합니다 (현재: {current_step})")

    # 기존 캐스팅 데이터 초기화 — world_data에서 cast 관련 필드만 제거
    world = res.data.get("world_data") or {}
    for key in ("charA", "charB", "charAName", "charBName", "charAVoice", "charBVoice",
                "charAOccupation", "charBOccupation", "charAPersonality", "charBPersonality",
                "charAFaceGrid", "charBFaceGrid", "castTrope", "castOverlay",
                "fullCast", "fullCastDetails", "cast_summary", "userSecrets"):
        world.pop(key, None)

    # pipeline_step을 casting으로 되돌려 run_casting이 올바르게 실행되도록
    db.table("v3_series").update({
        "world_data": world,
        "pipeline_step": PipelineStep.CASTING.value,
    }).eq("id", series_id).execute()

    # 캐스팅 재실행 (동기 대기)
    await run_casting(series_id)

    # run_casting이 pipeline_step을 CASTING으로 남길 수 있으므로 AWAITING_CASTING_APPROVAL로 복원
    db.table("v3_series").update({
        "pipeline_step": PipelineStep.AWAITING_CASTING_APPROVAL.value,
    }).eq("id", series_id).eq("pipeline_step", PipelineStep.CASTING.value).execute()

    # 완료 후 DB에서 최신 world_data 읽어 반환
    updated = db.table("v3_series").select("world_data,pipeline_step").eq("id", series_id).single().execute()
    new_world = (updated.data or {}).get("world_data") or {}
    return {
        "ok": True,
        "fullCastDetails": new_world.get("fullCastDetails", []),
        "castTrope": new_world.get("castTrope", ""),
        "castOverlay": new_world.get("castOverlay", {}),
    }


@router.post("/{series_id}/cast-reassign")
async def cast_reassign(series_id: str, req: CastReassignRequest):
    """주인공 A/B 재지정 — awaiting_casting_approval 단계에서만 가능."""
    from services.casting_service import _load_detail, _load_index, _load_char_family_context, _determine_initial_relationship
    if req.charA_id == req.charB_id:
        raise HTTPException(400, "주인공 A와 B는 다른 캐릭터여야 합니다")
    db = get_supabase()
    res = db.table("v3_series").select("pipeline_step,world_data").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    if res.data.get("pipeline_step") != PipelineStep.AWAITING_CASTING_APPROVAL.value:
        raise HTTPException(400, f"캐스팅 재지정은 awaiting_casting_approval 단계에서만 가능 (현재: {res.data.get('pipeline_step')})")

    world = res.data.get("world_data") or {}
    full_cast: list[dict] = world.get("fullCast") or []
    cast_map = {c["id"]: c for c in full_cast}
    char_a_cast = cast_map.get(req.charA_id)
    char_b_cast = cast_map.get(req.charB_id)
    if not char_a_cast or not char_b_cast:
        raise HTTPException(400, "지정한 캐릭터가 현재 캐스트에 없습니다")

    idx_map = {c["id"]: c for c in _load_index()}

    def _fields(prefix: str, char: dict) -> dict:
        char_id = char["id"]
        idx = idx_map.get(char_id, {})
        detail = _load_detail(char_id)
        core = detail.get("core", {})
        sits = char.get("persona_situations") or detail.get("situations", [])
        return {
            prefix:                        char_id,
            f"{prefix}Name":               char.get("persona_name") or char.get("name", ""),
            f"{prefix}Voice":              idx.get("voice_id", ""),
            f"{prefix}Occupation":         char.get("persona_occupation") or char.get("occupation", ""),
            f"{prefix}SpeakingStyle":      core.get("speaking_style", ""),
            f"{prefix}Secret":             core.get("lie_to_self", ""),
            f"{prefix}Situation":          sits[0] if sits else "",
            f"{prefix}Fear":               core.get("fear", ""),
            f"{prefix}Personality":        core.get("personality", ""),
            f"{prefix}FaceGrid":           char.get("face_grid_url", ""),
        }

    world.update(_fields("charA", char_a_cast))
    world.update(_fields("charB", char_b_cast))

    # LD-017: 주인공 교체 시 관계 6개 필드 재계산 (cast-reassign 후 architect가 올바른 컨텍스트를 갖도록)
    char_a_ctx = _load_char_family_context(req.charA_id)
    char_b_ctx = _load_char_family_context(req.charB_id)
    fg_a = char_a_ctx.get("family_group", "")
    fg_b = char_b_ctx.get("family_group", "")
    world.update({
        "charAFamilyGroup": fg_a,
        "charBFamilyGroup": fg_b,
        "charARelationships": char_a_ctx.get("relationships", {}),
        "charBRelationships": char_b_ctx.get("relationships", {}),
        "relationshipAtCh01Start": _determine_initial_relationship(fg_a, fg_b),
        "relationshipAtCh01Description": "",  # architect 단계에서 채워짐
    })

    # fullCastDetails 순서 재정렬: 새 A/B가 맨 앞으로
    details: list[dict] = world.get("fullCastDetails") or []
    a_det = next((d for d in details if d["id"] == req.charA_id), None)
    b_det = next((d for d in details if d["id"] == req.charB_id), None)
    others = [d for d in details if d["id"] not in (req.charA_id, req.charB_id)]
    if a_det and b_det:
        world["fullCastDetails"] = [a_det, b_det] + others

    db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()
    return {"ok": True, "charA": req.charA_id, "charB": req.charB_id}


@router.post("/{series_id}/approve/{step_name}")
async def approve_step(series_id: str, step_name: str, background_tasks: BackgroundTasks, req: ApproveStepRequest = ApproveStepRequest()):
    next_step = APPROVAL_TRANSITIONS.get(step_name)
    if not next_step:
        raise HTTPException(400, f"승인 불가한 단계: {step_name}")
    db = get_supabase()
    # 멱등성 가드 — 이미 next_step 이상 진행된 경우 중복 실행 방지
    res = db.table("v3_series").select("pipeline_step,world_data").eq("id", series_id).single().execute()
    if res.data:
        current = res.data.get("pipeline_step", "idle")
        step_order = [s.value for s in PipelineStep]
        current_idx = step_order.index(current) if current in step_order else 0
        next_idx = step_order.index(next_step.value) if next_step.value in step_order else 0
        if current_idx >= next_idx:
            return {"ok": True, "skipped": True, "current": current}

    # 캐스팅 확정 시 — 사용자 투입 비밀 처리 (최대 1개 허용)
    if step_name == "casting" and req.userSecrets:
        from services.casting_service import apply_user_secrets
        from services.wiki_service import upsert_wiki_page, ingest_chunk
        world = (res.data.get("world_data") or {}) if res.data else {}
        filtered = {k: v.strip() for k, v in req.userSecrets.items() if v and v.strip()}

        # ★ 비밀 1개 이하 원칙: A 캐릭터 비밀 우선, 초과분 제거
        if len(filtered) > 1:
            a_id = world.get("charA", "")
            if a_id in filtered:
                filtered = {a_id: filtered[a_id]}
            else:
                first_key = next(iter(filtered))
                filtered = {first_key: filtered[first_key]}

        world["userSecrets"] = filtered
        world = await apply_user_secrets(filtered, world)
        db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()

        # 비밀이 RAG에 반영되도록 wiki characters 페이지 즉시 갱신
        a_name = world.get("charAName", "주인공A")
        b_name = world.get("charBName", "주인공B")
        a_id   = world.get("charA", "")
        b_id   = world.get("charB", "")

        def _char_wiki_block(prefix: str, name: str, char_id: str) -> str:
            lines = [f"## {name}"]
            for k, field in [("직업", f"{prefix}Occupation"), ("겉모습", f"{prefix}PublicFace"),
                              ("속모습", f"{prefix}Shadow"), ("상황", f"{prefix}Situation"),
                              ("자기기만", f"{prefix}Secret"), ("Want", f"{prefix}Want"),
                              ("Need", f"{prefix}Need"), ("말투", f"{prefix}SpeakingStyle")]:
                v = world.get(field, "")
                if v:
                    lines.append(f"- {k}: {v}")
            injected = filtered.get(char_id, "")
            if injected:
                lines.append(f"- ★ 투입된 비밀: {injected}")
            return "\n".join(lines)

        chars_md = (f"# 등장인물\n\n"
                    f"{_char_wiki_block('charA', a_name, a_id)}\n\n"
                    f"{_char_wiki_block('charB', b_name, b_id)}")
        await upsert_wiki_page(series_id, "characters", chars_md)
        await ingest_chunk(series_id, "character", chars_md, source_ref="secrets:characters")

    db.table("v3_series").update({"pipeline_step": next_step.value}).eq("id", series_id).execute()
    background_tasks.add_task(run_pipeline, series_id, next_step)
    return {"ok": True, "next_step": next_step}


@router.post("/{series_id}/next-chapter")
async def next_chapter(series_id: str, background_tasks: BackgroundTasks):
    """CHAPTER_DONE 상태에서 다음 챕터 파이프라인 시작 — 챕터 수 무제한"""
    db = get_supabase()
    res = db.table("v3_series").select("pipeline_step,current_chapter").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    if res.data.get("pipeline_step") != PipelineStep.CHAPTER_DONE.value:
        raise HTTPException(400, f"챕터 완료 상태가 아님: {res.data.get('pipeline_step')}")

    current_ch = res.data.get("current_chapter", 1)
    db.table("v3_series").update({"pipeline_step": PipelineStep.SCRIPT.value}).eq("id", series_id).execute()
    background_tasks.add_task(run_pipeline, series_id, PipelineStep.SCRIPT)
    return {"ok": True, "next_chapter": current_ch}


@router.post("/{series_id}/terminate")
async def terminate_series(series_id: str):
    """사용자가 시리즈 종결 결정 — CHAPTER_DONE → DONE"""
    db = get_supabase()
    res = db.table("v3_series").select("pipeline_step,current_chapter").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    if res.data.get("pipeline_step") != PipelineStep.CHAPTER_DONE.value:
        raise HTTPException(400, "챕터 완료 상태에서만 종결할 수 있습니다")

    completed = res.data.get("current_chapter", 2) - 1  # increment 후이므로 -1
    db.table("v3_series").update({
        "pipeline_step": PipelineStep.DONE.value,
        "status": "done",
    }).eq("id", series_id).execute()
    return {"ok": True, "total_chapters": completed}


@router.delete("/{series_id}")
async def delete_series(series_id: str):
    """시리즈 + 연관 데이터 전체 삭제"""
    db = get_supabase()
    res = db.table("v3_series").select("id").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    db.table("v3_scenes").delete().eq("series_id", series_id).execute()
    db.table("v3_chapters").delete().eq("series_id", series_id).execute()
    db.table("v3_chapter_meta").delete().eq("series_id", series_id).execute()
    db.table("v3_pipeline_runs").delete().eq("series_id", series_id).execute()
    db.table("v3_series").delete().eq("id", series_id).execute()
    return {"ok": True}


@router.post("/{series_id}/retry/{step_name}")
async def retry_step(series_id: str, step_name: str, background_tasks: BackgroundTasks):
    try:
        step = PipelineStep(step_name)
    except ValueError:
        raise HTTPException(400, f"알 수 없는 단계: {step_name}")
    db = get_supabase()
    db.table("v3_series").update({
        "pipeline_step": step.value,
        "status": "retrying",
        "error_detail": None,
    }).eq("id", series_id).execute()
    background_tasks.add_task(run_pipeline, series_id, step)
    return {"ok": True, "retrying_step": step}


@router.get("/{series_id}/status")
async def get_status(series_id: str):
    db = get_supabase()
    res = db.table("v3_series").select("id,status,pipeline_step,error_detail,updated_at").eq("id", series_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Series not found")
    return res.data


@router.get("/{series_id}/logs")
async def get_logs(series_id: str):
    db = get_supabase()
    res = db.table("v3_pipeline_runs").select("*").eq("series_id", series_id).order("started_at", desc=True).limit(50).execute()
    return res.data


@router.get("/{series_id}/stream")
async def stream_pipeline(series_id: str):
    """파이프라인 실시간 이벤트 스트림 (SSE)"""
    return StreamingResponse(
        event_bus.stream(series_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Kling image-to-video
# ---------------------------------------------------------------------------

class KlingRequest(BaseModel):
    scene_ids: Optional[list[str]] = None   # None이면 keyframe_done 전체
    model: str = "v3/standard"             # "v3/standard" | "v2.1/pro" | "v2.1/master"
    duration: str = "5"                    # "5" | "10"
    aspect_ratio: str = "16:9"
    max_concurrent: int = 2


@router.post("/{series_id}/kling")
async def run_kling(series_id: str, req: KlingRequest, background_tasks: BackgroundTasks):
    """keyframe_url → Kling AI → kling_clip_url (MP4)

    - scene_ids 미지정: keyframe_done 상태 씬 전체
    - 이미 kling_clip_url이 있는 씬은 자동 스킵 (캐시)
    - 비용: v3/standard $0.10/5초, v2.1/pro $0.20/5초
    """
    from services.kling_service import run_kling as _run_kling
    from core.config import settings
    if not settings.FAL_KEY:
        raise HTTPException(400, "FAL_KEY 환경변수가 설정되지 않았습니다.")

    background_tasks.add_task(
        _run_kling,
        series_id,
        req.scene_ids,
        req.model,
        req.duration,
        req.aspect_ratio,
        req.max_concurrent,
    )
    return {"ok": True, "message": "Kling 변환 시작 (백그라운드 실행)"}


@router.get("/{series_id}/cost")
async def get_cost(series_id: str):
    """시리즈 전체 API 비용 합계 (cost_usd 컬럼 기준)"""
    from services.kling_service import get_series_cost
    return await get_series_cost(series_id)


