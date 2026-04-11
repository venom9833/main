"""V3 파이프라인 오케스트레이터 — FastAPI BackgroundTasks 기반"""
import asyncio
import traceback
from datetime import datetime, timezone

from agent.state_machine import PipelineStep, AUTO_TRANSITIONS, APPROVAL_TRANSITIONS
from agent.retry_policy import get_policy
from agent.event_bus import event_bus
from core.database import get_supabase

# 사용자 승인이 필요한 대기 상태 (기본값 — autoApprove 플래그로 건너뜀 가능)
_AWAITING_STEPS = {
    PipelineStep.AWAITING_SOURCE_UPLOAD,
    PipelineStep.AWAITING_WORLD_APPROVAL,
    PipelineStep.AWAITING_CASTING_APPROVAL,
    PipelineStep.AWAITING_SCRIPT_APPROVAL,
    PipelineStep.AWAITING_KEYFRAME_SETUP,
    PipelineStep.AWAITING_UPLOAD_APPROVAL,
}

# 대기 상태 → autoApprove 설정 키 매핑
_AUTO_APPROVE_KEYS: dict[PipelineStep, str] = {
    PipelineStep.AWAITING_SOURCE_UPLOAD:    "autoApproveSource",
    PipelineStep.AWAITING_WORLD_APPROVAL:   "autoApproveWorld",
    PipelineStep.AWAITING_CASTING_APPROVAL: "autoApproveCasting",
    PipelineStep.AWAITING_SCRIPT_APPROVAL:  "autoApproveScript",
    PipelineStep.AWAITING_KEYFRAME_SETUP:   "autoApproveKeyframe",
    PipelineStep.AWAITING_UPLOAD_APPROVAL:  "autoApproveUpload",
}


def _load_settings(db, series_id: str) -> dict:
    """series.settings 로드"""
    try:
        res = db.table("v3_series").select("settings").eq("id", series_id).single().execute()
        return res.data.get("settings") or {}
    except Exception:
        return {}


def _is_auto_approve(settings: dict, step: PipelineStep) -> bool:
    """해당 게이트의 autoApprove 플래그 확인"""
    key = _AUTO_APPROVE_KEYS.get(step)
    return bool(key and settings.get(key, False))


async def run_pipeline(series_id: str, start_step: PipelineStep = PipelineStep.AWAITING_SOURCE_UPLOAD):
    """파이프라인 실행 — start_step부터 대기 상태(또는 CHAPTER_DONE/완료)까지 자동 진행"""
    db = get_supabase()
    step = start_step

    while step not in (PipelineStep.DONE, PipelineStep.FAILED, PipelineStep.CHAPTER_DONE):

        # ── 대기 상태 처리 ─────────────────────────────────────────────────────
        if step in _AWAITING_STEPS:
            settings = _load_settings(db, series_id)

            if _is_auto_approve(settings, step):
                # autoApprove ON → 즉시 다음 단계로
                _key_map = {
                    PipelineStep.AWAITING_SOURCE_UPLOAD:    "source_upload",
                    PipelineStep.AWAITING_WORLD_APPROVAL:   "world",
                    PipelineStep.AWAITING_CASTING_APPROVAL: "casting",
                    PipelineStep.AWAITING_SCRIPT_APPROVAL:  "script",
                    PipelineStep.AWAITING_KEYFRAME_SETUP:   "keyframe_setup",
                    PipelineStep.AWAITING_UPLOAD_APPROVAL:  "upload",
                }
                next_step = APPROVAL_TRANSITIONS.get(_key_map.get(step, ""))
                if next_step:
                    _update_series(db, series_id, next_step)
                    await event_bus.publish(series_id, {"type": "auto_approved", "step": step.value})
                    step = next_step
                    continue
            else:
                # autoApprove OFF → 사용자 대기
                _update_series(db, series_id, step)
                await event_bus.publish(series_id, {"type": "awaiting_approval", "step": step.value})
                return

        # ── 실행 단계 처리 ─────────────────────────────────────────────────────
        policy = get_policy(step)
        success = False

        await event_bus.publish(series_id, {"type": "step_start", "step": step.value})

        for attempt in range(1, policy["max_attempts"] + 1):
            run_id = _log_run(db, series_id, step, attempt)
            try:
                result = await _execute_step(series_id, step)
                _finish_run(db, run_id, "success", metadata=result or {})
                success = True
                await event_bus.publish(series_id, {"type": "step_done", "step": step.value})
                break
            except Exception as e:
                err = traceback.format_exc()
                _finish_run(db, run_id, "failed", error=err)
                await event_bus.publish(series_id, {"type": "step_error", "step": step.value, "error": str(e)})
                if attempt < policy["max_attempts"]:
                    wait = policy["backoff"][attempt - 1] if attempt - 1 < len(policy["backoff"]) else 0
                    if wait > 0:
                        await asyncio.sleep(wait)

        if not success:
            _update_series(db, series_id, PipelineStep.FAILED, error=f"{step} 실패")
            await event_bus.publish(series_id, {"type": "done", "step": "failed"})
            return

        next_step = AUTO_TRANSITIONS.get(step)
        if next_step:
            # CHAPTER_DONE: 챕터 증가 후 정지 (다음날 재진입)
            if next_step == PipelineStep.CHAPTER_DONE:
                completed = _increment_chapter(db, series_id)  # 완료된 챕터 번호 반환
                _update_series(db, series_id, PipelineStep.CHAPTER_DONE)
                await event_bus.publish(series_id, {
                    "type": "chapter_done",
                    "chapter": completed,  # 방금 완료한 챕터 번호
                })
                break
            _update_series(db, series_id, next_step)
            step = next_step
        else:
            await event_bus.publish(series_id, {"type": "done", "step": step.value})
            break


async def _execute_step(series_id: str, step: PipelineStep) -> dict:
    step_map = {
        PipelineStep.WORLD:          _run_world,
        PipelineStep.CASTING:        _run_casting,
        PipelineStep.ARCHITECT:      _run_architect,
        PipelineStep.SCRIPT:         _run_script,
        PipelineStep.KEYFRAME:       _run_keyframe,
        PipelineStep.TTS:            _run_tts,
        PipelineStep.RENDER:         _run_render,
        PipelineStep.UPLOAD:         _run_upload,
        PipelineStep.NAVER_UPLOAD:   _run_naver_upload,
        PipelineStep.YOUTUBE_MANAGE: _run_youtube_manage,
    }
    fn = step_map.get(step)
    if fn:
        result = await fn(series_id)
        return result or {}
    return {}


# ── 단계별 함수 ───────────────────────────────────────────────────────────────

async def _run_world(series_id: str):
    from services.world_service import run_world
    await run_world(series_id)

async def _run_casting(series_id: str):
    from services.casting_service import run_casting
    await run_casting(series_id)

async def _run_architect(series_id: str):
    from services.architect_service import run_architect
    await run_architect(series_id)

async def _run_script(series_id: str):
    from services.script_service import run_script
    await run_script(series_id)

async def _run_keyframe(series_id: str):
    from services.keyframe_service import run_keyframe
    await run_keyframe(series_id)

async def _run_tts(series_id: str):
    from services.tts_service import run_tts
    await run_tts(series_id)

async def _run_render(series_id: str):
    from services.render_service import run_render
    await run_render(series_id)

async def _run_upload(series_id: str):
    from services.youtube_service import run_upload
    await run_upload(series_id)

async def _run_naver_upload(series_id: str):
    from services.naver_service import run_naver_upload
    await run_naver_upload(series_id)

async def _run_youtube_manage(series_id: str):
    from services.youtube_service import run_youtube_manage
    await run_youtube_manage(series_id)


# ── DB 헬퍼 ──────────────────────────────────────────────────────────────────

def _log_run(db, series_id: str, step: PipelineStep, attempt: int) -> str:
    try:
        res = db.table("v3_pipeline_runs").insert({
            "series_id": series_id,
            "step": step.value,
            "status": "running",
            "attempt": attempt,
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return "unknown"


def _finish_run(db, run_id: str, status: str, error: str | None = None, metadata: dict | None = None):
    db.table("v3_pipeline_runs").update({
        "status": status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "error_detail": error,
        "metadata": metadata or {},
    }).eq("id", run_id).execute()


def _update_series(db, series_id: str, step: PipelineStep, error: str | None = None):
    patch = {"pipeline_step": step.value}
    if error:
        patch["error_detail"] = error
        patch["status"] = "failed"
    db.table("v3_series").update(patch).eq("id", series_id).execute()


def _increment_chapter(db, series_id: str) -> int:
    """current_chapter + 1. 완료된 챕터 번호 반환.
    종결은 사용자가 명시적으로 결정 — 자동 DONE 없음."""
    try:
        res = db.table("v3_series").select("current_chapter").eq("id", series_id).single().execute()
        current = res.data.get("current_chapter", 1)
        db.table("v3_series").update({"current_chapter": current + 1}).eq("id", series_id).execute()
        return current
    except Exception:
        return 1
