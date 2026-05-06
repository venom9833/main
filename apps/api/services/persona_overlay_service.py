"""Persona Overlay 서비스 — 시대물·판타지 소스에서 캐릭터 이름·시대·직업·상황 오버라이드.

원본 캐릭터의 voice_id, face_grid_url, personality 등 자산은 절대 덮어쓰지 않는다.
오버레이 정보는 cast 딕셔너리의 persona_* 필드에만 추가한다.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# 현대 한국 드라마 감지용 키워드
_MODERN_KOREAN_KEYWORDS = {
    "현대", "21세기", "도시", "서울", "직장", "아파트",
    "대한민국", "2000년대", "1990년대", "회사", "오피스", "강남",
}

# 비현대 장르 확정 키워드 — 이 중 하나라도 있으면 오버레이 필수 (현대 키워드보다 우선)
_NON_MODERN_KEYWORDS = {
    "역사", "판타지", "무협", "sf", "사극", "시대극", "고려", "조선",
    "고대", "중세", "왕조", "장군", "무사", "기사", "마법", "용",
    "이세계", "전쟁", "병사", "갑옷", "검술", "무림",
}


def _is_modern_korean(world: dict) -> bool:
    """세계관이 현대 한국 드라마이면 True — 오버레이 불필요.

    비현대 장르 키워드가 있으면 False 우선 (역방향 조건).
    genre, selectedOptions.background, socialBackground 에서 키워드 확인.
    """
    genre: str = world.get("genre", "")
    background: str = world.get("selectedOptions", {}).get("background", "")
    social_background: str = world.get("socialBackground", "")
    topic: str = world.get("topic", "")

    combined = f"{genre} {background} {social_background} {topic}".lower()

    # 역방향 우선: 비현대 키워드가 하나라도 있으면 반드시 오버레이 실행
    for kw in _NON_MODERN_KEYWORDS:
        if kw in combined:
            return False

    # conflictTypes 기반 추가 판단: 현대 드라마 전형 키워드
    conflict_types: list[str] = world.get("conflictTypes") or []
    modern_conflict_keywords = {"불륜", "이혼", "재혼", "직장", "재개발", "상속", "갑질", "취업"}
    for ct in conflict_types:
        for kw in modern_conflict_keywords:
            if kw in ct:
                return True

    for kw in _MODERN_KOREAN_KEYWORDS:
        if kw in combined:
            return True

    return False


async def generate_persona_overlay(world: dict, cast_chars: list[dict]) -> dict[str, Any]:
    """세계관 소스 기반으로 각 캐릭터에 맞는 Persona Overlay 생성.

    현대 한국 드라마이면 즉시 {} 반환.
    시대물·판타지·SF 등에서만 Gemini를 호출해 이름·시대·직업·상황을 오버라이드한다.

    Returns:
        { char_id: { persona_name, era, occupation, role_in_story, situations } }
        실패 시 빈 딕셔너리 {} 반환 — 기존 동작 폴백.
    """
    if _is_modern_korean(world):
        return {}

    if not cast_chars:
        return {}

    from services.gemini_helper import call_gemini, extract_json

    topic: str = world.get("topic", "")
    genre: str = world.get("genre", "미분류")
    world_summary: str = world.get("worldSummary", world.get("socialBackground", ""))
    n = len(cast_chars)

    # 캐릭터 목록 — char_id와 기존 역할만 넘겨 Gemini가 맥락 파악하도록
    char_list_text = "\n".join(
        f'- char_id="{c.get("id", "")}", 기존역할="{c.get("role", "")}", 성별="{c.get("gender", "")}", 나이={c.get("age", "?")}'
        for c in cast_chars
    )

    prompt = f"""소스 정보:
- 토픽: {topic}
- 장르: {genre}
- 세계관 요약: {world_summary}

이 이야기에 등장하는 인물 {n}명 각각에 대해 JSON 배열로 반환하라.
각 인물은 위 세계관에 맞는 이름·시대·직업·이야기 내 역할·상황 3가지를 가진다.

등장 인물 목록:
{char_list_text}

아래 JSON 배열만 출력한다. 설명·마크다운·코드블록 없이 순수 JSON만 출력한다.
배열 크기는 정확히 {n}개여야 한다.

[
  {{
    "char_id": "위 목록의 char_id 그대로",
    "persona_name": "이 세계관에 맞는 이름 (한국어 또는 장르에 맞는 이름)",
    "era": "시대 (예: 조선 중기, 현대 판타지 왕국, 2387년 우주연합)",
    "occupation": "이 세계관에 맞는 직업·신분",
    "role_in_story": "이 이야기에서의 역할 한 줄",
    "situations": [
      "이 세계관에서 처한 상황 1",
      "이 세계관에서 처한 상황 2",
      "이 세계관에서 처한 상황 3"
    ]
  }}
]"""

    try:
        # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 — 비현대 장르(역사/판타지/SF)에서만 호출
        raw = await call_gemini(prompt, max_tokens=2000, temperature=0.7)

        # 배열 파싱 — extract_json은 dict용이므로 직접 파싱
        # 코드블록 제거
        import re
        code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', raw)
        if code_match:
            raw = code_match.group(1).strip()
        # 배열 추출
        arr_match = re.search(r'\[[\s\S]*\]', raw)
        if not arr_match:
            logger.warning("persona_overlay: Gemini 응답에서 배열을 찾지 못함 — 폴백")
            return {}

        data = json.loads(arr_match.group(0))
        if not isinstance(data, list):
            logger.warning("persona_overlay: 응답이 리스트가 아님 — 폴백")
            return {}

        overlay: dict[str, Any] = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            char_id = item.get("char_id", "")
            if not char_id:
                continue
            overlay[char_id] = {
                "persona_name":    item.get("persona_name", ""),
                "era":             item.get("era", ""),
                "occupation":      item.get("occupation", ""),
                "role_in_story":   item.get("role_in_story", ""),
                "situations":      item.get("situations", []),
            }
        return overlay

    except Exception as e:
        logger.warning(f"persona_overlay: Gemini 호출 실패 ({e}) — 빈 오버레이 반환")
        return {}


def apply_persona_overlay(cast_chars: list[dict], overlay: dict[str, Any]) -> list[dict]:
    """overlay 정보를 cast_chars의 persona_* 필드에 추가.

    원본 name, voice_id, face_grid_url 등은 절대 덮어쓰지 않는다.
    overlay가 비어 있으면 cast_chars 그대로 반환.
    """
    if not overlay:
        return cast_chars

    result: list[dict] = []
    for char in cast_chars:
        char_id = char.get("id", "")
        persona = overlay.get(char_id)
        if persona:
            # 얕은 복사 후 persona_* 필드만 추가
            updated = dict(char)
            updated["persona_name"]       = persona.get("persona_name", "")
            updated["persona_era"]        = persona.get("era", "")
            updated["persona_occupation"] = persona.get("occupation", "")
            updated["persona_situations"] = persona.get("situations", [])
            updated["persona_role"]       = persona.get("role_in_story", "")
            result.append(updated)
        else:
            result.append(char)

    return result
