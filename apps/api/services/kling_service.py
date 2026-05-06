"""kling_service.py — Kling image-to-video via fal.ai

keyframe_url(PNG/R2) → Kling v3/standard → MP4 클립 → R2 업로드 → v3_scenes 갱신

비용: $0.10 / 5초 클립 (v3/standard), $0.20 / 5초 (v2.1/pro)
캐시: kling_clip_url이 이미 있는 씬은 재생성 스킵
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
import tempfile
import httpx

from core.config import settings
from core.database import get_supabase
from services.tts_service import _upload_r2


# ---------------------------------------------------------------------------
# 비용 테이블 (모델별, 5초 기준)
# ---------------------------------------------------------------------------
_COST_TABLE: dict[str, float] = {
    "v3/standard": 0.10,
    "v2.1/pro":    0.20,
    "v2.1/master": 0.30,
}
_DEFAULT_MODEL = "v3/standard"
_DEFAULT_DURATION = "5"   # "5" | "10"
_POLL_INTERVAL = 5        # 초


# ---------------------------------------------------------------------------
# 핵심 API 호출
# ---------------------------------------------------------------------------

async def _call_kling(
    image_url: str,
    prompt: str,
    model: str = _DEFAULT_MODEL,
    duration: str = _DEFAULT_DURATION,
    aspect_ratio: str = "16:9",
) -> str:
    """fal.ai Kling queue API → MP4 다운로드 bytes 반환."""
    api_key = settings.FAL_KEY
    if not api_key:
        raise RuntimeError("FAL_KEY 환경변수가 설정되지 않았습니다.")

    op = "image-to-video"
    endpoint = f"https://queue.fal.run/fal-ai/kling-video/{model}/{op}"
    headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}
    payload = {
        "image_url": image_url,
        "prompt": prompt,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # 1. 큐 제출
        resp = await client.post(endpoint, headers=headers, json=payload)
        resp.raise_for_status()
        q = resp.json()
        status_url: str = q["status_url"]
        response_url: str = q["response_url"]

        # 2. 완료 폴링
        while True:
            await asyncio.sleep(_POLL_INTERVAL)
            sr = await client.get(status_url, headers=headers, timeout=15)
            sr.raise_for_status()
            st = sr.json().get("status", "UNKNOWN")
            if st == "COMPLETED":
                break
            if st in ("FAILED", "CANCELLED"):
                raise RuntimeError(f"Kling 생성 실패: status={st}")

        # 3. 결과 URL
        rr = await client.get(response_url, headers=headers, timeout=30)
        rr.raise_for_status()
        video_url: str = rr.json()["video"]["url"]

        # 4. 바이너리 다운로드
        vr = await client.get(video_url, timeout=120)
        vr.raise_for_status()
        return vr.content  # MP4 bytes


# ---------------------------------------------------------------------------
# 씬 단위 처리
# ---------------------------------------------------------------------------

async def _process_scene(series_id: str, scene: dict, db, model: str, duration: str) -> dict:
    """씬 1개 → Kling → R2 → DB 갱신. 결과 dict 반환."""
    scene_id = scene["id"]
    keyframe_url = scene.get("keyframe_url")

    # 캐시 확인 — kling_clip_url 이미 있으면 스킵
    if scene.get("kling_clip_url"):
        return {"scene_id": scene_id, "status": "cached", "url": scene["kling_clip_url"]}

    if not keyframe_url:
        return {"scene_id": scene_id, "status": "skipped", "reason": "keyframe_url 없음"}

    prompt = scene.get("image_prompt") or scene.get("image_hint") or ""
    cost_usd = _COST_TABLE.get(model, 0.10) * (int(duration) / 5)

    try:
        mp4_bytes = await _call_kling(keyframe_url, prompt, model, duration)

        with tempfile.TemporaryDirectory() as tmpdir:
            clip_path = Path(tmpdir) / f"kling_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}.mp4"
            clip_path.write_bytes(mp4_bytes)
            r2_key = f"v3/{series_id}/kling/scene_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}.mp4"
            clip_url = await asyncio.to_thread(_upload_r2, str(clip_path), r2_key)

        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "kling_clip_url": clip_url,
                "cost_usd": cost_usd,
            }).eq("id", scene_id).execute()
        )
        return {"scene_id": scene_id, "status": "ok", "url": clip_url, "cost_usd": cost_usd}

    except Exception as e:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "error_detail": f"Kling 실패: {e}",
            }).eq("id", scene_id).execute()
        )
        return {"scene_id": scene_id, "status": "error", "reason": str(e)}


# ---------------------------------------------------------------------------
# 공개 엔트리포인트
# ---------------------------------------------------------------------------

async def run_kling(
    series_id: str,
    scene_ids: list[str] | None = None,
    model: str = _DEFAULT_MODEL,
    duration: str = _DEFAULT_DURATION,
    aspect_ratio: str = "16:9",
    max_concurrent: int = 2,
) -> dict:
    """시리즈 전체 (또는 지정 씬) keyframe → Kling → kling_clip_url.

    Args:
        series_id: 대상 시리즈 UUID
        scene_ids: None이면 keyframe_done 전체. 지정하면 해당 씬만.
        model: "v3/standard" | "v2.1/pro" | "v2.1/master"
        duration: "5" | "10"  (초)
        aspect_ratio: "16:9" | "9:16"
        max_concurrent: 동시 Kling 호출 수 (기본 2 — 비용 제어)
    """
    if not settings.FAL_KEY:
        raise RuntimeError("FAL_KEY가 설정되지 않았습니다. .env에 추가하세요.")

    db = get_supabase()

    # 처리 대상 씬 조회
    q = (
        db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,keyframe_url,image_prompt,image_hint,kling_clip_url")
        .eq("series_id", series_id)
    )
    if scene_ids:
        q = q.in_("id", scene_ids)
    else:
        q = q.eq("status", "keyframe_done")

    scenes_res = await asyncio.to_thread(lambda: q.execute())
    scenes = scenes_res.data or []

    if not scenes:
        return {"ok": True, "note": "처리할 씬 없음"}

    # 동시성 제한 세마포어
    sem = asyncio.Semaphore(max_concurrent)

    async def _bounded(scene: dict):
        async with sem:
            return await _process_scene(series_id, scene, db, model, duration)

    results = await asyncio.gather(*[_bounded(s) for s in scenes], return_exceptions=True)

    # 집계
    ok = [r for r in results if isinstance(r, dict) and r.get("status") == "ok"]
    cached = [r for r in results if isinstance(r, dict) and r.get("status") == "cached"]
    errors = [r for r in results if isinstance(r, dict) and r.get("status") == "error"]
    total_cost = sum(r.get("cost_usd", 0) for r in ok)

    return {
        "ok": True,
        "total": len(scenes),
        "generated": len(ok),
        "cached": len(cached),
        "errors": len(errors),
        "total_cost_usd": round(total_cost, 4),
        "model": model,
        "duration": duration,
        "results": [r for r in results if isinstance(r, dict)],
    }


# ---------------------------------------------------------------------------
# 비용 조회 헬퍼
# ---------------------------------------------------------------------------

async def get_series_cost(series_id: str) -> dict:
    """시리즈 전체 API 비용 합계 조회."""
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("cost_usd")
        .eq("series_id", series_id)
        .execute()
    )
    rows = res.data or []
    total = sum((r.get("cost_usd") or 0) for r in rows)
    return {
        "series_id": series_id,
        "scene_count": len(rows),
        "total_cost_usd": round(total, 4),
    }
