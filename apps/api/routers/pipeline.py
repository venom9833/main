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

    # 캐스팅 확정 시 — 사용자 투입 비밀 처리
    if step_name == "casting" and req.userSecrets:
        from services.casting_service import apply_user_secrets
        world = (res.data.get("world_data") or {}) if res.data else {}
        filtered = {k: v.strip() for k, v in req.userSecrets.items() if v and v.strip()}
        world["userSecrets"] = filtered
        world = apply_user_secrets(filtered, world)
        db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()

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
