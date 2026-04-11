"""TTS 서비스 — edge-tts 씬별 병렬 생성 + R2 업로드"""
import asyncio
import json
import re
import tempfile
from pathlib import Path
from core.config import settings
from core.database import get_supabase
from agent.generation_queue import get_tts_queue

# 기본 나레이션 음성
_DEFAULT_VOICE  = "ko-KR-SunHiNeural"
_NARRATOR_VOICE = "ko-KR-InJoonNeural"  # 중성적 나레이터

# ─────────────────────────────────────────────────────────────────────────────
# edge-tts 한국어 목소리: 총 9개 (남4 + 여5) — 이게 전부입니다
# ─────────────────────────────────────────────────────────────────────────────
# 남성 4개:
#   BongJinNeural  — 중후한 중년 남성 (50대급, 낮고 무게감)
#   GookMinNeural  — 젊은 남성 (20~30대, 가장 어린 느낌)
#   InJoonNeural   — 나레이터급 전문직 남성 (안정적, 중립)
#   HyunsuNeural   — 단단하고 강한 남성 (에너지·긴장감)
#
# 여성 5개:
#   SunHiNeural    — 따뜻한 여성 표준 (아내·어머니·주인공)
#   JiMinNeural    — 밝은 젊은 여성 (20대 활기)
#   YuJinNeural    — 활동적 여성 (직장인·적극적)
#   SeoHyeonNeural — 조용한 젊은 여성 (내성적·섬세)
#   SoonBokNeural  — 중년/시니어 여성 (60대+ 느낌)
# ─────────────────────────────────────────────────────────────────────────────

# 캐릭터 voice_id → edge-tts 음성명 매핑
# 캐릭터 JSON의 voice_id 필드에 입력하는 값을 키로 사용
VOICE_MAP: dict[str, str] = {
    # ── 9개 기본 별칭 (권장) ─────────────────────────────────────────────────
    "bongjin":    "ko-KR-BongJinNeural",    # 중후한 남성 (50대급)
    "gookmin":    "ko-KR-GookMinNeural",    # 젊은 남성 (20~30대)
    "injoon":     "ko-KR-InJoonNeural",     # 나레이터급 전문직 남성
    "hyunsu":     "ko-KR-HyunsuNeural",     # 단단한 강한 남성
    "sunhi":      "ko-KR-SunHiNeural",      # 따뜻한 여성 (표준)
    "jimin":      "ko-KR-JiMinNeural",      # 밝은 여성 (20대)
    "yujin":      "ko-KR-YuJinNeural",      # 활동적 여성
    "seohyeon":   "ko-KR-SeoHyeonNeural",   # 조용한 여성 (섬세)
    "soonbok":    "ko-KR-SoonBokNeural",    # 중년/시니어 여성

    # ── 하위 호환 별칭 (기존 JSON의 voice_id 값 유지) ────────────────────────
    "andrew":     "ko-KR-BongJinNeural",
    "dohyun":     "ko-KR-GookMinNeural",
    "gwangsu":    "ko-KR-InJoonNeural",
    "harrison":   "ko-KR-HyunsuNeural",
    "angelina":   "ko-KR-SunHiNeural",
    "chiki":      "ko-KR-JiMinNeural",
    "dayun":      "ko-KR-YuJinNeural",
    "grace":      "ko-KR-SeoHyeonNeural",
    "jihu":       "ko-KR-JiMinNeural",
    "misook":     "ko-KR-SoonBokNeural",
    "tilly":      "ko-KR-YuJinNeural",
}

# 엑스트라(캐스팅 외) 화자 → edge-tts 폴백 목소리
# 키 형식: "{age_group}_{gender}" 또는 "{gender}"
# speaker_age_group: teen / young / adult / elder / child
# speaker_gender: male / female
EXTRA_VOICE_MAP: dict[str, str] = {
    # 성별만 지정된 경우 (기본 폴백)
    "male":              "ko-KR-InJoonNeural",     # 성인 남성 기본
    "female":            "ko-KR-SunHiNeural",      # 성인 여성 기본

    # 나이대 + 성별 조합 ─────────────────────────────────────────────────────
    # 청소년 (10대)
    "teen_male":         "ko-KR-GookMinNeural",    # 10대 남
    "teen_female":       "ko-KR-JiMinNeural",      # 10대 여

    # 청년 (20~30대)
    "young_male":        "ko-KR-GookMinNeural",    # 20~30대 남
    "young_female":      "ko-KR-YuJinNeural",      # 20~30대 여 (활동적)

    # 중년 (40~50대)
    "adult_male":        "ko-KR-BongJinNeural",    # 40~50대 남
    "adult_female":      "ko-KR-SunHiNeural",      # 40~50대 여

    # 시니어 (60대+)
    "elder_male":        "ko-KR-BongJinNeural",    # 60대+ 남
    "elder_female":      "ko-KR-SoonBokNeural",    # 60대+ 여

    # 아동
    "child_male":        "ko-KR-GookMinNeural",    # 아동 남
    "child_female":      "ko-KR-JiMinNeural",      # 아동 여
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
_SUPERTONE_BASE = "https://api.supertoneapi.com"


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

    # tts_voice 컬럼 우선 사용 (script_service가 speaker → voice 해석해서 저장)
    # 없으면 기본 나레이터 음성 폴백
    voice = scene.get("tts_voice") or _NARRATOR_VOICE

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
            r2_key_mp3 = f"v3/{series_id}/tts/ch{scene['chapter']}_s{scene['scene_index']}c{cut_idx}.mp3"
            r2_key_srt = f"v3/{series_id}/tts/ch{scene['chapter']}_s{scene['scene_index']}c{cut_idx}.srt"

            tts_url = await asyncio.to_thread(_upload_r2, str(mp3_path), r2_key_mp3)
            srt_url = await asyncio.to_thread(_upload_r2, str(srt_path), r2_key_srt)

        # DB 갱신
        await asyncio.to_thread(
            lambda: db.table("v3_scenes").update({
                "tts_url": tts_url,
                "srt_url": srt_url,
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


def _make_srt(word_events: list[dict], output_path: str, words_per_chunk: int = 5):
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


def _upload_r2(local_path: str, r2_key: str) -> str:
    """로컬 파일 → R2 업로드 → Public URL 반환"""
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
    )
    _EXT_TYPES = {".mp3": "audio/mpeg", ".srt": "text/plain", ".png": "image/png", ".mp4": "video/mp4"}
    ext = Path(local_path).suffix.lower()
    content_type = _EXT_TYPES.get(ext, "application/octet-stream")
    s3.upload_file(
        local_path,
        settings.R2_BUCKET,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{settings.R2_PUBLIC_URL}/{r2_key}"
