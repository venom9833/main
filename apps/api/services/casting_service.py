"""캐스팅 서비스 — 트롭 기반 결정론적 캐스팅 (AI 호출 0회)
V2 series_casting_service.py 로직 이관 + V3 Supabase 저장
"""
from __future__ import annotations

import asyncio
import json
import random
from pathlib import Path
from typing import Any, Optional

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


# ── V3 파이프라인 연동 ────────────────────────────────────────────────────────

async def run_casting(series_id: str) -> dict:
    """
    world_data의 트롭 → 트롭 기반 캐스팅 → world_data에 저장 + RAG 인제스트
    """
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}

    # 트롭 결정: conflictTypes → 첫 번째, 없으면 topic 기반 추론
    conflict_types = world.get("conflictTypes") or []
    trope = conflict_types[0].lower().replace(" ", "_") if conflict_types else "affair"
    # TROPE_TAG_MAP에 없으면 가장 근접한 키워드 매핑
    if trope not in TROPE_TAG_MAP:
        trope = _infer_trope(world.get("topic", ""), world.get("genre", ""))

    cast = cast_for_trope(trope, seed=hash(series_id) % 10000)

    # 주인공 2명 정보 world_data에 저장
    char_a = cast[0] if len(cast) >= 1 else {}
    char_b = cast[1] if len(cast) >= 2 else char_a

    # 상세 정보 로드 (situations, core 포함)
    detail_a = _load_detail(char_a.get("id", ""))
    detail_b = _load_detail(char_b.get("id", ""))

    # 실제 캐릭터 리스트의 이름을 무조건 사용 — world_service가 창작한 가상 이름 무시
    core_a = detail_a.get("core", {})
    core_b = detail_b.get("core", {})
    patch: dict = {
        "charA":              char_a.get("id", ""),
        "charAName":          char_a.get("name", "주인공A"),          # 리스트 실명 강제
        "charAVoice":         char_a.get("voice_id", ""),
        "charAOccupation":    char_a.get("occupation", ""),
        "charASpeakingStyle": core_a.get("speaking_style", ""),
        "charASecret":        core_a.get("lie_to_self", ""),           # lie_to_self → Secret
        "charASituation":     (detail_a.get("situations") or [""])[0],
        "charAFear":          core_a.get("fear", ""),
        "charAPersonality":   core_a.get("personality", ""),
        "charAFaceGrid":      char_a.get("face_grid_url", ""),
        "charB":              char_b.get("id", ""),
        "charBName":          char_b.get("name", "주인공B"),           # 리스트 실명 강제
        "charBVoice":         char_b.get("voice_id", ""),
        "charBOccupation":    char_b.get("occupation", ""),
        "charBSpeakingStyle": core_b.get("speaking_style", ""),
        "charBSecret":        core_b.get("lie_to_self", ""),
        "charBSituation":     (detail_b.get("situations") or [""])[0],
        "charBFear":          core_b.get("fear", ""),
        "charBPersonality":   core_b.get("personality", ""),
        "charBFaceGrid":      char_b.get("face_grid_url", ""),
        "castTrope":          trope,
        "fullCast":           [{"id": c["id"], "name": c["name"], "role": c.get("role", "")} for c in cast],
        "fullCastDetails":    _build_full_cast_details(cast),  # 전체 캐릭터 상세 (UI 표시용)
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

    cast_summary = [f"- {c['name']} ({c.get('role', '')})" for c in cast]
    return {"ok": True, "trope": trope, "cast": cast_summary}


def _build_full_cast_details(cast: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """전체 캐스트의 상세 정보를 UI 표시용으로 조합"""
    result = []
    for c in cast:
        detail = _load_detail(c.get("id", ""))
        core = detail.get("core", {})
        result.append({
            "id":            c.get("id", ""),
            "name":          c.get("name", ""),
            "gender":        c.get("gender", ""),
            "age":           c.get("age", 0),
            "age_group":     c.get("age_group", ""),
            "occupation":    c.get("occupation", ""),
            "role":          c.get("role", ""),
            "role_in_story": c.get("role_in_story", ""),
            "family_group":  c.get("family_group", ""),
            "personality":   core.get("personality", ""),
            "speaking_style": core.get("speaking_style", ""),
            "concern":       core.get("concern", ""),
            "fear":          core.get("fear", ""),
            "lie_to_self":   core.get("lie_to_self", ""),
            "under_stress":  core.get("under_stress", ""),
            "situations":    detail.get("situations", []),
            "relationships": detail.get("relationships", {}),
            "photo_real_url":   detail.get("photo_real_url", "") or c.get("photo_real_url", ""),
            "photo_masako_url": detail.get("photo_masako_url", "") or c.get("photo_masako_url", ""),
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


def _infer_trope(topic: str, genre: str) -> str:
    """topic/genre 텍스트에서 가장 근접한 트롭 추론"""
    combined = (topic + " " + genre).lower()
    keyword_map = {
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
    }
    for kw, trope in keyword_map.items():
        if kw in combined:
            return trope
    return "affair"  # 기본 트롭
