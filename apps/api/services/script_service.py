# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""대본 생성 서비스 — RAG 컨텍스트 주입 + 챕터별 생성"""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from core.database import get_supabase

# 이 모듈 전용 로거 — 서비스 계층 디버그/경고 메시지 출력에 사용
logger = logging.getLogger(__name__)
from services.gemini_helper import call_gemini
from services.openrouter_helper import call_judge_with_fallback, load_judge_prompt, get_revise_threshold
from services.wiki_service import build_rag_context, auto_update_wiki

_CHAR_DATA_DIR = Path(__file__).parent.parent / "data" / "characters"
_MAX_SITUATIONS = 5  # Gemini에 주입할 상황 최대 개수 (fallback)


def _max_situations_for_chapter(chapter: int) -> int:
    """ch01은 핵심 1개만, 이후는 2개까지 — 갈등 과잉 방지."""
    return 1 if chapter == 1 else 2


def _load_char_situations(char_id: str) -> list[str]:
    """캐릭터 JSON에서 최신 situations 로드 — 파일 없으면 빈 리스트"""
    if not char_id:
        return []
    path = _CHAR_DATA_DIR / f"{char_id}.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("situations") or []
    except Exception:
        return []


def _load_char_relationships(char_id: str) -> dict:
    """캐릭터 JSON의 relationships 객체를 반환한다.

    world_data에 charARelationships가 없는 기존 시리즈를 위한 fallback 함수.
    파일이 없거나 오류가 발생하면 빈 딕셔너리를 반환한다.
    """
    if not char_id:
        return {}
    path = _CHAR_DATA_DIR / f"{char_id}.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("relationships") or {}
    except Exception:
        return {}


def _fmt_char_relationships(char_name: str, rels: dict) -> str:
    """캐릭터 관계 딕셔너리를 프롬프트 블록 형태의 텍스트로 변환한다.

    토큰 절약을 위해 각 항목은 최대 60자로 truncate하고 최대 6개만 포함한다.
    LLM이 charB를 charA의 배우자로 잘못 묘사하지 않도록 관계를 명시한다.
    """
    if not rels:
        return f"  ({char_name} 관계 정보 없음)"
    lines = [f"  {char_name}의 현재 가족·관계:"]
    for person, desc in list(rels.items())[:6]:  # 최대 6개 항목
        short = desc[:60] if len(desc) > 60 else desc
        lines.append(f"    - {person}: {short}")
    return "\n".join(lines)


def _load_system_instruction() -> str:
    """apps/api/prompts/wiki_query.md SYSTEM_INSTRUCTION 블록 로드"""
    prompts_dir = Path(__file__).parent.parent / "prompts"
    raw = (prompts_dir / "wiki_query.md").read_text(encoding="utf-8")
    m = re.search(r"<!-- SYSTEM_INSTRUCTION -->([\s\S]+?)<!-- /SYSTEM_INSTRUCTION -->", raw)
    if not m:
        raise RuntimeError("wiki_query.md에서 SYSTEM_INSTRUCTION 블록을 찾을 수 없습니다")
    return m.group(1).strip()


_SYSTEM_INSTRUCTION = _load_system_instruction()

_CHAPTER_ROLES = ["도입부", "전개", "전개", "클라이맥스", "클라이맥스", "결말"]

_ROLE_GUIDE: dict[str, str] = {
    "도입부": (
        "## 도입부\n"
        "- 첫 문장은 감각 디테일로 시작. 주인공 A 한 명에만 집중. 사건 원인 설명 금지.\n"
        "- **주인공 최우선 목표 1개만 전면에 둔다.** 인물 관계를 모두 소개하려 하지 않는다.\n"
        "- 한 장면에 한 갈등만. 여러 갈등을 한 장면에 묶으면 모두 약해진다.\n"
        "- 마지막 훅은 다음 화에서 일어날 구체적인 사건을 예고하는 행동/발견으로 닫는다."
    ),
    "전개": (
        "## 전개\n"
        "- 앞 챕터 징후에서 이어받아 시작. 갈등을 한 단계 심화. 거짓말·회피 순간 포함.\n"
        "- 한 장면에 한 갈등만. 긴장은 감정 서술 대신 인물의 선택과 행동으로 보여준다.\n"
        "- 마지막 훅은 다음 화에서 일어날 구체적인 사건을 예고하는 행동/발견으로 닫는다."
    ),
    "클라이맥스": (
        "## 클라이맥스\n"
        "- 핵심 갈등 폭발·충돌. 반전/고백 1개 행동으로 드러냄.\n"
        "- 긴장은 감정 서술 대신 인물의 선택과 행동으로 보여준다.\n"
        "- 마지막 훅은 다음 화에서 일어날 구체적인 사건을 예고하는 행동/발견으로 닫는다."
    ),
    "결말": (
        "## 결말\n"
        "- 핵심 갈등의 감정적 해소. 열린 결말 또는 완결.\n"
        "- 여운 1문장으로 닫는다. 모든 것을 설명하지 않는다."
    ),
}


async def _detect_and_generate_guest_cast(
    series_id: str,
    scenes: list[dict],
    world: dict,
) -> None:
    """SCRIPT 완료 후 미등록 조연 감지 → Gemini 외모 생성 → world_data.guest_cast 저장.

    _index.json에 없는 이름만 처리. 이미 guest_cast에 있는 이름은 건너뜀.
    """
    from services.casting_service import generate_guest_cast

    # 등록 캐릭터 이름 집합
    idx_path = _CHAR_DATA_DIR.parent / "characters" / "_index.json"
    try:
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        known_names: set[str] = {c["name"] for c in idx.get("characters", [])}
    except Exception:
        return

    # 이미 생성된 guest_cast 이름 — 재생성 방지
    existing_guests: set[str] = set((world.get("guest_cast") or {}).keys())

    # 모든 씬의 characters 수집
    all_names: set[str] = set()
    for s in scenes:
        chars = (s.get("scene_meta") or {}).get("characters") or []
        all_names.update(chars)

    # 미등록 + 미생성 이름만
    guest_names = [
        n for n in all_names
        if n not in known_names and n not in existing_guests
    ]
    if not guest_names:
        return

    # 씬 컨텍스트 수집
    guest_info: list[dict] = []
    for name in guest_names:
        relevant = [
            {"text": s.get("text", "")[:150], "image_hint": s.get("image_hint", "")}
            for s in scenes
            if name in ((s.get("scene_meta") or {}).get("characters") or [])
        ]
        guest_info.append({"name": name, "scenes": relevant})

    await generate_guest_cast(series_id, guest_info)


async def _generate_outline(
    world: dict, chapter: int, role: str, prev_ending: str,
) -> str:
    """PRE-PASS — 챕터 청사진 조립.

    🔒 LD-005: storyArc 있으면 Python 직접 조립 (Gemini 0회).
    arc 없을 때만 Gemini PRE-PASS 호출 (~1200 tokens).
    실패 시 빈 문자열 반환 (STEP1은 청사진 없이 계속 진행).
    """
    arc = (world.get("storyArc") or {}).get(f"ch{chapter:02d}", "")
    role_guide = _ROLE_GUIDE.get(role, _ROLE_GUIDE["전개"])
    ch01_cliff = world.get("ch01Cliffhanger", "") if chapter == 1 else ""
    cliffhanger_note = f"★ 마지막 클리프행어 필수: {ch01_cliff}" if ch01_cliff else ""
    prev_section = f"## 직전 챕터 마지막 장면\n{prev_ending.strip()}" if prev_ending else ""

    # 🔒 LD-005: storyArc 있으면 Python 직접 조립 — Gemini 호출 없음
    if arc:
        parts = [f"## 이번 챕터 방향\n{arc}"]
        if cliffhanger_note:
            parts.append(cliffhanger_note)
        if prev_section:
            parts.append(prev_section)
        parts.append(role_guide)
        return "## 청사진 (비트별 가이드)\n" + "\n\n".join(parts)

    # arc 없음 → Gemini PRE-PASS 호출
    prompt = (
        f"{cliffhanger_note}\n{prev_section}\n\n{role_guide}\n\n"
        "위 정보를 바탕으로 이번 챕터의 7비트 청사진을 작성하라.\n"
        "각 비트는 구체적인 행동·발견·사건으로만 기술한다 — 감정 서술 금지.\n"
        "각 비트 2~3문장 이내. 마지막 비트(⑦)는 ★ 표시.\n\n"
        "### 비트 ① — {이름}\n{구체적 장면 묘사}\n...\n### 비트 ⑦ — {이름} ★\n{구체적 장면 묘사}"
    )
    # ⚠️ GEMINI-PAID: PRE-PASS 청사진 — arc 없을 때만 호출. Phase 2에서 Cerebras로 전환 예정
    result = await call_gemini(
        prompt,
        system_instruction=_SYSTEM_INSTRUCTION,
        max_tokens=1200,
        temperature=0.4,
    )
    if not result or not result.strip():
        return ""
    return "## 청사진 (비트별 가이드)\n" + result.strip()


async def _lint_and_revise(narrative: str, world: dict, chapter: int) -> str:
    """STEP 1.5 — 3-Judge 병렬 Lint (style/structure/causality) → 임계치 초과 시 Revise.

    각 Judge는 call_judge_with_fallback()을 통해 Cerebras/NVIDIA/OpenRouter/Gemini-Free
    폴백 체인으로 실행 — Gemini 유료 호출 없음.
    Revise(재작성)만 Gemini 유료 사용.
    """
    series_title = world.get("seriesTitle") or world.get("title") or "시리즈"
    narrative_prompt = (
        f"다음은 「{series_title}」 {chapter}화 대본이다.\n\n"
        f"## 대본\n{narrative}\n\n"
        "위 대본에서 담당 원칙 위반 항목을 JSON으로 출력하라."
    )

    # ── 3-Judge 병렬 호출 (Cerebras/NVIDIA/OpenRouter/Gemini-Free) ─────────
    style_sys = load_judge_prompt("style")
    structure_sys = load_judge_prompt("structure")
    causality_sys = load_judge_prompt("causality")

    (style_key, style_tickets), (struct_key, struct_tickets), (caus_key, caus_tickets) = (
        await asyncio.gather(
            call_judge_with_fallback("style", narrative_prompt, style_sys),
            call_judge_with_fallback("structure", narrative_prompt, structure_sys),
            call_judge_with_fallback("causality", narrative_prompt, causality_sys),
        )
    )

    all_tickets: list[dict] = style_tickets + struct_tickets + caus_tickets
    active_count = sum(1 for k in (style_key, struct_key, caus_key) if k is not None)

    if not all_tickets:
        return narrative  # 위반 없음 또는 전체 Judge 실패 — 원본 유지

    # ── Revise 임계치 판단 ────────────────────────────────────────────────
    high_min, medium_min = get_revise_threshold(active_count)
    high_count = sum(1 for t in all_tickets if t.get("severity") == "high")
    medium_count = sum(1 for t in all_tickets if t.get("severity") == "medium")

    needs_revise = (high_count >= high_min) or (medium_count >= medium_min)
    if not needs_revise:
        return narrative  # 경미한 위반 — 재작성 불필요

    # ── Revise: ticket 목록 기반 재작성 (Gemini 유료 1회) ────────────────
    prompts_dir = Path(__file__).parent.parent / "prompts"
    reviser_instruction = (prompts_dir / "reviser.md").read_text(encoding="utf-8")

    ticket_summary = "\n".join(
        f"- [{t.get('axis','?')}:{t.get('principle_id','?')}] "
        f"severity={t.get('severity','?')} | {t.get('excerpt','')[:60]} → {t.get('fix_direction','')[:80]}"
        for t in all_tickets
    )
    revise_prompt = (
        f"## 원본 대본 ({chapter}화)\n{narrative}\n\n"
        f"## Judge 위반 티켓 (총 {len(all_tickets)}개, active_judges={active_count})\n"
        f"{ticket_summary}\n\n"
        "위 티켓의 수정 방향을 반영해 대본을 재작성하라.\n"
        "서사 흐름·인물·사건 순서는 반드시 유지한다.\n"
        "출력: 순수 한국어 서사 본문만 (JSON·마크다운 코드블록 없이)."
    )
    # ⚠️ GEMINI-PAID: Revise — Judge 임계치 초과 시에만 실행 (조건부 호출)
    revised = await call_gemini(
        revise_prompt,
        system_instruction=reviser_instruction,
        max_tokens=6000,
        temperature=0.7,
    )

    return revised.strip() if revised else narrative


async def run_script(series_id: str) -> dict:
    """현재 챕터(current_chapter) 1개만 생성 — 1일 1챕터 정책"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data,settings,current_chapter,series_code")
        .eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}
    chapter: int = res.data.get("current_chapter", 1)
    series_code: str | None = res.data.get("series_code")
    role = _CHAPTER_ROLES[chapter - 1] if chapter <= len(_CHAPTER_ROLES) else "전개"
    _settings: dict = res.data.get("settings") or {}
    _art_style: str = _settings.get("artStyle", "polystyle")
    _guest_cast: dict = world.get("guest_cast") or {}

    # 직전 챕터 엔딩 로드
    prev_ending = ""
    if chapter > 1:
        prev_res = await asyncio.to_thread(
            lambda: db.table("v3_chapters")
            .select("content")
            .eq("series_id", series_id)
            .eq("chapter", chapter - 1)
            .single().execute()
        )
        if prev_res.data:
            prev_ending = _extract_last_scene(prev_res.data.get("content", ""))

    # 직전 챕터들의 복선 메타 로드
    prev_metas: list[dict] = []
    if chapter > 1:
        metas_res = await asyncio.to_thread(
            lambda: db.table("v3_chapter_meta")
            .select("*")
            .eq("series_id", series_id)
            .lt("chapter", chapter)
            .order("chapter")
            .execute()
        )
        prev_metas = metas_res.data or []

    # RAG 컨텍스트
    rag_ctx = await build_rag_context(series_id, role, chapter)

    # 전역 감정선 로드 (character_emoline 테이블 — 단일 전역 행)
    try:
        emoline_res = await asyncio.to_thread(
            lambda: db.table("character_emoline").select("edges").eq("id", 1).single().execute()
        )
        emoline_edges: list = (emoline_res.data or {}).get("edges", [])
    except Exception:
        emoline_edges = []

    # ── PRE-PASS: 7비트 청사진 생성 (소형 Gemini 호출 → STEP1 방향 고정) ──
    outline_block = ""
    try:
        outline_block = await _generate_outline(world, chapter, role, prev_ending)
    except Exception:
        pass  # PRE-PASS 실패해도 STEP1은 계속 진행

    # ── STEP 1: 대본 생성 (순수 한국어 서사) ──────────────────────────────
    narrative_prompt = _build_narrative_prompt(world, chapter, role, rag_ctx, prev_ending, prev_metas, emoline_edges, outline_block)
    narrative = await call_gemini(
        narrative_prompt,
        system_instruction=_SYSTEM_INSTRUCTION,
        max_tokens=6000,
        temperature=0.95,
    )

    # ── STEP 1.5: 자동 Lint → 위반 있으면 자동 Revise ────────────────────
    try:
        narrative = await _lint_and_revise(narrative, world, chapter)
    except Exception:
        pass  # lint 실패해도 원본으로 계속 진행

    # v3_chapters에 대본 원문 저장
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").upsert({
            "series_id": series_id,
            "chapter": chapter,
            "role": role,
            "content": narrative,
            "approved": False,
        }, on_conflict="series_id,chapter").execute()
    )

    # ── STEP 2: 씬/컷 JSON 구조화 (별도 Gemini 호출) ──────────────────────
    structure_prompt = _build_structure_prompt(narrative, world, chapter)
    structure_raw = await call_gemini(
        structure_prompt,
        max_tokens=8000,
        temperature=0.3,   # 구조화는 낮은 temperature — 창의성보다 정확성
    )

    # 씬/컷 파싱 (world 전달 → speaker → tts_voice 자동 해석)
    scenes = _parse_scenes_json(structure_raw, chapter, world)
    scenes = await _absorb_dialogue_cuts(scenes, chapter)  # Pass 2: 대사 흡수
    content = narrative  # wiki 갱신·메타 추출에 원문 사용

    # ch1 최초 생성 시 series_code 확정
    # ★ scenes[0]은 HOOK 복사본(scene_index=0) → 원본 HOOK 컷(scene_index>0, is_hook=True) 사용
    if chapter == 1 and scenes and not series_code:
        original_hook_cut = next(
            (s for s in scenes if s["is_hook"] and s["scene_index"] > 0),
            None
        )
        seed_cut = original_hook_cut or next((s for s in scenes if s["scene_index"] > 0), scenes[0])
        series_code = _make_series_code(seed_cut)
        await asyncio.to_thread(
            lambda: db.table("v3_series").update({"series_code": series_code}).eq("id", series_id).execute()
        )

    # 씬 저장 (scene_code 포함) — prompt_composer 버전으로 image_prompt 자동 계산
    await _save_scenes(db, series_id, chapter, scenes, series_code,
                       art_style=_art_style, guest_cast=_guest_cast)

    # 복선 메타 저장
    try:
        meta = await _extract_chapter_meta(content, chapter)
        await asyncio.to_thread(
            lambda: db.table("v3_chapter_meta").upsert(
                {"series_id": series_id, "chapter": chapter, **meta},
                on_conflict="series_id,chapter"
            ).execute()
        )
    except Exception:
        pass

    # wiki 갱신
    await auto_update_wiki(series_id, chapter, content[:500])

    # ── POST-SCRIPT: 미등록 조연 외모 자동 생성 ──────────────────────────────
    try:
        await _detect_and_generate_guest_cast(series_id, scenes, world)
    except Exception:
        pass  # 실패해도 대본 파이프라인 계속 진행

    await asyncio.to_thread(
        lambda: db.table("v3_series").update({"status": "script_ready"}).eq("id", series_id).execute()
    )

    # ── 출력 폴더 + 파일 저장 ────────────────────────────────────────────────
    _output_root = Path(__file__).parent.parent.parent.parent / "output"
    _folder_name = series_code or series_id
    _chapter_dir = _output_root / _folder_name / f"ch{chapter:02d}"
    try:
        _chapter_dir.mkdir(parents=True, exist_ok=True)
        # ch01_RAW_대본.txt — 순수 한국어 서사 원문
        (_chapter_dir / f"ch{chapter:02d}_RAW_대본.txt").write_text(narrative, encoding="utf-8")
        # ch01.json — 씬/컷 구조 JSON
        (_chapter_dir / f"ch{chapter:02d}.json").write_text(
            json.dumps(scenes, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[script] 출력 저장 완료: {_chapter_dir}")
    except Exception as e:
        print(f"[script] 출력 저장 실패 (무시): {e}")

    return {"ok": True, "chapter": chapter, "role": role, "scenes": len(scenes)}


def _elevated_cast_block(world: dict) -> str:
    """격상된 조연 캐릭터를 주연급으로 프롬프트에 포함"""
    elevated: list[dict] = world.get("elevatedCast") or []
    if not elevated:
        return ""
    lines = ["## 격상된 조연 (주연급 비중으로 등장)"]
    for c in elevated:
        name = c.get("name", "")
        char_id = c.get("id", "")
        lines.append(f"\n### {name}")
        lines.append(f"- 직업: {c.get('occupation', '')}")
        lines.append(f"- 성격: {c.get('personality', '')}")
        # 최신 situations 로드
        sits = _load_char_situations(char_id) or c.get("situations") or []
        sits_clean = [s for s in sits if not s.startswith("★ 투입된 비밀:")]
        sits_top = sits_clean[:_MAX_SITUATIONS]
        if len(sits_top) == 1:
            lines.append(f"- 현재 상황: {sits_top[0]}")
        elif len(sits_top) > 1:
            numbered = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(sits_top))
            lines.append(f"- 현재 상황 ({len(sits_top)}개):\n{numbered}")
        user_secret = c.get('userSecret', '')
        if user_secret:
            lines.append(
                f"- 비밀 [{name}만 알고 있음 — 다른 인물은 모름]: {user_secret}\n"
                f"  → {name}은 이 비밀을 숨긴 채 행동. 상대방이 눈치채는 복선만 허용."
            )
        lines.append(f"- 말투: {c.get('speaking_style', '')}")
    lines.append("\n위 격상 캐릭터는 단순 조연가 아닌 서사 변수로 취급할 것. 비밀이 이야기를 바꾸는 방식으로 활용한다.")
    return "\n".join(lines)


def _build_emoline_block(edges: list, world: dict) -> str:
    """감정선 → Gemini 프롬프트 블록 — 현재 캐스트에 속한 엣지만 포함"""
    if not edges:
        return ""

    # 현재 캐스트 ID → 이름 맵
    full_cast = world.get("fullCastDetails") or []
    cast_name_map: dict[str, str] = {c["id"]: c["name"] for c in full_cast if c.get("id")}
    if not cast_name_map:
        return ""

    cast_ids = set(cast_name_map.keys())
    lines = ["## 인물 관계 (감정선 — 대본 서사에 반드시 반영)"]
    count = 0

    for edge in edges:
        src_id = edge.get("source", "")
        tgt_id = edge.get("target", "")
        if src_id not in cast_ids or tgt_id not in cast_ids:
            continue  # 현재 캐스트에 없는 인물 조합 제외

        src_name = cast_name_map[src_id]
        tgt_name = cast_name_map[tgt_id]
        emotion = (edge.get("data") or {}).get("label", "")

        lines.append(f"\n- {src_name} → {tgt_name}: **{emotion}**")

        # 각 캐릭터 상위 2개 상황 (비밀 제외 — 비밀은 인물 블록에서 별도 처리)
        for char_id, char_name in [(src_id, src_name), (tgt_id, tgt_name)]:
            sits = _load_char_situations(char_id)
            sits_clean = [s for s in sits if not s.startswith("★ 투입된 비밀:")][:2]
            if sits_clean:
                lines.append(f"  [{char_name} 현재 상황] {' / '.join(sits_clean)}")

        count += 1

    if count == 0:
        return ""

    lines.append("\n위 감정선은 인물 행동·대화·긴장감의 서사적 근거다. "
                 "감정선에 명시된 관계가 이번 챕터 장면에서 드러나야 한다.")
    return "\n".join(lines)


def _build_narrative_prompt(
    world: dict,
    chapter: int,
    role: str,
    rag_ctx: str,
    prev_ending: str,
    prev_metas: list[dict],
    emoline_edges: list | None = None,
    outline_block: str = "",
) -> str:
    """STEP 1 — 순수 대본 생성 프롬프트. JSON 구조 없음. 서사에만 집중."""
    char_a = world.get("charAName", "주인공A")
    char_b = world.get("charBName", "주인공B")
    conflict = ", ".join(world.get("conflictTypes") or [])
    role_guide = _ROLE_GUIDE.get(role, _ROLE_GUIDE["전개"])

    # 인물 블록
    user_secrets: dict = world.get("userSecrets") or {}

    def char_block(prefix: str, name: str, char_id: str = "") -> str:
        secret = user_secrets.get(char_id) or world.get(f'{prefix}Secret', '')

        # 최신 situations 로드 (파일 직접 읽기 — 캐스팅 이후 추가/수정 반영)
        situations = _load_char_situations(char_id)
        if not situations:
            fallback = world.get(f'{prefix}Situation', '')
            situations = [fallback] if fallback else []
        # ★ 투입된 비밀 항목은 situations에서 제거 — 비밀은 아래 '비밀' 필드에서만 처리
        situations_clean = [s for s in situations if not s.startswith("★ 투입된 비밀:")]
        # ★ 챕터별 상황 주입 상한 — ch01은 핵심 1개만, 이후는 2개까지 (갈등 과잉 방지)
        _sit_cap = _max_situations_for_chapter(chapter)
        situations_top = situations_clean[:_sit_cap]

        if len(situations_top) == 1:
            sit_block = f"- 현재 주요 상황 (이 챕터의 핵심): {situations_top[0]}"
        elif len(situations_top) > 1:
            numbered = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(situations_top))
            sit_block = f"- 현재 상황 ({len(situations_top)}개, 1번이 이 챕터 핵심):\n{numbered}"
        else:
            sit_block = ""

        # 비밀은 본인만 아는 정보임을 명시
        secret_block = (
            f"- 비밀 [{name}만 알고 있음 — 다른 인물은 모름]: {secret}\n"
            f"  → 대본에서 {name}은 이 비밀을 숨긴 채 행동. 상대방이 눈치채는 복선만 허용."
        ) if secret else ""

        inner = "\n".join(filter(None, [
            f"- 직업: {world.get(f'{prefix}Occupation', '')}",
            f"- 겉모습: {world.get(f'{prefix}PublicFace', '')}",
            f"- 속모습: {world.get(f'{prefix}Shadow', '')}",
            sit_block,
            secret_block,
            f"- Want: {world.get(f'{prefix}Want', '')}",
            f"- Need: {world.get(f'{prefix}Need', '')}",
            f"- 말투: {world.get(f'{prefix}SpeakingStyle', '')}",
        ]))
        return f'<character name="{name}">\n{inner}\n</character>'

    # 이전 챕터 복선 누적
    prev_meta_section = ""
    if prev_metas and chapter > 1:
        flines, tlines = [], []
        for m in prev_metas:
            ch = m.get("chapter", "?")
            for f in m.get("planted_foreshadows", []):
                flines.append(f"- [ch{ch}] {f}")
            for t in m.get("open_threads", []):
                tlines.append(f"- [ch{ch}] {t}")
        parts = []
        if flines:
            parts.append("### 심어진 복선 (이번 챕터에서 1개 이상 회수)\n" + "\n".join(flines))
        if tlines:
            parts.append("### 미결 실마리\n" + "\n".join(tlines))
        if parts:
            prev_meta_section = "\n## 누적 복선 장부\n" + "\n\n".join(parts)

    prev_section = ""
    if prev_ending and chapter > 1:
        prev_section = f"\n## 직전 챕터 마지막 장면 (정확히 이어받아 시작)\n{prev_ending.strip()}"

    # ch01 전용 블록 — 모든 역량 집중
    ch01_block = ""
    if chapter == 1:
        opening_hook = world.get("openingHook", "")
        arc_ch01 = (world.get("storyArc") or {}).get("ch01", "")
        social_bg = world.get("socialBackground", "")
        ch01_cliffhanger = world.get("ch01Cliffhanger", "")
        ch01_block = f"""
## ★ 1화 특별 지침 (가장 중요)
이 1화가 네이버 웹소설·유튜브에 처음 공개된다.
독자·시청자는 1화만 보고 계속 볼지 결정한다.
**1화가 전부다. 2화는 1화의 성공 이후에만 존재한다.**

- 첫 문장부터 독자를 낚아채야 한다
- 인물의 욕망·비밀이 1화 안에 충분히 드러나야 한다
- 마지막 씬은 반드시 "다음화가 궁금한" 열린 훅으로 끝낸다
- 이 1화 하나로 완결되지 않되, 혼자 읽어도 만족감이 있어야 한다
{f"- 세계관 훅: {opening_hook}" if opening_hook else ""}
{f"- 1화 방향: {arc_ch01}" if arc_ch01 else ""}
{f"- 사회적 배경 (반드시 반영): {social_bg}" if social_bg else ""}
{f"- ★ 마지막 클리프행어 (반드시 포함): {ch01_cliffhanger}" if ch01_cliffhanger else ""}
"""

    arc_hint = ""
    if chapter > 1:
        arc = world.get("storyArc") or {}
        ch_key = f"ch{chapter:02d}"
        # outline_block이 있으면 arc가 이미 포함됨 (LD-005 Python 조립) → 중복 주입 방지
        if ch_key in arc and not outline_block:
            arc_hint = f"\n## 이번 챕터 방향 (세계관 가이드라인)\n{arc[ch_key]}\n"

    _outline_section = f"\n{outline_block}\n" if outline_block else ""

    # ── Gate 3 (LD-017): 두 주인공의 관계 상태 블록 조립 ───────────────────────
    # world_data에 필드가 없는 기존 시리즈는 캐릭터 JSON에서 직접 fallback 로드
    rel_start = world.get("relationshipAtCh01Start") or "strangers"
    rel_desc = world.get("relationshipAtCh01Description") or "두 사람은 이 시점에 서로를 모른다"

    char_a_id = world.get("charA", "")
    char_b_id = world.get("charB", "")

    # world_data에 관계 딕셔너리가 있으면 그것을 우선 사용, 없으면 캐릭터 JSON fallback
    char_a_rels = world.get("charARelationships") or _load_char_relationships(char_a_id)
    char_b_rels = world.get("charBRelationships") or _load_char_relationships(char_b_id)

    # strangers 조건에서의 경고 메시지 — LLM이 관계를 혼동하지 않도록 명시
    strangers_warning = ""
    if rel_start == "strangers":
        strangers_warning = f"""
⚠️ 관계 상태가 "strangers"이므로 아래 규칙을 절대 위반하지 않는다:
  - {char_a}와 {char_b}는 이 챕터에서 같은 집에 거주하거나 부부·동거인·연인으로 등장하면 절대 안 된다.
  - {char_a}의 가족(배우자·자녀 등)이 위에 명시된 경우, {char_b}가 그 역할을 대신하면 절대 안 된다.
  - {char_b}는 이 챕터에서 직접 등장하지 않거나, 환영·편지·목소리 등 간접 형태로만 등장할 수 있다."""

    relationship_block = f"""<relationship_constraint chapter="{chapter}" status="{rel_start}" locked="ABSOLUTE">
## ★ 두 주인공의 현재 관계 (ch{chapter} 시작 시점 — 절대 변경 금지)
- 관계 상태: {rel_start}
- 설명: {rel_desc}
{_fmt_char_relationships(char_a, char_a_rels)}
{_fmt_char_relationships(char_b, char_b_rels)}
{strangers_warning}
</relationship_constraint>"""

    return f"""=== CONTEXT ===

{relationship_block}

## 세계관
- 주제: {world.get('topic', '')}
- 장르: {world.get('genre', '')}
- 문체: {world.get('style', '')}
- 관계: {world.get('relationship', '')}
- 갈등: {conflict}
- 핵심 주제의식: {world.get('coreTheme', '')}

{char_block("charA", char_a, world.get("charA", ""))}

{char_block("charB", char_b, world.get("charB", ""))}

{_elevated_cast_block(world)}

{_build_emoline_block(emoline_edges or [], world)}

{rag_ctx}
{prev_section}
{prev_meta_section}
{ch01_block}
{arc_hint}
{_outline_section}
=== TASK ===

**챕터 {chapter} ({role})**의 대본을 쓴다. 이 챕터만 쓴다.
출력: **순수 한국어 서사 본문만** — JSON·마크다운·비트 레이블 없이 흐르는 글로.

{role_guide}

## 필수 비트 (순서대로 포함)
[비트1] 여는 이미지 — 장소·감각 디테일로 시작, 첫 문장이 독자를 낚아채야 한다
[비트2] 일상의 균열 — 이상 신호 1개
[비트3] 첫 대화 — 3회전 이상, 인물 말투 반드시 반영
[비트4] 긴장 상승 — 갈등 표면화, 거짓말·회피 포함
[비트5] 비밀의 징후 — 단서 2개
[비트6] 반전 또는 발견
[비트7] 닫는 훅{"(다음화 예고 없이, 장면 여운으로)" if chapter == 1 else ""}

<genre_constraint genre="{world.get('genre', '')}">
## 장르 일관성 (절대 준수)
이 작품의 장르: {world.get('genre', '')}
→ 모든 씬·대사·사건은 이 장르의 톤 안에서만 처리한다.
→ 장르 외부의 클리셰 요소(예: 회귀·스릴러 작품에 통속 멜로 패턴 삽입)를 혼입하지 않는다.
→ 이 챕터에서 전면에 드러낼 갈등은 **1개**. 나머지는 배경 복선으로만 처리한다.
</genre_constraint>

<prohibition>
## 금지 클리셰 (다음 패턴은 절대 쓰지 않는다)
- 주인공이 상대 핸드폰·메시지·통화를 우연히 목격 → 직접 행동·선택·충돌로 대체
- "난 괜찮아", "괜찮은 척하자" 류의 자기 위로 독백 → 구체적 신체 행동·반응으로 대체
- 조연이 주인공에게 "제발 ~해주세요", "~도 좀 알아주세요" 류의 직접 호소 대사 → 간접 암시·행동으로 대체
- 짧은 분량 안에 3개 이상 갈등을 동시에 제시 → 주갈등 1개를 깊이 파고들 것
</prohibition>

## 분량
- 전체 2,500~4,000자
- 장면이 전환될 때 자연스럽게 단락 나눔 (--- 구분자 사용)
- 대화는 인용부호로, 나레이션은 서술로 구분
"""


def _split_mixed_text(text: str) -> list[dict]:
    """
    mixed 타입 컷 텍스트를 나레이션/대사 세그먼트로 분리.
    대사: "..." 또는 "..." 패턴 (따옴표 포함 그대로 보존)
    반환: [{"type": "narration"|"dialogue", "text": str, "speaker": None}]
    ※ speaker는 원문에서 알 수 없으므로 모두 None → tts_voice는 narrator 폴백
    """
    import re
    segments: list[dict] = []
    regex = re.compile(r'"[^"]*?"|"[^"]*?"')
    last = 0
    for m in regex.finditer(text):
        narr = text[last:m.start()].strip()
        if narr:
            segments.append({"type": "narration", "text": narr, "speaker": None})
        # 따옴표 제거 후 저장 (TTS가 따옴표를 읽는 문제 방지)
        dialogue_text = re.sub(r'["""]', '', m.group()).strip()
        segments.append({"type": "dialogue", "text": dialogue_text, "speaker": None})
        last = m.end()
    tail = text[last:].strip()
    if tail:
        segments.append({"type": "narration", "text": tail, "speaker": None})
    return segments if segments else [{"type": "narration", "text": text, "speaker": None}]


def _load_supertone_voice_id(char_id: str) -> str:
    """캐릭터 JSON에서 supertone_voice_id 로드 — 없으면 빈 문자열"""
    if not char_id:
        return ""
    path = _CHAR_DATA_DIR / f"{char_id}.json"
    if not path.exists():
        return ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        st_id = (data.get("supertone_voice_id") or "").strip()
        st_style = (data.get("supertone_style") or "").strip()
        if st_id:
            return f"st:{st_id}:{st_style}" if st_style else f"st:{st_id}"
        return ""
    except Exception:
        return ""


def _build_speaker_voice_map(world: dict) -> dict[str, str]:
    """
    world_data의 캐릭터 정보 → speaker 이름 기준 tts_voice 매핑 딕셔너리.
    주연(charA~D) + fullCastDetails + elevatedCast 모두 포함.

    우선순위:
    1. supertone_voice_id (캐릭터 JSON) → "st:{voice_id}" 또는 "st:{voice_id}:{style}"
    2. voice_id (캐릭터 JSON / world 데이터) → edge-tts 음성명
    3. 기본 나레이터 목소리
    캐스팅에 없는 화자는 speaker_age_group + speaker_gender 기반 폴백 사용.
    """
    from services.tts_service import resolve_voice, _NARRATOR_VOICE
    mapping: dict[str, str] = {}

    def _resolve(char_id: str, voice_id: str) -> str:
        """char_id → supertone 우선, 없으면 edge-tts"""
        st = _load_supertone_voice_id(char_id)
        if st:
            return st
        return resolve_voice(voice_id) if voice_id else _NARRATOR_VOICE

    # fullCastDetails를 id/voice 조회용 인덱스로 미리 빌드
    _full_cast_index: dict[str, dict] = {}
    for _c in (world.get("fullCastDetails") or []):
        _n = (_c.get("name") or "").strip()
        if _n:
            _full_cast_index[_n] = _c

    # 주연 (charA~D)
    # charXId가 비어있을 경우 fullCastDetails에서 이름 매칭으로 char_id 보완
    # → supertone_voice_id 로드 가능하게 함
    for prefix in ("charA", "charB", "charC", "charD"):
        name     = world.get(f"{prefix}Name", "").strip()
        char_id  = world.get(f"{prefix}Id", "").strip()
        voice_id = world.get(f"{prefix}Voice", "").strip()
        if name:
            if not char_id:
                _fc = _full_cast_index.get(name, {})
                char_id  = (_fc.get("id") or "").strip()
                if not voice_id:
                    voice_id = (_fc.get("voice_id") or "").strip()
            mapping[name] = _resolve(char_id, voice_id)

    # 조연 fullCastDetails
    for c in (world.get("fullCastDetails") or []):
        name     = (c.get("name") or "").strip()
        char_id  = (c.get("id") or "").strip()
        voice_id = (c.get("voice_id") or "").strip()
        if name and name not in mapping:
            mapping[name] = _resolve(char_id, voice_id)

    # 격상 조연 elevatedCast
    for c in (world.get("elevatedCast") or []):
        name     = (c.get("name") or "").strip()
        char_id  = (c.get("id") or "").strip()
        voice_id = (c.get("voice_id") or "").strip()
        if name and name not in mapping:
            mapping[name] = _resolve(char_id, voice_id)

    return mapping


def _resolve_extra_voice(speaker_gender: str | None, speaker_age_group: str | None = None) -> str:
    """캐스팅에 없는 엑스트라 화자 → 나이대+성별 기반 목소리 반환

    우선순위:
    1. "{age_group}_{gender}" 조합 키 (teen_male, young_female, elder_male 등)
    2. "{gender}" 단독 키 (male / female)
    3. 기본값 female
    """
    from services.tts_service import EXTRA_VOICE_MAP
    gender = (speaker_gender or "").strip().lower()
    age_grp = (speaker_age_group or "").strip().lower()
    combined_key = f"{age_grp}_{gender}" if age_grp and gender else gender
    return (
        EXTRA_VOICE_MAP.get(combined_key)
        or EXTRA_VOICE_MAP.get(gender)
        or EXTRA_VOICE_MAP["female"]
    )


def _compute_production_type(cut_type: str, char_names: list) -> tuple[str, str]:
    """62번 §1 자동 분기 기준 — production / animation_type 판정 (★ 설계 의도 — 변경 금지)

    | type       | 캐릭터 수 | production  | animation_type |
    |------------|---------|-------------|----------------|
    | dialogue   | —       | composite   | lipsync        |
    | narration  | 1명     | composite   | ken_burns      | ← parallax 보류 (LD-004)
    | narration  | 2명+    | composite   | ken_burns      |
    | narration  | 0명     | bg_only     | ken_burns      |
    """
    # 🔒 LD-004: parallax 보류 — narration 전 타입 ken_burns 적용
    if cut_type == "dialogue":
        return "composite", "lipsync"
    elif len(char_names) >= 1:
        return "composite", "ken_burns"
    else:
        return "bg_only", "ken_burns"


def _parse_scenes_json(raw: str, chapter: int, world: dict | None = None) -> list[dict]:
    """
    Gemini JSON 응답 → v3_scenes 형식 리스트 (씬>컷 계층 → 플랫 컷 리스트)

    출력 구조:
      scene_index = 서사 씬 번호 (1부터)
      cut_index   = 씬 내 컷 번호 (씬별 1부터 리셋)

    HOOK 처리 (컷 단위):
      - is_hook=true인 컷 1개 — 대본 전체에서 감정 충격이 가장 강한 단일 컷
      - 해당 HOOK 컷을 scene_index=0, cut_index=1로 복사 (영상 도입부)
      - 원본 HOOK 컷은 원래 scene_index/cut_index에 유지
      - HOOK 컷 없으면 폴백: 마지막 씬의 마지막 컷

    tts_voice: speaker 이름 → world_data 캐릭터 voice_id → edge-tts 음성명으로 해석
    """
    from services.gemini_helper import extract_json
    from services.tts_service import _NARRATOR_VOICE, _DEFAULT_VOICE
    speaker_voice_map = _build_speaker_voice_map(world or {})
    data = extract_json(raw)
    scenes_data = data.get("scenes", []) if isinstance(data, dict) else []

    result: list[dict] = []

    for scene_i, scene in enumerate(scenes_data):
        scene_idx = scene.get("scene_index", scene_i + 1)
        cuts = scene.get("cuts", [])

        # 씬 레벨 메타 — 모든 컷이 공유하는 공통 맥락 (scene_hint 포함)
        scene_meta = {
            "location":    scene.get("location", ""),
            "time_of_day": scene.get("time_of_day", ""),
            "characters":  scene.get("characters", []),
            "atmosphere":  scene.get("atmosphere", ""),
            "scene_hint":  scene.get("scene_hint", ""),
        }

        # 구형 포맷 폴백: cuts 없고 text 있으면 단일 컷으로 변환
        if not cuts and scene.get("text"):
            cuts = [{
                "cut_index": 1,
                "text": scene.get("text", ""),
                "image_hint": "",
                "image_prompt": scene.get("image_prompt", ""),
                "duration_seconds": scene.get("duration_seconds", 4.5),
                "is_hook": scene.get("is_hook", False),  # 구형: 씬 레벨 is_hook 수용
            }]

        for cut_i, cut in enumerate(cuts):
            cut_idx = cut.get("cut_index", cut_i + 1)
            # LD-015 (2026-04-18): nc01 gap 제거 — 씬1도 nc01부터 정상 시작
            # HOOK 복사본은 scenes[0](scene_index=0)으로 별도 존재하므로 nc01 슬롯 충돌 없음
            is_hook = bool(cut.get("is_hook", False))
            cut_type = cut.get("type", "narration")
            if cut_type not in ("narration", "dialogue", "mixed"):
                cut_type = "narration"

            # mixed 타입: 나레이션+대사 혼합 → 세그먼트로 분리해 별도 컷으로 삽입
            # (Gemini 프롬프트에서 mixed 금지이나 폴백 처리)
            if cut_type == "mixed":
                segs = _split_mixed_text(cut.get("text", ""))
                sub_cut_base = cut_idx * 100  # 2 → 201, 202, 203 ...
                cut_gender = cut.get("speaker_gender") or None
                cut_age_grp = cut.get("speaker_age_group") or None
                for seg_i, seg in enumerate(segs):
                    seg_type = seg["type"]
                    seg_speaker = seg.get("speaker") or None
                    if seg_type == "dialogue" and seg_speaker:
                        seg_voice = speaker_voice_map.get(
                            seg_speaker,
                            _resolve_extra_voice(cut_gender, cut_age_grp),
                        )
                    else:
                        seg_voice = _NARRATOR_VOICE
                    _seg_prod, _seg_anim = _compute_production_type(seg_type, scene_meta.get("characters") or [])
                    result.append({
                        "chapter":          chapter,
                        "scene_index":      scene_idx,
                        "cut_index":        sub_cut_base + seg_i + 1,
                        "text":             seg["text"][:2000],
                        "image_hint":       cut.get("image_hint", "") if seg_i == 0 else "",
                        "image_prompt":     cut.get("image_prompt", "") if seg_i == 0 else "",
                        "duration_seconds": float(cut.get("duration_seconds", 4.5)) / max(len(segs), 1),
                        "is_hook":          is_hook and seg_i == 0,
                        "scene_meta":       scene_meta,
                        "type":             seg_type,
                        "speaker":          seg_speaker,
                        "tts_voice":        seg_voice,
                        "production":       _seg_prod,
                        "animation_type":   _seg_anim,
                        "sub_scenes":       [],
                        "status":           "pending",
                    })
                continue  # 원본 mixed 컷은 result에 추가하지 않음

            # speaker: 대사 화자 이름 (narration이면 null)
            speaker = cut.get("speaker") or None
            speaker_gender = cut.get("speaker_gender") or None
            speaker_age_group = cut.get("speaker_age_group") or None
            # tts_voice: speaker 이름 → world 캐릭터 voice → 나이대+성별 폴백
            if cut_type == "dialogue" and speaker:
                tts_voice = speaker_voice_map.get(
                    speaker,
                    _resolve_extra_voice(speaker_gender, speaker_age_group),
                )
            else:
                tts_voice = _NARRATOR_VOICE
            _production, _animation_type = _compute_production_type(cut_type, scene_meta.get("characters") or [])
            result.append({
                "chapter":          chapter,
                "scene_index":      scene_idx,
                "cut_index":        cut_idx,
                "text":             (cut.get("text", ""))[:2000],
                "image_hint":       cut.get("image_hint", ""),
                "image_prompt":     cut.get("image_prompt", ""),
                "duration_seconds": float(cut.get("duration_seconds", 4.5)),
                "is_hook":          is_hook,
                "scene_meta":       scene_meta,
                "type":             cut_type,
                "speaker":          speaker,
                "tts_voice":        tts_voice,
                "production":       _production,
                "animation_type":   _animation_type,
                "sub_scenes":       [],
                "status":           "pending",
            })

    # HOOK 컷 탐색
    # Gemini가 씬 전체에 is_hook=true를 붙이는 경우 대비:
    #   - 후보가 여러 개 → 마지막 컷 선택 (대본 클라이맥스에 가장 가까운 위치)
    #   - 나머지 후보는 is_hook=False로 리셋 (훅컷은 전체 대본에서 단 1개)
    hook_candidates = [c for c in result if c["is_hook"]]
    if hook_candidates:
        hook_cut = hook_candidates[-1]          # 마지막 후보 = 가장 극적인 위치
        for c in result:
            c["is_hook"] = (c is hook_cut)      # 선택된 1개만 True, 나머지 False
    else:
        hook_cut = None

    if hook_cut is None and result:
        last_scene_idx = max(c["scene_index"] for c in result)
        last_cut_in_scene = max(
            (c for c in result if c["scene_index"] == last_scene_idx),
            key=lambda x: x["cut_index"]
        )
        last_cut_in_scene["is_hook"] = True
        hook_cut = last_cut_in_scene

    # render_type 결정
    # - ch01 전체 → ai_video (영화급)
    # - ch02+ HOOK 컷 → ai_video, 나머지 → keyframe_anim
    for c in result:
        if chapter == 1 or c["is_hook"]:
            c["render_type"] = "ai_video"
        else:
            c["render_type"] = "keyframe_anim"

    # ═══════════════════════════════════════════════════════════════════════
    # ★ 설계 의도 — 절대 제거·병합 금지 (53번 문서 §HOOK 컷 규칙)
    #
    # HOOK 컷은 v3_scenes에 의도적으로 2번 저장된다:
    #
    #   [저장 1] scene_index=0  ← 영상 도입부(콜드오픈) 전용 복사본
    #   [저장 2] 원본 scene_index ← 서사 흐름 속 자연 위치 (원본 그대로)
    #
    # 재생 순서:
    #   scene_index=0 (HOOK 복사본) → scene_index=1,2,3... → scene_index=N (HOOK 원본)
    #
    # 이 패턴이 "중복 버그"처럼 보이더라도 절대 삭제하거나 하나로 합치지 말 것.
    # 두 레코드의 scene_code는 원본 위치 기준으로 동일하게 생성됨 (_orig_* 필드).
    # ═══════════════════════════════════════════════════════════════════════
    if hook_cut is not None:
        hook_copy = {
            **hook_cut,
            "scene_index": 0,
            "cut_index": 1,
            "is_hook": True,
            "render_type": "ai_video",
            "_orig_scene_index": hook_cut["scene_index"],
            "_orig_cut_index":   hook_cut["cut_index"],
        }
        result = [hook_copy] + result

    return result


def _extract_last_scene(content: str) -> str:
    """마지막 컷 텍스트 추출 (다음 챕터 이어받기용) — 씬>컷 계층 및 구형 포맷 모두 처리"""
    try:
        from services.gemini_helper import extract_json
        data = extract_json(content)
        scenes = data.get("scenes", []) if isinstance(data, dict) else []
        if scenes:
            last_scene = scenes[-1]
            # 새 포맷: cuts 배열
            cuts = last_scene.get("cuts", [])
            if cuts:
                last_text = cuts[-1].get("text", "")
            else:
                # 구형 포맷: text 필드 직접
                last_text = last_scene.get("text", "")
            return last_text[-500:] if len(last_text) > 500 else last_text
    except Exception:
        pass
    # 폴백: 구 마크다운 구분자 방식
    parts = re.split(r'\n---\n', content)
    last = parts[-1].strip() if parts else ""
    return last[-500:] if len(last) > 500 else last


async def regenerate_chapter(series_id: str, chapter: int) -> dict:
    """단일 챕터 재생성 — 기존 챕터/씬 교체"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("world_data,settings").eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}
    _settings: dict = res.data.get("settings") or {}
    _art_style: str = _settings.get("artStyle", "polystyle")
    _guest_cast: dict = world.get("guest_cast") or {}

    # chapter_role 동적 결정
    if chapter == 1:
        role = "도입부"
    elif chapter in (2, 3):
        role = "전개"
    elif chapter in (4, 5):
        role = "클라이맥스"
    else:
        role = "결말"

    # RAG 컨텍스트
    rag_ctx = await build_rag_context(series_id, role, chapter)

    # 이전 챕터 엔딩 로드 (ch-1의 마지막 500자)
    prev_ending = ""
    if chapter > 1:
        prev_res = await asyncio.to_thread(
            lambda: db.table("v3_chapters")
            .select("content")
            .eq("series_id", series_id)
            .eq("chapter", chapter - 1)
            .single()
            .execute()
        )
        if prev_res.data:
            prev_ending = _extract_last_scene(prev_res.data.get("content", ""))

    # STEP 1: 대본 생성
    narrative_prompt = _build_narrative_prompt(world, chapter, role, rag_ctx, prev_ending, [])
    narrative = await call_gemini(narrative_prompt, system_instruction=_SYSTEM_INSTRUCTION, max_tokens=6000, temperature=0.95)

    # v3_chapters upsert
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").upsert({
            "series_id": series_id,
            "chapter": chapter,
            "role": role,
            "content": narrative,
            "approved": False,
        }, on_conflict="series_id,chapter").execute()
    )

    # STEP 2: 씬/컷 JSON 구조화
    structure_raw = await call_gemini(
        _build_structure_prompt(narrative, world, chapter),
        max_tokens=8000,
        temperature=0.3,
    )

    # series_code 로드
    sc_res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
    )
    series_code: str | None = sc_res.data.get("series_code")

    # v3_scenes 기존 씬 삭제 후 재삽입 (scene_code 포함)
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .delete()
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .execute()
    )
    scenes = _parse_scenes_json(structure_raw, chapter, world)
    scenes = await _absorb_dialogue_cuts(scenes, chapter)  # Pass 2: 대사 흡수
    await _save_scenes(db, series_id, chapter, scenes, series_code,
                       art_style=_art_style, guest_cast=_guest_cast)

    # 복선 메타 갱신
    try:
        meta = await _extract_chapter_meta(narrative, chapter)
        await asyncio.to_thread(
            lambda: db.table("v3_chapter_meta").upsert(
                {"series_id": series_id, "chapter": chapter, **meta},
                on_conflict="series_id,chapter"
            ).execute()
        )
    except Exception:
        pass

    # 위키 청크 갱신
    try:
        await auto_update_wiki(series_id, chapter, narrative[:500])
    except Exception:
        pass

    return {"ok": True, "chapter": chapter, "role": role, "scenes": len(scenes)}


async def revise_chapter_content(series_id: str, chapter: int) -> dict:
    """기존 대본을 유지하며 규칙 위반 부분만 교정 (대사 30% 이하, 짧은 대사 병합)"""
    db = get_supabase()

    ch_res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("content,role")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    if not ch_res.data or not ch_res.data.get("content"):
        raise ValueError(f"챕터 {chapter} 대본 없음")
    existing_content: str = ch_res.data["content"]
    role: str = ch_res.data.get("role", "전개")

    series_res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data,series_code,settings")
        .eq("id", series_id).single().execute()
    )
    world: dict = series_res.data.get("world_data") or {}
    series_code: str | None = series_res.data.get("series_code")
    _settings: dict = series_res.data.get("settings") or {}
    _art_style: str = _settings.get("artStyle", "polystyle")
    _guest_cast: dict = world.get("guest_cast") or {}

    revise_prompt = (
        f"다음은 {chapter}화 대본이다. 아래 규칙 위반 부분만 수정하고 나머지는 그대로 유지하라.\n\n"
        "## 수정 규칙\n"
        "1. **대사 비중 30% 이하**: 대사(dialogue)가 전체 컷의 30%를 초과하면 초과분을 나레이션으로 흡수한다.\n"
        "2. **짧은 대사 병합**: 대사 텍스트가 15자 미만이면 앞뒤 나레이션과 합쳐 narration으로 변환한다.\n"
        '   예: "젠장." → "손가락이 떨려왔다. 젠장, 그는 중얼거렸다."\n'
        "3. **서사 흐름 유지**: 사건 순서·인물 행동·반전·결말은 절대 바꾸지 않는다.\n"
        "4. **캐릭터 어투 유지**: 각 인물의 말투·성격은 그대로 유지한다.\n\n"
        f"## 원본 대본 ({chapter}화)\n{existing_content}\n\n"
        "위 규칙을 지키며 수정된 대본을 출력하라.\n"
        "출력: 순수 한국어 서사 본문만 (JSON·마크다운 코드블록 없이). 규칙 위반 부분만 최소한으로 수정한다."
    )

    revised = await call_gemini(
        revise_prompt,
        system_instruction=_SYSTEM_INSTRUCTION,
        max_tokens=6000,
        temperature=0.4,
    )
    revised_content = revised.strip() if revised else existing_content

    await asyncio.to_thread(
        lambda: db.table("v3_chapters").update({
            "content": revised_content,
            "approved": False,
        }).eq("series_id", series_id).eq("chapter", chapter).execute()
    )

    # 씬/컷 재구조화
    structure_raw = await call_gemini(
        _build_structure_prompt(revised_content, world, chapter),
        max_tokens=8000,
        temperature=0.3,
    )
    await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .delete().eq("series_id", series_id).eq("chapter", chapter).execute()
    )
    scenes = _parse_scenes_json(structure_raw, chapter, world)
    scenes = await _absorb_dialogue_cuts(scenes, chapter)  # Pass 2: 대사 흡수
    await _save_scenes(db, series_id, chapter, scenes, series_code,
                       art_style=_art_style, guest_cast=_guest_cast)

    # 복선 메타 갱신
    try:
        meta = await _extract_chapter_meta(revised_content, chapter)
        await asyncio.to_thread(
            lambda: db.table("v3_chapter_meta").upsert(
                {"series_id": series_id, "chapter": chapter, **meta},
                on_conflict="series_id,chapter"
            ).execute()
        )
    except Exception:
        pass

    # 위키 청크 갱신
    try:
        await auto_update_wiki(series_id, chapter, revised_content[:500])
    except Exception:
        pass

    return {"ok": True, "chapter": chapter, "role": role, "scenes": len(scenes)}


async def revise_all_chapters(series_id: str) -> dict:
    """모든 챕터 교정 — awaiting_script_approval 상태 유지"""
    db = get_supabase()
    ch_res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("chapter").eq("series_id", series_id).order("chapter").execute()
    )
    chapters = [r["chapter"] for r in (ch_res.data or [])]
    failed = []
    for chapter in chapters:
        try:
            await revise_chapter_content(series_id, chapter)
        except Exception as e:
            failed.append({"chapter": chapter, "error": str(e)})
    # 상태는 awaiting_script_approval 그대로 — 별도 변경 없음
    return {"ok": True, "revised": len(chapters) - len(failed), "failed": failed}


async def _save_scenes(
    db,
    series_id: str,
    chapter: int,
    scenes: list[dict],
    series_code: str | None,
    *,
    art_style: str = "polystyle",
    guest_cast: dict | None = None,
):
    """컷 리스트 → v3_scenes upsert (scene_code 포함)

    ★ HOOK 복사본 처리 (53번 설계 — 변경 금지):
      scene_index=0인 HOOK 복사본과 원본(scene_index>0)이 동시에 저장됨.
      복사본의 scene_code는 _orig_scene_index/_orig_cut_index (원본 위치) 기준으로 생성
      → 두 레코드가 동일한 scene_code를 가짐. 이는 정상이며 의도된 동작.
      DB에서 scene_index=0 레코드를 발견해도 "중복 오류"로 판단하지 말 것.

    art_style/guest_cast 제공 시 image_prompt를 prompt_composer 버전으로 자동 덮어씀.
    (Gemini가 생성한 단순 영문 프롬프트 → 캐릭터 JSON·화풍·컷 타입 분기 적용 버전)
    """
    from services.prompt_composer import build_cut_image_prompt

    for scene in scenes:
        scene["series_id"] = series_id
        # HOOK 복사본은 원본 인덱스로 scene_code 생성 (ch01s00hc01 방지)
        code_scene_idx = scene.pop("_orig_scene_index", scene["scene_index"])
        code_cut_idx   = scene.pop("_orig_cut_index",   scene["cut_index"])
        scene["scene_code"] = _scene_code(
            series_code, chapter,
            code_scene_idx, code_cut_idx, scene["is_hook"]
        )
        # prompt_composer 버전으로 image_prompt 덮어쓰기
        # 실패 시 빈 문자열로 초기화 — Gemini 생성 photorealistic 프롬프트 차단 (LD-003)
        try:
            scene["image_prompt"] = build_cut_image_prompt(
                scene, art_style, guest_cast=guest_cast or {}
            )
        except Exception:
            scene["image_prompt"] = ""  # LD-003: 폴백 시 빈 문자열 — Gemini 생성 프롬프트 차단
        await asyncio.to_thread(
            lambda s=scene: db.table("v3_scenes").upsert(
                s, on_conflict="series_id,chapter,scene_index,cut_index"
            ).execute()
        )

    # DB upsert 완료 후 ch{N}.json 동기화 — DB가 소스 오브 트루스
    if series_code:
        rows = await asyncio.to_thread(
            lambda: db.table("v3_scenes")
            .select("*")
            .eq("series_id", series_id)
            .eq("chapter", chapter)
            .order("scene_index")
            .order("cut_index")
            .execute()
        )
        chapter_dir = Path(__file__).parent.parent.parent.parent / "output" / series_code / f"ch{chapter:02d}"
        chapter_dir.mkdir(parents=True, exist_ok=True)
        (chapter_dir / f"ch{chapter:02d}.json").write_text(
            json.dumps(rows.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def _make_series_code(first_cut: dict) -> str:
    """
    마스터코드 생성 — ch01 HOOK 씬 첫 번째 컷 기준
    형식: YYYYMMDD_HHMMSS_ch01s{씬번호:02d}{h|n}c{컷번호:02d}
    예:   20260410_143022_ch01s05hc01  (HOOK이 5번째 씬, 1번째 컷)
    """
    now = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    scene_idx = first_cut.get("scene_index", 1)
    cut_idx = first_cut.get("cut_index", 1)
    is_hook = bool(first_cut.get("is_hook", False))
    first_code = f"ch01s{scene_idx:02d}{'h' if is_hook else 'n'}c{cut_idx:02d}"
    return f"{now}_{first_code}"


def _scene_code(series_code: str | None, chapter: int, scene_index: int, cut_index: int, is_hook: bool) -> str:
    """
    컷별 고유 식별자 — 날짜시간 + 씬/컷 위치
    형식: YYYYMMDD_HHMMSS_ch{chapter:02d}s{scene_index:02d}{h|n}c{cut_index:02d}
    예:   20260410_143022_ch01s03nc02
    series_code에서 앞의 날짜+시간(YYYYMMDD_HHMMSS)만 추출해 prefix로 사용
    series_code 미확정(None)이면 위치 코드만 반환
    """
    position = f"ch{chapter:02d}s{scene_index:02d}{'h' if is_hook else 'n'}c{cut_index:02d}"
    if series_code:
        parts = series_code.split('_')
        datetime_prefix = f"{parts[0]}_{parts[1]}"  # YYYYMMDD_HHMMSS
        return f"{datetime_prefix}_{position}"
    return position


def _build_structure_prompt(narrative: str, world: dict, chapter: int) -> str:
    """
    STEP 2 — 완성된 대본 → 씬/컷 JSON 구조화 프롬프트.
    씬과 컷의 정의를 명확히 전달하고, 씬 힌트를 컷이 계승하도록 강제한다.
    """
    char_a = world.get("charAName", "주인공A")
    char_b = world.get("charBName", "주인공B")

    return f"""당신은 한국 웹소설 대본을 영상 제작용 씬/컷 구조로 변환하는 전문 편집자다.

## 등장인물 참고
- 주인공 A: {char_a}
- 주인공 B: {char_b}

---

## ★ 씬/컷 2단계 분할 절차 (반드시 이 순서대로)

### 1단계 — 씬 분할 (먼저 확정, 대본 전체를 한 번 독해)

대본 전체를 읽고 **공간·시간·등장인물·문맥 큰 흐름** 기준으로 씬 경계를 먼저 잡는다.
씬은 "동일한 촬영 세트"다. 아래 중 하나라도 바뀌면 새 씬:

| 기준 | 예시 |
|------|------|
| 공간(장소) 변경 | 카페 → 사무실, 실내 → 야외 |
| 시간 변경 | 오전 → 저녁, 당일 → 다음날 |
| 등장인물 구성 변경 | A+B → A 혼자, 또는 제3자 합류 |
| 문맥의 큰 흐름 전환 | 갈등 고조 → 화해 시도, 긴장 → 이완 |

> 씬 수 목표: **6~8개** (챕터 전체 분량을 균등하게 분배)

씬은 **시각적 공통 힌트**를 갖는다:
- `scene_hint`: 이 씬을 관통하는 핵심 시각 키워드 (조명·질감·날씨·오브젝트, 15자 이내)
- 예: "낡은 카페, 빗줄기 창문, 차가운 블루 톤"
- 예: "심야 사무실 형광등, 파란 모니터 빛"
- **이 씬에 속한 모든 컷의 image_hint는 한국어로 작성한다**

### 2단계 — 컷 분할 (씬 확정 후, 씬 내부를 세분화)

1단계에서 확정된 **각 씬 안에서만** 컷을 나눈다. 씬 경계를 넘는 컷은 없다.
씬 설정(장소·시간·인물)은 유지한 채, 아래 기준으로 세분화:

| 기준 | 규칙 |
|------|------|
| **대사 1개 = 컷 1개** | 대사(dialogue) 1줄은 반드시 단독 컷 — 나레이션과 절대 같은 컷에 묶지 않음 |
| **나레이션 덩어리** | 연속된 나레이션은 자연스러운 호흡(2~4문장) 단위로 묶어 하나의 컷 |
| 카메라 포커스 변경 | 공간 전체 풀샷 → 손 클로즈업 |
| 감정 강도 변화 | 정적 → 폭발, 냉소 → 눈물 |

> 씬당 컷 수: **3~7개**
> 챕터 총 컷 수: **20~35개**

컷의 구성:
- `text`: 이 컷에서 TTS로 읽힐 텍스트 — **따옴표 없이** 원문 내용만 (TTS가 따옴표를 읽음)
  - narration 컷: 나레이션 문장 그대로
  - dialogue 컷: 대사 내용만 (따옴표 제외) — 예: `아빠, 괜찮아?`
- `image_hint`: 이 컷에서 카메라가 포착하는 **단일 순간·단일 프레임** 시각 묘사 **(반드시 한국어)**
  캐릭터는 이름 대신 외형·역할로 묘사: "남자", "여자", "정장 차림의 중년 남성", "여주인공" 등
  예: "떨리는 커피잔 클로즈업, 책상 위", "남자의 표정이 굳어지는 미디엄샷"
  **⚠️ 절대 금지**: 시퀀스 언어 사용 불가 — "then", "montage", "cut to", "then a shot of", "then a cut to", "flashback", "sequence" 등 시간 흐름·장면 전환을 암시하는 표현 금지.
  image_hint는 정지된 한 장의 사진처럼 묘사한다. 복수 장면을 나열하지 말 것.
- `duration_seconds`: text 글자수 ÷ 100 (소수점 1자리)

---

## 변환할 대본 (챕터 {chapter})

{narrative}

---

## 출력 형식
마크다운 코드블록 없이 순수 JSON만 출력:

{{
  "scenes": [
    {{
      "scene_index": 1,
      "location": "장소 (한국어)",
      "time_of_day": "시간대 (한국어)",
      "characters": ["등장 캐릭터 이름"],
      "atmosphere": "씬 전체 분위기 (한국어, 1문장)",
      "scene_hint": "이 씬의 핵심 시각 키워드 — 조명·질감·날씨·오브젝트 등 (한국어, 15자 이내)",
      "cuts": [
        {{
          "cut_index": 1,
          "is_hook": false,
          "type": "narration",
          "speaker": null,
          "text": "나레이션 문장 (따옴표 없이, TTS가 읽을 내용만)",
          "image_hint": "책상 위 커피잔 클로즈업, 손이 떨리는 장면",
          "duration_seconds": 4.5
        }},
        {{
          "cut_index": 2,
          "is_hook": false,
          "type": "dialogue",
          "speaker": "등장인물 이름",
          "speaker_gender": "male",
          "speaker_age_group": "adult",
          "text": "대사 내용만 (따옴표 제외, 예: 아빠 괜찮아?)",
          "image_hint": "화자의 표정이 굳어지는 미디엄샷",
          "duration_seconds": 2.5
        }}
      ]
    }}
  ]
}}

## 변환 규칙
1. **절차**: 씬 경계 먼저 확정 → 씬 내부 컷 분할 (순서 역전 금지)
2. **텍스트 원문 분배**: 대본 내용을 그대로 컷 text에 할당 — 새로 창작하지 말 것
3. **씬 구분**: 공간·시간·등장인물·문맥 큰 흐름 변경 기준으로 분절
4. **scene_hint**: 15자 이내 핵심 시각 키워드 — 해당 씬 분위기를 대표하는 한국어 시각 키워드
5. **is_hook**: 전체 대본에서 감정 충격이 가장 강렬한 컷 1개에만 true — 첫 씬 첫 컷 금지
6. **수량**: 씬 6~8개, 씬당 컷 3~7개, 총 컷 20~35개, cut_index는 씬마다 1부터 리셋
7. **대사 컷 필수 필드**: speaker(이름), speaker_gender(male|female), speaker_age_group(child|teen|young|adult|elder)
   - age 기준: child(0~12), teen(13~19), young(20~35), adult(36~59), elder(60+)
8. **text 따옴표 금지**: text 값에 ", ", " 포함 금지 — TTS가 따옴표를 음성으로 읽음
9. **type: mixed 금지**: narration 또는 dialogue만 허용
10. **대사 비중 30% 이하**: dialogue 타입 컷이 전체 컷의 30%를 초과하면 안 된다.
    초과 예상 시 대사를 간접 인용 narration으로 변환해 narration 타입으로 배정할 것.
    예: `"당신이 미워요."` → narration: `"그녀는 미워하는 마음을 숨기지 않았다."`
"""


def _merge_consecutive_dialogue(cuts: list[dict]) -> list[dict]:
    """Pass 1.5 — 동일 화자 연속 dialogue 컷을 1개로 병합 (HOOK 컷 제외)."""
    result = []
    i = 0
    while i < len(cuts):
        cut = cuts[i]
        if cut.get("type") != "dialogue" or cut.get("is_hook"):
            result.append(cut)
            i += 1
            continue
        speaker = cut.get("speaker")
        group = [cut]
        j = i + 1
        while (
            j < len(cuts)
            and cuts[j].get("type") == "dialogue"
            and cuts[j].get("speaker") == speaker
            and not cuts[j].get("is_hook")
        ):
            group.append(cuts[j])
            j += 1
        if len(group) > 1:
            merged = dict(cut)
            merged["text"] = " ".join(c.get("text", "") for c in group)
            merged["image_hint"] = group[-1].get("image_hint") or cut.get("image_hint")
            result.append(merged)
        else:
            result.append(cut)
        i = j
    return result


async def _absorb_dialogue_cuts(cuts: list[dict], chapter: int) -> list[dict]:
    """
    Pass 2 — dialogue 컷이 상한을 초과할 경우, 핵심 대사 외 나머지를
    단일 Gemini 배치 호출로 간접 인용 narration으로 변환한다.
    ch01: 최대 3개 / ch02~06: 최대 5개
    보존 우선순위: is_hook 컷 > 앞쪽 순서
    """
    from services.tts_service import _NARRATOR_VOICE

    # Pass 1.5: 동일 화자 연속 컷 병합 (cap 계산 전에 수행)
    cuts = _merge_consecutive_dialogue(cuts)

    cap = 3 if chapter == 1 else 5
    d_indices = [i for i, c in enumerate(cuts) if c.get("type") == "dialogue"]

    if len(d_indices) <= cap:
        return cuts  # 상한 이하 → 변환 없음

    # 보존 대상: is_hook 컷 + 앞쪽 (cap - hook수)개
    hook_set = {i for i in d_indices if cuts[i].get("is_hook")}
    non_hook = [i for i in d_indices if i not in hook_set]
    keep_count = max(0, cap - len(hook_set))
    keep_set = hook_set | set(non_hook[:keep_count])
    absorb_indices = [i for i in d_indices if i not in keep_set]

    if not absorb_indices:
        return cuts

    # 단일 배치 Gemini 호출
    items_text = "\n".join(
        f'{n}. 화자: {cuts[i].get("speaker", "화자")} | 대사: {cuts[i].get("text", "")}'
        for n, i in enumerate(absorb_indices, 1)
    )
    batch_prompt = (
        "다음 대사들을 각각 간접 인용 나레이션 1문장으로 변환하라.\n\n"
        f"{items_text}\n\n"
        "규칙: 3인칭 서술체(예: '그는 ~라고 했다'), 따옴표 없이, 감정·행동 자연스럽게 녹임\n"
        "출력: 순수 JSON 배열만\n"
        '[{"n": 1, "text": "변환된 나레이션"}, ...]'
    )

    # ── 1차: LLM 간접 인용 변환 시도 (Cerebras → ... → Gemini Free) ──────────
    # extract_json은 dict 전용이므로 배열 응답은 직접 파싱한다.
    text_map: dict[int, str] = {}
    llm_ok = False
    try:
        import re as _re, json as _json
        from services.gemini_helper import call_free_llm
        raw = await call_free_llm(batch_prompt, max_tokens=2000, temperature=0.3)
        # 코드펜스 제거 (닫힘 없는 잘린 응답 포함)
        _txt = _re.sub(r'```(?:json|JSON)?\s*', '', raw)
        _txt = _re.sub(r'```', '', _txt).strip()
        # 배열 추출
        _arr = _re.search(r'\[[\s\S]*\]', _txt)
        if _arr:
            converted = _json.loads(_arr.group(0))
            if isinstance(converted, list):
                text_map = {
                    item["n"]: item["text"]
                    for item in converted
                    if isinstance(item, dict) and "n" in item and "text" in item
                }
                llm_ok = any(v for v in text_map.values())  # 빈 문자열 응답 = 실패로 처리
    except Exception as e:
        logger.warning("[_absorb_dialogue_cuts] LLM 변환 실패 → Python 폴백 진입: %s", e)

    # ── 2차: LLM 실패/부분 실패 시 Python 결정론적 narration 폴백 ────────────
    # 🔒 LD-002: dialogue cap(ch01=3, ch02+=5) 준수는 LLM 가용성과 독립이어야 한다.
    if not llm_ok or len(text_map) < len(absorb_indices):
        for n, idx in enumerate(absorb_indices, 1):
            if n in text_map and text_map[n]:
                continue  # LLM이 변환한 항목은 유지
            # 화자 이름과 원본 대사를 이용해 간단한 간접 인용문 생성
            speaker = (cuts[idx].get("speaker") or "그").strip() or "그"
            original = (cuts[idx].get("text") or "").strip()
            original = original.strip('"\'"“”‘’')
            if original.endswith(("다.", "요.", "?", "!", ".")):
                quoted = original
            elif original:
                quoted = original + "."
            else:
                quoted = "무언가."
            base = quoted[:-1] if quoted.endswith(".") else quoted
            text_map[n] = f"{speaker}는 {base}라고 말했다."

    # ── 3차: cuts 변환 적용 ────────────────────────────────────────────────
    try:
        result = [dict(c) for c in cuts]
        for n, idx in enumerate(absorb_indices, 1):
            converted_text = text_map.get(n)
            if not converted_text:
                continue
            _char_names = (result[idx].get("scene_meta") or {}).get("characters") or []
            _prod, _anim = _compute_production_type("narration", _char_names)
            result[idx] = {
                **result[idx],
                "type":           "narration",
                "text":           converted_text,
                "speaker":        None,
                "tts_voice":      _NARRATOR_VOICE,
                "production":     _prod,
                "animation_type": _anim,
            }
        return result
    except Exception as e:
        logger.error("[_absorb_dialogue_cuts] 폴백 적용 실패 — 원본 반환 (LD-002 위반 위험): %s", e)
        return cuts


async def _extract_chapter_meta(content: str, chapter: int) -> dict:
    """챕터 본문에서 복선/미해결 실마리 추출 (간단 JSON)"""
    prompt = f"""다음 챕터{chapter} 대본에서 복선과 미해결 실마리를 추출하라.

대본:
{content[:1500]}

반드시 아래 JSON 형식으로만 응답 (마크다운 없이):
{{
  "chapter": {chapter},
  "planted_foreshadows": ["심은 복선1", "심은 복선2"],
  "open_threads": ["미해결 실마리1", "미해결 실마리2"]
}}"""
    # 🟢 FREE-LLM: 복선 추출 — 저비용 무료 API 사용
    from services.gemini_helper import call_free_llm, extract_json
    raw = await call_free_llm(prompt, max_tokens=512, temperature=0.3)
    return extract_json(raw)
