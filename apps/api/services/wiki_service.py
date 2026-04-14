"""V3 Wiki 서비스 — Supabase pgvector 기반 RAG + 풀 Wiki API"""
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from google import genai
from google.genai import types as genai_types
from core.config import settings
from core.database import get_supabase

# 임베딩 모델: gemini-embedding-001 (768차원)
_EMBED_MODEL = "gemini-embedding-001"
_CHUNK_SIZE = 400
_CHUNK_OVERLAP = 50

# 4개 핵심 wiki 슬러그
WIKI_SLUGS = ["world", "characters", "foreshadows", "timeline"]

# prompts/ 경로
_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _get_client() -> genai.Client:
    return genai.Client(api_key=settings.GOOGLE_API_KEY)


# ── 임베딩 ────────────────────────────────────────────────────────────────────

def _embed_sync(text: str, retries: int = 3) -> list[float]:
    import time
    client = _get_client()
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            result = client.models.embed_content(
                model=_EMBED_MODEL,
                contents=text,
                config=genai_types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=768,
                ),
            )
            return result.embeddings[0].values
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    # 최종 실패 — 빈 벡터 반환 (RAG 스킵, 파이프라인 계속)
    print(f"[embed] {retries}회 실패, 빈 벡터 반환: {last_err}")
    return [0.0] * 768


async def embed(text: str) -> list[float]:
    return await asyncio.to_thread(_embed_sync, text)


# ── 청크 분할 ─────────────────────────────────────────────────────────────────

def _chunk_text(text: str) -> list[str]:
    parts = [p.strip() for p in text.split("---") if p.strip()]
    chunks = []
    for part in parts:
        if len(part) <= _CHUNK_SIZE:
            chunks.append(part)
        else:
            sentences = part.replace("。", ".").split(".")
            buf = ""
            for s in sentences:
                s = s.strip()
                if not s:
                    continue
                if len(buf) + len(s) < _CHUNK_SIZE:
                    buf += s + ". "
                else:
                    if buf:
                        chunks.append(buf.strip())
                    overlap = buf[-_CHUNK_OVERLAP:] if len(buf) > _CHUNK_OVERLAP else buf
                    buf = overlap + s + ". "
            if buf:
                chunks.append(buf.strip())
    return [c for c in chunks if len(c) > 20]


# ── RAG 인제스트 ──────────────────────────────────────────────────────────────

async def ingest_chunk(
    series_id: str,
    source_type: str,
    content: str,
    source_ref: Optional[str] = None,
    metadata: Optional[dict] = None,
):
    """텍스트 → 청크 분할 → 임베딩 → v3_wiki_chunks 저장"""
    db = get_supabase()
    chunks = _chunk_text(content)
    for chunk in chunks:
        embedding = await embed(chunk)
        await asyncio.to_thread(
            lambda c=chunk, e=embedding: db.table("v3_wiki_chunks").insert({
                "series_id": series_id,
                "source_type": source_type,
                "source_ref": source_ref,
                "content": c,
                "embedding": e,
                "metadata": metadata or {},
            }).execute()
        )


async def search_chunks(series_id: str, query: str, top_k: int = 10) -> list[dict]:
    """쿼리 → pgvector 유사도 검색 → top-K 청크"""
    db = get_supabase()
    q_embedding = await embed(query)
    res = await asyncio.to_thread(
        lambda: db.rpc("match_wiki_chunks", {
            "p_series_id": series_id,
            "p_query_embedding": q_embedding,
            "p_match_count": top_k,
            "p_score_threshold": 0.65,
        }).execute()
    )
    return res.data or []


# ── Wiki 페이지 CRUD ───────────────────────────────────────────────────────────

async def upsert_wiki_page(series_id: str, slug: str, content_md: str):
    db = get_supabase()
    await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").upsert({
            "series_id": series_id,
            "slug": slug,
            "content_md": content_md,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="series_id,slug").execute()
    )


async def append_wiki_page(series_id: str, slug: str, content_md: str):
    """기존 페이지 끝에 내용 추가. 없으면 생성."""
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").select("content_md")
        .eq("series_id", series_id).eq("slug", slug).execute()
    )
    existing = (res.data[0]["content_md"] if res.data else "") or ""
    await upsert_wiki_page(series_id, slug, existing + "\n" + content_md)


async def delete_wiki_page(series_id: str, slug: str):
    db = get_supabase()
    await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages")
        .delete().eq("series_id", series_id).eq("slug", slug).execute()
    )


async def list_wiki_pages(series_id: str) -> list[dict]:
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").select("slug,updated_at")
        .eq("series_id", series_id).execute()
    )
    return res.data or []


async def read_wiki_page(series_id: str, slug: str) -> Optional[dict]:
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").select("*")
        .eq("series_id", series_id).eq("slug", slug).execute()
    )
    return res.data[0] if res.data else None


# ── Wiki 초기화 ───────────────────────────────────────────────────────────────

async def init_wiki_from_world(series_id: str, world_data: dict) -> dict:
    """세계관 데이터 → 4개 wiki 페이지 초기 생성 (Gemini 호출)"""
    from services.gemini_helper import call_gemini

    char_a = world_data.get("charAName", "주인공A")
    char_b = world_data.get("charBName", "주인공B")
    topic = world_data.get("topic", "")
    genre = world_data.get("genre", "")

    def _world_block() -> str:
        lines = [
            f"# 세계관 — {topic}",
            f"- 장르: {genre}",
            f"- 문체: {world_data.get('style', '')}",
            f"- 관계: {world_data.get('relationship', '')}",
            f"- 갈등: {', '.join(world_data.get('conflictTypes') or [])}",
            f"- 트랜드 키워드: {world_data.get('trendKeyword', '')}",
        ]
        return "\n".join(l for l in lines if l.split(": ", 1)[-1].strip())

    def _char_block(prefix: str, name: str) -> str:
        fields = {
            "직업": world_data.get(f"{prefix}Occupation", ""),
            "겉모습": world_data.get(f"{prefix}PublicFace", ""),
            "속모습": world_data.get(f"{prefix}Shadow", ""),
            "상황": world_data.get(f"{prefix}Situation", ""),
            "비밀": world_data.get(f"{prefix}Secret", ""),
            "Want": world_data.get(f"{prefix}Want", ""),
            "Need": world_data.get(f"{prefix}Need", ""),
            "말투": world_data.get(f"{prefix}SpeakingStyle", ""),
        }
        lines = [f"## {name}"]
        for k, v in fields.items():
            if v:
                lines.append(f"- {k}: {v}")
        return "\n".join(lines)

    # world 페이지
    world_md = _world_block()
    await upsert_wiki_page(series_id, "world", world_md)
    await ingest_chunk(series_id, "world", world_md, source_ref="init:world")

    # characters 페이지
    chars_md = f"# 등장인물\n\n{_char_block('charA', char_a)}\n\n{_char_block('charB', char_b)}"
    await upsert_wiki_page(series_id, "characters", chars_md)
    await ingest_chunk(series_id, "character", chars_md, source_ref="init:characters")

    # foreshadows 페이지 (초기 템플릿)
    foreshadows_md = (
        "# 복선 추적\n\n"
        "## 심어진 복선 (planted)\n_챕터 진행 후 자동 갱신_\n\n"
        "## 회수된 복선 (recovered)\n_없음_\n\n"
        "## 미회수 복선\n_없음_"
    )
    await upsert_wiki_page(series_id, "foreshadows", foreshadows_md)

    # timeline 페이지 (초기 템플릿)
    timeline_md = "# 타임라인\n\n_챕터 승인 후 자동 갱신_"
    await upsert_wiki_page(series_id, "timeline", timeline_md)

    return {"ok": True, "pages": WIKI_SLUGS}


# ── 소스 인제스트 ─────────────────────────────────────────────────────────────

def _load_ingest_prompt() -> str:
    path = _PROMPTS_DIR / "wiki_ingest.md"
    return path.read_text(encoding="utf-8")


async def ingest_source(
    series_id: str,
    source_type: str,
    content: str,
    source_ref: Optional[str] = None,
    title: str = "",
) -> dict:
    """
    소스 1건 수집 → RAG 인제스트 + wiki 페이지 패치
    구조화 타입(trend/news/fact): Gemini 없이 facts에 직접 추가
    기타(url/text/chapter/user_note): Gemini ingest 프롬프트 → 패치 적용
    """
    from services.gemini_helper import call_gemini, extract_json

    # 1. RAG 인제스트 (항상)
    await ingest_chunk(series_id, source_type, content, source_ref=source_ref)

    # 2. 구조화 타입: facts 페이지에 직접 추가
    if source_type in ("trend", "news", "fact", "viral"):
        entry = f"\n### {title or source_ref or source_type}\n{content[:500]}"
        await append_wiki_page(series_id, "facts", entry)
        return {"ok": True, "mode": "direct", "source_type": source_type}

    # 3. 기타 타입: Gemini ingest 프롬프트로 wiki 패치 생성
    pages = await list_wiki_pages(series_id)
    page_summaries = [{"slug": p["slug"], "updated_at": p["updated_at"]} for p in pages]

    prompt = f"""{_load_ingest_prompt()}

=== 입력 ===
{{
  "series_id": "{series_id}",
  "source": {{
    "source_type": "{source_type}",
    "title": "{title}",
    "raw_content": {json.dumps(content[:3000], ensure_ascii=False)}
  }},
  "existing_pages": {json.dumps(page_summaries, ensure_ascii=False)}
}}
"""
    raw = await call_gemini(prompt, max_tokens=3000, temperature=0.3)

    try:
        data = extract_json(raw)
        patches = data.get("patches", [])
        for patch in patches:
            slug = patch.get("slug", "")
            content_md = patch.get("content_md", "")
            kind = patch.get("patch_kind", "append")
            if not slug or not content_md:
                continue
            if kind == "append":
                await append_wiki_page(series_id, slug, f"\n{content_md}")
            else:
                await upsert_wiki_page(series_id, slug, content_md)
        return {"ok": True, "mode": "gemini", "patches": len(patches)}
    except Exception as e:
        return {"ok": False, "error": str(e), "raw": raw[:300]}


async def ingest_file(series_id: str, filename: str, file_bytes: bytes) -> dict:
    """파일(.txt/.srt/.vtt/.pdf) → 로컬 저장 + 텍스트 추출 → ingest_source

    저장 경로: C:\\LinkDropV3\\source\\{series_id}\\{filename}
    역할: 트랜드 대체 소스 — 세계관 형성 RAG 컨텍스트로 활용
    """
    ext = Path(filename).suffix.lower()

    # ── 1. 로컬 source 폴더에 원본 파일 저장 ─────────────────────────────────
    series_source_dir = settings.SOURCE_DIR / series_id
    series_source_dir.mkdir(parents=True, exist_ok=True)
    (series_source_dir / filename).write_bytes(file_bytes)

    # ── 2. 텍스트 추출 ────────────────────────────────────────────────────────
    if ext == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
        except Exception as e:
            return {"ok": False, "error": f"PDF 파싱 실패: {e}"}

    elif ext == ".srt":
        raw = file_bytes.decode("utf-8", errors="ignore")
        text = re.sub(r"^\d+\s*\n", "", raw, flags=re.MULTILINE)
        text = re.sub(r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n", "", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

    elif ext == ".vtt":
        raw = file_bytes.decode("utf-8", errors="ignore")
        # WEBVTT 헤더·타임스탬프 제거
        text = re.sub(r"WEBVTT.*?\n\n", "", raw, flags=re.DOTALL)
        text = re.sub(r"\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}[^\n]*\n", "", text)
        text = re.sub(r"<[^>]+>", "", text)          # 태그 제거
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

    else:  # .txt 및 기타
        text = file_bytes.decode("utf-8", errors="ignore")

    if not text.strip():
        return {"ok": False, "error": "텍스트 추출 결과 없음"}

    # ── 3. Python 소스 분석 → world_data.source_summary 저장 ─────────────────
    from services.source_analyzer import analyze as _analyze_source
    analysis = _analyze_source(text, filename)
    if analysis.get("summary"):
        db = get_supabase()
        series_res = await asyncio.to_thread(
            lambda: db.table("v3_series").select("world_data").eq("id", series_id).single().execute()
        )
        current_world: dict = ((series_res.data or {}).get("world_data") or {})
        current_world["source_summary"] = analysis
        await asyncio.to_thread(
            lambda wd=current_world: db.table("v3_series")
            .update({"world_data": wd}).eq("id", series_id).execute()
        )

    # ── 4. RAG 인제스트 (대본 생성 단계에서도 활용) ──────────────────────────
    return await ingest_source(
        series_id,
        source_type="user_file",
        content=text,
        source_ref=f"file:{filename}",
        title=filename,
    )


async def ingest_chapter(series_id: str, chapter: int, content: str) -> dict:
    """챕터 대본 완성 후 자동 wiki 갱신 (character_arcs + timeline + foreshadows)"""
    await ingest_chunk(series_id, "chapter", content, source_ref=f"chapter:{chapter}")

    # timeline append
    snippet = content[:80].replace("\n", " ")
    await append_wiki_page(series_id, "timeline", f"\n- **챕터 {chapter}**: {snippet}...")

    return {"ok": True, "chapter": chapter}


# ── 컨텍스트 빌드 ─────────────────────────────────────────────────────────────

_ROLE_QUERIES = {
    "도입부":    "세계관 배경 주인공 설정 첫 장면 분위기",
    "전개":      "갈등 심화 복선 캐릭터 관계 변화",
    "클라이맥스": "절정 반전 복선 회수 감정 충돌",
    "결말":      "해소 여운 캐릭터 최종 상태 복선 마무리",
}


async def build_rag_context(
    series_id: str,
    chapter_role: str,
    chapter_number: int,
    token_budget: int = 4000,
) -> str:
    """대본 생성용 컨텍스트: wiki 4페이지 + RAG 청크 + writing_guide"""
    db = get_supabase()

    # 1. 핵심 wiki 페이지 로드
    pages_res = await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").select("slug,content_md")
        .eq("series_id", series_id).execute()
    )
    pages = {p["slug"]: p["content_md"] for p in (pages_res.data or [])}

    # 2. RAG 청크 검색
    query = _ROLE_QUERIES.get(chapter_role, chapter_role)
    chunks = await search_chunks(series_id, query, top_k=12)

    # 3. 컨텍스트 조립
    parts = []
    for slug in ["world", "characters", "foreshadows", "timeline"]:
        label = {"world": "세계관", "characters": "등장인물",
                 "foreshadows": "복선 현황", "timeline": "타임라인"}.get(slug, slug)
        if pages.get(slug):
            parts.append(f"## {label}\n{pages[slug]}")

    if chunks:
        chunk_text = "\n---\n".join(c["content"] for c in chunks)
        parts.append(f"## 관련 참고 (RAG)\n{chunk_text}")

    context = "\n\n".join(parts)

    if len(context) > token_budget:
        context = context[:token_budget] + "\n...(이하 생략)"

    return context


# ── Lint ─────────────────────────────────────────────────────────────────────

async def run_lint(series_id: str) -> str:
    """위키 + 대본 건강성 점검 → Gemini lint → 보고서 반환"""
    from services.gemini_helper import call_gemini

    db = get_supabase()

    # wiki 페이지 수집
    pages_res = await asyncio.to_thread(
        lambda: db.table("v3_wiki_pages").select("slug,content_md,updated_at")
        .eq("series_id", series_id).execute()
    )
    pages = pages_res.data or []

    # 최근 챕터 대본 수집 (최대 3개)
    chapters_res = await asyncio.to_thread(
        lambda: db.table("v3_chapters").select("chapter,content,role")
        .eq("series_id", series_id).order("chapter").limit(3).execute()
    )
    chapters = chapters_res.data or []

    lint_prompt_raw = (_PROMPTS_DIR / "wiki_lint.md").read_text(encoding="utf-8")
    # wiki_query.md SYSTEM_INSTRUCTION 추출 → INCLUDE 지시문 실제 교체
    wiki_query_raw = (_PROMPTS_DIR / "wiki_query.md").read_text(encoding="utf-8")
    query_si_m = re.search(r"<!-- SYSTEM_INSTRUCTION -->([\s\S]+?)<!-- /SYSTEM_INSTRUCTION -->", wiki_query_raw)
    wiki_query_si = query_si_m.group(1).strip() if query_si_m else ""
    lint_guide = re.sub(r"<!-- INCLUDE: wiki_query\.md#SYSTEM_INSTRUCTION -->", wiki_query_si, lint_prompt_raw)
    lint_guide = lint_guide.replace("<!-- SYSTEM_INSTRUCTION -->", "").replace("<!-- /SYSTEM_INSTRUCTION -->", "").strip()

    pages_text = "\n\n".join(
        f"### [{p['slug']}]\n{(p['content_md'] or '')[:800]}" for p in pages
    )
    chapters_text = "\n\n".join(
        f"### 챕터 {c['chapter']} ({c['role']})\n{(c['content'] or '')[:600]}" for c in chapters
    )

    prompt = f"""{lint_guide}

=== 위키 페이지 ===
{pages_text}

=== 대본 (최근 3챕터) ===
{chapters_text}

위 내용을 기준으로 lint 보고서를 작성하라.
"""
    report = await call_gemini(prompt, max_tokens=3000, temperature=0.3)

    # lint_report를 wiki 페이지로 저장
    await upsert_wiki_page(series_id, "lint_report", report)

    return report


# ── 챕터 승인 후 자동 갱신 ────────────────────────────────────────────────────

async def auto_update_wiki(series_id: str, chapter: int, chapter_content: str):
    """챕터 승인 후 자동 wiki 갱신 + RAG 인제스트"""
    await ingest_chunk(series_id, "chapter", chapter_content, source_ref=f"chapter:{chapter}")
    new_line = f"\n- **챕터 {chapter}**: {chapter_content[:80].replace(chr(10), ' ')}..."
    await append_wiki_page(series_id, "timeline", new_line)
