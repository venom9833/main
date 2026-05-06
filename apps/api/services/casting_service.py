# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""캐스팅 서비스 — LLM 기반 소스-인지 캐스팅 (call_free_llm 우선, 결정론적 fallback)
V2 series_casting_service.py 로직 이관 + V3 Supabase 저장
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

from core.database import get_supabase
from services.wiki_service import ingest_chunk

# ── 캐릭터 데이터 경로 ────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data" / "characters"
_INDEX_PATH = _DATA_DIR / "_index.json"
_ALL_PATH = _DATA_DIR / "_all.json"

# ── 트롭 → 태그 매핑 ─────────────────────────────────────────────────────────
TROPE_TAG_MAP: dict[str, list[str]] = {
    "affair":           ["affair_risk", "forbidden_romance", "affair_target"],
    "divorce":          ["marriage_strain", "remarriage", "financial_pressure"],
    "office_romance":   ["office_romance", "glass_ceiling", "career_vs_family"],
    "remarriage":       ["remarriage", "blended_family", "in_law_conflict"],
    "redevelopment":    ["redevelopment", "poverty", "financial_pressure"],
    "inheritance":      ["family_burden", "in_law_conflict", "power_abuse"],
    "midlife_crisis":   ["midlife_crisis", "affair_risk", "career_vs_family"],
    "youth":            ["youth_unemployment", "career_crisis", "romance"],
    "in_law":           ["in_law_conflict", "remarriage", "generational_gap"],
    "isolation":        ["isolation", "aging", "poverty"],
    "power_abuse":      ["power_abuse", "hypocrisy", "career_vs_family"],
    # 비현대 장르 — persona_overlay가 이름·직업 오버라이드
    "historical":       ["loyalty", "betrayal", "forbidden_romance"],
    "fantasy":          ["forbidden_romance", "power_abuse", "betrayal"],
    "martial":          ["rivalry", "betrayal", "loyalty"],
    "war":              ["loyalty", "betrayal", "isolation"],
    "general":          ["romance", "rivalry", "betrayal"],
}

MAX_CAST = 10
MIN_CAST = 6


# ── 로더 ──────────────────────────────────────────────────────────────────────

def _load_index() -> list[dict[str, Any]]:
    return json.loads(_INDEX_PATH.read_text(encoding="utf-8")).get("characters", [])


def _load_detail(char_id: str) -> dict[str, Any]:
    path = _DATA_DIR / f"{char_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _load_char_family_context(char_id: str) -> dict[str, Any]:
    """캐릭터 JSON에서 가족 그룹과 관계 정보를 가져온다.

    캐릭터 파일이 없거나 오류가 발생하면 빈 딕셔너리를 반환한다 (방어 처리).
    반환값:
      - family_group: 해당 캐릭터가 속한 가족 단위 식별자 (예: "family_choi")
      - relationships: 주변 인물 관계 딕셔너리 (예: {"최민성(남편)": "..."})
    """
    try:
        detail = _load_detail(char_id)
        return {
            "family_group": detail.get("family_group", ""),
            "relationships": detail.get("relationships", {}),
        }
    except Exception:
        return {}


# 가족 단위 미지정을 뜻하는 범용 family_group 값 — 동일성 비교에서 제외
# 이 값들은 "같은 family_group"이 아니라 "아직 배정되지 않음"을 의미하므로
# 두 캐릭터가 모두 "supporting"이어도 실제 가족 관계가 아니다
_GENERIC_FAMILY_GROUPS: set[str] = {"", "supporting", "extra", "none", "unaffiliated"}


def _determine_initial_relationship(fg_a: str, fg_b: str) -> str:
    """두 캐릭터의 family_group을 비교해 ch01 시작 시점 관계 상태를 결정론적으로 산출한다.

    "supporting"/"extra"/"" 등은 가족 단위 미지정 플레이스홀더이므로
    양쪽 모두 generic 이 아니고 + 동일할 때만 "family" 반환한다.
    그 외(서로 다름, 한쪽 또는 양쪽이 generic)는 "strangers".
    """
    a = (fg_a or "").strip().lower()
    b = (fg_b or "").strip().lower()
    if not a or not b:
        return "strangers"  # 어느 한쪽도 family_group이 없으면 모르는 사이
    if a in _GENERIC_FAMILY_GROUPS or b in _GENERIC_FAMILY_GROUPS:
        return "strangers"  # 범용 플레이스홀더는 실제 가족 관계로 보지 않음
    if a == b:
        return "family"     # 동일한 특정 가족 단위에 속함 → 실제 가족/부부 관계
    return "strangers"      # 다른 가족 단위 → 모르는 사이


# ── 캐스팅 엔진 ───────────────────────────────────────────────────────────────

def _matches_tropes(char: dict, target_tags: list[str]) -> bool:
    return bool(set(char.get("trope_tags", [])) & set(target_tags))


def _score(char: dict, target_tags: list[str]) -> int:
    return len(set(char.get("trope_tags", [])) & set(target_tags))


def _gender_balanced(pool: list[dict], count: int) -> list[dict]:
    males   = [c for c in pool if c.get("gender") == "male"]
    females = [c for c in pool if c.get("gender") == "female"]
    result: list[dict] = []
    per = count // 2
    result.extend(males[:per])
    result.extend(females[:per])
    remaining = [c for c in pool if c not in result]
    result.extend(remaining[:count - len(result)])
    return result[:count]


def cast_for_trope(
    trope: str,
    seed: Optional[int] = None,
    recent_ids: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """트롭 → 8~10명 캐릭터 선발 (AI 없음, 결정론적)"""
    rng = random.Random(seed)
    all_chars = _load_index()
    recent_ids = recent_ids or []
    target_tags = TROPE_TAG_MAP.get(trope, [trope])

    protagonists = [c for c in all_chars if "protagonist" in c.get("role_pool", [])]
    antagonists  = [c for c in all_chars if "antagonist"  in c.get("role_pool", [])]
    catalysts    = [c for c in all_chars if "catalyst"    in c.get("role_pool", [])]
    elders       = [c for c in all_chars if "elder"       in c.get("role_pool", [])]
    mirrors      = [c for c in all_chars if "mirror"      in c.get("role_pool", [])]

    cast: list[dict] = []
    used_ids: set[str] = set()

    def _pick(pool: list[dict], count: int, require_trope: bool = True, allow_recent: bool = False) -> list[dict]:
        candidates = [c for c in pool if c["id"] not in used_ids]
        if not allow_recent:
            fresh  = [c for c in candidates if c["id"] not in recent_ids]
            recent = [c for c in candidates if c["id"] in recent_ids]
            candidates = fresh + recent
        if require_trope:
            matched   = sorted([c for c in candidates if _matches_tropes(c, target_tags)],
                               key=lambda c: _score(c, target_tags), reverse=True)
            unmatched = [c for c in candidates if not _matches_tropes(c, target_tags)]
            candidates = matched + unmatched
        if len(candidates) > count:
            top_score = _score(candidates[0], target_tags) if candidates else 0
            top  = [c for c in candidates if _score(c, target_tags) == top_score]
            rest = [c for c in candidates if _score(c, target_tags) < top_score]
            rng.shuffle(top)
            candidates = top + rest
        selected = candidates[:count]
        used_ids.update(c["id"] for c in selected)
        return selected

    # 주인공 2명 (남/여 균형)
    proto_matched = sorted([c for c in protagonists if _matches_tropes(c, target_tags)],
                           key=lambda c: _score(c, target_tags), reverse=True)
    proto_pool = proto_matched + [c for c in protagonists if not _matches_tropes(c, target_tags)]
    proto_fresh  = [c for c in proto_pool if c["id"] not in recent_ids]
    proto_recent = [c for c in proto_pool if c["id"] in recent_ids]
    proto_pool = proto_fresh + proto_recent
    protagonists_selected = _gender_balanced(proto_pool, 2)
    used_ids.update(c["id"] for c in protagonists_selected)
    cast.extend(protagonists_selected)

    # 빌런 1명
    villain_pool = sorted(antagonists, key=lambda c: (c.get("villain_intensity", 0), _score(c, target_tags)), reverse=True)
    cast.extend(_pick(villain_pool, 1, require_trope=False))

    # 촉매 2명
    cast.extend(_pick(catalysts, 2))

    # 시니어 카메오 1명
    cast.extend(_pick(elders, 1, allow_recent=True))

    # 거울 1명
    cast.extend(_pick(mirrors, 1))

    # 보충 (총 8명 목표)
    remaining = max(MIN_CAST, 8) - len(cast)
    if remaining > 0:
        extras = sorted([c for c in all_chars if c["id"] not in used_ids and _matches_tropes(c, target_tags)],
                        key=lambda c: _score(c, target_tags), reverse=True)
        cast.extend(extras[:remaining])

    return cast[:MAX_CAST]


def build_character_injection(cast: list[dict[str, Any]]) -> str:
    """선발 캐릭터 → Gemini 프롬프트 주입용 텍스트"""
    lines = ["## 등장인물 (주요 인물 목록 — 가능하면 이 범위 내에서 구성)\n"]
    for c in cast:
        intensity = c.get("villain_chapter_intensity", c.get("villain_intensity", 0))
        villain_note = ""
        if intensity and intensity >= 2:
            villain_note = f" [악역 강도 {intensity}/3 — 매력적이지만 명백히 위험]"
        elif intensity == 1:
            villain_note = " [잠재적 갈등 유발자 — 아직 본색 미노출]"
        gender_label = "남" if c.get("gender") == "male" else "여"
        lines.append(
            f"- **{c['name']}** ({c.get('age', '?')}세, {gender_label}) "
            f"/ {c.get('occupation', '')} / {c.get('role', '')}{villain_note}"
        )
    lines.append("\n주요 관계와 갈등은 위 목록 내에서 구성할 것. 단, 아주 짧게 등장하는 무명 배경 인물(택시기사, 점원, 경비원 등)은 허용.")
    return "\n".join(lines)


def get_available_tropes() -> list[str]:
    return list(TROPE_TAG_MAP.keys())


# ── 미등록 조연 외모 생성 ─────────────────────────────────────────────────────

async def generate_guest_cast(
    series_id: str,
    guest_info: list[dict],  # [{name, scenes: [{text, image_hint}]}]
) -> dict:
    """미등록 조연 이름 목록 → 경량 Gemini 외모 생성 → world_data.guest_cast 저장.

    guest_info 구조:
      [{"name": "송현아", "scenes": [{"text": "...", "image_hint": "..."}]}]

    저장 구조 (world_data.guest_cast):
      {
        "송현아": {
          "fal_identity_prompt": "...",
          "body_prompt": "...",
          "wardrobe": {
            "default":  {"wardrobe_prompt": "..."},
            "casual":   {"wardrobe_prompt": "..."},
            "stressed": {"wardrobe_prompt": "..."}
          },
          "negative_prompt": "..."
        }
      }
    """
    from services.gemini_helper import call_gemini, extract_json

    db = get_supabase()
    guest_cast: dict = {}

    for info in guest_info:
        name = info.get("name", "")
        if not name:
            continue

        # 등장 씬 컨텍스트 (최대 3씬)
        ctx_lines: list[str] = []
        for s in (info.get("scenes") or [])[:3]:
            if s.get("image_hint"):
                ctx_lines.append(f"- 장면: {s['image_hint']}")
            if s.get("text"):
                ctx_lines.append(f"  서술: {s['text'][:120]}")
        ctx_text = "\n".join(ctx_lines) or "등장 장면 정보 없음"

        prompt = (
            f"다음 조연 캐릭터의 외모를 생성하라. 한국 드라마 현실적 인물 기준.\n\n"
            f"이름: {name}\n"
            f"등장 씬 컨텍스트:\n{ctx_text}\n\n"
            "아래 JSON만 출력 (설명·마크다운 코드블록 없이):\n"
            '{\n'
            '  "fal_identity_prompt": "영문 외모 묘사 — 나이대 Korean man/woman, 주요 얼굴 특징, 체형 요약 (2문장 이내)",\n'
            '  "body_prompt": "영문 체형/자세 묘사 (1문장)",\n'
            '  "wardrobe_default": "영문 일반 의상 묘사 (1문장)",\n'
            '  "wardrobe_casual": "영문 캐주얼/집 의상 묘사 (1문장)",\n'
            '  "wardrobe_stressed": "영문 긴장 상황 의상 묘사 (1문장)"\n'
            '}'
        )

        try:
            raw = await call_gemini(prompt, max_tokens=400, temperature=0.5)
            data = extract_json(raw)
            if data and data.get("fal_identity_prompt"):
                guest_cast[name] = {
                    "fal_identity_prompt": data.get("fal_identity_prompt", ""),
                    "body_prompt":         data.get("body_prompt", ""),
                    "wardrobe": {
                        "default":  {"wardrobe_prompt": data.get("wardrobe_default", "")},
                        "casual":   {"wardrobe_prompt": data.get("wardrobe_casual", "")},
                        "stressed": {"wardrobe_prompt": data.get("wardrobe_stressed", "")},
                    },
                    "negative_prompt": (
                        "photorealistic, anime, flat cartoon, CGI, 3d render, "
                        "ugly, deformed, extra limbs, text, watermark"
                    ),
                }
        except Exception:
            # Gemini 실패 → 이름 텍스트 폴백 보장
            guest_cast[name] = {
                "fal_identity_prompt": "",
                "body_prompt": "",
                "wardrobe": {},
                "negative_prompt": "",
            }

    if not guest_cast:
        return {}

    # world_data.guest_cast 저장
    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
    )
    world: dict = (res.data or {}).get("world_data") or {}
    world["guest_cast"] = {**(world.get("guest_cast") or {}), **guest_cast}

    await asyncio.to_thread(
        lambda: db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()
    )

    return guest_cast


# ── V3 파이프라인 연동 ────────────────────────────────────────────────────────

def _match_voice_face(gender: str, age: int, index: list[dict]) -> tuple[str, str]:
    """성별+나이 기준으로 풀에서 가장 가까운 캐릭터의 voice_id·face_grid_url 반환."""
    pool = [c for c in index if c.get("gender") == gender] or index
    best = min(pool, key=lambda c: abs(c.get("age", 30) - age))
    return best.get("voice_id", ""), best.get("face_grid_url", "")


async def _extract_cast_from_source(
    world: dict, series_id: str, index: list[dict]
) -> list[dict] | None:
    """소스 파일에서 등장인물을 직접 추출 (sourceMode='extract' 전용).

    풀을 사용하지 않음 — 이름·성격·상황은 소스에서, 목소리·얼굴은 성별/나이 매칭으로 풀에서 빌림.
    """
    from services.gemini_helper import call_free_llm, extract_json
    from core.config import settings

    # ── 소스 텍스트 준비 ────────────────────────────────────────────────────────
    source_text = ""
    source_summary_obj = world.get("source_summary") or {}
    filename = source_summary_obj.get("filename", "")

    if filename:
        src_path = settings.SOURCE_DIR / series_id / filename
        if src_path.exists():
            try:
                source_text = src_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                pass

    # 파일 없으면 source_summary 요약문으로 대체
    if not source_text:
        key_sents = source_summary_obj.get("key_sentences") or []
        source_text = "\n".join(key_sents)

    if len(source_text) < 100:
        logger.warning("_extract_cast_from_source: 소스 텍스트 부족 — fallback")
        return None

    excerpt = source_text[:4000]
    world_summary = world.get("worldSummary") or world.get("socialBackground") or ""
    genre = world.get("genre", "")
    topic = world.get("topic", "")

    prompt = f"""다음 소설/시나리오의 등장인물을 추출하라.

== 이야기 정보 ==
제목/주제: {topic}
장르: {genre}
세계관: {world_summary}

== 소스 텍스트 (앞부분) ==
{excerpt}

== 추출 규칙 ==
- 소스 텍스트에 실제로 등장하는 인물만 추출 (창작 금지)
- 이름은 소스 원문의 이름을 그대로 사용
- gender는 소스 원문에 명시된 성별을 그대로 사용 — 직업·직위(장군, 의사 등)로 성별을 추정하거나 변경 절대 금지
- role_in_story: protagonist_a / protagonist_b / antagonist / catalyst / supporting 중 하나
- 최소 2명, 최대 8명
- 성격·상황·말투는 소스 텍스트 기반으로 작성

아래 JSON만 출력하라. 설명·마크다운 없이 순수 JSON만.
{{
  "characters": [
    {{
      "name": "원본 이름",
      "gender": "male 또는 female",
      "age": 나이_숫자,
      "occupation": "직업 또는 신분",
      "role_in_story": "protagonist_a",
      "personality": "성격 한 줄",
      "speaking_style": "말투 한 줄",
      "fear": "두려움 한 줄",
      "situations": ["상황1", "상황2", "상황3"]
    }}
  ]
}}"""

    try:
        raw = await call_free_llm(prompt, max_tokens=1200, temperature=0.6)
        data = extract_json(raw)
        chars = data.get("characters") or []

        if len(chars) < 2:
            logger.warning(f"_extract_cast_from_source: 추출 인원 부족 ({len(chars)}명) — fallback")
            return None
        # 2명 이상이면 통과 — 단편·2인극 소스는 protagonist_a/b만으로 충분

        result: list[dict] = []
        used_voice_face: set[str] = set()

        for i, c in enumerate(chars):
            gender = c.get("gender", "female")
            _raw_age = c.get("age")
            try:
                age = int(_raw_age) if _raw_age is not None else 30
            except (ValueError, TypeError):
                age = 30  # 소스에 나이 불명 캐릭터(고대인 등) 대비

            # 아직 쓰지 않은 voice/face 매칭
            pool_filtered = [p for p in index if p["id"] not in used_voice_face]
            vid, fgrid = _match_voice_face(gender, age, pool_filtered or index)

            # 이 voice/face를 제공한 풀 캐릭터 id 기록 (중복 대여 방지)
            matched = next(
                (p for p in index if p.get("voice_id") == vid and p.get("face_grid_url") == fgrid),
                None,
            )
            if matched:
                used_voice_face.add(matched["id"])

            char_dict: dict = {
                "id": f"src_{i}",
                "name": c.get("name", f"인물{i+1}"),
                "gender": gender,
                "age": age,
                "age_group": "청년" if age < 35 else ("중년" if age < 55 else "시니어"),
                "occupation": c.get("occupation", ""),
                "role_pool": [c.get("role_in_story", "supporting")],
                "role_in_story": c.get("role_in_story", "supporting"),
                "role": c.get("occupation", ""),
                "trope_tags": [],
                "villain_intensity": 0,
                "voice_id": vid,
                "face_grid_url": fgrid,
                "is_extracted": True,
                "core": {
                    "personality":    c.get("personality", ""),
                    "speaking_style": c.get("speaking_style", ""),
                    "fear":           c.get("fear", ""),
                    "lie_to_self":    "",
                    "concern":        "",
                    "under_stress":   "",
                },
                "situations": c.get("situations") or [],
            }
            result.append(char_dict)

        logger.info(f"_extract_cast_from_source: {len(result)}명 추출 — {[c['name'] for c in result]}")
        return result

    except Exception as e:
        logger.warning(f"_extract_cast_from_source 실패 ({e}) — fallback")
        return None


async def _llm_select_cast(world: dict, index: list[dict]) -> list[dict] | None:
    """call_free_llm으로 세계관+소스를 인지하여 27명 풀에서 이야기에 맞는 캐릭터 선발.

    성공 시 최소 4명 이상의 캐릭터 리스트 반환. 실패 시 None 반환(fallback 트리거).
    """
    from services.gemini_helper import call_free_llm, extract_json

    # 캐릭터 풀 요약 (프롬프트 토큰 절약)
    pool_lines = []
    for c in index:
        role_str = "/".join(c.get("role_pool", []))
        pool_lines.append(
            f'id="{c["id"]}" 이름="{c["name"]}" 성별={c["gender"]} 나이={c["age"]} '
            f'직업="{c["occupation"]}" 역할풀={role_str} 역할="{c["role"]}"'
        )
    pool_text = "\n".join(pool_lines)

    topic          = world.get("topic", "")
    genre          = world.get("genre", "미분류")
    conflict_types = world.get("conflictTypes") or []
    world_summary  = world.get("worldSummary") or world.get("socialBackground") or ""
    source_summary = (world.get("source_summary") or {}).get("summary", "")
    opening_hook   = world.get("openingHook", "")

    prompt = f"""다음 이야기에 어울리는 캐릭터를 아래 풀에서 선발하라.

== 이야기 정보 ==
주제: {topic}
장르: {genre}
갈등 유형: {', '.join(conflict_types) if conflict_types else '미정'}
세계관 요약: {world_summary}
소스 요약: {source_summary}
오프닝 훅: {opening_hook}

== 캐릭터 풀 ({len(index)}명) ==
{pool_text}

== 선발 규칙 ==
- protagonist_a와 protagonist_b는 반드시 서로 다른 성별
- antagonist는 role_pool에 antagonist가 포함된 캐릭터 우선 (없으면 villain_intensity가 높은 캐릭터)
- catalyst는 2명 (role_pool에 catalyst 포함 캐릭터 우선)
- supporting은 1~3명 (이야기 테마와 관련성 높은 캐릭터)
- 같은 id를 두 역할에 중복 사용 절대 금지
- 이야기의 시대/장르/갈등 구조에 가장 어울리는 성격과 역할을 가진 캐릭터를 선택
- 풀에 없는 id는 절대 사용 금지

아래 JSON만 출력하라. 설명·마크다운·코드블록 없이 순수 JSON만.
{{
  "protagonist_a": "캐릭터 id",
  "protagonist_b": "캐릭터 id",
  "antagonist": "캐릭터 id",
  "catalysts": ["캐릭터 id", "캐릭터 id"],
  "supporting": ["캐릭터 id"],
  "reason": "선발 이유 한 줄"
}}"""

    try:
        raw = await call_free_llm(prompt, max_tokens=600, temperature=0.8)
        data = extract_json(raw)

        id_map = {c["id"]: c for c in index}
        selected_ids: list[str] = []
        role_map: dict[str, str] = {}  # id → story role

        def _add(cid: str, story_role: str) -> bool:
            if cid and cid in id_map and cid not in selected_ids:
                selected_ids.append(cid)
                role_map[cid] = story_role
                return True
            return False

        _add(data.get("protagonist_a", ""), "protagonist_a")
        _add(data.get("protagonist_b", ""), "protagonist_b")
        _add(data.get("antagonist", ""), "antagonist")
        for cid in (data.get("catalysts") or []):
            _add(cid, "catalyst")
        for cid in (data.get("supporting") or []):
            _add(cid, "supporting")

        if len(selected_ids) < 4:
            logger.warning(f"_llm_select_cast: 선발 캐릭터 수 부족 ({len(selected_ids)}명) — fallback")
            return None

        result = []
        for cid in selected_ids:
            char = dict(id_map[cid])
            char["role_in_story"] = role_map[cid]
            result.append(char)

        logger.info(f"_llm_select_cast: {len(result)}명 선발 성공 — {[c['name'] for c in result]}")
        return result

    except Exception as e:
        logger.warning(f"_llm_select_cast 실패 ({e}) — fallback")
        return None


async def run_casting(series_id: str) -> dict:
    """
    LLM 기반 소스-인지 캐스팅 (call_free_llm 우선) → 실패 시 트롭 기반 fallback
    → world_data에 저장 + RAG 인제스트
    """
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}

    index = _load_index()
    # source_summary.filename 이 있으면 소스가 업로드된 것 → 자동으로 extract 모드
    _has_source = bool((world.get("source_summary") or {}).get("filename"))
    source_mode = "extract" if _has_source else world.get("sourceMode", "design")
    cast_overlay: dict = {}

    # ── 소스 추출 캐스팅 (sourceMode='extract') ───────────────────────────────
    if source_mode == "extract":
        cast = await _extract_cast_from_source(world, series_id, index)
        trope = "source_extracted"
        # 소스에서 직접 추출한 캐릭터 → persona_overlay 불필요

    # ── LLM 풀 기반 캐스팅 (sourceMode='design' 또는 소스 없음) ──────────────
    else:
        cast = await _llm_select_cast(world, index)
        trope = "llm_selected" if cast is not None else _infer_trope(world.get("topic", ""), world.get("genre", ""), world)

        # ── fallback: 트롭 기반 결정론적 캐스팅 ──────────────────────────────
        if cast is None:
            conflict_types = world.get("conflictTypes") or []
            trope = conflict_types[0].lower().replace(" ", "_") if conflict_types else _infer_trope(world.get("topic", ""), world.get("genre", ""), world)
            if trope not in TROPE_TAG_MAP:
                trope = _infer_trope(world.get("topic", ""), world.get("genre", ""), world)
            seed = int(series_id.replace("-", ""), 16) % (10 ** 9)
            cast = cast_for_trope(trope, seed=seed)

        # ── Persona Overlay (시대물·판타지 소스 대응, 풀 기반일 때만) ────────
        from services.persona_overlay_service import generate_persona_overlay, apply_persona_overlay
        cast_overlay = await generate_persona_overlay(world, cast)
        cast = apply_persona_overlay(cast, cast_overlay)

    # extract 실패 시 design 모드 fallback — 세계관 기반 트롭 사용
    if cast is None:
        seed = int(series_id.replace("-", ""), 16) % (10 ** 9)
        trope = _infer_trope(world.get("topic", ""), world.get("genre", ""), world)
        cast = cast_for_trope(trope, seed=seed)

    # 주인공 2명 정보 world_data에 저장
    char_a = cast[0] if len(cast) >= 1 else {}
    char_b = cast[1] if len(cast) >= 2 else char_a

    # 상세 정보 로드 — extracted 캐릭터는 인라인 core/situations 사용
    if char_a.get("is_extracted"):
        core_a  = char_a.get("core") or {}
        detail_a: dict = {"situations": char_a.get("situations", []), "relationships": {}}
    else:
        detail_a = _load_detail(char_a.get("id", ""))
        core_a   = detail_a.get("core", {})

    if char_b.get("is_extracted"):
        core_b  = char_b.get("core") or {}
        detail_b: dict = {"situations": char_b.get("situations", []), "relationships": {}}
    else:
        detail_b = _load_detail(char_b.get("id", ""))
        core_b   = detail_b.get("core", {})

    # 이름·직업 우선순위: persona_* > 원본 (extracted는 이미 원본 이름이 최종값)
    name_a = char_a.get("persona_name") or char_a.get("name", "주인공A")
    name_b = char_b.get("persona_name") or char_b.get("name", "주인공B")
    occ_a  = char_a.get("persona_occupation") or char_a.get("occupation", "")
    occ_b  = char_b.get("persona_occupation") or char_b.get("occupation", "")
    sit_a  = (char_a.get("persona_situations") or detail_a.get("situations") or [""])[0]
    sit_b  = (char_b.get("persona_situations") or detail_b.get("situations") or [""])[0]

    # ── Gate 1 (LD-017): 두 주인공의 가족 컨텍스트 로드 ───────────────────────
    # extracted 캐릭터는 캐릭터 JSON 파일이 없으므로 detail에서 직접 읽는다
    charA_id = char_a.get("id", "")
    charB_id = char_b.get("id", "")

    if char_a.get("is_extracted"):
        # 소스에서 추출된 캐릭터 — 가족 정보 없음 (빈 딕셔너리)
        char_a_ctx: dict = {"family_group": "", "relationships": {}}
    else:
        char_a_ctx = _load_char_family_context(charA_id)

    if char_b.get("is_extracted"):
        char_b_ctx: dict = {"family_group": "", "relationships": {}}
    else:
        char_b_ctx = _load_char_family_context(charB_id)

    fg_a = char_a_ctx.get("family_group", "")
    fg_b = char_b_ctx.get("family_group", "")

    patch: dict = {
        "charA":              charA_id,
        "charAName":          name_a,
        "charAVoice":         char_a.get("voice_id", ""),
        "charAOccupation":    occ_a,
        "charASpeakingStyle": core_a.get("speaking_style", ""),
        "charASecret":        core_a.get("lie_to_self", ""),           # lie_to_self → Secret
        "charASituation":     sit_a,
        "charAFear":          core_a.get("fear", ""),
        "charAPersonality":   core_a.get("personality", ""),
        "charAFaceGrid":      char_a.get("face_grid_url", ""),
        "charB":              charB_id,
        "charBName":          name_b,
        "charBVoice":         char_b.get("voice_id", ""),
        "charBOccupation":    occ_b,
        "charBSpeakingStyle": core_b.get("speaking_style", ""),
        "charBSecret":        core_b.get("lie_to_self", ""),
        "charBSituation":     sit_b,
        "charBFear":          core_b.get("fear", ""),
        "charBPersonality":   core_b.get("personality", ""),
        "charBFaceGrid":      char_b.get("face_grid_url", ""),
        "castTrope":          trope,
        "castOverlay":        cast_overlay,                            # persona overlay 영속화
        "fullCast":           [{"id": c["id"], "name": c.get("persona_name") or c["name"], "role": c.get("persona_role") or c.get("role", "")} for c in cast],
        "fullCastDetails":    _build_full_cast_details(cast),  # 전체 캐릭터 상세 (UI 표시용)
        # ── 관계 모델링 필드 6개 (LD-017) ────────────────────────────────────
        # family_group이 같으면 "family", 다르면 "strangers" (결정론적 산출)
        # architect 단계에서 더 정밀하게 덮어쓸 수 있음
        "charAFamilyGroup":            fg_a,
        "charBFamilyGroup":            fg_b,
        "charARelationships":          char_a_ctx.get("relationships", {}),
        "charBRelationships":          char_b_ctx.get("relationships", {}),
        "relationshipAtCh01Start":     _determine_initial_relationship(fg_a, fg_b),
        "relationshipAtCh01Description": "",  # architect 단계에서 채움
    }
    world.update(patch)

    await asyncio.to_thread(
        lambda: db.table("v3_series").update({"world_data": world}).eq("id", series_id).execute()
    )

    # 캐릭터 프롬프트 RAG 인제스트
    char_injection = build_character_injection(cast)
    await ingest_chunk(series_id, "character", char_injection, source_ref=f"casting:{trope}")

    # 주인공 상세 인제스트
    for detail, name in [(detail_a, char_a.get("name", "")), (detail_b, char_b.get("name", ""))]:
        prompt = detail.get("core", {}).get("personality", "")
        situations = "\n".join(detail.get("situations") or [])
        if prompt or situations:
            await ingest_chunk(series_id, "character",
                               f"{name} 성격: {prompt}\n상황: {situations}",
                               source_ref=f"character:{detail.get('id', '')}")

    cast_summary = [f"- {c.get('persona_name') or c['name']} ({c.get('persona_role') or c.get('role', '')})" for c in cast]
    return {"ok": True, "trope": trope, "cast": cast_summary}


def _build_full_cast_details(cast: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """전체 캐스트의 상세 정보를 UI 표시용으로 조합.

    is_extracted=True 인 소스 추출 캐릭터는 인라인 core/situations 사용.
    풀 기반 캐릭터는 기존대로 개별 JSON 파일에서 로드.
    """
    result = []
    for c in cast:
        if c.get("is_extracted"):
            core = c.get("core") or {}
            detail: dict = {"situations": c.get("situations", []), "relationships": {}}
        else:
            detail = _load_detail(c.get("id", ""))
            core = detail.get("core", {})

        result.append({
            "id":            c.get("id", ""),
            "name":          c.get("persona_name") or c.get("name", ""),
            "gender":        c.get("gender", ""),
            "age":           c.get("age", 0),
            "age_group":     c.get("age_group", ""),
            "occupation":    c.get("persona_occupation") or c.get("occupation", ""),
            "role":          c.get("role", ""),
            "role_in_story": c.get("persona_role") or c.get("role_in_story", ""),
            "family_group":  c.get("family_group", ""),
            "personality":   core.get("personality", ""),
            "speaking_style": core.get("speaking_style", ""),
            "concern":       core.get("concern", ""),
            "fear":          core.get("fear", ""),
            "lie_to_self":   core.get("lie_to_self", ""),
            "under_stress":  core.get("under_stress", ""),
            "situations":    c.get("persona_situations") or detail.get("situations", []),
            "relationships": detail.get("relationships", {}),
            "photo_real_url":   detail.get("photo_real_url", "") or c.get("photo_real_url", ""),
            "photo_polystyle_url": detail.get("photo_polystyle_url", "") or c.get("photo_polystyle_url", ""),
            "face_grid_url": c.get("face_grid_url", ""),
        })
    return result


def apply_user_secrets(user_secrets: dict[str, str], world: dict) -> dict:
    """
    비밀 투입 처리:
    1. 각 캐릭터 JSON의 situations 맨 앞에 영구 추가
    2. fullCastDetails의 situations도 동기화
    3. 조연(index >= 2)이 비밀 투입되면 elevatedCast에 full detail 추가
    """
    full_cast_details: list[dict] = world.get("fullCastDetails") or []
    char_index = {c["id"]: i for i, c in enumerate(full_cast_details)}
    elevated: list[dict] = []

    for char_id, secret in user_secrets.items():
        secret = secret.strip()
        if not secret:
            continue

        new_situation = f"★ 투입된 비밀: {secret}"

        # 1. 캐릭터 JSON 파일 영구 저장
        path = _DATA_DIR / f"{char_id}.json"
        if path.exists():
            char_data = json.loads(path.read_text(encoding="utf-8"))
            situations: list[str] = char_data.get("situations", [])
            # 중복 방지: 이전 투입 비밀 제거 후 맨 앞에 추가
            situations = [s for s in situations if not s.startswith("★ 투입된 비밀:")]
            situations.insert(0, new_situation)
            char_data["situations"] = situations
            path.write_text(json.dumps(char_data, ensure_ascii=False, indent=2), encoding="utf-8")

        # 2. fullCastDetails 동기화
        idx = char_index.get(char_id)
        if idx is not None:
            d = full_cast_details[idx]
            sits = [s for s in d.get("situations", []) if not s.startswith("★ 투입된 비밀:")]
            sits.insert(0, new_situation)
            full_cast_details[idx] = {**d, "situations": sits}

        # 3. 조연이면 elevatedCast에 추가
        if idx is not None and idx >= 2:
            detail = full_cast_details[idx].copy()
            detail["userSecret"] = secret
            elevated.append(detail)

    if full_cast_details:
        world["fullCastDetails"] = full_cast_details
    if elevated:
        world["elevatedCast"] = elevated

    return world


def _infer_trope(topic: str, genre: str, world: dict | None = None) -> str:
    """topic/genre 텍스트에서 가장 근접한 트롭 추론.

    world.conflictTypes 첫 번째 값이 있으면 그것을 우선 사용 (자유 텍스트 허용).
    키워드 미매칭 시 'affair' 폴백.
    """
    # world.conflictTypes 우선 참조
    if world:
        conflict_types = world.get("conflictTypes") or []
        if conflict_types:
            first_conflict = conflict_types[0].lower().replace(" ", "_")
            if first_conflict in TROPE_TAG_MAP:
                return first_conflict
            # TROPE_TAG_MAP에 없어도 자유 텍스트 그대로 반환 (cast_for_trope가 fallback 처리)
            if first_conflict:
                return first_conflict

    combined = (topic + " " + genre).lower()
    keyword_map = {
        # 현대극
        "불륜": "affair", "외도": "affair", "바람": "affair",
        "이혼": "divorce", "재혼": "remarriage",
        "직장": "office_romance", "오피스": "office_romance",
        "상속": "inheritance", "유산": "inheritance",
        "재개발": "redevelopment", "철거": "redevelopment",
        "중년": "midlife_crisis", "위기": "midlife_crisis",
        "청년": "youth", "취업": "youth",
        "시어머니": "in_law", "고부": "in_law",
        "고독": "isolation", "노인": "isolation",
        "갑질": "power_abuse", "권력": "power_abuse",
        # 비현대 장르 — persona_overlay가 이름·시대 오버라이드
        "역사": "historical", "조선": "historical", "고려": "historical",
        "시대극": "historical", "사극": "historical", "장군": "historical",
        "판타지": "fantasy", "마법": "fantasy", "용": "fantasy", "이세계": "fantasy",
        "무협": "martial", "무사": "martial", "검": "martial",
        "전쟁": "war", "전투": "war", "군": "war",
        "sf": "fantasy", "미래": "fantasy",
    }
    for kw, trope in keyword_map.items():
        if kw in combined:
            return trope
    return "general"  # 현대/비현대 불명 → 중립 트롭
