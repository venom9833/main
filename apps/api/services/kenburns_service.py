"""Ken Burns 애니메이션 서비스 — Phase 2 (Pillow 프레임별 생성)

FFmpeg zoompan 필터 제거 이유:
  zoompan은 내부적으로 정수 픽셀 좌표로 크롭 → sub-pixel 보간 없음
  → 매 2~3프레임마다 1픽셀 점프 → 화면이 "뚝뚝 끊기는" 현상 발생

Phase 2 아키텍처:
  PNG (1920×1080 정규화)
    → Pillow LANCZOS 2× 사전 스케일 (3840×2160)  ← 원본 해상도 2배 확보
    → 프레임 루프:
        t_eased = ease_in_out(n / total_frames)   ← 부드러운 감속 곡선
        zoom = z_from + (z_to - z_from) * t_eased
        crop box (float) = 소스 중앙 기준          ← 소수점 좌표 유지
        crop.resize((1920,1080), LANCZOS)          ← 매 프레임 sub-pixel 정확도
        → FFmpeg stdin pipe (raw RGB24)
    → FFmpeg: rawvideo → libx264 -preset slow -crf 18 -tune stillimage

Hybrid 모드:
  lipsync MP4(짧음) + Ken Burns tail → 전체 TTS 길이에 맞춘 최종 MP4
"""
import asyncio
import json
import math
import pathlib
import subprocess
import tempfile
from typing import Optional

import httpx

# 프로젝트 루트 기준 output 폴더 경로
OUTPUT_ROOT = pathlib.Path(__file__).parent.parent.parent.parent / "output"

# 출력 프레임레이트 (30fps = 1초에 30프레임)
FPS = 30

# 출력 해상도 (Full HD 고정)
_OUT_W = 1920
_OUT_H = 1080

# 사용 가능한 Ken Burns 효과 목록
# scene_index % len(_EFFECTS) 로 씬마다 자동 순환
_EFFECTS = ["zoom_in"]  # zoom_out/pan/diagonal 제거 — 가장자리 흰/검 배경 노출 방지


# ── 효과 선택 ─────────────────────────────────────────────────────────────────

def _pick_effect(scene_index: int) -> str:
    """씬 인덱스로 효과를 순환 선택한다.

    scene_index=0 → zoom_in
    scene_index=1 → zoom_out
    scene_index=2 → pan_right
    ... (5개 효과를 반복)
    """
    return _EFFECTS[scene_index % len(_EFFECTS)]


# ── 이징(감속) 곡선 ────────────────────────────────────────────────────────────

def _ease_in_out(t: float) -> float:
    """코사인 기반 ease-in-out 이징 함수.

    t=0.0 → 0.0 (시작: 느림)
    t=0.5 → 0.5 (중간: 가장 빠름)
    t=1.0 → 1.0 (끝: 다시 느림)

    선형 보간 대비 시작·끝이 부드럽게 감속되어 자연스러운 카메라 이동감을 준다.
    """
    return (1 - math.cos(math.pi * t)) / 2


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────

def _probe_duration(path: pathlib.Path) -> float:
    """ffprobe로 오디오/비디오 파일의 재생 길이(초)를 측정한다."""
    res = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True, text=True, timeout=10,
    )
    return float(json.loads(res.stdout)["format"]["duration"])


# 하위 호환성을 위한 alias (기존 코드에서 _mp3_duration으로 호출하는 경우 대비)
_mp3_duration = _probe_duration


def _normalize_png(img_path: pathlib.Path) -> None:
    """PNG를 1920×1080 (16:9 센터 크롭 후 리사이즈)로 정규화한다.

    처리 순서:
      1. 이미 1920×1080이면 즉시 반환 (불필요한 재처리 방지)
      2. 현재 비율이 16:9보다 넓으면 좌우 크롭
      3. 현재 비율이 16:9보다 좁으면 상하 크롭
      4. 1920×1080으로 LANCZOS 리사이즈 후 원본 경로에 덮어씀

    결과: 항상 정확히 1920×1080 PNG 상태로 유지됨
    """
    from PIL import Image
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    if (w, h) == (_OUT_W, _OUT_H):
        return  # 이미 정규화됨, 스킵

    target_ratio = _OUT_W / _OUT_H  # 16:9 ≈ 1.7778
    current_ratio = w / h

    if current_ratio > target_ratio:
        # 좌우가 넘치는 경우 → 좌우를 동일하게 잘라냄
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    elif current_ratio < target_ratio:
        # 상하가 넘치는 경우 → 상하를 동일하게 잘라냄
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    img = img.resize((_OUT_W, _OUT_H), Image.LANCZOS)
    img.save(img_path, format="PNG", optimize=True)
    print(f"[normalize] {img_path.name}: {w}×{h} → {_OUT_W}×{_OUT_H}")


# ── Pillow 프레임별 Ken Burns 생성 ────────────────────────────────────────────

def _pillow_kenburns(
    img_path: pathlib.Path,
    mp4_path: pathlib.Path,
    duration: float,
    effect: str,
    smooth: bool = False,
) -> None:
    """Pillow LANCZOS 기반 프레임별 Ken Burns MP4 생성 (오디오 없음).

    Phase 2 핵심 함수:
      - zoompan 정수 픽셀 점프 문제 완전 해소
      - 3840×2160 사전 스케일 → 매 프레임 소수점 crop box → LANCZOS resize
      - FFmpeg stdin pipe로 rawvideo(RGB24) 수신 → libx264 인코딩

    Args:
        img_path:  입력 PNG (호출 전 _normalize_png 적용 필요)
        mp4_path:  출력 MP4 경로
        duration:  목표 재생 시간(초)
        effect:    zoom_in | zoom_out | pan_right | pan_left | diagonal
        smooth:    True이면 hybrid tail 전용 — zoom 5% 미세 이동 (기본 15% 대비 조용한 움직임)
    """
    from PIL import Image

    # 1. PNG 정규화 (1920×1080 보장)
    _normalize_png(img_path)

    # 2. 2× 사전 스케일: 3840×2160
    #    이유: crop 박스가 소수점 좌표일 때 round() 이후에도
    #          더 많은 픽셀 정보가 남아 있어 LANCZOS 보간 품질이 높아짐
    src = Image.open(img_path).convert("RGB").resize((3840, 2160), Image.LANCZOS)

    # 3. 총 프레임 수 계산
    total_frames = max(1, round(duration * FPS))

    # 4. 효과별 zoom 범위 설정
    #    smooth=True (hybrid tail): 5% 미세 줌 → 이음새가 눈에 띄지 않음
    #    smooth=False (일반 Ken Burns): 15% 줌 → 뚜렷한 카메라 움직임
    if smooth:
        # smooth tail은 항상 zoom_in (가장자리 노출 방지)
        z_from, z_to = 1.0, 1.10
    else:
        if effect == "zoom_in":
            z_from, z_to = 1.0, 1.15
        elif effect == "zoom_out":
            z_from, z_to = 1.15, 1.0
        elif effect in ("pan_right", "pan_left"):
            # 팬 효과: zoom은 1.15 고정, x축만 이동
            z_from = z_to = 1.15
        else:
            # diagonal
            z_from, z_to = 1.0, 1.15

    # 소스 이미지 치수 및 중심 좌표 (3840×2160 기준)
    src_w, src_h = 3840, 2160
    src_cx = src_w / 2  # = 1920.0
    src_cy = src_h / 2  # = 1080.0

    # 팬 효과 이동 범위 (소스 기준)
    # z=1.15 고정 시 crop 폭 = 3840/1.15 ≈ 3339px
    # 좌우 여백 합계 = 3840 - 3339 = 501px, 그 80% = 400px (총 이동 거리)
    pan_range_x = (src_w - src_w / 1.15) * 0.8

    # 5. FFmpeg 프로세스 시작 (stdin pipe로 rawvideo 수신)
    cmd = [
        "ffmpeg", "-y",
        # 입력: stdin에서 rawvideo (RGB24, 1920×1080, 30fps)
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{_OUT_W}x{_OUT_H}",
        "-r", str(FPS),
        "-i", "pipe:0",
        # 출력: libx264 (고품질 설정)
        # -preset slow: 인코딩 시간 증가, 파일 크기 및 품질 향상
        # -crf 18: 시각적 무손실에 가까운 품질 (0=완전무손실, 51=최저)
        # -tune stillimage: 정지 이미지 기반 영상 최적화 (Ken Burns에 적합)
        # -g 30: 키프레임 간격 = 1초 (탐색 효율)
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-tune", "stillimage",
        "-g", str(FPS),
        "-pix_fmt", "yuv420p",
        str(mp4_path),
    ]
    # stderr=DEVNULL: FFmpeg 진행 로그가 Python 버퍼와 교착 방지
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    try:
        # 6. 프레임 루프: 각 프레임을 Pillow로 생성 → FFmpeg stdin에 전달
        for n in range(total_frames):
            # 정규화된 시간 t: 0.0(첫 프레임) ~ 1.0(마지막 프레임)
            t = n / max(total_frames - 1, 1)
            # ease-in-out 적용 (시작·끝 부드럽게 감속)
            t_e = _ease_in_out(t)

            # 현재 프레임의 zoom 값
            zoom = z_from + (z_to - z_from) * t_e

            # ── crop 박스 계산 (소스 3840×2160 기준) ──────────────────────────
            # zoom=1.0 → crop = 전체 소스(3840×2160) → 원본 이미지 그대로
            # zoom=1.15 → crop = 3840/1.15 × 2160/1.15 ≈ 3339×1878 → 15% 확대
            half_cw = (src_w / zoom) / 2   # 가로 절반 (소스 기준)
            half_ch = (src_h / zoom) / 2   # 세로 절반 (소스 기준)

            # 기본 crop 박스: 소스 중앙 기준
            cx = src_cx
            cy = src_cy

            # 팬 효과: cx만 이동, zoom은 1.15 고정
            if effect == "pan_right":
                cx = src_cx + (t_e - 0.5) * pan_range_x
            elif effect == "pan_left":
                cx = src_cx - (t_e - 0.5) * pan_range_x

            # crop 박스 좌상단·우하단 좌표
            x0 = cx - half_cw
            y0 = cy - half_ch
            x1 = cx + half_cw
            y1 = cy + half_ch

            # diagonal 효과: 현재 zoom에서 생긴 여백만큼만 cx/cy 이동
            # zoom=1.0에서는 여백=0 → 드리프트 없음 (클램프 왜곡 방지)
            # zoom이 커질수록 여백이 생기면서 자연스럽게 드리프트
            if effect == "diagonal":
                slack_x = (src_w - src_w / zoom) / 2   # 현재 zoom에서 좌우 여백 절반
                slack_y = (src_h - src_h / zoom) / 2
                # t_e=0 → 우하단(+slack), t_e=1 → 좌상단(-slack)
                cx += slack_x * (0.5 - t_e) * 1.6
                cy += slack_y * (0.5 - t_e) * 1.6
                x0 = cx - half_cw
                y0 = cy - half_ch
                x1 = cx + half_cw
                y1 = cy + half_ch

            # 경계 클램프: 소스 이미지(3840×2160) 밖으로 벗어나지 않도록
            # crop 박스가 소스 밖으로 나가면 검은 테두리(letterbox)가 생기므로 필수
            if x0 < 0:
                x1 -= x0   # 오른쪽으로 보정
                x0 = 0
            if y0 < 0:
                y1 -= y0   # 아래로 보정
                y0 = 0
            if x1 > 3840:
                x0 -= (x1 - 3840)  # 왼쪽으로 보정
                x1 = 3840
            if y1 > 2160:
                y0 -= (y1 - 2160)  # 위로 보정
                y1 = 2160

            # round(): PIL crop은 정수만 허용하지만 이 시점의 round는
            # "마지막 1회"만 정수화 → zoompan처럼 매 프레임 누적 오류 없음
            crop = src.crop((round(x0), round(y0), round(x1), round(y1)))

            # LANCZOS 리사이즈: 소수점 crop 박스를 정수화할 때 발생하는
            # 미세 크기 차이를 보정하면서 1920×1080으로 고품질 축소
            frame = crop.resize((_OUT_W, _OUT_H), Image.LANCZOS)

            # FFmpeg stdin에 RGB24 바이트 전달 (3바이트 × 1920 × 1080 = 6,220,800 bytes/frame)
            proc.stdin.write(frame.tobytes())

    finally:
        # stdin 닫기: FFmpeg에 입력 종료 신호 전달
        proc.stdin.close()

    # FFmpeg 인코딩 완료 대기 (최대 10분)
    proc.wait(timeout=600)

    if proc.returncode != 0:
        raise RuntimeError(
            f"FFmpeg Pillow Ken Burns 인코딩 실패: returncode={proc.returncode}, "
            f"effect={effect}, duration={duration:.1f}s, output={mp4_path}"
        )


# ── 다국어 대응 오디오 분리 파이프라인 ───────────────────────────────────────────
#
#  clean.mp4   = 영상만 (무음) — ken_burns 또는 hybrid concat 결과
#  kr_voice.mp3 = TTS 목소리만 — tts_service 생성물
#  sfx_bgm.mp3  = SFX+BGM 믹스 (언어 무관) — _mix_sfx_only 생성물
#  ──────────────────────────────────────────────────────
#  final_kr.mp4 = clean + kr_voice + sfx_bgm   (_mux_final 생성물)
#  future: final_en.mp4 = clean + en_voice + sfx_bgm (clean/sfx 재사용 비용 0)

def _mix_sfx_only(
    sfx_plan: "dict | None",
    out_mp3: pathlib.Path,
    total_dur: float,
) -> None:
    """SFX/BGM OGG 레이어만 믹스 → MP3 (목소리 제외, 언어 무관).
    SFX 에셋 미존재 시 무음 MP3 생성 (파일 존재 보장).
    """
    from services.sfx_service import SFX_ASSETS_DIR

    sfx_layers: list[tuple[pathlib.Path, int, bool]] = []
    if sfx_plan:
        for key, loop in (("ambience", True), ("bed", True)):
            entry = sfx_plan.get(key)
            if entry:
                p = SFX_ASSETS_DIR / entry["file"]
                if p.exists():
                    sfx_layers.append((p, entry["volume_db"], loop))
        for os_entry in sfx_plan.get("oneshots", []):
            p = SFX_ASSETS_DIR / os_entry["file"]
            if p.exists():
                sfx_layers.append((p, os_entry["volume_db"], False))

    if not sfx_layers:
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", str(round(total_dur, 3)),
            "-c:a", "libmp3lame", "-b:a", "128k",
            str(out_mp3),
        ], check=True, capture_output=True, timeout=30)
        return

    cmd_inputs: list[str] = []
    filter_parts: list[str] = []
    mix_labels: list[str] = []

    for i, (ogg, vol_db, loop) in enumerate(sfx_layers):
        lbl = f"s{i}"
        if loop:
            cmd_inputs += ["-stream_loop", "-1", "-t", str(total_dur + 1), "-i", str(ogg)]
            filter_parts.append(f"[{i}:a]atrim=duration={total_dur},volume={vol_db}dB[{lbl}]")
        else:
            cmd_inputs += ["-i", str(ogg)]
            filter_parts.append(f"[{i}:a]volume={vol_db}dB[{lbl}]")
        mix_labels.append(f"[{lbl}]")

    n = len(mix_labels)
    filter_parts.append(
        f"{''.join(mix_labels)}amix=inputs={n}:normalize=0:dropout_transition=0[aout]"
    )
    subprocess.run([
        "ffmpeg", "-y",
        *cmd_inputs,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[aout]",
        "-t", str(round(total_dur, 3)),
        "-c:a", "libmp3lame", "-b:a", "128k",
        str(out_mp3),
    ], check=True, capture_output=True, timeout=180)


def _mux_final(
    clean_mp4: pathlib.Path,
    voice_mp3: pathlib.Path,
    sfx_mp3: "pathlib.Path | None",
    out_mp4: pathlib.Path,
    total_dur: float,
) -> None:
    """clean 영상(무음) + 목소리 MP3 + SFX MP3 → 최종 MP4.

    sfx_mp3 있으면 voice+sfx amix, 없으면 voice 단독.
    clean_mp4 == out_mp4 인-플레이스도 내부 tmpdir로 안전 처리.
    """
    import shutil

    with tempfile.TemporaryDirectory() as _tmp:
        tmp_out = pathlib.Path(_tmp) / "final.mp4"

        if sfx_mp3 and sfx_mp3.exists():
            subprocess.run([
                "ffmpeg", "-y",
                "-i", str(clean_mp4),
                "-i", str(voice_mp3),
                "-i", str(sfx_mp3),
                "-filter_complex",
                "[1:a][2:a]amix=inputs=2:normalize=0:dropout_transition=0[aout]",
                "-map", "0:v", "-map", "[aout]",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", str(round(total_dur, 3)),
                str(tmp_out),
            ], check=True, capture_output=True, timeout=180)
        else:
            subprocess.run([
                "ffmpeg", "-y",
                "-i", str(clean_mp4),
                "-i", str(voice_mp3),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", str(round(total_dur, 3)),
                str(tmp_out),
            ], check=True, capture_output=True, timeout=180)

        shutil.move(str(tmp_out), str(out_mp4))


def _stage_sfx_assets(sfx_plan: "dict | None", out_dir: pathlib.Path) -> None:
    """sfx_plan에서 사용된 OGG 파일을 out_dir/sfx/ 로 복사 (이미 있으면 스킵).

    output/{series_code}/ch01/sfx/ambience/*.ogg
    output/{series_code}/ch01/sfx/bed/*.ogg
    output/{series_code}/ch01/sfx/oneshot/*.ogg
    """
    if not sfx_plan:
        return
    import shutil
    from services.sfx_service import SFX_ASSETS_DIR

    files: list[str] = []
    for key in ("ambience", "bed"):
        entry = sfx_plan.get(key)
        if entry:
            files.append(entry["file"])
    for os_entry in sfx_plan.get("oneshots", []):
        files.append(os_entry["file"])

    for rel in files:
        src = SFX_ASSETS_DIR / rel
        if not src.exists():
            continue
        dst = out_dir / "sfx" / rel
        if dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))


# ── Hybrid 처리 (lipsync + Ken Burns tail) ────────────────────────────────────

def _run_hybrid(
    img_path: pathlib.Path,
    lipsync_mp4: pathlib.Path,
    mp3_path: pathlib.Path,
    out_mp4: pathlib.Path,
    total_dur: float,
    lipsync_dur: float,
    effect: str,
    sfx_plan: "dict | None" = None,
    clean_out: "pathlib.Path | None" = None,
    sfx_mp3_out: "pathlib.Path | None" = None,
) -> None:
    """Lipsync MP4 1회 + Ken Burns tail + TTS 오디오 → 최종 MP4.

    clean_out 지정 시: 무음 클린 영상을 clean_out에 저장 (다국어 재더빙용).
    sfx_mp3_out 지정 시: SFX 전용 MP3를 sfx_mp3_out에 저장 (다국어 재더빙용).
    """
    import shutil as _sh

    tail_dur = max(0.1, total_dur - lipsync_dur)

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = pathlib.Path(tmp)

        # 1. Lipsync 재인코딩: 1920×1080, 30fps, 오디오 제거
        lipsync_fixed = tmpdir / "lipsync_fixed.mp4"
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(lipsync_mp4),
            "-vf", (
                "scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"
            ),
            "-r", str(FPS),
            "-an",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            str(lipsync_fixed),
        ], check=True, capture_output=True, timeout=120)

        # 2. Ken Burns tail 생성 — smooth=True: 5% 미세 줌
        tail_mp4 = tmpdir / "tail.mp4"
        _pillow_kenburns(img_path, tail_mp4, tail_dur, effect, smooth=True)

        # 3. Concat: lipsync_fixed + tail → 무음 클린 영상
        list_file = tmpdir / "list.txt"
        list_file.write_text(
            f"file '{lipsync_fixed}'\nfile '{tail_mp4}'\n",
            encoding="utf-8",
        )
        concat_mp4 = tmpdir / "concat.mp4"
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            str(concat_mp4),
        ], check=True, capture_output=True, timeout=300)

        # 다국어 대응: 클린 영상 별도 저장
        if clean_out:
            _sh.copy2(str(concat_mp4), str(clean_out))

        # SFX 전용 MP3 생성 (tmpdir 내) + 선택적 외부 저장
        sfx_tmp = tmpdir / "sfx_bgm.mp3"
        _mix_sfx_only(sfx_plan, sfx_tmp, total_dur)
        if sfx_mp3_out:
            _sh.copy2(str(sfx_tmp), str(sfx_mp3_out))

        # 4. 최종 mux: clean + voice + sfx → out_mp4
        _mux_final(concat_mp4, mp3_path, sfx_tmp, out_mp4, total_dur)


# ── 이미지 다운로드 유틸 ──────────────────────────────────────────────────────

async def _download_img(url: str, dest: pathlib.Path) -> None:
    """URL에서 이미지를 다운로드하여 dest 경로에 저장한다.

    httpx를 사용하므로 비동기 컨텍스트에서 호출해야 한다.
    리다이렉트(follow_redirects=True)를 허용하여 R2 presigned URL도 처리 가능.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(url, timeout=30)
        r.raise_for_status()
        dest.write_bytes(r.content)


# ── 단일 컷 처리 ─────────────────────────────────────────────────────────────

async def single_kenburns(
    series_id: str,
    scene_code: str,
    db,
    overwrite: bool = False,
) -> dict:
    """scene_code 1개만 Ken Burns / Hybrid 처리한다.

    분기 로직:
      - overwrite=True + lipsync_url 있음 → R2 원본 lipsync 강제 재처리 (hybrid overwrite)
      - overwrite=True + lipsync_url 없음 → 기존 MP4 삭제 후 일반 Ken Burns 재생성
      - overwrite=False + MP4 존재 + MP4가 mp3보다 0.5초 이상 짧음 → Hybrid
      - overwrite=False + MP4 없음 → 일반 Ken Burns

    Returns:
        {"ok": True/False, "mode": "ken_burns"|"hybrid"|..., "reason": "..."}
    """
    # 시리즈 코드 조회 (출력 폴더 경로 구성용)
    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code")
        .eq("id", series_id).single().execute()
    )
    series_code_val = (ser.data or {}).get("series_code") or series_id

    # scene_code에서 챕터 번호 추출 (예: "ch01s02nc03" → chapter=1)
    ch_match = __import__("re").search(r"ch(\d+)", scene_code)
    chapter = int(ch_match.group(1)) if ch_match else 1

    out_dir = OUTPUT_ROOT / series_code_val / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    from services.grid_crop_service import _normalize_scene_code
    file_code = _normalize_scene_code(scene_code)  # ch##s##nc## 파일명 기준

    mp3_path   = out_dir / f"{file_code}.mp3"
    mp4_path   = out_dir / f"{file_code}.mp4"
    img_path   = out_dir / f"{file_code}.png"
    clean_path = out_dir / f"{file_code}_clean.mp4"  # 무음 클린 영상 (다국어 대응)
    sfx_path   = out_dir / f"{file_code}_sfx.mp3"    # SFX+BGM 전용 (언어 무관)

    # TTS 파일이 없으면 처리 불가 (TTS 단계가 먼저 완료되어야 함)
    if not mp3_path.exists():
        return {"ok": False, "reason": "mp3 없음"}

    # TTS 길이 측정 (Ken Burns duration + hybrid tail 계산에 모두 사용)
    try:
        duration = await asyncio.to_thread(_probe_duration, mp3_path)
    except Exception as e:
        return {"ok": False, "reason": f"duration 측정 실패: {e}"}

    # PNG가 MP4보다 새 파일이면 자동 overwrite
    # 이미지를 교체했을 때 Ken Burns를 자동으로 재생성하기 위한 안전장치
    if not overwrite and img_path.exists() and mp4_path.exists():
        if img_path.stat().st_mtime > mp4_path.stat().st_mtime + 2:  # 2초 여유
            overwrite = True
            print(f"[kenburns] PNG가 MP4보다 새로움 → 자동 재생성: {scene_code}")

    # DB에서 씬 정보 조회 (lipsync_url, bg_url, scene_index, sfx용 scene_meta 포함)
    scene_res_base = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("bg_url,keyframe_url,scene_index,lipsync_url,scene_meta,text,type")
        .eq("series_id", series_id).eq("scene_code", scene_code).limit(1).execute()
    )
    scene_row = (scene_res_base.data or [{}])[0]

    from services.sfx_service import resolve_sfx_plan
    sfx_plan = resolve_sfx_plan(scene_row)
    _stage_sfx_assets(sfx_plan, out_dir)

    # ── overwrite 분기: 기존 MP4가 있을 때 강제 재처리 ──────────────────────
    if overwrite and mp4_path.exists():
        lipsync_url = scene_row.get("lipsync_url")
        if not lipsync_url:
            # 일반 Ken Burns 컷 — 기존 MP4를 head로 보존하고 tail만 추가
            try:
                mp4_dur = await asyncio.to_thread(_probe_duration, mp4_path)
            except Exception:
                mp4_path.unlink(missing_ok=True)  # 측정 불가 → 전체 재생성
                # fall through to general ken burns below
            else:
                tail = duration - mp4_dur
                if tail <= 0.5:
                    kb_marker = out_dir / f"{file_code}.kb_mode"
                    if not kb_marker.exists():
                        kb_marker.write_text("hybrid")
                    print(f"  [skip] {scene_code}  mp4({mp4_dur:.1f}s) >= mp3({duration:.1f}s) → 켄번스 없이 출력")
                    return {"ok": True, "reason": "mp4 길이 충분 — 켄번스 없이 출력", "mp4_dur": round(mp4_dur, 2)}
                if not img_path.exists():
                    img_url = scene_row.get("bg_url") or scene_row.get("keyframe_url")
                    if not img_url:
                        return {"ok": False, "reason": "이미지 없음"}
                    await _download_img(img_url, img_path)
                scene_index = scene_row.get("scene_index", 0)
                smooth_effect = "zoom_in"
                total_dur = duration + 0.5
                await asyncio.to_thread(
                    _run_hybrid, img_path, mp4_path, mp3_path, mp4_path,
                    total_dur, mp4_dur, smooth_effect, sfx_plan, clean_path, sfx_path,
                )
                tail_actual = total_dur - mp4_dur
                print(
                    f"  [done] {scene_code}  "
                    f"[hybrid kenburns({mp4_dur:.1f}s)+{smooth_effect}({tail_actual:.1f}s)]  "
                    f"total={total_dur:.1f}s"
                )
                (out_dir / f"{file_code}.kb_mode").write_text("hybrid")
                return {"ok": True, "mode": "hybrid_kenburns", "total": total_dur, "lipsync": mp4_dur, "tail": tail_actual}
        else:
            # lipsync 있는 컷 → R2 원본 lipsync 다운로드 후 hybrid overwrite
            with tempfile.TemporaryDirectory() as _tmp:
                orig_mp4 = pathlib.Path(_tmp) / "orig_lipsync.mp4"
                await _download_img(lipsync_url, orig_mp4)  # URL 다운로드 (재활용)
                mp4_dur = await asyncio.to_thread(_probe_duration, orig_mp4)
                tail = duration + 0.5 - mp4_dur

                # lipsync mp4 >= mp3+0.5s → 켄번스 없이 mp4 그대로 사용
                if tail <= 0.5:
                    kb_marker = out_dir / f"{file_code}.kb_mode"
                    if not kb_marker.exists():
                        kb_marker.write_text("hybrid")
                    print(f"  [skip] {scene_code}  lipsync({mp4_dur:.1f}s) >= mp3+0.5s({duration+0.5:.1f}s) → 켄번스 없이 출력")
                    return {"ok": True, "reason": "lipsync 길이 충분 — 켄번스 없이 출력", "mp4_dur": round(mp4_dur, 2)}

                # 배경 이미지 확보
                img_path = out_dir / f"{file_code}.png"
                if not img_path.exists():
                    img_url = scene_row.get("bg_url") or scene_row.get("keyframe_url")
                    if not img_url:
                        return {"ok": False, "reason": "이미지 없음"}
                    await _download_img(img_url, img_path)

                scene_index = scene_row.get("scene_index", 0)
                # hybrid tail: 짝수 씬 zoom_in, 홀수 씬 zoom_out
                smooth_effect = "zoom_in"
                total_dur = duration + 0.5

                await asyncio.to_thread(
                    _run_hybrid, img_path, orig_mp4, mp3_path, mp4_path,
                    total_dur, mp4_dur, smooth_effect, sfx_plan, clean_path, sfx_path,
                )
                tail_actual = total_dur - mp4_dur
                print(
                    f"  [done] {scene_code}  "
                    f"[overwrite hybrid lipsync({mp4_dur:.1f}s)+{smooth_effect}({tail_actual:.1f}s)]  "
                    f"total={total_dur:.1f}s"
                )
                (out_dir / f"{file_code}.kb_mode").write_text("hybrid")
                return {
                    "ok": True,
                    "mode": "hybrid_overwrite",
                    "total": total_dur,
                    "lipsync": mp4_dur,
                    "tail": tail_actual,
                }

    # ── Hybrid 분기: 기존 MP4가 TTS보다 짧을 때 ─────────────────────────────
    if mp4_path.exists():
        try:
            mp4_dur = await asyncio.to_thread(_probe_duration, mp4_path)
        except Exception:
            return {"ok": False, "reason": "mp4 duration 측정 실패"}

        tail = duration - mp4_dur
        # mp4 >= mp3 → 켄번스 추가 없이 mp4 그대로 사용 (kb_mode 마커만 기록)
        if tail <= 0.5:
            kb_marker = out_dir / f"{file_code}.kb_mode"
            if not kb_marker.exists():
                kb_marker.write_text("hybrid")
            print(f"  [skip] {scene_code}  mp4({mp4_dur:.1f}s) >= mp3({duration:.1f}s) → 켄번스 없이 출력")
            return {"ok": True, "reason": "mp4 길이 충분 — 켄번스 없이 출력", "mp4_dur": round(mp4_dur, 2)}

        # 배경 이미지 확보 (tail Ken Burns용)
        img_path = out_dir / f"{file_code}.png"
        if not img_path.exists():
            scene_res = await asyncio.to_thread(
                lambda: db.table("v3_scenes").select("bg_url,keyframe_url,scene_index")
                .eq("series_id", series_id).eq("scene_code", scene_code).limit(1).execute()
            )
            row = (scene_res.data or [{}])[0]
            img_url = row.get("bg_url") or row.get("keyframe_url")
            if not img_url:
                return {"ok": False, "reason": "이미지 없음"}
            await _download_img(img_url, img_path)

        # scene_index 조회 (smooth_effect 결정용)
        scene_res2 = await asyncio.to_thread(
            lambda: db.table("v3_scenes").select("scene_index")
            .eq("series_id", series_id).eq("scene_code", scene_code).limit(1).execute()
        )
        scene_index = ((scene_res2.data or [{}])[0]).get("scene_index", 0)
        smooth_effect = "zoom_in"
        total_dur = duration + 0.5  # mp3 길이 + 0.5초 여유

        await asyncio.to_thread(
            _run_hybrid, img_path, mp4_path, mp3_path, mp4_path,
            total_dur, mp4_dur, smooth_effect, sfx_plan, clean_path, sfx_path,
        )
        tail_actual = total_dur - mp4_dur
        print(
            f"  [done] {scene_code}  "
            f"[hybrid lipsync({mp4_dur:.1f}s)+{smooth_effect}({tail_actual:.1f}s)]  "
            f"total={total_dur:.1f}s"
        )
        (out_dir / f"{file_code}.kb_mode").write_text("hybrid")
        return {"ok": True, "mode": "hybrid", "total": total_dur, "lipsync": mp4_dur, "tail": tail_actual}

    # ── 일반 Ken Burns 분기 ──────────────────────────────────────────────────
    img_path = out_dir / f"{file_code}.png"
    if not img_path.exists():
        scene_res = await asyncio.to_thread(
            lambda: db.table("v3_scenes").select("bg_url,keyframe_url,scene_index")
            .eq("series_id", series_id).eq("scene_code", scene_code).limit(1).execute()
        )
        row = (scene_res.data or [{}])[0]
        img_url = row.get("bg_url") or row.get("keyframe_url")
        if not img_url:
            return {"ok": False, "reason": "이미지 없음"}
        await _download_img(img_url, img_path)

    # scene_index로 효과 결정
    scene_res3 = await asyncio.to_thread(
        lambda: db.table("v3_scenes").select("scene_index")
        .eq("series_id", series_id).eq("scene_code", scene_code).limit(1).execute()
    )
    scene_index = ((scene_res3.data or [{}])[0]).get("scene_index", 0)
    effect = _pick_effect(scene_index)

    # Pillow 기반 Ken Burns 생성 (Phase 2 핵심) — 영상만(silent)
    # +0.5s 여유: TTS 마지막 음절이 영상 끝에 씹히는 현상 방지
    total_dur = duration + 0.5
    await asyncio.to_thread(_pillow_kenburns, img_path, clean_path, total_dur, effect)
    await asyncio.to_thread(_mix_sfx_only, sfx_plan, sfx_path, total_dur)
    await asyncio.to_thread(_mux_final, clean_path, mp3_path, sfx_path, mp4_path, total_dur)
    print(f"  [done] {scene_code}  [{effect}]  {total_dur:.1f}s (mp3={duration:.1f}s+0.5)")
    (out_dir / f"{file_code}.kb_mode").write_text("ken_burns")
    return {"ok": True, "mode": "ken_burns", "total": total_dur}


# ── 메인 배치 함수 ────────────────────────────────────────────────────────────

async def batch_kenburns(
    series_id: str,
    chapter: int,
    db,
    overwrite: bool = False,
) -> dict:
    """챕터 전체 씬에 대해 MP3+이미지 → Ken Burns MP4 자동 생성 (배치).

    Hybrid 모드:
      기존 MP4(립싱크)가 TTS보다 0.5초 이상 짧으면
      → [lipsync 1회] + [Ken Burns tail] + TTS 오디오 mux

    처리 순서 (씬별):
      1. MP3 없음 → 스킵 (TTS 미완료)
      2. MP4 있고 overwrite=False → hybrid 판단
         2a. MP4가 TTS보다 0.5s 이상 짧음 → _run_hybrid
         2b. 충분히 긴 경우 → 스킵
      3. MP4 없음 또는 overwrite=True → _pillow_kenburns (일반 Ken Burns)

    Args:
        series_id: Supabase v3_series.id
        chapter:   챕터 번호 (예: 1)
        db:        Supabase 클라이언트
        overwrite: True이면 기존 MP4도 재생성

    Returns:
        {"processed": N, "skipped": N, "errors": ["scene_code: 이유", ...]}
    """
    # 출력 폴더 구성
    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code")
        .eq("id", series_id).single().execute()
    )
    series_code = (ser.data or {}).get("series_code") or series_id
    out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 챕터 내 전체 씬 목록 조회 (scene_index, cut_index 순 정렬)
    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes").select("*")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index").order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []

    result = {"processed": 0, "skipped": 0, "errors": []}

    from services.sfx_service import resolve_sfx_plan

    for scene in scenes:
        raw_code = scene.get("scene_code", "")
        if not raw_code:
            result["skipped"] += 1
            continue
        from services.grid_crop_service import _normalize_scene_code
        code = _normalize_scene_code(raw_code)
        sfx_plan = resolve_sfx_plan(scene)
        _stage_sfx_assets(sfx_plan, out_dir)

        mp3_path   = out_dir / f"{code}.mp3"
        mp4_path   = out_dir / f"{code}.mp4"
        clean_path = out_dir / f"{code}_clean.mp4"
        sfx_path   = out_dir / f"{code}_sfx.mp3"

        # MP3 없으면 스킵 (TTS 단계 미완료)
        if not mp3_path.exists():
            result["skipped"] += 1
            continue

        # TTS 길이 측정
        try:
            duration = await asyncio.to_thread(_probe_duration, mp3_path)
        except Exception as e:
            result["errors"].append(f"{code}: duration 측정 실패 — {e}")
            continue

        # ── 기존 MP4 존재 시: hybrid 판단 ────────────────────────────────────
        if mp4_path.exists() and not overwrite:
            try:
                mp4_dur = await asyncio.to_thread(_probe_duration, mp4_path)
            except Exception:
                result["skipped"] += 1
                continue

            tail = duration - mp4_dur
            if tail <= 0.5:
                # MP4가 TTS와 비슷하거나 더 길면 스킵 (이미 충분한 길이)
                result["skipped"] += 1
                continue

            # Hybrid: 배경 이미지 확보 후 lipsync+tail 합성
            img_path = out_dir / f"{code}.png"
            if not img_path.exists():
                img_url = scene.get("bg_url") or scene.get("keyframe_url")
                if not img_url:
                    result["errors"].append(f"{code}: 이미지 없음 (hybrid)")
                    continue
                try:
                    await _download_img(img_url, img_path)
                except Exception as e:
                    result["errors"].append(f"{code}: 이미지 다운로드 실패 — {e}")
                    continue

            scene_index = scene.get("scene_index", 0)
            smooth_effect = "zoom_in"
            total_dur = duration + 0.5  # mp3 + 0.5초

            try:
                await asyncio.to_thread(
                    _run_hybrid,
                    img_path, mp4_path, mp3_path, mp4_path,
                    total_dur, mp4_dur, smooth_effect, sfx_plan, clean_path, sfx_path,
                )
                result["processed"] += 1
                tail_actual = total_dur - mp4_dur
                print(
                    f"  [done] {code}  "
                    f"[hybrid lipsync({mp4_dur:.1f}s)+{smooth_effect}({tail_actual:.1f}s)]  "
                    f"total={total_dur:.1f}s"
                )
            except Exception as e:
                result["errors"].append(f"{code}: hybrid MP4 생성 실패 — {e}")
            continue  # hybrid 처리 완료 → 이하 일반 Ken Burns 로직 건너뜀

        # ── 일반 Ken Burns ────────────────────────────────────────────────────
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

        effect = _pick_effect(scene.get("scene_index", 0))
        try:
            # Pillow 기반 Ken Burns 생성 (Phase 2 핵심) — 영상만(silent)
            # +0.5s 여유: TTS 마지막 음절이 영상 끝에 씹히는 현상 방지
            total_dur = duration + 0.5
            await asyncio.to_thread(_pillow_kenburns, img_path, clean_path, total_dur, effect)
            await asyncio.to_thread(_mix_sfx_only, sfx_plan, sfx_path, total_dur)
            await asyncio.to_thread(_mux_final, clean_path, mp3_path, sfx_path, mp4_path, total_dur)
            result["processed"] += 1
            print(f"  [done] {code}  [{effect}]  {total_dur:.1f}s (mp3={duration:.1f}s+0.5)")
        except Exception as e:
            result["errors"].append(f"{code}: MP4 생성 실패 — {e}")

    return result
