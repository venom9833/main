"""TTS 서비스 — edge-tts 씬별 병렬 생성 + R2 업로드"""
import asyncio
import json
import re
import subprocess
import tempfile
from pathlib import Path
from core.config import settings
from core.database import get_supabase
from agent.generation_queue import get_tts_queue

# ─────────────────────────────────────────────────────────────────────────────
# edge-tts 한국어 나레이터 목소리 (나레이션 컷 전용 — ttsGender 설정 기준)
#   여성: SunHiNeural
#   남성: HyunsuMultilingualNeural
# ─────────────────────────────────────────────────────────────────────────────
_MALE_VOICE   = "ko-KR-HyunsuMultilingualNeural"   # 남성 나레이터
_FEMALE_VOICE = "ko-KR-SunHiNeural"                # 여성 나레이터 (기본)

_DEFAULT_VOICE  = _FEMALE_VOICE   # 성별 미지정 기본값
_NARRATOR_VOICE = _FEMALE_VOICE   # 나레이터 기본값 (ttsGender 미지정 시)

# 캐릭터 voice_id → edge-tts 음성명 매핑
# 성별 기준으로 2개로 수렴 (MS edge-tts 한국어 음성 축소에 따른 정책 변경)
VOICE_MAP: dict[str, str] = {
    # ── 현재 별칭 ────────────────────────────────────────────────────────────
    "hyunsu":     _MALE_VOICE,     # 남성
    "sunhi":      _FEMALE_VOICE,   # 여성

    # ── 하위 호환 — 기존 캐릭터 JSON voice_id 값 → 성별 기준 리매핑 ──────────
    # 남성 계열
    "bongjin":    _MALE_VOICE,
    "gookmin":    _MALE_VOICE,
    "injoon":     _MALE_VOICE,
    "andrew":     _MALE_VOICE,
    "dohyun":     _MALE_VOICE,
    "gwangsu":    _MALE_VOICE,
    "harrison":   _MALE_VOICE,
    # 여성 계열
    "angelina":   _FEMALE_VOICE,
    "chiki":      _FEMALE_VOICE,
    "dayun":      _FEMALE_VOICE,
    "grace":      _FEMALE_VOICE,
    "jihu":       _FEMALE_VOICE,
    "jimin":      _FEMALE_VOICE,
    "misook":     _FEMALE_VOICE,
    "seohyeon":   _FEMALE_VOICE,
    "soonbok":    _FEMALE_VOICE,
    "tilly":      _FEMALE_VOICE,
    "yujin":      _FEMALE_VOICE,
}

# 엑스트라(캐스팅 외) 화자 → edge-tts 폴백 목소리
EXTRA_VOICE_MAP: dict[str, str] = {
    "male":        _MALE_VOICE,
    "female":      _FEMALE_VOICE,
    "teen_male":   _MALE_VOICE,
    "teen_female": _FEMALE_VOICE,
    "young_male":  _MALE_VOICE,
    "young_female":_FEMALE_VOICE,
    "adult_male":  _MALE_VOICE,
    "adult_female":_FEMALE_VOICE,
    "elder_male":  _MALE_VOICE,
    "elder_female":_FEMALE_VOICE,
    "child_male":  _MALE_VOICE,
    "child_female":_FEMALE_VOICE,
}


def resolve_voice(voice_id: str | None) -> str:
    """캐릭터 voice_id → edge-tts 음성명 반환. 없으면 기본값."""
    if not voice_id:
        return _DEFAULT_VOICE
    return VOICE_MAP.get(voice_id.lower(), _DEFAULT_VOICE)


# ─────────────────────────────────────────────────────────────────────────────
# Supertone API
# tts_voice 컬럼에 "st:{supertone_voice_id}" 형식으로 저장되면 이 경로 사용
# ─────────────────────────────────────────────────────────────────────────────
_SUPERTONE_BASE = "https://supertoneapi.com"


def _supertone_tts_sync(text: str, voice_id: str, output_path: str, style: str = "neutral") -> None:
    """Supertone REST API 호출 → MP3 저장 (동기)"""
    import requests
    from core.config import settings as _s

    clean = re.sub(r'\[IMAGE[^\]]*\]|\[HOOK\]|///', '', text)
    clean = re.sub(r'["""]', '', clean).strip()
    if not clean:
        clean = "내용이 없습니다."

    url = f"{_SUPERTONE_BASE}/v1/text-to-speech/{voice_id}"
    headers = {
        "x-sup-api-key": _s.SUPERTONE_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload: dict = {"text": clean, "language": "ko"}
    if style and style != "neutral":
        payload["style"] = style

    resp = requests.post(url, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    Path(output_path).write_bytes(resp.content)


async def _supertone_tts(text: str, voice_id: str, output_path: str, style: str = "neutral") -> list[dict]:
    """Supertone TTS → MP3 저장. 단어 타이밍은 미지원 → 빈 리스트 반환 (SRT 생략)"""
    await asyncio.to_thread(_supertone_tts_sync, text, voice_id, output_path, style)
    return []


async def run_tts(series_id: str) -> dict:
    """전체 씬 병렬 TTS 생성"""
    db = get_supabase()

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("id,chapter,scene_index,cut_index,text,status,scene_meta,tts_voice")
        .eq("series_id", series_id)
        .in_("status", ["pending", "keyframe_done"])
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return {"ok": True, "note": "처리할 씬 없음"}

    queue = get_tts_queue()

    tasks = [
        queue.enqueue(
            f"{series_id}_tts_ch{s['chapter']}_s{s['scene_index']}c{s.get('cut_index', 1)}",
            _generate_scene_tts,
            series_id,
            s,
            db,
            priority=s["scene_index"] * 100 + s.get("cut_index", 1),
        )
        for s in scenes
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    return {"ok": True, "scenes": len(scenes)}


_MIN_TTS_CHARS = 15  # 이 글자수 미만은 TTS 오류 빈발 → 스킵 처리


async def _generate_scene_tts(series_id: str, scene: dict, db):
    """씬 1개 TTS 생성 → R2 업로드 → DB 갱신"""
    scene_id = scene["id"]
    text = (scene.get("text") or "").strip()
    if not text:
        return

    # 짧은 대사 스킵 — 프롬프트 규칙(9번)으로 방지하지만, 혹시 통과된 경우 방어
    clean_check = re.sub(r'\[IMAGE[^\]]*\]|\[HOOK\]|///', '', text).strip()
    clean_check = re.sub(r'["""\s]', '', clean_check)
    if len(clean_check) < _MIN_TTS_CHARS:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "status": "short_skipped",
                "error_detail": f"대사 너무 짧음 ({len(clean_check)}자 < {_MIN_TTS_CHARS}자) — TTS 생략",
            }).eq("id", scene_id).execute()
        )
        return

    # tts_voice 컬럼 우선 사용
    # - Supertone(st:) → 캐릭터 고유 성우 → 그대로 사용
    # - edge-tts(ko-KR-*) 또는 없음 → 나레이션용 edge-tts: 시리즈 ttsGender 기준
    raw_voice = scene.get("tts_voice") or ""
    if raw_voice.startswith("st:"):
        voice = raw_voice
    else:
        # 나레이션 컷 — 시리즈 ttsGender 설정으로 edge-tts 성별 결정
        ser_res = await asyncio.to_thread(
            lambda: db.table("v3_series").select("settings").eq("id", series_id).single().execute()
        )
        tts_gender = ((ser_res.data or {}).get("settings") or {}).get("ttsGender", "female")
        voice = _MALE_VOICE if tts_gender == "male" else _FEMALE_VOICE

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            mp3_path = Path(tmpdir) / f"scene_{scene_id}.mp3"
            srt_path = Path(tmpdir) / f"scene_{scene_id}.srt"

            # TTS 생성 — Supertone("st:{id}") vs edge-tts 자동 분기
            if voice.startswith("st:"):
                # st:{voice_id} 또는 st:{voice_id}:{style}
                st_part = voice[3:]
                st_parts = st_part.split(":", 1)
                st_voice_id = st_parts[0]
                st_style = st_parts[1] if len(st_parts) > 1 else "neutral"
                word_events = await _supertone_tts(text, st_voice_id, str(mp3_path), style=st_style)
            else:
                word_events = await _edge_tts(text, str(mp3_path), voice=voice)

            # SRT 생성 (Supertone은 타이밍 없으므로 빈 파일)
            _make_srt(word_events, str(srt_path))

            # R2 업로드
            cut_idx = scene.get("cut_index", 1)
            r2_prefix = f"v3/{series_id}/tts/ch{scene['chapter']}_s{scene['scene_index']}c{cut_idx}"
            r2_key_mp3 = f"{r2_prefix}.mp3"
            r2_key_srt = f"{r2_prefix}.srt"
            r2_key_wav = f"{r2_prefix}.wav"

            # MP3→WAV 변환 (ffmpeg)
            wav_path = Path(tmpdir) / f"scene_{scene_id}.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(mp3_path), str(wav_path)],
                check=True,
                capture_output=True,
            )

            tts_url, srt_url, wav_url = await asyncio.gather(
                asyncio.to_thread(_upload_r2, str(mp3_path), r2_key_mp3),
                asyncio.to_thread(_upload_r2, str(srt_path), r2_key_srt),
                asyncio.to_thread(_upload_r2, str(wav_path), r2_key_wav),
            )

        # DB 갱신
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "tts_url": tts_url,
                "srt_url": srt_url,
                "wav_url": wav_url,
                "status": "tts_done",
            }).eq("id", scene_id).execute()
        )
    except Exception as e:
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "status": "failed",
                "error_detail": f"TTS 실패: {e}",
            }).eq("id", scene_id).execute()
        )
        raise


async def _edge_tts(text: str, output_path: str, voice: str = _DEFAULT_VOICE) -> list[dict]:
    """edge-tts MP3 생성 + 단어 타이밍 반환"""
    import edge_tts
    clean = re.sub(r'\[IMAGE[^\]]*\]|\[HOOK\]|///', '', text)
    # 대사 따옴표 제거 — edge-tts가 따옴표를 읽어버리는 문제 방지
    # 쌍따옴표 " " 및 " " (한국어 열림/닫힘) 모두 제거
    clean = re.sub(r'["""]', '', clean).strip()
    if not clean:
        clean = "내용이 없습니다."

    communicate = edge_tts.Communicate(clean, voice)
    audio_chunks: list[bytes] = []
    sentence_events: list[dict] = []

    async for event in communicate.stream():
        if event["type"] == "audio":
            audio_chunks.append(event["data"])
        elif event["type"] == "SentenceBoundary":
            sentence_events.append(event)

    with open(output_path, "wb") as f:
        for chunk in audio_chunks:
            f.write(chunk)

    return _sentence_boundary_to_words(sentence_events)


def _sentence_boundary_to_words(events: list[dict]) -> list[dict]:
    """SentenceBoundary 이벤트 → 단어 타이밍 리스트"""
    words = []
    for ev in events:
        text = ev.get("text", "").strip()
        offset = ev.get("offset", 0) / 10_000_000  # 100ns → 초
        duration = ev.get("duration", 0) / 10_000_000
        for word in text.split():
            words.append({"word": word, "start": offset, "end": offset + duration})
            offset += duration / max(len(text.split()), 1)
    return words


def _make_srt(word_events: list[dict], output_path: str, words_per_chunk: int = 3):
    """단어 타이밍 → SRT 자막 파일"""
    def _fmt(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        ms = int((sec % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines = []
    idx = 1
    for i in range(0, len(word_events), words_per_chunk):
        chunk = word_events[i:i + words_per_chunk]
        if not chunk:
            continue
        start = chunk[0]["start"]
        end = chunk[-1]["end"]
        text = " ".join(w["word"] for w in chunk)
        lines.append(f"{idx}\n{_fmt(start)} --> {_fmt(end)}\n{text}\n")
        idx += 1

    Path(output_path).write_text("\n".join(lines), encoding="utf-8")


def _upload_r2(local_path: str, r2_key: str, *, assets: bool = False) -> str:
    """로컬 파일 → R2 업로드 → Public URL 반환.

    assets=True: R2_ASSETS_BUCKET / R2_ASSETS_PUBLIC_URL (공용 에셋 버킷)
    assets=False: R2_BUCKET / R2_PUBLIC_URL (시리즈 콘텐츠 버킷, 기본값)
    """
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
    )
    _EXT_TYPES = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
        ".srt": "text/plain", ".png": "image/png", ".mp4": "video/mp4",
    }
    ext = Path(local_path).suffix.lower()
    content_type = _EXT_TYPES.get(ext, "application/octet-stream")
    bucket = settings.R2_ASSETS_BUCKET if assets else settings.R2_BUCKET
    public_url = settings.R2_ASSETS_PUBLIC_URL if assets else settings.R2_PUBLIC_URL
    s3.upload_file(
        local_path,
        bucket,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{public_url}/{r2_key}"
