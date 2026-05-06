"""
임시 패럴랙스 테스트 라우터 — 62번 §6 Plan A 구현 검증용

경고: 이 라우터는 임시 테스트 전용입니다.
정식 도입 결정 후 → render_service.py로 통합 예정.

엔드포인트:
  POST /api/v1/test/parallax/render/{scene_id}
    - scene의 bg_url + char_url + tts_url로 패럴랙스 MP4 생성
    - rembg로 캐릭터 배경 제거 → R2 cutout 업로드
    - Remotion renderMedia로 2-레이어 패럴랙스 렌더링
    - 결과 clip URL 반환

  GET /api/v1/test/parallax/scenes/{series_id}
    - 패럴랙스 가능 씬 목록 (bg_url + char_url + tts_url 모두 있는 씬)
"""
import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException

from core.config import settings
from core.database import get_supabase
from services.tts_service import _upload_r2  # R2 업로드 헬퍼 재사용

router = APIRouter(prefix="/api/v1/test/parallax", tags=["parallax-test"])

# Remotion render.mjs 경로
_RENDER_MJS = Path(__file__).parent.parent.parent.parent / "apps" / "remotion" / "render.mjs"
# 같은 레포 내 상대 경로 (apps/api/routers → apps/remotion)
_RENDER_MJS_REL = Path(__file__).parent.parent.parent / "remotion" / "render.mjs"


def _get_render_script() -> Path:
    """render.mjs 경로 탐색"""
    for p in [_RENDER_MJS_REL, _RENDER_MJS]:
        if p.exists():
            return p
    raise FileNotFoundError(f"render.mjs 없음. apps/remotion/render.mjs 확인하세요.")


# ─────────────────────────────────────────────────────────────────────────────
# GET /scenes/{series_id} — 패럴랙스 가능 씬 목록
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/scenes/{series_id}")
async def list_parallax_scenes(series_id: str):
    """패럴랙스 가능 씬 목록 — bg_url + char_url + tts_url 모두 있는 씬"""
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id, scene_code, type, status, bg_url, char_url, tts_url, clip_url, animation_type")
        .eq("series_id", series_id)
        .not_.is_("bg_url", "null")
        .not_.is_("char_url", "null")
        .not_.is_("tts_url", "null")
        .order("scene_code")
        .execute()
    )
    scenes = res.data or []
    return {
        "series_id": series_id,
        "count": len(scenes),
        "scenes": scenes,
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /render/{scene_id} — 패럴랙스 렌더링 실행
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/render/{scene_id}")
async def render_parallax(scene_id: str, skip_rembg: bool = False):
    """
    패럴랙스 MP4 생성 — 단일 씬

    Args:
        scene_id: v3_scenes.id
        skip_rembg: True면 char_url을 그대로 사용 (이미 RGBA인 경우)

    Returns:
        { ok, clip_url, duration_sec, frames }
    """
    db = get_supabase()

    # ① 씬 데이터 조회
    res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id, series_id, scene_code, chapter, scene_index, cut_index, bg_url, char_url, tts_url")
        .eq("id", scene_id)
        .single()
        .execute()
    )
    scene = res.data
    if not scene:
        raise HTTPException(404, f"씬 없음: {scene_id}")

    bg_url   = scene.get("bg_url")
    char_url = scene.get("char_url")
    tts_url  = scene.get("tts_url")

    if not bg_url or not char_url or not tts_url:
        raise HTTPException(400, f"bg_url / char_url / tts_url 중 하나 이상 없음 — {scene['scene_code']}")

    series_id  = scene["series_id"]
    scene_code = scene["scene_code"]

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        bg_path   = tmpdir / "bg.png"
        char_path = tmpdir / "char.png"
        mp3_path  = tmpdir / "audio.mp3"
        out_path  = tmpdir / "parallax.mp4"

        # ② 에셋 다운로드 (병렬)
        await asyncio.gather(
            _dl(bg_url,   bg_path),
            _dl(char_url, char_path),
            _dl(tts_url,  mp3_path),
        )

        # ③ rembg — 캐릭터 배경 제거 → RGBA PNG
        cutout_path = tmpdir / "char_cutout.png"
        if skip_rembg:
            cutout_path = char_path
        else:
            await asyncio.to_thread(_run_rembg, str(char_path), str(cutout_path))

        # ④ rembg 결과를 R2에 임시 업로드 (Remotion이 URL로 접근하기 위해)
        cutout_r2_key = f"v3/{series_id}/cutouts/{scene_code}_char_cutout.png"
        cutout_url = await asyncio.to_thread(_upload_r2, str(cutout_path), cutout_r2_key)

        # ⑤ 오디오 길이 측정
        duration_sec = await asyncio.to_thread(_probe_duration, str(mp3_path))

        # ⑥ Remotion 렌더링 — render.mjs 호출
        render_script = _get_render_script()
        cmd = [
            "node", str(render_script),
            "--bgUrl",       bg_url,
            "--charUrl",     cutout_url,
            "--audioUrl",    tts_url,
            "--durationSec", str(duration_sec),
            "--out",         str(out_path),
        ]
        result = await asyncio.to_thread(_run_node, cmd)
        if not result.get("ok"):
            raise HTTPException(500, f"Remotion 렌더 실패: {result.get('error')}")

        # ⑦ 결과 MP4 → R2 업로드
        r2_key = f"v3/{series_id}/clips/parallax_{scene_code}.mp4"
        clip_url = await asyncio.to_thread(_upload_r2, str(out_path), r2_key)

    # ⑧ DB 업데이트
    await asyncio.to_thread(
        lambda: db.table("v3_scenes").update({
            "clip_url":      clip_url,
            "animation_type": "parallax",
            "production":     "split",
            "status":         "render_done",
        }).eq("id", scene_id).execute()
    )

    return {
        "ok":           True,
        "clip_url":     clip_url,
        "cutout_url":   cutout_url,
        "duration_sec": duration_sec,
        "frames":       result.get("frames"),
        "scene_code":   scene_code,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼 함수
# ─────────────────────────────────────────────────────────────────────────────

async def _dl(url: str, dest: Path):
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


def _run_rembg(src: str, dst: str) -> None:
    """rembg — 캐릭터 PNG 배경 제거 → RGBA PNG"""
    from rembg import remove
    from PIL import Image
    import io

    img = Image.open(src).convert("RGBA")
    cutout = remove(img)
    cutout.save(dst, format="PNG")


def _run_node(cmd: list[str]) -> dict:
    """Node.js render.mjs 동기 실행 — JSON 결과 파싱"""
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,  # 최대 10분
    )
    # stderr: Remotion 진행 로그 (디버그용)
    if proc.stderr:
        for line in proc.stderr.strip().splitlines():
            print(f"[Remotion] {line}")

    # stdout: JSON 결과
    stdout = proc.stdout.strip()
    if not stdout:
        return {"ok": False, "error": f"Node.js 응답 없음. returncode={proc.returncode}"}
    try:
        return json.loads(stdout)
    except Exception:
        return {"ok": False, "error": f"JSON 파싱 실패: {stdout[:200]}"}


def _probe_duration(mp3_path: str) -> float:
    import json as _json
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", mp3_path],
            capture_output=True, text=True, timeout=15,
        )
        return float(_json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return 5.0
