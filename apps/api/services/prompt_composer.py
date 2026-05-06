# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""
prompt_composer.py — 씬 이미지 프롬프트 조합 서비스 (Gemini 0회)

캐릭터 JSON + 화풍 JSON 기반으로 fal.ai용 영문 프롬프트를 빌드한다.
모듈 로드 시 데이터 파일을 한 번만 읽어 캐시한다.

컷 타입별 분기:
  narration + 캐릭터 있음 → 패럴랙스용 합성 프롬프트 + 배경/캐릭터 분리 프롬프트
  narration + 캐릭터 없음 → 배경 전용 프롬프트 (bg_prompt_suffix)
  dialogue 1인           → 정면 클로즈업 합성 프롬프트
  dialogue 2인+          → OTS (Over The Shoulder) 합성 프롬프트
"""

import json
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# 시간대 한→영 결정론적 매핑 (Gemini 호출 없이 항상 일관된 영어 토큰 생성)
# ---------------------------------------------------------------------------
_KO_TIME_MAP: list[tuple[str, str]] = [
    ("새벽 [0-9]시",  "late night / early dawn"),
    ("깊은 밤",       "deep night"),
    ("자정",          "midnight"),
    ("새벽",          "dawn"),
    ("이른 아침",     "early morning"),
    ("오전",          "morning"),
    ("점심시간",      "noon"),
    ("낮",            "daytime"),
    ("오후",          "afternoon"),
    ("저녁",          "evening / dusk"),
    ("밤",            "night"),
    ("다음날",        "the next day"),
    ("며칠 후",       "a few days later"),
    ("다음 날",       "the next day"),
    ("일주일 후",     "a week later"),
    ("한 달 후",      "a month later"),
]

def _translate_time_of_day(ko: str) -> str:
    """한국어 시간대 → 영어. 매핑 없으면 원문 그대로 반환."""
    s = ko.strip()
    if not s:
        return ""
    for pattern, en in _KO_TIME_MAP:
        if re.search(pattern, s):
            return en
    return s

# ---------------------------------------------------------------------------
# 모듈 레벨 캐시 — import 시 1회만 로드
# ---------------------------------------------------------------------------
_DATA_DIR = Path(__file__).parent.parent / "data"

_CHAR_INDEX: dict[str, str] = {}   # name → id
_ART_STYLES: dict = {}

def _ensure_loaded() -> None:
    """첫 호출 시 인덱스·화풍 데이터를 메모리에 적재한다."""
    global _CHAR_INDEX, _ART_STYLES

    if not _CHAR_INDEX:
        idx_path = _DATA_DIR / "characters" / "_index.json"
        raw = json.loads(idx_path.read_text(encoding="utf-8"))
        _CHAR_INDEX = {
            c["name"]: c["id"]
            for c in raw.get("characters", [])
            if "name" in c and "id" in c
        }

    if not _ART_STYLES:
        styles_path = _DATA_DIR / "art_styles.json"
        _ART_STYLES = json.loads(styles_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------
def _load_char_appearance(char_id: str, art_style: str) -> dict | None:
    """{id}_{art_style}.json 우선, 없으면 {id}.json, 없으면 None."""
    chars_dir = _DATA_DIR / "characters"

    style_file = chars_dir / f"{char_id}_{art_style}.json"
    if style_file.exists():
        return json.loads(style_file.read_text(encoding="utf-8"))

    base_file = chars_dir / f"{char_id}.json"
    if base_file.exists():
        return json.loads(base_file.read_text(encoding="utf-8"))

    return None


def _pick_wardrobe(scene_meta: dict) -> str:
    # 🔒 LD-016: 사용자 명시 요청 없으면 항상 default 의상 유지
    return "default"


def _get_char_parts(
    char_names: list[str],
    art_style: str,
    wardrobe_key: str,
    guest_cast: dict | None,
) -> list[str]:
    """캐릭터 목록 → appearance 프롬프트 파트 리스트 (재사용 헬퍼)."""
    char_parts: list[str] = []
    for name in char_names:
        # 괄호 suffix 제거: "최민성 (멀리서)" → "최민성"
        _base_name = name.split("(")[0].strip() if "(" in name else name
        char_id = _CHAR_INDEX.get(_base_name) or _CHAR_INDEX.get(name)

        if char_id:
            char_data = _load_char_appearance(char_id, art_style)
            if not char_data:
                continue
            appearance = char_data.get("appearance_en") or {}
            wardrobe_prompt = (
                (appearance.get("wardrobe") or {})
                .get(wardrobe_key, {})
                .get("wardrobe_prompt") or ""
            ).strip()

            # polystyle + reference_url 있음 → fal_identity_prompt + 의상 포함
            # portrait 이미지 레퍼런스가 있어도 Gemini가 캐릭터 일관성을 보장하지 못하므로
            # 텍스트 묘사(fal_identity_prompt)를 함께 주입
            if art_style == "polystyle" and char_data.get("reference_url"):
                identity    = (appearance.get("fal_identity_prompt") or "").strip()
                body_prompt = ((appearance.get("body") or {}).get("body_prompt") or "").strip()
                for part in (identity, body_prompt, wardrobe_prompt):
                    if part:
                        char_parts.append(part)
            else:
                # 기존 verbose 경로 (polystyle / polystyle / reference 없음)
                identity    = (appearance.get("fal_identity_prompt") or "").strip()
                body_prompt = ((appearance.get("body") or {}).get("body_prompt") or "").strip()
                for part in (identity, body_prompt, wardrobe_prompt):
                    if part:
                        char_parts.append(part)
        else:
            gc              = (guest_cast or {}).get(name) or {}
            identity        = (gc.get("fal_identity_prompt") or "").strip()
            body_prompt     = (gc.get("body_prompt") or "").strip()
            wardrobe_prompt = (
                (gc.get("wardrobe") or {})
                .get(wardrobe_key, {})
                .get("wardrobe_prompt") or ""
            ).strip()
            if identity:
                for part in (identity, body_prompt, wardrobe_prompt):
                    if part:
                        char_parts.append(part)
            else:
                char_parts.append(f"a person named {name}")

    return char_parts


def _build_ots_char_parts(
    char_names: list[str],
    speaker: str,
    art_style: str,
    wardrobe_key: str,
    guest_cast: dict | None,
) -> list[str]:
    """OTS 구도 캐릭터 파트 — 화자 정면, 나머지 뒷모습.

    speaker가 비어 있으면 첫 번째 캐릭터를 화자로 간주한다.
    """
    speaker_name = speaker.strip() if speaker else (char_names[0] if char_names else "")
    parts: list[str] = []

    for name in char_names:
        char_id    = _CHAR_INDEX.get(name)
        is_speaker = (name == speaker_name)

        if is_speaker:
            # 화자 — 중경(약간 뒤), 2/3 측면, 얼굴 보임 → 립씽크 대상
            if char_id:
                char_data  = _load_char_appearance(char_id, art_style)
                appearance = (char_data or {}).get("appearance_en") or {}
                wardrobe   = (
                    (appearance.get("wardrobe") or {})
                    .get(wardrobe_key, {})
                    .get("wardrobe_prompt") or ""
                ).strip()

                # polystyle + reference_url → fal_identity_prompt + 의상 포함 (portrait만으론 Gemini 일관성 불충분)
                if art_style == "polystyle" and (char_data or {}).get("reference_url"):
                    identity = (appearance.get("fal_identity_prompt") or "").strip()
                    if identity:
                        parts.append(
                            f"{identity}, standing slightly behind in midground, "
                            "two-thirds side profile, face clearly visible, "
                            "gaze directed toward the listener in front, "
                            "NOT looking at camera"
                        )
                    if wardrobe:
                        parts.append(wardrobe)
                else:
                    identity = (appearance.get("fal_identity_prompt") or "").strip()
                    if identity:
                        parts.append(
                            f"{identity}, standing slightly behind in midground, "
                            "two-thirds side profile, face clearly visible, "
                            "gaze directed toward the listener in front, "
                            "NOT looking at camera"
                        )
                    if wardrobe:
                        parts.append(wardrobe)
            else:
                gc       = (guest_cast or {}).get(name) or {}
                identity = (gc.get("fal_identity_prompt") or name).strip()
                parts.append(
                    f"{identity}, standing slightly behind in midground, "
                    "two-thirds side profile, face clearly visible, "
                    "gaze directed toward the listener in front, "
                    "NOT looking at camera"
                )
        else:
            # 청자 — 전경(앞), 완전 후면, 얼굴 숨김 → 프레임 역할
            if char_id:
                char_data  = _load_char_appearance(char_id, art_style)
                appearance = (char_data or {}).get("appearance_en") or {}
                wardrobe   = (
                    (appearance.get("wardrobe") or {})
                    .get(wardrobe_key, {})
                    .get("wardrobe_prompt") or ""
                ).strip()
                parts.append(
                    f"{name} standing in foreground closer to camera, "
                    "full rear view, back of head and shoulders filling foreground, "
                    "face entirely hidden, slightly overlapping speaker in background"
                )
                if wardrobe:
                    parts.append(wardrobe)
            else:
                parts.append(
                    f"{name} standing in foreground closer to camera, "
                    "full rear view, back of head and shoulders filling foreground, "
                    "face entirely hidden, slightly overlapping speaker in background"
                )

    return parts


# ---------------------------------------------------------------------------
# 공개 함수
# ---------------------------------------------------------------------------
def build_cut_image_prompt(
    scene: dict,
    art_style: str,
    guest_cast: dict | None = None,
) -> str:
    """씬 데이터 + 화풍으로 fal.ai 영문 이미지 프롬프트를 조합한다.

    컷 타입(scene["type"])과 캐릭터 유무에 따라 자동 분기:
      - narration + 캐릭터  → 패럴랙스 합성 프롬프트
      - narration + 없음    → 배경 전용 프롬프트
      - dialogue 1인        → 정면 클로즈업
      - dialogue 2인+       → OTS (화자 정면, 나머지 뒷모습)
    """
    _ensure_loaded()

    style_cfg    = _ART_STYLES.get(art_style) or _ART_STYLES.get("polystyle") or {}
    scene_meta   = scene.get("scene_meta") or {}
    char_names: list[str] = scene_meta.get("characters") or []
    wardrobe_key = _pick_wardrobe(scene_meta)
    cut_type     = (scene.get("type") or "narration").lower()
    speaker      = (scene.get("speaker") or "").strip()

    scene_desc: str = (scene.get("image_hint_en") or scene.get("image_hint") or "").strip()

    # 시간대 — 결정론적 한→영 변환 (Gemini 없이 항상 명시적 토큰 주입)
    time_part = _translate_time_of_day(scene_meta.get("time_of_day") or "")

    # scene_meta 배경 컨텍스트 (location / atmosphere / scene_hint — time_of_day는 별도 주입)
    # bg_context_en이 있으면 우선 사용 (chapters.py에서 번역 주입)
    if scene.get("bg_context_en"):
        bg_context = scene["bg_context_en"]
    else:
        bg_ctx_parts = [p for p in [
            scene_meta.get("scene_hint") or "",
            scene_meta.get("location") or "",
            scene_meta.get("atmosphere") or "",
        ] if p]
        bg_context = ", ".join(bg_ctx_parts)

    # ── dialogue 컷 ────────────────────────────────────────────────────────
    if cut_type == "dialogue" and char_names:
        style_part = (style_cfg.get("base_style_prompt") or "").strip()

        if len(char_names) >= 2:
            # OTS 구도
            ots_parts = _build_ots_char_parts(
                char_names, speaker, art_style, wardrobe_key, guest_cast
            )
            # polystyle: scene_desc 우선, time_part, bg_context 후
            if art_style == "polystyle":
                all_parts = [scene_desc, time_part, "over-the-shoulder shot", bg_context] + ots_parts + [style_part]
            else:
                all_parts = ["over-the-shoulder shot", time_part, bg_context, scene_desc] + ots_parts + [style_part]
        else:
            # 1인 — 2/3 측면 뷰, 시선은 씬 내부 방향 (카메라 직시 금지)
            char_parts = _get_char_parts(char_names, art_style, wardrobe_key, guest_cast)
            if art_style == "polystyle":
                all_parts = [
                    scene_desc, time_part, bg_context,
                    "medium close-up, two-thirds profile view, "
                    "gaze directed into the scene not at lens, natural candid framing"
                ] + char_parts + [style_part]
            else:
                all_parts = [
                    time_part, bg_context, scene_desc,
                    "medium close-up, two-thirds profile view, "
                    "gaze directed into the scene not at lens, natural candid framing"
                ] + char_parts + [style_part]

        return ", ".join(p for p in all_parts if p)

    # ── narration 컷 ──────────────────────────────────────────────────────
    char_parts = _get_char_parts(char_names, art_style, wardrobe_key, guest_cast)

    if char_parts:
        style_part = (style_cfg.get("base_style_prompt") or "").strip()
    else:
        style_part = (
            style_cfg.get("bg_prompt_suffix")
            or style_cfg.get("base_style_prompt")
            or ""
        ).strip()

    # polystyle: image_hint(scene_desc) 우선 → time_part → bg_context → 캐릭터 → 화풍
    if art_style == "polystyle":
        all_parts = [scene_desc, time_part, bg_context] + char_parts + [style_part]
    else:
        all_parts = [time_part, bg_context, scene_desc] + char_parts + [style_part]
    return ", ".join(p for p in all_parts if p)


def build_bg_prompt(
    scene: dict,
    art_style: str,
    guest_cast: dict | None = None,  # noqa: ARG001 — 시그니처 통일용
) -> str:
    """배경 전용 프롬프트 — 인물 없음, bg_prompt_suffix 사용.

    narration 컷의 배경 이미지를 사용자가 수동 생성할 때 복사해 쓴다.
    """
    _ensure_loaded()

    style_cfg  = _ART_STYLES.get(art_style) or _ART_STYLES.get("polystyle") or {}
    scene_desc = (scene.get("image_hint_en") or scene.get("image_hint") or "").strip()
    style_part = (
        style_cfg.get("bg_prompt_suffix")
        or style_cfg.get("base_style_prompt")
        or ""
    ).strip()

    all_parts = [scene_desc, style_part]
    return ", ".join(p for p in all_parts if p)


def build_char_prompt(
    scene: dict,
    art_style: str,
    guest_cast: dict | None = None,
) -> str:
    """캐릭터 누끼 생성용 프롬프트 — 단색 배경, 전신.

    narration 컷 + 캐릭터 정확히 1명인 경우만 반환 (parallax용).
    2명 이상이면 빈 문자열 — Ken Burns 합성(사용자 수동)으로 처리하므로 누끼 불필요.
    FLUX API 호출 후 rembg로 배경 제거 → 투명 PNG 생성에 사용.
    """
    _ensure_loaded()

    style_cfg    = _ART_STYLES.get(art_style) or _ART_STYLES.get("polystyle") or {}
    scene_meta   = scene.get("scene_meta") or {}
    char_names: list[str] = scene_meta.get("characters") or []

    # parallax는 1인 narration 전용 — 2인+ 는 Ken Burns 합성으로 처리
    if len(char_names) != 1:
        return ""

    wardrobe_key = _pick_wardrobe(scene_meta)
    char_parts   = _get_char_parts(char_names, art_style, wardrobe_key, guest_cast)

    if not char_parts:
        return ""

    style_part = (style_cfg.get("base_style_prompt") or "").strip()

    if art_style == "polystyle":
        proportion_prefix = (
            "3-head proportion body STRICTLY, oversized head on small body, "
            "stylized character mascot ratio NOT realistic human ratio"
        )
        cutout_suffix = (
            "solid flat chroma key green #00B140 background only, "
            "no background elements, no shadows on background, full body visible"
        )
        all_parts = [proportion_prefix] + char_parts + [style_part, cutout_suffix]
    else:
        cutout_suffix = "on plain white background, isolated character, full body, no background elements"
        all_parts = char_parts + [style_part, cutout_suffix]

    return ", ".join(p for p in all_parts if p)


def build_cut_negative_prompt(
    scene: dict,
    art_style: str,
    guest_cast: dict | None = None,
) -> str:
    """글로벌 화풍 negative_prompt + 각 캐릭터 negative_prompt 결합.

    dialogue 컷은 카메라 직시 관련 negative 토큰을 추가한다.
    중복 토큰 제거 후 ", " join.
    """
    _ensure_loaded()

    style_cfg  = _ART_STYLES.get(art_style) or _ART_STYLES.get("polystyle") or {}
    cut_type   = (scene.get("type") or "narration").lower()
    char_names: list[str] = (scene.get("scene_meta") or {}).get("characters") or []

    raw_parts: list[str] = []

    global_neg = (style_cfg.get("negative_prompt") or "").strip()
    if global_neg:
        raw_parts.append(global_neg)

    # dialogue 컷 — 카메라 직시 방지 + 양쪽 측면 구도 방지
    # 화자 2/3측면 + 청자 후면 조합이 립씽크에 최적
    # 양쪽 모두 측면이면 립씽크 실패
    if cut_type == "dialogue":
        raw_parts.append(
            "looking at camera, direct eye contact, eye contact with viewer, "
            "staring into camera, facing directly at viewer, "
            "both characters in side profile, two characters facing each other symmetrically"
        )

    for name in char_names:
        # 괄호 suffix 제거: "최민성 (멀리서)" → "최민성"
        _base_name = name.split("(")[0].strip() if "(" in name else name
        char_id = _CHAR_INDEX.get(_base_name) or _CHAR_INDEX.get(name)

        if char_id:
            char_data = _load_char_appearance(char_id, art_style)
            if not char_data:
                continue
            char_neg = (char_data.get("negative_prompt") or "").strip()
            if char_neg:
                raw_parts.append(char_neg)
        else:
            gc = (guest_cast or {}).get(name) or {}
            char_neg = (gc.get("negative_prompt") or "").strip()
            if char_neg:
                raw_parts.append(char_neg)

    # 토큰 단위 중복 제거 (순서 유지)
    seen: set[str] = set()
    unique_tokens: list[str] = []
    for part in raw_parts:
        for token in (t.strip() for t in part.split(",")):
            if token and token.lower() not in seen:
                seen.add(token.lower())
                unique_tokens.append(token)

    return ", ".join(unique_tokens)
