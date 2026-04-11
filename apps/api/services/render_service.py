"""렌더 서비스 — FFmpeg 씬별 MP4 클립 + concat"""
import asyncio
import json
import subprocess
import tempfile
from pathlib import Path
import httpx
from core.config import settings
from core.database import get_supabase
from services.tts_service import _upload_r2

_FPS = 30
_W, _H = 1920, 1080


async def run_render(series_id: str) -> dict:
    """전체 씬 클립 생성 → concat → 최종 MP4"""
    db = get_supabase()

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,keyframe_url,tts_url,srt_url,text,status")
        .eq("series_id", series_id)
        .eq("status", "tts_done")
        .order("chapter")
        .order("scene_index")
        .order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return {"ok": True, "note": "렌더할 씬 없음"}

    sem = asyncio.Semaphore(settings.MAX_CONCURRENT_RENDERS)
    clip_map: dict[str, str] = {}  # scene_id → R2 clip URL

    async def render_scene(scene: dict):
        async with sem:
            url = await _render_clip(series_id, scene, db)
            if url:
                clip_map[scene["id"]] = url

    await asyncio.gather(*[render_scene(s) for s in scenes], return_exceptions=True)

    # 씬 순서대로 clip URL 정렬
    ordered_urls = [
        clip_map[s["id"]]
        for s in sorted(scenes, key=lambda x: (x["chapter"], x["scene_index"], x.get("cut_index", 1)))
        if s["id"] in clip_map
    ]

    if not ordered_urls:
        raise RuntimeError("생성된 클립 없음")

    # 최종 concat
    final_url = await _concat_all(series_id, ordered_urls)

    # series 최종 URL 저장 — settings 기존 값 먼저 조회 후 병합
    series_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("settings").eq("id", series_id).single().execute()
    )
    existing_settings = (series_res.data or {}).get("settings") or {}
    await asyncio.to_thread(
        lambda: db.table("v3_series").update({
            "status": "render_ready",
            "settings": {
                **existing_settings,
                "finalMp4Url": final_url,
            },
        }).eq("id", series_id).execute()
    )

    return {"ok": True, "final_url": final_url, "clips": len(ordered_urls)}


async def _render_clip(series_id: str, scene: dict, db) -> str | None:
    """씬 1개 → MP4 클립 생성 → R2 업로드"""
    scene_id = scene["id"]
    keyframe_url = scene.get("keyframe_url")
    tts_url = scene.get("tts_url")

    if not keyframe_url or not tts_url:
        return None

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)

            # R2에서 파일 다운로드
            img_path = tmpdir / "frame.png"
            mp3_path = tmpdir / "audio.mp3"
            await _download(keyframe_url, img_path)
            await _download(tts_url, mp3_path)

            # 오디오 길이 측정
            duration = await asyncio.to_thread(_probe_duration, str(mp3_path))
            total_frames = int(duration * _FPS) + _FPS

            clip_path = tmpdir / f"clip_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}.mp4"

            # FFmpeg zoompan Ken Burns
            cmd = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", str(img_path),
                "-i", str(mp3_path),
                "-vf", (
                    f"scale={_W}:{_H}:force_original_aspect_ratio=decrease,"
                    f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2,"
                    f"zoompan=z='min(zoom+0.001,1.05)':"
                    f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                    f"d={total_frames}:s={_W}x{_H}:fps={_FPS}"
                ),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-shortest", "-movflags", "+faststart",
                str(clip_path),
            ]
            await asyncio.to_thread(subprocess.run, cmd, capture_output=True, check=True)

            r2_key = f"v3/{series_id}/clips/scene_{scene['chapter']}_{scene['scene_index']}c{scene.get('cut_index', 1)}.mp4"
            clip_url = await asyncio.to_thread(_upload_r2, str(clip_path), r2_key)

        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "clip_url": clip_url,
                "status": "render_done",
            }).eq("id", scene_id).execute()
        )
        return clip_url

    except Exception as e:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "status": "failed",
                "error_detail": f"렌더 실패: {e}",
            }).eq("id", scene_id).execute()
        )
        return None


async def _concat_all(series_id: str, clip_urls: list[str]) -> str:
    """클립 URL 목록 → concat → 최종 MP4 R2 업로드"""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # 클립 다운로드
        clip_paths = []
        for i, url in enumerate(clip_urls):
            p = tmpdir / f"clip_{i:04d}.mp4"
            await _download(url, p)
            clip_paths.append(p)

        # concat list 파일
        list_file = tmpdir / "list.txt"
        list_file.write_text(
            "\n".join(f"file '{p}'" for p in clip_paths),
            encoding="utf-8",
        )

        final_path = tmpdir / "final.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c", "copy",
            str(final_path),
        ]
        await asyncio.to_thread(subprocess.run, cmd, capture_output=True, check=True)

        r2_key = f"v3/{series_id}/final.mp4"
        return await asyncio.to_thread(_upload_r2, str(final_path), r2_key)


def _probe_duration(mp3_path: str) -> float:
    """ffprobe로 오디오 길이(초) 측정"""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", mp3_path],
            capture_output=True, text=True, timeout=30,
        )
        if not result.stdout.strip():
            return 5.0
        return float(json.loads(result.stdout)["format"]["duration"])
    except Exception:
        return 5.0


async def _download(url: str, dest: Path):
    """URL → 로컬 파일 다운로드"""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
