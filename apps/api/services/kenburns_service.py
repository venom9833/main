"""Ken Burns 애니메이션 서비스
PNG 이미지 + TTS MP3 duration → FFmpeg zoompan → MP4 자동 생성
"""
import asyncio
import json
import pathlib
import subprocess
from typing import Optional

import httpx

OUTPUT_ROOT = pathlib.Path(__file__).parent.parent.parent.parent / "output"
FPS = 25

# ── 효과 정의 ─────────────────────────────────────────────────────────────────
# scene_index 기반으로 효과를 고정 (같은 씬은 항상 같은 효과)
_EFFECTS = ["zoom_in", "zoom_out", "pan_right", "pan_left", "diagonal"]


def _pick_effect(scene_index: int) -> str:
    return _EFFECTS[scene_index % len(_EFFECTS)]


def _zoompan_filter(effect: str, duration: float) -> str:
    # on/d 방식: 클립 길이와 무관하게 항상 20% 이동 보장
    d = max(1, int(duration * FPS))
    base = f"s=1920x1080:fps={FPS}:d={d}"
    if effect == "zoom_in":
        return (f"zoompan=z='min(1.0+on/{d}*0.2,1.2)'"
                f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':{base}")
    if effect == "zoom_out":
        return (f"zoompan=z='max(1.001,1.2-on/{d}*0.2)'"
                f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':{base}")
    if effect == "pan_right":
        return (f"zoompan=z='1.2'"
                f":x='on/{d}*(iw*0.15)':y='ih/2-(ih/zoom/2)':{base}")
    if effect == "pan_left":
        return (f"zoompan=z='1.2'"
                f":x='iw*0.15*(1-on/{d})':y='ih/2-(ih/zoom/2)':{base}")
    # diagonal: 줌인 + 대각선 패닝
    return (f"zoompan=z='min(1.0+on/{d}*0.2,1.2)'"
            f":x='on/{d}*(iw*0.1)':y='on/{d}*(ih*0.08)':{base}")


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────
def _mp3_duration(mp3_path: pathlib.Path) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(mp3_path)],
        capture_output=True, text=True, timeout=10,
    )
    return float(json.loads(res.stdout)["format"]["duration"])


def _run_kenburns(img_path: pathlib.Path, mp4_path: pathlib.Path,
                  duration: float, effect: str) -> None:
    zp = _zoompan_filter(effect, duration)
    subprocess.run([
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", str(FPS), "-i", str(img_path),
        "-vf", zp,
        "-t", str(round(duration, 3)),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        str(mp4_path),
    ], check=True, capture_output=True, timeout=120)


async def _download_img(url: str, dest: pathlib.Path) -> None:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(url, timeout=30)
        r.raise_for_status()
        dest.write_bytes(r.content)


# ── 메인 배치 함수 ────────────────────────────────────────────────────────────
async def batch_kenburns(series_id: str, chapter: int, db,
                         overwrite: bool = False) -> dict:
    """모든 씬에 대해 MP3+이미지 → Ken Burns MP4 자동 생성.

    Args:
        series_id: Supabase v3_series.id
        chapter:   챕터 번호 (보통 1)
        db:        Supabase 클라이언트
        overwrite: True이면 기존 MP4도 재생성
    Returns:
        {"processed": N, "skipped": N, "errors": [...]}
    """
    # 시리즈 코드
    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code")
        .eq("id", series_id).single().execute()
    )
    series_code = (ser.data or {}).get("series_code") or series_id
    out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 씬 목록
    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes").select("*")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index").order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []

    result = {"processed": 0, "skipped": 0, "errors": []}

    for scene in scenes:
        code = scene.get("scene_code", "")
        if not code:
            result["skipped"] += 1
            continue

        mp3_path = out_dir / f"{code}.mp3"
        mp4_path = out_dir / f"{code}.mp4"

        # MP3 없으면 스킵 (TTS 미생성)
        if not mp3_path.exists():
            result["skipped"] += 1
            continue

        # 이미 MP4 있고 overwrite 아니면 스킵
        if mp4_path.exists() and not overwrite:
            result["skipped"] += 1
            continue

        # 이미지 소스 확보
        img_path = out_dir / f"{code}.png"
        if not img_path.exists():
            img_url = scene.get("bg_url") or scene.get("keyframe_url")
            if not img_url:
                result["errors"].append(f"{code}: 이미지 없음")
                continue
            try:
                await _download_img(img_url, img_path)
            except Exception as e:
                result["errors"].append(f"{code}: 이미지 다운로드 실패 — {e}")
                continue

        # TTS 길이 측정
        try:
            duration = await asyncio.to_thread(_mp3_duration, mp3_path)
        except Exception as e:
            result["errors"].append(f"{code}: duration 측정 실패 — {e}")
            continue

        # Ken Burns 생성
        effect = _pick_effect(scene.get("scene_index", 0))
        try:
            await asyncio.to_thread(_run_kenburns, img_path, mp4_path, duration, effect)
            result["processed"] += 1
            print(f"  ✓ {code}  [{effect}]  {duration:.1f}s")
        except Exception as e:
            result["errors"].append(f"{code}: MP4 생성 실패 — {e}")

    return result
