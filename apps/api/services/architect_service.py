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
    raw = await call_gemini(prompt, max_tokens=4000, temperature=0.7)

    data = extract_json(raw)
    plan_md: str = data.get("series_plan_md", raw)
    story_arc: dict = data.get("story_arc", {})

    # 1. wiki 'series_plan' 페이지 저장 (인간 가독용)
    await upsert_wiki_page(series_id, "series_plan", plan_md)

    # 2. world_data.storyArc 갱신 → script_service.py arc_hint가 자동 소비
    if story_arc:
        world["storyArc"] = story_arc
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

## {char_b}
- 비밀: {b_secret}
- Want: {b_want}

위 정보를 바탕으로 6챕터 시리즈 설계도를 작성하라.
"""
