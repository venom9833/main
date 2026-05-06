"""영상/오디오 → SRT 전사 라우터

POST /api/v1/transcribe
- 30분 이하 영상·오디오 파일 업로드
- FFmpeg 오디오 추출 → faster-whisper 전사 → SRT 반환
"""
import pathlib
import subprocess
import tempfile
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

router = APIRouter()

MAX_DURATION_SEC = 30 * 60  # 30분
SUPPORTED_EXTS = {".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".mp3", ".m4a", ".wav", ".aac"}

WHISPER_MODEL = "small"  # tiny|base|small|medium|large
_model_cache: dict = {}


def _get_model(model_size: str):
    if model_size not in _model_cache:
        from faster_whisper import WhisperModel
        _model_cache[model_size] = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _model_cache[model_size]


def _probe_duration(path: str) -> float:
    """ffprobe로 미디어 길이(초) 반환. 실패 시 0."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _extract_audio(src: str, dst: str) -> None:
    """FFmpeg로 오디오만 추출 → 16kHz mono WAV"""
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", src,
            "-vn", "-ar", "16000", "-ac", "1",
            "-f", "wav", dst,
        ],
        check=True, capture_output=True, timeout=120,
    )


def _to_srt(segments) -> str:
    lines = []
    for i, seg in enumerate(segments, 1):
        start = _fmt_ts(seg.start)
        end = _fmt_ts(seg.end)
        text = seg.text.strip()
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _fmt_ts(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@router.post("/api/v1/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("ko"),
    model: str = Form(WHISPER_MODEL),
):
    """영상/오디오 → SRT 다운로드

    - file: 영상·오디오 파일 (30분 이하)
    - language: 언어 코드 (ko/en/ja/zh…, 기본 ko)
    - model: whisper 모델 (tiny/base/small/medium, 기본 small)
    """
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTS:
        raise HTTPException(400, f"지원하지 않는 형식: {suffix}. 지원: {', '.join(sorted(SUPPORTED_EXTS))}")

    if model not in {"tiny", "base", "small", "medium", "large"}:
        model = WHISPER_MODEL

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = pathlib.Path(tmpdir)
        src_path = str(tmp / f"input{suffix}")
        wav_path = str(tmp / "audio.wav")

        # 1. 파일 저장
        content = await file.read()
        (tmp / f"input{suffix}").write_bytes(content)

        # 2. 길이 검사
        duration = _probe_duration(src_path)
        if duration > MAX_DURATION_SEC:
            mins = int(duration // 60)
            raise HTTPException(400, f"영상 길이 {mins}분 — 30분 이하만 지원합니다")

        # 3. 오디오 추출 (이미 오디오 파일이면 그대로 복사)
        if suffix in {".mp3", ".m4a", ".wav", ".aac"}:
            import shutil
            shutil.copy(src_path, wav_path)
            # WAV가 아닌 오디오도 변환
            if suffix != ".wav":
                _extract_audio(src_path, wav_path)
        else:
            _extract_audio(src_path, wav_path)

        # 4. 전사
        whisper_model = _get_model(model)
        segments_gen, _ = whisper_model.transcribe(
            wav_path,
            language=language if language != "auto" else None,
            beam_size=5,
            vad_filter=True,
        )
        segments = list(segments_gen)

        # 5. SRT 생성
        srt_content = _to_srt(segments)
        stem = pathlib.Path(file.filename or "transcript").stem

    return Response(
        content=srt_content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{stem}.srt"'},
    )
