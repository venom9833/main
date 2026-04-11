"""Wiki 라우터 — V3 콘텐츠 생산 공장 API"""
import asyncio
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from services.wiki_service import (
    list_wiki_pages, read_wiki_page, upsert_wiki_page,
    append_wiki_page, delete_wiki_page,
    init_wiki_from_world,
    ingest_source, ingest_file, ingest_chunk, ingest_chapter,
    search_chunks, build_rag_context, run_lint,
)
from services.architect_service import run_architect
from services.reviser_service import run_reviser

router = APIRouter(prefix="/api/v1/wiki", tags=["wiki"])


# ── 요청 모델 ─────────────────────────────────────────────────────────────────

class InitRequest(BaseModel):
    world_data: dict

class WritePageRequest(BaseModel):
    content_md: str

class AppendPageRequest(BaseModel):
    content_md: str

class IngestRequest(BaseModel):
    source_type: str
    content: str
    source_ref: Optional[str] = None
    title: str = ""

class IngestChapterRequest(BaseModel):
    chapter: int
    content: str

class SearchRequest(BaseModel):
    query: str
    top_k: int = 10

class ContextRequest(BaseModel):
    chapter_role: str   # 도입부 | 전개 | 클라이맥스 | 결말
    chapter_number: int = 1
    token_budget: int = 4000


# ── 초기화 ────────────────────────────────────────────────────────────────────

@router.post("/{series_id}/init")
async def init_wiki(series_id: str, req: InitRequest):
    """세계관 데이터 → wiki 4페이지 초기 생성"""
    result = await init_wiki_from_world(series_id, req.world_data)
    return result


# ── 페이지 CRUD ───────────────────────────────────────────────────────────────

@router.get("/{series_id}/pages")
async def list_pages(series_id: str):
    pages = await list_wiki_pages(series_id)
    return {"series_id": series_id, "pages": pages}


@router.get("/{series_id}/pages/{slug}")
async def get_page(series_id: str, slug: str):
    page = await read_wiki_page(series_id, slug)
    if not page:
        raise HTTPException(404, f"Page not found: {slug}")
    return page


@router.put("/{series_id}/pages/{slug}")
async def update_page(series_id: str, slug: str, req: WritePageRequest):
    """페이지 전체 교체"""
    await upsert_wiki_page(series_id, slug, req.content_md)
    return {"ok": True}


@router.post("/{series_id}/pages/{slug}/append")
async def append_page(series_id: str, slug: str, req: AppendPageRequest):
    """페이지 끝에 내용 추가"""
    await append_wiki_page(series_id, slug, req.content_md)
    return {"ok": True}


@router.delete("/{series_id}/pages/{slug}")
async def delete_page(series_id: str, slug: str):
    await delete_wiki_page(series_id, slug)
    return {"ok": True}


# ── 소스 수집 ─────────────────────────────────────────────────────────────────

@router.post("/{series_id}/sources/ingest")
async def ingest_note(series_id: str, req: IngestRequest):
    """텍스트 소스 수집 → RAG 인제스트 + wiki 패치"""
    result = await ingest_source(
        series_id,
        source_type=req.source_type,
        content=req.content,
        source_ref=req.source_ref,
        title=req.title,
    )
    return result


@router.post("/{series_id}/sources/upload-file")
async def upload_file(series_id: str, file: UploadFile = File(...)):
    """파일 업로드 (.txt / .srt / .pdf) → 텍스트 추출 → ingest"""
    try:
        file_bytes = await file.read()
        result = await ingest_file(series_id, file.filename or "upload", file_bytes)
        return result
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/{series_id}/sources/ingest-chapter")
async def ingest_chapter_endpoint(series_id: str, req: IngestChapterRequest):
    """챕터 대본 완성 후 wiki 자동 갱신"""
    result = await ingest_chapter(series_id, req.chapter, req.content)
    return result


# ── 검색 & 컨텍스트 ───────────────────────────────────────────────────────────

@router.post("/{series_id}/search")
async def search_wiki(series_id: str, req: SearchRequest):
    """RAG 검색 — query → 관련 청크 반환"""
    chunks = await search_chunks(series_id, req.query, req.top_k)
    return {"series_id": series_id, "query": req.query, "chunks": chunks}


@router.post("/{series_id}/context")
async def get_context(series_id: str, req: ContextRequest):
    """챕터 역할별 위키 컨텍스트 미리보기"""
    context = await build_rag_context(
        series_id,
        chapter_role=req.chapter_role,
        chapter_number=req.chapter_number,
        token_budget=req.token_budget,
    )
    return {"series_id": series_id, "chapter_role": req.chapter_role, "context": context}


# ── Lint ─────────────────────────────────────────────────────────────────────

@router.post("/{series_id}/lint")
async def lint_wiki(series_id: str):
    """위키 + 대본 건강성 점검 → Gemini lint 보고서 (33차원)"""
    report = await run_lint(series_id)
    return {"series_id": series_id, "report": report}


# ── Architect ─────────────────────────────────────────────────────────────────

@router.post("/{series_id}/architect")
async def architect_series(series_id: str):
    """세계관 → 6챕터 전체 설계도 생성 (파이프라인 CASTING→ARCHITECT→SCRIPT 자동 실행).
    수동 재실행도 가능 (설계도 갱신 목적).
    출력: wiki 'series_plan' 페이지 + world_data.storyArc 갱신.
    """
    result = await run_architect(series_id)
    return result


# ── Reviser ───────────────────────────────────────────────────────────────────

@router.post("/{series_id}/revise")
async def revise_chapters(series_id: str):
    """lint_report 기반 '수정 필요' 챕터 자동 재작성.
    /lint 실행 후 호출. 수정된 챕터는 approved=False로 초기화되어 재검토 필요.
    """
    result = await run_reviser(series_id)
    return result
