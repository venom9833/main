"""render_service.py — 챕터 단위 MP4 합성 파이프라인

3단계 구조:
  1. _normalize_clip()  — 각 컷 mp4 → libx264/aac 표준 파라미터 재인코딩
                          (파라미터 강제 통일 — concat -c copy 안전성 보장)
  2. _concat_clips()    — 표준화 클립 scene_code 순 concat (-c copy)
  3. render_chapter()   — 챕터 단위 최종 MP4 생성 (공개 엔트리포인트)

설계 근거:
  - 컷별 mp4는 경로마다 다른 코덱 파라미터를 가질 수 있음
    (ken_burns: libx264 crf18 / hybrid: lipsync 원본 코덱 / 사용자 교체 mp4: 불명)
  - -c copy concat은 모든 클립 파라미터가 동일해야 안전
  - normalize 단계에서 1920×1080, 30fps, libx264 crf18, aac 44100으로 강제 통일
  - 이후 -c copy concat은 무조건 안전
"""
import asyncio
import datetime as _dt
import json as _json
import re as _re        # 시리즈 코드에서 챕터 접미사 제거용 정규식
import shutil           # 언어별 폴더 복사 (kr/en/jp)
import subprocess
import tempfile
from pathlib import Path

from core.database import get_supabase
from services.grid_crop_service import _normalize_scene_code

OUTPUT_ROOT = Path(__file__).parent.parent.parent.parent / "output"

_FPS = 30
_W, _H = 1920, 1080
_CRF = 18
_AUDIO_RATE = 44100


# ── 오디오 소스 탐지 ────────────────────────────────────────────────────────

def _audio_source(mp4_path: Path) -> Path | None:
    """컷 mp4의 오디오 소스를 반환.

    우선순위:
      1. 동반 .mp3 파일 (TTS 별도 저장 — ken_burns 클립)
      2. mp4 내장 오디오 스트림
      3. None (무음 → anullsrc 사용)
    """
    mp3 = mp4_path.with_suffix(".mp3")
    if mp3.exists() and mp3.stat().st_size > 0:
        return mp3

    try:
        r = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=index",
                "-of", "csv=p=0",
                str(mp4_path),
            ],
            capture_output=True,
            timeout=10,
        )
        if r.stdout.strip():
            return mp4_path
    except Exception:
        pass

    return None


# ── 1단계: 표준화 재인코딩 ───────────────────────────────────────────────────

def _normalize_clip(src: Path, dst: Path) -> None:
    """컷 mp4 → 표준 파라미터 재인코딩 (1920×1080).

    오디오 우선순위: 동반 .mp3(TTS) > mp4 내장 오디오 > anullsrc 무음.
    항상 정확히 1개 오디오 스트림 출력 → concat 스트림 수 일치 보장.
    """
    vf = (
        f"scale={_W}:{_H}:force_original_aspect_ratio=decrease,"
        f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2:color=black,"
        "setsar=1"
    )
    audio = _audio_source(src)
    if audio is None:
        # 무음 fallback
        cmd = [
            "ffmpeg", "-y",
            "-i", str(src),
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-vf", vf,
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-map", "0:v:0", "-map", "1:a:0",
            "-shortest", "-movflags", "+faststart",
            str(dst),
        ]
    elif audio == src:
        # mp4 내장 오디오 사용
        cmd = [
            "ffmpeg", "-y",
            "-i", str(src),
            "-vf", vf,
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-map", "0:v:0", "-map", "0:a:0",
            "-movflags", "+faststart",
            str(dst),
        ]
    else:
        # 동반 .mp3(TTS) 사용 — video는 mp4(0), audio는 mp3(1)
        cmd = [
            "ffmpeg", "-y",
            "-i", str(src),
            "-i", str(audio),
            "-vf", vf,
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-map", "0:v:0", "-map", "1:a:0",
            "-shortest", "-movflags", "+faststart",
            str(dst),
        ]
    subprocess.run(cmd, check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=300)


# ── 1-B단계: 9:16 Center Crop 변환 ───────────────────────────────────────────

def _normalize_clip_9x16(src: Path, dst: Path) -> None:
    """컷 mp4 → 9:16 Center Crop 변환 (1080×1920).

    소스 해상도에 무관하게 항상 1080×1920 출력:
      1) 1920×1080 letterbox 정규화
      2) 중앙 1:1 크롭 → 1080×1080
      3) 상하 검은 여백 패딩 → 1080×1920 (상하 각 420px)

    오디오: 소스에 있으면 그대로, 없으면 anullsrc. 항상 1개 스트림 출력.
    """
    _PAD_Y = (_H * 16 // 9 - _H) // 2   # (1920-1080)/2 = 420
    _H9 = _H * 16 // 9                  # 1920
    vf = ",".join([
        f"scale={_W}:{_H}:force_original_aspect_ratio=decrease",
        f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2:black",
        f"crop={_H}:{_H}:({_W}-{_H})/2:0",
        f"pad={_H}:{_H9}:0:{_PAD_Y}:black",
        "setsar=1",
    ])
    audio = _audio_source(src)
    if audio is None:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(src),
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a:0",
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-shortest", "-movflags", "+faststart",
            str(dst),
        ], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=300)
    elif audio == src:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(src),
            "-vf", vf,
            "-map", "0:v:0", "-map", "0:a:0",
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-movflags", "+faststart",
            str(dst),
        ], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=300)
    else:
        # 동반 .mp3(TTS) 사용
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(src),
            "-i", str(audio),
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a:0",
            "-r", str(_FPS),
            "-c:v", "libx264", "-crf", str(_CRF), "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", str(_AUDIO_RATE), "-b:a", "128k",
            "-shortest", "-movflags", "+faststart",
            str(dst),
        ], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=300)


# ── 클립 실측 길이 ──────────────────────────────────────────────────────────

def _ffprobe_duration(path: Path) -> float:
    """normalize된 클립의 실제 재생 길이를 ffprobe로 측정."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error",
             "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, stdin=subprocess.DEVNULL, timeout=10,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


# ── 2단계: concat ───────────────────────────────────────────────────────────

def _concat_clips(clip_paths: list[Path], out_path: Path) -> None:
    """표준화된 클립 리스트 → concat (-c copy).

    _normalize_clip() 완료 클립만 입력할 것.
    모든 파라미터 동일이 보장된 상태에서만 -c copy 안전.
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for p in clip_paths:
            # Windows 경로 역슬래시 → 슬래시 변환 (FFmpeg concat list 요구사항)
            f.write(f"file '{p.as_posix()}'\n")
        list_path = Path(f.name)

    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-c", "copy",
            str(out_path),
        ], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=600)
    finally:
        list_path.unlink(missing_ok=True)


# ── 3단계: 챕터 렌더 엔트리포인트 ───────────────────────────────────────────

async def render_chapter(series_id: str, chapter: int, resolution: str = "16:9") -> dict:
    """챕터 단위 최종 MP4 생성.

    흐름:
      1. DB에서 scene_code 목록 조회 (scene_index, cut_index 순)
         ※ HOOK 레코드 2개 포함 — LD-001: 중복 제거 금지
      2. 로컬 output 폴더에서 컷별 mp4 수집
      3. 각 클립 표준화 재인코딩 (_normalize_clip 또는 _normalize_clip_9x16)
      4. 순서대로 concat → ch{N}_final.mp4
      5. kr/en/jp 폴더에 각각 복사 저장

    Args:
        series_id:  v3_series.id
        chapter:    챕터 번호 (예: 1)
        resolution: "16:9" (기본, 1920×1080) 또는 "9:16" (1080×1920 세로형)

    Returns:
        {
          "ok": True,
          "output": "/abs/path/kr/base_ch01_kr.mp4",   # kr 경로 (대표)
          "clips": N,
          "missing": ["file_code", ...],  # mp4 없어서 제외된 컷
          "lang_outputs": {"kr": "...", "en": "...", "jp": "..."},
        }
    """
    # resolution 값에 따라 표준화 함수 선택 (9:16이면 세로형, 그 외는 가로형)
    normalize_fn = _normalize_clip_9x16 if resolution == "9:16" else _normalize_clip
    db = get_supabase()

    # series_code → 로컬 output 폴더 경로
    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code")
        .eq("id", series_id).single().execute()
    )
    series_code = (ser.data or {}).get("series_code") or series_id
    out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # scene_code 순서 목록 조회
    # ★ LD-001: HOOK은 scene_index=0 + 원본 위치 2개 존재 — 중복 제거 금지
    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("scene_code,scene_index,cut_index")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index").order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return {"ok": False, "reason": "씬 데이터 없음"}

    # 로컬 mp4 수집 — raw scene_code도 병렬 추적 (clip_durations.json 키로 사용)
    clip_paths: list[Path] = []
    clip_scene_codes: list[str] = []   # clip_paths와 1:1 대응
    missing: list[str] = []
    for scene in scenes:
        raw_code = scene.get("scene_code") or ""
        if not raw_code:
            continue
        file_code = _normalize_scene_code(raw_code)
        mp4 = out_dir / f"{file_code}.mp4"
        if mp4.exists():
            clip_paths.append(mp4)
            clip_scene_codes.append(raw_code)
        else:
            missing.append(file_code)

    if not clip_paths:
        return {"ok": False, "reason": "mp4 클립 없음", "missing": missing}

    if missing:
        print(f"[render] ch{chapter:02d} 누락 컷 {len(missing)}개: {missing[:5]}...")

    # 표준화 재인코딩 → concat (임시 폴더 사용)
    final_path = out_dir / f"ch{chapter:02d}_final.mp4"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        sem = asyncio.Semaphore(4)  # 동시 FFmpeg 프로세스 최대 4개

        async def norm_one(idx: int, src: Path) -> Path:
            dst = tmp / f"norm_{idx:04d}.mp4"
            async with sem:
                try:
                    await asyncio.to_thread(normalize_fn, src, dst)
                    print(f"  [norm {idx+1:03d}/{len(clip_paths)}] {src.name}")
                    return dst
                except subprocess.CalledProcessError as e:
                    stderr = (e.stderr or b"").decode(errors="replace")
                    raise RuntimeError(f"표준화 실패: {src.name}\n{stderr[-500:]}")

        try:
            normalized: list[Path] = list(await asyncio.gather(
                *[norm_one(i, src) for i, src in enumerate(clip_paths)]
            ))
        except RuntimeError as e:
            return {"ok": False, "reason": str(e)}

        # ── 실측 클립 길이 수집 (tmpdir 정리 전에 측정) ───────────────────────
        clip_durations: list[dict] = [
            {"scene_code": sc, "duration": round(_ffprobe_duration(norm), 6)}
            for sc, norm in zip(clip_scene_codes, normalized)
        ]

        try:
            await asyncio.to_thread(_concat_clips, normalized, final_path)
        except subprocess.CalledProcessError as e:
            stderr = (e.stderr or b"").decode(errors="replace")
            return {
                "ok": False,
                "reason": "concat 실패",
                "stderr": stderr[-500:],
            }

    # ── 언어별 폴더(kr/en/jp)에 최종 MP4 복사 후 중간 파일 삭제 ─────────────────
    base_code    = _re.sub(r'_ch\d+.*', '', series_code)
    ch_label     = f"ch{chapter:02d}"
    ratio_suffix = resolution.replace(":", "-")  # "16:9"→"16-9", "9:16"→"9-16"
    dur_payload = {
        "chapter": chapter,
        "resolution": resolution,
        "generated_at": _dt.datetime.utcnow().isoformat() + "Z",
        "clips": clip_durations,
    }
    lang_outputs: dict[str, str] = {}
    for lang in ("kr", "en", "jp"):
        lang_dir = out_dir / lang
        lang_dir.mkdir(parents=True, exist_ok=True)
        dest = lang_dir / f"{base_code}_{ch_label}_{lang}_{ratio_suffix}.mp4"
        shutil.copy2(str(final_path), str(dest))
        lang_outputs[lang] = str(dest)
        # 실측 클립 길이 시드 저장 — SRT 타임코드 정밀화용
        (lang_dir / f"{ch_label}_clip_durations.json").write_text(
            _json.dumps(dur_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # 중간 파일 삭제 — kr/en/jp 복사 완료 후 ch{N}_final.mp4 불필요
    final_path.unlink(missing_ok=True)

    print(
        f"[render] ch{chapter:02d} 완료 → {lang_outputs['kr']} "
        f"({len(normalized)}클립 / 누락 {len(missing)}개)"
    )
    return {
        "ok": True,
        "output": lang_outputs["kr"],   # 대표 경로는 kr 버전
        "clips": len(normalized),
        "missing": missing,
        "lang_outputs": lang_outputs,   # 3개 언어 경로 전체
    }
