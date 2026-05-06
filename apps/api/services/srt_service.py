"""srt_service.py — 챕터 SRT 병합 + 다국어 번역 + KR 번인

컷별 srt_url → 타임스탬프 오프셋 누적 → 챕터 단위 SRT
call_free_llm() 배치 번역 (LD-011 준수)
KR: FFmpeg subtitles 필터로 영상에 직접 burn-in
EN/JP: 소프트 자막 트랙 (YouTube captions.insert)
"""
import asyncio
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import httpx

from core.database import get_supabase


# ── SRT 파싱 / 직렬화 ────────────────────────────────────────────────────────

@dataclass
class _Entry:
    start: float  # seconds
    end: float
    text: str


def _ts_to_sec(ts: str) -> float:
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def _sec_to_ts(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec % 1) * 1000))
    if ms >= 1000:
        ms = 999
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_srt(content: str) -> list[_Entry]:
    entries = []
    for block in re.split(r"\n\n+", content.strip()):
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue
        m = re.match(r"(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})", lines[1])
        if not m:
            continue
        entries.append(_Entry(
            start=_ts_to_sec(m.group(1)),
            end=_ts_to_sec(m.group(2)),
            text="\n".join(lines[2:]),
        ))
    return entries


def _entries_to_srt(entries: list[_Entry]) -> str:
    parts = []
    for i, e in enumerate(entries, 1):
        parts.append(f"{i}\n{_sec_to_ts(e.start)} --> {_sec_to_ts(e.end)}\n{e.text}")
    return "\n\n".join(parts) + "\n"


async def _fetch_srt(url: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


# ── 챕터 SRT 병합 ────────────────────────────────────────────────────────────

async def merge_chapter_srt(series_id: str, chapter: int, lang: str = "kr") -> str | None:
    """DB text + clip_durations.json → 챕터 단위 SRT 문자열 반환.

    clip_durations.json(렌더 파이프라인 실측값) 우선 사용.
    파일 없으면 DB duration_seconds + 0.5s fallback.
    타이밍 오프셋은 실측 클립 길이 누적 — 자막 end는 실측 + 0.5s (씹힘 방지).
    HOOK 2개 등장(LD-001) 그대로 유지.
    """
    import json as _json
    from services.render_service import OUTPUT_ROOT

    db = get_supabase()

    ser_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code")
        .eq("id", series_id).single().execute()
    )
    series_code = (ser_res.data or {}).get("series_code") or series_id

    scenes_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("scene_code,text,duration_seconds")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .order("scene_index").order("cut_index")
        .execute()
    )
    scenes = scenes_res.data or []
    if not scenes:
        return None

    # clip_durations.json 탐색 — 렌더 후 실측값
    ch_label = f"ch{chapter:02d}"
    dur_path = OUTPUT_ROOT / series_code / ch_label / lang / f"{ch_label}_clip_durations.json"
    clip_dur_map: dict[str, float] = {}
    if dur_path.exists():
        try:
            data = _json.loads(dur_path.read_text(encoding="utf-8"))
            for item in data.get("clips", []):
                sc = item.get("scene_code", "")
                dur = item.get("duration", 0)
                if sc and dur > 0:
                    clip_dur_map[sc] = float(dur)
        except Exception:
            pass

    merged: list[_Entry] = []
    offset = 0.0
    _SRT_TAIL = 0.5  # 자막을 실측 끝보다 0.5s 더 표시 — 음성 끝부분 씹힘 방지

    for scene in scenes:
        text = (scene.get("text") or "").strip()
        raw_code = scene.get("scene_code") or ""

        if raw_code in clip_dur_map:
            clip_dur = clip_dur_map[raw_code]       # 실측값 사용
        else:
            clip_dur = float(scene.get("duration_seconds") or 0)  # fallback

        if not text or clip_dur <= 0:
            offset += clip_dur
            continue

        merged.append(_Entry(
            start=offset,
            end=offset + clip_dur + _SRT_TAIL,  # 실측 + 0.5s
            text=text,
        ))
        offset += clip_dur  # 다음 클립 시작 = 실측 클립 길이 누적

    if not merged:
        return None
    return _entries_to_srt(merged)


# ── SRT 텍스트 줄 래핑 ──────────────────────────────────────────────────────────

def _wrap_text(text: str, max_chars: int) -> str:
    """공백 기준 단어 분리 후 max_chars 이하 줄로 묶기."""
    words = text.split(" ")
    lines: list[str] = []
    cur = ""
    for word in words:
        if not cur:
            cur = word
        elif len(cur) + 1 + len(word) <= max_chars:
            cur += " " + word
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def _split_long_entry(entry: _Entry, max_lines: int = 2) -> list[_Entry]:
    """2줄 초과 항목을 max_lines씩 잘라 여러 항목으로 분할. duration 균등 배분."""
    lines = entry.text.split('\n')
    if len(lines) <= max_lines:
        return [entry]
    chunks = ['\n'.join(lines[i:i + max_lines]) for i in range(0, len(lines), max_lines)]
    dur = (entry.end - entry.start) / len(chunks)
    return [
        _Entry(start=entry.start + i * dur, end=entry.start + (i + 1) * dur, text=chunk)
        for i, chunk in enumerate(chunks)
    ]


def wrap_srt(srt_content: str, max_chars: int) -> str:
    """SRT 각 항목 텍스트를 max_chars 글자 기준으로 줄바꿈 후 2줄 초과 시 분할."""
    entries = _parse_srt(srt_content)
    result: list[_Entry] = []
    for e in entries:
        wrapped = _Entry(start=e.start, end=e.end, text=_wrap_text(e.text, max_chars))
        result.extend(_split_long_entry(wrapped))
    return _entries_to_srt(result)


# ── 다국어 번역 ──────────────────────────────────────────────────────────────

_LANG_NAME = {"en": "English", "ja": "Japanese"}
_BATCH = 30  # call_free_llm 1회 최대 자막 수


async def translate_srt(srt_content: str, target_lang: str) -> str:
    """KR SRT → EN/JP 번역.

    텍스트만 번역, 타임스탬프·인덱스 보존.
    배치(30개) 단위 call_free_llm() 호출 (LD-011 무료 체인).
    번역 실패 시 원문 반환.
    """
    from services.gemini_helper import call_free_llm

    entries = _parse_srt(srt_content)
    if not entries:
        return srt_content

    lang_name = _LANG_NAME.get(target_lang, target_lang)
    translated_texts: list[str] = []

    for i in range(0, len(entries), _BATCH):
        batch = entries[i:i + _BATCH]
        numbered = "\n".join(f"[{j + 1}] {e.text}" for j, e in enumerate(batch))
        prompt = (
            f"Translate the following Korean drama subtitle lines into {lang_name}. "
            "Keep each translation SHORT (under 10 words). Natural, conversational tone. "
            "Output ONLY the translations with the same [N] numbering. No extra text.\n\n"
            f"{numbered}"
        )
        try:
            result = await call_free_llm(prompt, max_tokens=1000, temperature=0.2)
            for line in result.strip().splitlines():
                m = re.match(r"\[(\d+)\]\s*(.*)", line.strip())
                if m:
                    translated_texts.append(m.group(2).strip())
        except Exception as exc:
            print(f"[srt] 번역 실패 (배치 {i}): {exc}")
            return srt_content

    if len(translated_texts) != len(entries):
        print(f"[srt] 번역 수량 불일치: {len(translated_texts)} vs {len(entries)}")
        return srt_content

    translated = [
        _Entry(start=e.start, end=e.end, text=t)
        for e, t in zip(entries, translated_texts)
    ]
    return _entries_to_srt(translated)


# ── KR 자막 번인 ─────────────────────────────────────────────────────────────

def _sec_to_ass_time(sec: float) -> str:
    """seconds → ASS 시간 형식 H:MM:SS.cc (센티초 2자리)."""
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec % 1) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _srt_to_ass_typewriter(
    wrapped_srt: str,
    play_res_x: int,
    play_res_y: int,
    style: dict,
    ms_per_char: int = 60,
) -> str:
    """래핑된 SRT → 타이핑 효과 ASS.

    각 항목의 텍스트를 한 글자씩 순차 노출하는 다이얼로그 시퀀스로 확장.
    타이핑 구간: min(N * ms_per_char, duration * 0.8). 이후 전체 텍스트 고정 표시.
    Python '\\n' → ASS '\\N' 변환 (강제 줄바꿈).
    """
    entries = _parse_srt(wrapped_srt)

    margin_v = round(play_res_y * style.get("marginVPercent", 8) / 100)
    ratio_key = "9:16" if play_res_x < play_res_y else "16:9"
    base_font = style.get("fontSize1080ByRatio", {}).get(ratio_key) or style.get("fontSize1080", 38)
    font_size = round(base_font * play_res_y / 1080)
    bold_flag = -1 if style.get("bold", 1) else 0  # ASS: -1=굵게, 0=보통

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {play_res_x}\n"
        f"PlayResY: {play_res_y}\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,"
        f"{style['fontName']},{font_size},"
        f"{style['primaryColourASS']},&H000000FF,"
        f"{style['outlineColourASS']},{style['backColourASS']},"
        f"{bold_flag},0,0,0,100,100,0,0,"
        f"{style['borderStyle']},{style['outline']},{style['shadow']},"
        f"{style['alignment']},10,10,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    char_step = ms_per_char / 1000.0
    dialogue_lines: list[str] = []

    for entry in entries:
        chars = list(entry.text)  # '\n' 포함 문자 목록
        n = len(chars)
        if n == 0:
            continue
        total_dur = entry.end - entry.start
        if total_dur <= 0:
            continue

        type_dur = min(n * char_step, total_dur * 0.8)
        actual_step = type_dur / n

        for k in range(1, n + 1):
            t_start = entry.start + (k - 1) * actual_step
            t_end = entry.end if k == n else entry.start + k * actual_step
            partial = "".join(chars[:k]).replace("\n", r"\N")
            dialogue_lines.append(
                f"Dialogue: 0,{_sec_to_ass_time(t_start)},{_sec_to_ass_time(t_end)},"
                f"Default,,0,0,0,,{partial}"
            )

    return header + "\n".join(dialogue_lines) + "\n"


# CSS font-family key → (ASS 폰트명, 파일명)
_FONT_MAP: dict[str, tuple[str, str]] = {
    "NotoSerifKR-Regular":   ("Noto Serif KR", "NotoSerifKR-Regular.ttf"),
    "NotoSerifKR-Black":     ("Noto Serif KR", "NotoSerifKR-Black.ttf"),
    "Pretendard-Regular":    ("Pretendard",     "Pretendard-Regular.otf"),
    "Pretendard-Medium":     ("Pretendard",     "Pretendard-Medium.otf"),
    "PretendardJP-Regular":  ("Pretendard JP",  "PretendardJP-Regular.otf"),
    "PretendardJP-SemiBold": ("Pretendard JP",  "PretendardJP-SemiBold.otf"),
    "Montserrat-Regular":    ("Montserrat",     "Montserrat-Regular.ttf"),
    "SeoulAlrim-Medium":     ("Seoul Alrim",    "SeoulAlrim-Medium.otf"),
}

# 폰트 파일 위치: apps/web/public/fonts/
_FONTS_DIR = Path(__file__).parent.parent.parent / "web" / "public" / "fonts"


def burn_subtitles(
    mp4_path: Path,
    srt_path: Path,
    out_path: Path,
    font_name: str | None = None,
    subtitle_y: int | None = None,
    subtitle_bg: bool | None = None,
) -> None:
    """FFmpeg ASS 타이핑 효과로 래핑된 SRT를 영상에 burn-in.

    font_name:  keyframe cut=0 CSS 폰트 키 (예: 'Pretendard-Regular')
    subtitle_y: 0~100 위에서 내려오는 %, 기본 80
    subtitle_bg: True=박스 배경, False=아웃라인
    """
    import json as _json
    import shutil as _shutil

    _STYLE_JSON = Path(__file__).parent.parent / "data" / "subtitle_style.json"
    s = _json.loads(_STYLE_JSON.read_text(encoding="utf-8"))

    # ── keyframe 설정 오버라이드 ───────────────────────────────────────────────
    copied_font: Path | None = None
    if font_name and font_name in _FONT_MAP:
        ass_font_name, font_file = _FONT_MAP[font_name]
        s["fontName"] = ass_font_name
        # 폰트 파일을 ASS 작업 디렉토리에 복사 → fontsdir=. 사용
        src_font = _FONTS_DIR / font_file
        if src_font.exists():
            dst_font = srt_path.parent / font_file
            _shutil.copy2(str(src_font), str(dst_font))
            copied_font = dst_font

    if subtitle_y is not None:
        # subtitleY → marginVPercent: bottom % = 100 - subtitleY
        s["marginVPercent"] = 100 - subtitle_y

    if subtitle_bg is not None:
        s["borderStyle"] = 3 if subtitle_bg else 1

    mp4_name = mp4_path.name.lower()
    is_vertical = "9-16" in mp4_name or "vertical" in mp4_name

    play_res_x = 1080 if is_vertical else 1920
    play_res_y = 1920 if is_vertical else 1080

    ms_per_char = s.get("msPerChar", 60)
    wrapped_srt = srt_path.read_text(encoding="utf-8")
    ass_content = _srt_to_ass_typewriter(wrapped_srt, play_res_x, play_res_y, s, ms_per_char)

    ass_path = srt_path.with_suffix(".ass")
    ass_path.write_text(ass_content, encoding="utf-8")

    # fontsdir=. → ASS와 같은 디렉토리에서 폰트 탐색 (Windows 경로 콜론 문제 회피)
    vf = f"ass={ass_path.name}:fontsdir=." if copied_font else f"ass={ass_path.name}"

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(mp4_path),
                "-vf", vf,
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(out_path),
            ],
            cwd=str(ass_path.parent),
            check=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=600,
        )
    finally:
        ass_path.unlink(missing_ok=True)
        if copied_font and copied_font.exists():
            copied_font.unlink(missing_ok=True)
