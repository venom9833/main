"""세계관 생성 서비스 — Gemini 1회 호출 (extract 모드는 call_free_llm)"""
import asyncio
import json
import logging
import pathlib
from core.database import get_supabase
from services.gemini_helper import call_gemini, extract_json
from services.wiki_service import ingest_chunk, upsert_wiki_page, search_chunks

logger = logging.getLogger(__name__)

# world_options.json 경로 (파일은 요청마다 새로 읽어 서버 재시작 없이 반영)
_OPTIONS_PATH = pathlib.Path(__file__).parent.parent / "data" / "world_options.json"


def _load_options() -> dict:
    """world_options.json을 매 호출마다 새로 읽어 반환 — 서버 재시작 없이 반영"""
    with open(_OPTIONS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _find_option(dimension: str, option_id: str) -> dict | None:
    """world_options.json에서 특정 옵션 항목을 찾아 반환"""
    options = _load_options()
    for item in options.get(dimension, []):
        if item["id"] == option_id:
            return item
    return None


def _build_selected_options_block(selected: dict) -> str:
    """사용자가 선택한 옵션 → Gemini 프롬프트 제약 블록으로 변환"""
    lines: list[str] = []

    bg_id = selected.get("background")
    rel_id = selected.get("relationship")
    soc_id = selected.get("social_fracture")
    conf_id = selected.get("conflict_structure")
    pov_id_check = selected.get("narrative_pov")
    res_id_check = selected.get("resolution_method")

    if not any([bg_id, rel_id, soc_id, conf_id, pov_id_check, res_id_check]):
        return ""

    lines.append("## ★ 사용자 확정 세계관 설정 (반드시 그대로 반영)")
    lines.append("아래 설정은 사용자가 직접 선택한 것입니다. 변경하거나 무시하지 마십시오.\n")

    opt = _find_option("backgrounds", bg_id) if bg_id else None
    if bg_id and opt:
        lines.append(f"### 배경/장소: {opt['label']}")
        lines.append(f"- 핵심 긴장: {opt['tension']}")
        if opt.get("scene"):
            lines.append(f"- 시작 장면 앵커: {opt['scene']}")
        lines.append("  → socialBackground는 이 배경 위에서 설계할 것\n")
    elif bg_id:
        # ID가 world_options.json에 없는 경우 → 자유 텍스트 직접 주입
        freeform_text = selected.get("background", "")
        if freeform_text:
            lines.append(f"### 배경/장소: {freeform_text}")
            lines.append("  → socialBackground는 이 배경 위에서 설계할 것\n")

    opt = _find_option("relationships", rel_id) if rel_id else None
    if rel_id and opt:
        lines.append(f"### 두 주인공의 관계: {opt['label']}")
        lines.append(f"- 핵심 긴장: {opt['tension']}")
        if opt.get("scene"):
            lines.append(f"- 첫 만남 장면 앵커: {opt['scene']}")
        lines.append("  → relationship 필드는 이 관계 구조를 그대로 사용할 것\n")
    elif rel_id:
        freeform_text = selected.get("relationship", "")
        if freeform_text:
            lines.append(f"### 두 주인공의 관계: {freeform_text}")
            lines.append("  → relationship 필드는 이 관계 구조를 그대로 사용할 것\n")

    opt = _find_option("social_fractures", soc_id) if soc_id else None
    if soc_id and opt:
        lines.append(f"### 사회적 균열: {opt['label']}")
        lines.append(f"- 드라마 뿌리: {opt['tension']}")
        if opt.get("scene"):
            lines.append(f"- 현장 장면 앵커: {opt['scene']}")
        lines.append("  → coreTheme/coreWound에 이 사회적 균열을 반드시 녹일 것\n")
    elif soc_id:
        freeform_text = selected.get("social_fracture", "")
        if freeform_text:
            lines.append(f"### 사회적 균열: {freeform_text}")
            lines.append("  → coreTheme/coreWound에 이 사회적 균열을 반드시 녹일 것\n")

    opt = _find_option("conflict_structures", conf_id) if conf_id else None
    if conf_id and opt:
        lines.append(f"### 갈등 구조: {opt['label']}")
        lines.append(f"- 갈등의 본질: {opt['tension']}")
        if opt.get("scene"):
            lines.append(f"- 갈등 장면 앵커: {opt['scene']}")
        lines.append("  → storyArc 전체가 이 갈등 구조 위에서 전개될 것\n")
    elif conf_id:
        freeform_text = selected.get("conflict_structure", "")
        if freeform_text:
            lines.append(f"### 갈등 구조: {freeform_text}")
            lines.append("  → storyArc 전체가 이 갈등 구조 위에서 전개될 것\n")

    pov_id = selected.get("narrative_pov")
    pov_opt = _find_option("narrative_povs", pov_id) if pov_id else None
    if pov_id and pov_opt:
        lines.append(f"### 서술 시점: {pov_opt['label']}")
        lines.append(f"- 서술 효과: {pov_opt['tension']}")
        if pov_opt.get("scene"):
            lines.append(f"- 시점 장면 앵커: {pov_opt['scene']}")
        if pov_id == "pov_01":
            lines.append("  → 모든 챕터를 주인공의 1인칭 독백으로 서술. 주인공의 내면·판단·감정이 직접 드러날 것\n")
        elif pov_id == "pov_02":
            lines.append("  → 주변인의 1인칭 시점. 주인공은 관찰되는 대상. 독자는 화자를 통해 주인공의 진실에 접근\n")
        elif pov_id == "pov_03":
            lines.append("  → 빌런의 1인칭 독백. 빌런은 자신의 행동을 정당화하는 방식으로 서술. 독자가 빌런의 논리에 설득당하도록 설계할 것\n")
        elif pov_id == "pov_04":
            lines.append("  → 3인칭 전지적 시점. 여러 인물의 내면을 자유롭게 오가며 서술. 독자가 인물들보다 더 많이 알도록 설계할 것\n")
    elif pov_id:
        freeform_text = selected.get("narrative_pov", "")
        if freeform_text and freeform_text != pov_id:
            lines.append(f"### 서술 시점: {freeform_text}\n")

    res_id = selected.get("resolution_method")
    res_opt = _find_option("resolution_methods", res_id) if res_id else None
    if res_id and res_opt:
        category = res_opt.get("category", "")
        lines.append(f"### 갈등 해소 방식: {res_opt['label']} ({category})")
        lines.append(f"- 해소의 본질: {res_opt['tension']}")
        if res_opt.get("scene"):
            lines.append(f"- 결말 장면 앵커: {res_opt['scene']}")
        lines.append("  → storyArc ch06과 seriesDirection은 반드시 이 방식으로 귀결될 것")
        if category == "비현실적":
            lines.append("  → 초자연·판타지 요소를 결말에 자연스럽게 녹일 것 (갑작스러운 삽입 금지)\n")
        else:
            lines.append("  → 기억상실·타임슬립·초자연 요소로 마무리 금지 — 현실 안에서 해소할 것\n")
    elif res_id:
        freeform_text = selected.get("resolution_method", "")
        if freeform_text and freeform_text != res_id:
            lines.append(f"### 갈등 해소 방식: {freeform_text}")
            lines.append("  → storyArc ch06과 seriesDirection은 반드시 이 방식으로 귀결될 것\n")

    lines.append("---")
    return "\n".join(lines)


def _classify_sources(chunks: list[dict]) -> tuple[list[str], list[str]]:
    """청크를 소설(각색용)과 팩트(사실 반영용)로 분류

    source_ref에 'file:' 이 포함된 경우 파일명 확장자·키워드로 판단.
    - .srt/.vtt + 뉴스·경제·사회 키워드 → 팩트
    - .txt/.md + 소설·단편·수필 키워드 → 소설
    """
    FACT_KEYWORDS = {"폭락", "폭등", "주식", "부동산", "경제", "뉴스", "사건", "사고",
                     "금리", "환율", "코인", "투자", "수익", "손실", "보도", "기사"}
    FICTION_KEYWORDS = {"소설", "단편", "수필", "이야기", "관상", "여종", "무협",
                        "드라마", "시나리오", "웹소설", "로맨스", "판타지"}

    fact_chunks, fiction_chunks = [], []

    for c in chunks:
        content = c.get("content", "")
        ref = (c.get("source_ref") or "").lower()

        # 파일명·내용 기반 판단
        is_fact = any(kw in ref or kw in content[:200] for kw in FACT_KEYWORDS)
        is_fiction = any(kw in ref or kw in content[:200] for kw in FICTION_KEYWORDS)

        # .srt/.vtt는 기본적으로 팩트 소스로 간주
        if ".srt" in ref or ".vtt" in ref:
            is_fact = True

        if is_fact and not is_fiction:
            fact_chunks.append(content)
        else:
            fiction_chunks.append(content)

    return fact_chunks, fiction_chunks


def _build_summary_block(source_summary: dict) -> str:
    """Python 분석 결과(source_summary) → Gemini 프롬프트 소스 블록 (RAG 대체)"""
    summary = source_summary.get("summary", "")
    entities = source_summary.get("entities", [])
    key_sentences = source_summary.get("key_sentences", [])
    filename = source_summary.get("filename", "업로드 파일")

    if not summary:
        return ""

    parts = [f"## 업로드 소스 분석 결과 (파일: {filename})"]
    if entities:
        parts.append(f"\n### 핵심어\n{', '.join(entities[:10])}")
    if key_sentences:
        sents = "\n".join(f"- {s}" for s in key_sentences[:5])
        parts.append(f"\n### 핵심 문장\n{sents}")
    parts.append(f"\n### 요약\n{summary}")
    parts.append("\n---")
    return "\n".join(parts)


def _build_source_block(fact_chunks: list[str], fiction_chunks: list[str]) -> str:
    if not fact_chunks and not fiction_chunks:
        return ""

    parts = []

    if fact_chunks:
        fact_text = "\n\n".join(fact_chunks[:4])  # 최대 4개
        parts.append(f"""### [팩트 소스 — 사실 기반 세계관 재료]
아래는 실제 사건·현상·경제 정보입니다.
이 팩트를 세계관의 **사회적 배경, 시대적 분위기, 갈등의 뿌리**로 직접 활용하세요.
인물들이 이 현실 속에서 살아가도록 설계하세요.

{fact_text}""")

    if fiction_chunks:
        fiction_text = "\n\n".join(fiction_chunks[:4])  # 최대 4개
        parts.append(f"""### [소설 소스 — 각색 재료]
아래는 기존 소설·시나리오 내용입니다.
원작을 복사하지 말고, 인물 유형·관계 구조·갈등 씨앗만 **완전히 새로운 이야기로 각색**하세요.
배경·이름·직업은 현대 한국 사회로 바꾸세요.

{fiction_text}""")

    return "## 참고 소스\n\n" + "\n\n---\n\n".join(parts) + "\n\n---\n"


async def _extract_world_from_source(series_id: str, source_summary: dict, topic: str) -> dict:
    """sourceMode='extract': 소스 원문에서 세계관을 보존 추출 (시대·이름·장르 변형 금지)"""
    from services.gemini_helper import call_free_llm
    from core.config import settings

    filename = source_summary.get("filename", "")
    src_text = ""

    if filename:
        src_path = settings.SOURCE_DIR / series_id / filename
        try:
            src_text = src_path.read_text(encoding="utf-8")[:6000]
        except Exception as e:
            logger.warning(f"소스 파일 읽기 실패 ({src_path}): {e}")

    if not src_text:
        key_sentences = source_summary.get("key_sentences", [])
        summary = source_summary.get("summary", "")
        src_text = (summary + "\n" + "\n".join(key_sentences)).strip()

    if not src_text:
        raise ValueError("소스 원문이 없어 extract 세계관 추출 불가")

    prompt = f"""당신은 한국 웹소설 분석 전문가입니다.

## 소스 원문
{src_text}

## 작가 주제
{topic}

소스 원문에서 세계관 정보를 정확히 추출하세요.

⚠️ 절대 규칙:
- 소스의 시대·배경·인물 이름·장르를 그대로 보존 (현대 한국 변환 금지)
- 소스에 없는 내용 창작 금지
- openingHook은 소스의 실제 첫 장면 또는 가장 강렬한 장면으로
- storyArc는 소스의 실제 서사 흐름을 따를 것
- charARole / charBRole에 소스의 실제 인물 이름 포함 가능

아래 JSON 형식만 출력하세요. 설명·마크다운·코드블록 없이 순수 JSON만 출력합니다.

{{
  "title": "소스 기반 시리즈 제목",
  "genre": "소스의 실제 장르",
  "style": "소스의 실제 문체",
  "relationship": "소스의 두 주인공 관계",
  "conflictTypes": ["소스의 실제 갈등 키워드"],
  "socialBackground": "소스의 시대적·사회적 배경 (현대 변환 절대 금지)",
  "coreTheme": "소스의 핵심 주제의식",
  "coreWound": "소스의 두 주인공이 공명하는 감정",
  "openingHook": "소스의 실제 첫 장면 또는 가장 강렬한 장면",
  "seriesDirection": "소스의 서사가 나아가는 방향",
  "charARole": "소스의 주인공 A 역할 (소스 원문 이름 그대로)",
  "charBRole": "소스의 주인공 B 역할 (소스 원문 이름 그대로)",
  "storyArc": {{
    "ch01": "소스 기반 도입부",
    "ch02": "소스 기반 전개 1",
    "ch03": "소스 기반 전개 2",
    "ch04": "소스 기반 클라이맥스 1",
    "ch05": "소스 기반 클라이맥스 2",
    "ch06": "소스 기반 잠정 결말"
  }}
}}"""

    raw = await call_free_llm(prompt, max_tokens=2000, temperature=0.3)
    world = extract_json(raw)
    if not world or not world.get("title"):
        raise ValueError(f"소스 원문 세계관 추출 실패 — raw: {raw[:200]}")
    logger.info(f"[{series_id}] extract_world 완료: {world.get('title')}")
    return world


async def run_world(series_id: str) -> dict:
    """
    1. 업로드 소스 → 팩트/소설 분류 → 차별화된 프롬프트 구성
    2. Gemini 세계관 생성 (1회)
    3. world_data 갱신
    4. wiki world 페이지 초기화
    5. RAG 인제스트
    """
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series").select("topic,world_data,settings").eq("id", series_id).single().execute()
    )
    series = res.data
    topic: str = series.get("topic", "")
    world_data: dict = series.get("world_data") or {}
    source_mode: str = world_data.get("sourceMode", "design")

    fact_chunks: list[str] = []
    fiction_chunks: list[str] = []

    # ── extract 경로: 소스 원문 보존 (call_free_llm) ───────────────────────────
    if source_mode == "extract":
        source_summary: dict = world_data.get("source_summary") or {}
        world = await _extract_world_from_source(series_id, source_summary, topic)

    # ── design 경로: 기존 Gemini 각색 흐름 ────────────────────────────────────
    else:
        source_summary = world_data.get("source_summary") or {}
        if source_summary:
            source_block = _build_summary_block(source_summary)
            world_direction = "업로드된 소스의 핵심어·핵심문장을 세계관의 뿌리로 활용하세요."
        else:
            # RAG fallback (source_summary 없는 경우)
            chunks = await search_chunks(series_id, topic, top_k=10)
            fact_chunks, fiction_chunks = _classify_sources(chunks)
            source_block = _build_source_block(fact_chunks, fiction_chunks)

            if fact_chunks and not fiction_chunks:
                world_direction = "팩트 소스에 나온 실제 사회·경제 현상을 세계관의 핵심 배경으로 삼으세요."
            elif fiction_chunks and not fact_chunks:
                world_direction = "소설 소스의 인물·갈등 구조를 현대 한국으로 완전히 각색하세요."
            elif fact_chunks and fiction_chunks:
                world_direction = "팩트 소스의 현실 배경 위에 소설 소스의 각색된 인물·갈등을 얹으세요."
            else:
                world_direction = "주제에서 자연스럽게 세계관을 도출하세요."

        # 사용자가 미리 선택한 옵션 읽기 (없으면 빈 dict)
        selected_options: dict = world_data.get("selectedOptions") or {}
        options_block = _build_selected_options_block(selected_options)

        forbidden_words: list[str] = _load_options().get("_meta", {}).get("forbidden_words", [])
        forbidden_block = ""
        if forbidden_words:
            forbidden_block = "## 절대 금지 표현\n" + "\n".join(f"- {w}" for w in forbidden_words)

        prompt = f"""당신은 한국 웹소설 기획 전문가입니다.

{source_block}
작가 주제: "{topic}"
세계관 방향: {world_direction}

{options_block}

이 소재로 한국 웹소설/드라마 시리즈의 세계관을 설계하세요.
아래 JSON 형식만 출력하세요. 설명·마크다운·코드블록 없이 순수 JSON만 출력합니다.

{{
  "title": "시리즈 제목",
  "genre": "장르 (예: 로맨스, 스릴러, 직장물, 경제드라마)",
  "style": "문체 (예: 감성 묘사 위주, 빠른 전개, 대사 중심)",
  "relationship": "두 주인공의 관계",
  "conflictTypes": ["갈등 유형 키워드 1", "갈등 유형 키워드 2 (선택)"],
  "socialBackground": "시대적·사회적 배경 한 단락 (팩트 소스가 있으면 반드시 반영)",
  "coreTheme": "시리즈 핵심 주제의식 한 문장",
  "coreWound": "두 주인공의 감정 공명 — 서로의 상처가 맞닿는 지점",
  "openingHook": "1화 첫 장면 훅 — 반드시 시간·장소·행동 중 하나로 시작하는 구체적 장면 (개념·설명·감상 시작 금지)",
  "seriesDirection": "시리즈가 나아가는 방향 — 종결 없이 계속 이어질 수 있는 열린 구조로",
  "charARole": "주인공 A의 서사 역할 한 줄 (예: 폭락장에서 전 재산을 잃은 중년 가장)",
  "charBRole": "주인공 B의 서사 역할 한 줄 (예: 폭락을 기회로 삼으려는 신흥 투자자)",
  "storyArc": {{
    "ch01": "도입부 — 인물 소개, 첫 충돌, 훅 사건 (한 줄)",
    "ch02": "전개 — 관계 깊어짐, 갈등 심화 (한 줄)",
    "ch03": "전개 — 비밀 균열 시작, 복선 심기 (한 줄)",
    "ch04": "클라이맥스 — 폭로·배신·반전 (한 줄)",
    "ch05": "클라이맥스 — 감정 절정, 돌이킬 수 없는 선택 (한 줄)",
    "ch06": "잠정 결말 — 여운·미해결 복선 남김 (한 줄, 연재 연장 가능)"
  }}
}}

조건:
- 사용자 확정 세계관 설정이 있으면 그 설정을 세계관의 중심축으로 삼을 것 — 해석·변형·무시 금지
- openingHook은 반드시 구체적 장면으로 시작 ("2003년 가을", "냄새가 먼저였다" 등) — 개념 정의 시작 금지
- 핵심 갈등: 비밀·배신·경제적 욕망 등 현실 요소 포함
- 모든 텍스트 한국어
- 인물 이름·직업·말투 등 인물 세부 정보는 절대 출력하지 말 것 — 캐스팅 단계에서 별도 결정
- storyArc는 약 6챕터 가이드라인 — 실제 연재는 독자 반응에 따라 늘어날 수 있음
- ch06 이후에도 새로운 갈등이 자연스럽게 파생될 수 있는 열린 구조로 설계
- 팩트 소스 직접 인용 금지 — 사회 배경으로만 활용
- 소설 소스 직접 복사 금지 — 인물 유형·갈등만 참조해 완전히 새로운 이야기로

{forbidden_block}
"""

        raw = await call_gemini(prompt, max_tokens=3000, temperature=0.9)
        world = extract_json(raw)

    # conflictTypes: Gemini가 자유 생성한 키워드 그대로 보존 (더 이상 28개 카탈로그로 강제 환원하지 않음)
    # selectedOptions는 world_data에 그대로 유지
    world["conflictFormulas"] = []   # WorldEditor 호환용 (옵션 선택 UI로 대체 예정)
    world["conflictTypes"] = world.get("conflictTypes") or []

    world_data.update(world)
    world_data["topic"] = topic
    world_data["sourceTypes"] = {
        "fact": len(fact_chunks),
        "fiction": len(fiction_chunks),
    }

    # 제목 업데이트
    title = world.get("title", topic)

    await asyncio.to_thread(
        lambda: db.table("v3_series").update({
            "title": title,
            "world_data": world_data,
            "status": "world_ready",
        }).eq("id", series_id).execute()
    )

    # wiki world 페이지 초기화
    world_md = _world_to_md(world)
    await upsert_wiki_page(series_id, "world", world_md)

    # wiki characters 페이지 초기화
    char_md = _chars_to_md(world)
    await upsert_wiki_page(series_id, "characters", char_md)

    # wiki foreshadows, timeline 빈 페이지 초기화
    await upsert_wiki_page(series_id, "foreshadows", "# 복선 현황\n\n(아직 심어진 복선 없음)")
    await upsert_wiki_page(series_id, "timeline", "# 타임라인\n")

    # RAG 인제스트
    await ingest_chunk(series_id, "world", world_md, source_ref="world")

    return {"ok": True, "title": title}


def _world_to_md(w: dict) -> str:
    lines = [
        f"# 세계관: {w.get('title', '')}",
        f"\n## 기본 설정",
        f"- 장르: {w.get('genre', '')}",
        f"- 문체: {w.get('style', '')}",
        f"- 관계: {w.get('relationship', '')}",
        f"- 갈등: {', '.join(w.get('conflictTypes', []))}",
        f"- 핵심 상처: {w.get('coreWound', '')}",
    ]
    if w.get("socialBackground"):
        lines += [f"\n## 사회적 배경", w["socialBackground"]]
    if w.get("coreTheme"):
        lines += [f"\n## 핵심 주제의식", w["coreTheme"]]
    if w.get("openingHook"):
        lines += [f"\n## 1화 훅", w["openingHook"]]
    if w.get("seriesDirection"):
        lines += [f"\n## 시리즈 방향", w["seriesDirection"]]
    arc = w.get("storyArc")
    if arc and isinstance(arc, dict):
        lines.append("\n## 챕터 가이드라인 (약 6화 기준, 연장 가능)")
        for ch, desc in arc.items():
            lines.append(f"- {ch}: {desc}")
    return "\n".join(lines)


def _chars_to_md(w: dict) -> str:
    lines = [
        "# 등장인물 (세계관 단계 초안)",
        "> 캐스팅 단계에서 실제 인물이 배정됩니다",
    ]
    char_a_role = w.get("charARole", "")
    char_b_role = w.get("charBRole", "")
    if char_a_role:
        lines += ["\n## 주인공 A 서사 역할", char_a_role]
    if char_b_role:
        lines += ["\n## 주인공 B 서사 역할", char_b_role]
    return "\n".join(lines)
