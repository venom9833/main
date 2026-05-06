# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""Architect 에이전트 — 시리즈 전체 구조 설계 (InkOS Architect 역할)

CASTING 완료 직후 파이프라인에서 1회만 실행.

출력:
- wiki 'series_plan' 페이지: 6챕터 전체 설계도 (인간 가독용 마크다운)
- v3_series.world_data.storyArc: 챕터별 방향 힌트 dict
  → script_service.py의 arc_hint 블록이 자동 소비
"""
import asyncio
from pathlib import Path
from core.database import get_supabase
from services.gemini_helper import call_gemini, extract_json
from services.wiki_service import upsert_wiki_page

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _fmt_relationships(rels: dict, max_chars: int = 60) -> str:
    """관계 딕셔너리를 프롬프트에 주입 가능한 한 줄 텍스트로 변환한다.

    토큰 절약을 위해 각 항목을 max_chars 글자로 truncate하고 " / "로 연결한다.
    관계 정보가 없으면 "정보 없음"을 반환한다.
    """
    if not rels:
        return "정보 없음"
    parts = []
    for person, desc in rels.items():
        short = desc[:max_chars] if len(desc) > max_chars else desc
        parts.append(f"{person}: {short}")
    return " / ".join(parts)


async def run_architect(series_id: str) -> dict:
    """세계관 → 6챕터 설계도 생성 → wiki series_plan + storyArc 갱신"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data")
        .eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}

    prompt = _build_prompt(world)
    # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 — architect 설계도 생성, 시리즈당 1회
    raw = await call_gemini(prompt, max_tokens=4000, temperature=0.7)

    data = extract_json(raw)
    plan_md: str = data.get("series_plan_md", raw)
    story_arc: dict = data.get("story_arc", {})
    ch01_cliffhanger: str = data.get("ch01_cliffhanger", "")

    # 1. wiki 'series_plan' 페이지 저장 (인간 가독용)
    await upsert_wiki_page(series_id, "series_plan", plan_md)

    # 2. world_data 갱신 — storyArc + ch01Cliffhanger + relationship_state (LD-017)
    updated = False
    if story_arc:
        world["storyArc"] = story_arc
        updated = True
    if ch01_cliffhanger:
        world["ch01Cliffhanger"] = ch01_cliffhanger
        updated = True

    # Gate 2b (LD-017): architect가 결정한 관계 상태를 world_data에 저장
    # casting 단계의 결정론적 초기값을 architect가 보정할 수 있음
    rel_state: dict = data.get("relationship_state") or {}
    if rel_state.get("ch01_start"):
        world["relationshipAtCh01Start"] = rel_state["ch01_start"]
        updated = True
    if rel_state.get("ch01_start_description"):
        world["relationshipAtCh01Description"] = rel_state["ch01_start_description"]
        updated = True

    if updated:
        await asyncio.to_thread(
            lambda: db.table("v3_series")
            .update({"world_data": world})
            .eq("id", series_id).execute()
        )

    return {
        "ok": True,
        "series_id": series_id,
        "wiki_page": "series_plan",
        "chapters": len(story_arc),
        "ch01_cliffhanger": ch01_cliffhanger,
    }


def _build_prompt(world: dict) -> str:
    char_a = world.get("charAName", "주인공A")
    char_b = world.get("charBName", "주인공B")
    topic = world.get("topic", "")
    genre = world.get("genre", "")
    conflict = ", ".join(world.get("conflictTypes") or [])
    core_theme = world.get("coreTheme", "")
    opening_hook = world.get("openingHook", "")
    social_bg = world.get("socialBackground", "")
    a_secret = world.get("charASecret", "")
    b_secret = world.get("charBSecret", "")
    a_want = world.get("charAWant", "")
    b_want = world.get("charBWant", "")

    # Gate 2b (LD-017): casting 단계에서 산출된 관계 컨텍스트를 프롬프트에 주입
    # family_group이 다르면 두 사람은 기본적으로 모르는 사이임을 architect에게 전달
    char_a_rels_block = _fmt_relationships(world.get("charARelationships") or {})
    char_b_rels_block = _fmt_relationships(world.get("charBRelationships") or {})
    fg_a = world.get("charAFamilyGroup", "")
    fg_b = world.get("charBFamilyGroup", "")
    same_family = (
        "예 (같은 가족 단위 — 기혼·혈연 가능성 높음)"
        if (fg_a and fg_b and fg_a == fg_b)
        else "아니오 (다른 가족 단위 — 기본적으로 서로 모르는 사이)"
    )
    # casting 단계의 결정론적 초기값 (architect가 보정 가능)
    initial_rel = world.get("relationshipAtCh01Start", "strangers")

    template = (_PROMPTS_DIR / "architect.md").read_text(encoding="utf-8")

    return f"""{template}

=== 시리즈 정보 ===
- 주제: {topic}
- 장르: {genre}
- 갈등 유형: {conflict}
- 핵심 주제의식: {core_theme}
- 오프닝 훅: {opening_hook}
- 사회적 배경: {social_bg}

=== 등장인물 ===
## {char_a}
- 비밀: {a_secret}
- Want: {a_want}
- 가족·관계: {char_a_rels_block}
- family_group: {fg_a if fg_a else "미정"}

## {char_b}
- 비밀: {b_secret}
- Want: {b_want}
- 가족·관계: {char_b_rels_block}
- family_group: {fg_b if fg_b else "미정"}

=== 관계 컨텍스트 (LD-017 — 반드시 반영) ===
- 두 사람이 같은 가족 단위인가: {same_family}
- casting 단계 초기 관계 상태: {initial_rel}
- ⚠️ relationship_state.ch01_start를 반드시 출력 JSON에 포함할 것

위 정보를 바탕으로 6챕터 시리즈 설계도를 작성하라.
"""
