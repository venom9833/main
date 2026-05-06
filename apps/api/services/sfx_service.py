"""sfx_service.py — SFX 계획 결정 서비스 (Gemini 0회)

규칙 테이블(sfx_rules.json)로만 동작.
  resolve_sfx_plan(scene_row) → sfx_plan dict
  sfx_plan = {
      "ambience": {"file": "ambience/office_night.ogg", "volume_db": -28} | None,
      "bed":      {"file": "bed/tension.ogg",           "volume_db": -30} | None,
      "oneshots": [{"file": "oneshot/phone_ring.ogg", "keyword": "전화", "volume_db": -16}, ...]
  }
"""
import json
from pathlib import Path
from functools import lru_cache

_RULES_PATH = Path(__file__).parent.parent / "data" / "sfx_rules.json"
_ASSETS_ROOT  = Path(__file__).parent.parent.parent.parent / "linkdrop-assets"
SFX_ASSETS_DIR = _ASSETS_ROOT / "sfx"
BGM_ASSETS_DIR = _ASSETS_ROOT / "bgm"


@lru_cache(maxsize=1)
def _rules() -> dict:
    return json.loads(_RULES_PATH.read_text(encoding="utf-8"))


def resolve_sfx_plan(scene_row: dict) -> dict:
    """씬 DB 레코드 → SFX 계획 (Gemini 0회, 규칙 테이블만).

    Args:
        scene_row: v3_scenes 레코드 dict (scene_meta, text, type 포함)

    Returns:
        {
            "ambience": {"file": str, "volume_db": int} | None,
            "bed":      {"file": str, "volume_db": int} | None,
            "oneshots": [{"file": str, "keyword": str, "volume_db": int}]
        }
    """
    rules = _rules()
    meta = scene_row.get("scene_meta") or {}
    text = scene_row.get("text") or ""
    cut_type = scene_row.get("type") or "narration"

    location = meta.get("location") or ""
    atmosphere = meta.get("atmosphere") or ""
    time_of_day = meta.get("time_of_day") or ""

    ambience = _match_ambience(rules, location, time_of_day)
    bed = _match_bed(rules, atmosphere)
    oneshots = _match_oneshots(rules, text)

    ambience, bed, oneshots = _apply_type_gain(rules, ambience, bed, oneshots, cut_type)

    return {"ambience": ambience, "bed": bed, "oneshots": oneshots}


# ── 내부 매처 ────────────────────────────────────────────────────────────────

def _match_ambience(rules: dict, location: str, time_of_day: str) -> dict | None:
    """location + time_of_day → ambience 항목 선택 (우선순위 높은 첫 히트)."""
    candidates = []
    for entry in rules.get("ambience", []):
        loc_hit = any(kw in location for kw in entry["location_keywords"])
        if not loc_hit:
            continue
        time_kws = entry.get("time_keywords") or []
        if time_kws:
            time_hit = any(kw in time_of_day for kw in time_kws)
            score = entry["priority"] + (5 if time_hit else 0)
        else:
            score = entry["priority"]
        candidates.append((score, entry))

    if candidates:
        _, best = max(candidates, key=lambda x: x[0])
        return {"file": best["file"], "volume_db": best["volume_db"]}

    fb = rules.get("fallback", {}).get("ambience")
    return {"file": fb["file"], "volume_db": fb["volume_db"]} if fb else None


def _match_bed(rules: dict, atmosphere: str) -> dict | None:
    """atmosphere → bed 항목 선택 (우선순위 높은 첫 히트)."""
    candidates = []
    for entry in rules.get("bed", []):
        if any(kw in atmosphere for kw in entry["atmosphere_keywords"]):
            candidates.append((entry["priority"], entry))

    if candidates:
        _, best = max(candidates, key=lambda x: x[0])
        return {"file": best["file"], "volume_db": best["volume_db"]}

    return rules.get("fallback", {}).get("bed")


def _match_oneshots(rules: dict, text: str) -> list[dict]:
    """텍스트 키워드 매칭 → oneshot 목록 (중복 없음, 우선순위 내림차순)."""
    matched: list[dict] = []
    seen_ids: set[str] = set()

    sorted_entries = sorted(rules.get("oneshot", []), key=lambda e: -e["priority"])
    for entry in sorted_entries:
        if entry["id"] in seen_ids:
            continue
        for kw in entry["text_keywords"]:
            if kw in text:
                matched.append({
                    "file": entry["file"],
                    "keyword": kw,
                    "volume_db": entry["volume_db"],
                })
                seen_ids.add(entry["id"])
                break

    return matched


def _apply_type_gain(
    rules: dict,
    ambience: dict | None,
    bed: dict | None,
    oneshots: list[dict],
    cut_type: str,
) -> tuple[dict | None, dict | None, list[dict]]:
    """컷 타입(dialogue/narration)에 따라 볼륨 조정."""
    adjustments = rules.get("type_gain_adjust", {}).get(cut_type, {})
    a_delta = adjustments.get("ambience_delta", 0)
    b_delta = adjustments.get("bed_delta", 0)
    o_delta = adjustments.get("oneshot_delta", 0)

    if ambience and a_delta:
        ambience = {**ambience, "volume_db": ambience["volume_db"] + a_delta}
    if bed and b_delta:
        bed = {**bed, "volume_db": bed["volume_db"] + b_delta}
    if o_delta:
        oneshots = [{**o, "volume_db": o["volume_db"] + o_delta} for o in oneshots]

    return ambience, bed, oneshots


def sfx_asset_path(relative_file: str) -> Path:
    """sfx 에셋 절대 경로 반환 (존재 여부 무관)."""
    return SFX_ASSETS_DIR / relative_file


def sfx_asset_exists(relative_file: str) -> bool:
    """sfx 에셋 파일 존재 여부 확인."""
    return sfx_asset_path(relative_file).exists()
