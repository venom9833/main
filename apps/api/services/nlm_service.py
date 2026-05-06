"""NotebookLM 기반 PDF 생성 서비스 — Direction B
고정 작업 노트북(linkdrop(pdf)) 재사용 구조:
  매 호출마다 소스만 교체 — 노트북 생성/삭제 없음
"""
import asyncio

import notebooklm_tools.services.notebooks as nb_svc
import notebooklm_tools.services.sources as src_svc
import notebooklm_tools.services.chat as chat_svc
from notebooklm_tools.core.auth import load_cached_tokens
from notebooklm_tools.core.client import NotebookLMClient

from services.gemini_helper import call_free_llm, call_gemini
from services.pdf_service import _build_system_prompt, _get_principles

# 고정 작업 노트북 — linkdrop(pdf) / venom9833@gmail.com
_WORK_NOTEBOOK_ID = "b14d404b-dfbb-467c-b14e-493460a9e18c"


def _make_client() -> NotebookLMClient:
    tokens = load_cached_tokens()
    if tokens is None:
        raise RuntimeError("NLM 인증 토큰 없음 — 터미널에서 `nlm login` 실행 후 재시도")
    return NotebookLMClient(
        cookies=tokens.cookies,
        csrf_token=tokens.csrf_token,
        session_id=tokens.session_id,
        build_label=tokens.build_label or "",
    )


def _clear_sources(client: NotebookLMClient, notebook_id: str) -> int:
    """노트북의 기존 소스를 모두 제거하고 삭제된 개수를 반환."""
    try:
        detail = nb_svc.get_notebook(client, notebook_id)
        existing = detail.get("sources", [])
        if not existing:
            return 0
        ids = [s["id"] for s in existing]
        src_svc.delete_sources(client, ids)
        return len(ids)
    except Exception:
        return 0


async def generate_with_nlm(
    sources: list[dict],   # [{"filename": str, "text": str}, ...]
    title: str,
    doc_type: str = "문서형",
    chapter_count: int = 0,
    use_paid_ai: bool = False,
) -> str:
    """소스 → NLM 종합 분석 → LLM 문서 생성 (Direction B)

    고정 작업 노트북(_WORK_NOTEBOOK_TITLE)을 재사용.
    매 호출마다 기존 소스를 제거하고 새 소스로 교체한다.
    """
    client = _make_client()
    notebook_id = _WORK_NOTEBOOK_ID

    # 1. 기존 소스 전체 제거
    _clear_sources(client, notebook_id)

    # 2. 새 소스 주입 (최대 50,000자/개)
    for s in sources:
        src_svc.add_source(
            client, notebook_id,
            source_type="text",
            text=s["text"][:50000],
            title=s["filename"],
        )

    # 3. 글쓰기 원칙 소스 추가
    principles = _get_principles()
    if principles:
        src_svc.add_source(
            client, notebook_id,
            source_type="text",
            text=principles,
            title="글쓰기_원칙",
        )

    # 4. NLM 소스 처리 대기
    await asyncio.sleep(10)

    # 5. NLM에 종합 분석 쿼리
    chapter_guide = (
        f"총 {chapter_count}개 챕터로 구성"
        if chapter_count > 0
        else "내용 분량에 맞게 챕터 수 자율 결정"
    )
    synthesis_query = (
        f"'{title}' 문서 작성을 위해 소스 내용을 종합 정리해주세요. "
        f"1) 소스의 핵심 주장, 사실, 수치, 사례를 빠짐없이 추출. "
        f"2) 글쓰기 원칙의 핵심 규칙 목록 정리. "
        f"3) 문서 구성 제안: {chapter_guide}. "
        f"창작 없이 소스 내용만 기반으로 정리하세요."
    )
    query_result: chat_svc.QueryResult = chat_svc.query(
        client, notebook_id, synthesis_query, timeout=90
    )
    nlm_synthesis = query_result.get("answer", "")

    # 6. 원본 소스 병합 (LLM 최종 생성용)
    if len(sources) == 1:
        combined = sources[0]["text"]
    else:
        combined = "\n\n".join(
            f"[소스 {i + 1}: {s['filename']}]\n{s['text']}"
            for i, s in enumerate(sources)
        )

    # 7. LLM으로 최종 문서 생성
    system_prompt = _build_system_prompt(doc_type)
    chapter_line = (
        f"총 {chapter_count}개 챕터로 구성한다."
        if chapter_count > 0
        else "내용 분량에 맞게 챕터 수를 결정한다."
    )
    user_prompt = f"""아래 소스 문서와 NotebookLM 종합 분석을 바탕으로 '{title}' 문서를 작성해 주세요.

[엄격한 제약]
- 소스에 있는 내용만 사용한다. 소스에 없는 내용을 추가하거나 창작하지 않는다.
- 소스의 사실·수치·주장을 변형하지 않는다.
- 소스를 글쓰기 원칙에 따라 재구성하고 명확하게 정리하는 것이 목표이다.
- {chapter_line}

=== NotebookLM 종합 분석 ===
{nlm_synthesis[:6000]}
===========================

=== 원본 소스 ===
{combined[:8000]}
================"""

    if use_paid_ai:
        # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 (AI도움 옵션 ON)
        return await call_gemini(
            prompt=user_prompt,
            system_instruction=system_prompt,
            temperature=0.4,
            max_tokens=8192,
        )
    else:
        # 🟢 CEREBRAS-FREE: LD-011 기본값
        return await call_free_llm(
            prompt=user_prompt,
            system_instruction=system_prompt,
            temperature=0.4,
            max_tokens=6000,
        )
