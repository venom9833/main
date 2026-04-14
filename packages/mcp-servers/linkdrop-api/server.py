"""LinkDrop V3 MCP 서버 — FastMCP 3.x
V3 FastAPI(기본 http://localhost:8001)를 MCP 도구로 노출한다.

환경변수:
  V3_API_URL  — V3 API 베이스 URL (기본값: http://localhost:8001)
"""
import os
import sys
import httpx
from fastmcp import FastMCP

API_URL = os.environ.get("V3_API_URL", "http://localhost:8001").rstrip("/")

mcp = FastMCP(
    name="linkdrop-api",
    instructions=(
        "LinkDrop V3 콘텐츠 생산 API. "
        "시리즈 생성·파이프라인 제어·챕터 관리·위키 조회를 도구로 제공한다. "
        "시리즈 ID는 UUID 문자열이다."
    ),
)

# ─────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────

async def _get(path: str, params: dict | None = None) -> dict | list:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API_URL}{path}", params=params)
        r.raise_for_status()
        return r.json()


async def _post(path: str, body: dict | None = None) -> dict | list:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{API_URL}{path}", json=body or {})
        r.raise_for_status()
        return r.json()


async def _patch(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.patch(f"{API_URL}{path}", json=body)
        r.raise_for_status()
        return r.json()


async def _delete(path: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(f"{API_URL}{path}")
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────────────────────
# Series 도구
# ─────────────────────────────────────────────────────────────

@mcp.tool()
async def create_series(topic: str, settings: dict | None = None) -> dict:
    """새 시리즈를 생성하고 파이프라인 첫 단계(소스 업로드 대기)로 진입한다."""
    body: dict = {"topic": topic}
    if settings:
        body["settings"] = settings
    return await _post("/api/v1/series", body)


@mcp.tool()
async def list_series(status: str | None = None) -> list:
    """시리즈 목록을 최신순으로 반환한다.
    status 필터: draft | processing | done | failed
    """
    params = {"status": status} if status else None
    return await _get("/api/v1/series", params)


@mcp.tool()
async def get_series(series_id: str) -> dict:
    """시리즈 전체 데이터(world_data 포함)를 반환한다."""
    return await _get(f"/api/v1/series/{series_id}")


@mcp.tool()
async def get_series_status(series_id: str) -> dict:
    """시리즈의 현재 pipeline_step / status / error_detail만 빠르게 조회한다."""
    return await _get(f"/api/v1/series/{series_id}/status")


@mcp.tool()
async def run_series(series_id: str) -> dict:
    """현재 pipeline_step에서 파이프라인을 즉시 재실행한다."""
    return await _post(f"/api/v1/series/{series_id}/run")


@mcp.tool()
async def approve_step(series_id: str, step_name: str, user_secrets: dict | None = None) -> dict:
    """파이프라인 단계를 승인하고 다음 단계로 전진시킨다.
    step_name 허용값: source_upload | world | casting | script | keyframe_setup | upload
    user_secrets: 캐스팅 확정 시 {char_id: "비밀 내용"} (선택)
    """
    body: dict = {}
    if user_secrets:
        body["userSecrets"] = user_secrets
    return await _post(f"/api/v1/series/{series_id}/approve/{step_name}", body)


@mcp.tool()
async def next_chapter(series_id: str) -> dict:
    """CHAPTER_DONE 상태에서 다음 챕터 파이프라인을 시작한다."""
    return await _post(f"/api/v1/series/{series_id}/next-chapter")


@mcp.tool()
async def terminate_series(series_id: str) -> dict:
    """CHAPTER_DONE 상태에서 시리즈를 종결(DONE)시킨다."""
    return await _post(f"/api/v1/series/{series_id}/terminate")


@mcp.tool()
async def retry_step(series_id: str, step_name: str) -> dict:
    """특정 단계부터 파이프라인을 재시도한다.
    step_name: world | casting | architect | script | keyframe | tts | render
    """
    return await _post(f"/api/v1/series/{series_id}/retry/{step_name}")


@mcp.tool()
async def delete_series(series_id: str) -> dict:
    """시리즈와 연관 데이터(챕터·씬·파이프라인 로그)를 전부 삭제한다."""
    return await _delete(f"/api/v1/series/{series_id}")


@mcp.tool()
async def get_pipeline_logs(series_id: str) -> list:
    """최근 50건의 파이프라인 실행 로그를 반환한다."""
    return await _get(f"/api/v1/series/{series_id}/logs")


# ─────────────────────────────────────────────────────────────
# Chapter 도구
# ─────────────────────────────────────────────────────────────

@mcp.tool()
async def list_chapters(series_id: str) -> list:
    """시리즈의 모든 챕터 목록을 반환한다."""
    return await _get(f"/api/v1/series/{series_id}/chapters")


@mcp.tool()
async def get_chapter(series_id: str, chapter: int) -> dict:
    """특정 챕터의 대본 및 메타데이터를 반환한다."""
    return await _get(f"/api/v1/series/{series_id}/chapters/{chapter}")


@mcp.tool()
async def approve_chapter(series_id: str, chapter: int) -> dict:
    """챕터 대본을 승인하고 wiki를 자동 갱신한다."""
    return await _post(f"/api/v1/series/{series_id}/chapters/{chapter}/approve")


@mcp.tool()
async def regenerate_chapter(series_id: str, chapter: int) -> dict:
    """챕터 대본 1개만 재생성한다."""
    return await _post(f"/api/v1/series/{series_id}/chapters/{chapter}/regenerate")


@mcp.tool()
async def get_scenes(series_id: str, chapter: int) -> list:
    """챕터의 씬/컷 구조를 반환한다."""
    return await _get(f"/api/v1/series/{series_id}/chapters/{chapter}/scenes")


@mcp.tool()
async def harvest_sentences(series_id: str, chapter: int) -> dict:
    """챕터 대본에서 글쓰기 원칙을 구현한 명문 후보 3개를 추출한다."""
    return await _post(f"/api/v1/series/{series_id}/chapters/{chapter}/harvest")


# ─────────────────────────────────────────────────────────────
# Wiki 도구
# ─────────────────────────────────────────────────────────────

@mcp.tool()
async def list_wiki_pages(series_id: str) -> dict:
    """시리즈 위키 페이지 목록을 반환한다."""
    return await _get(f"/api/v1/wiki/{series_id}/pages")


@mcp.tool()
async def get_wiki_page(series_id: str, slug: str) -> dict:
    """위키 페이지 내용을 반환한다.
    slug 예시: characters | world | series_plan | timeline
    """
    return await _get(f"/api/v1/wiki/{series_id}/pages/{slug}")


@mcp.tool()
async def search_wiki(series_id: str, query: str, top_k: int = 10) -> dict:
    """RAG 검색으로 위키에서 관련 청크를 반환한다."""
    return await _post(f"/api/v1/wiki/{series_id}/search", {"query": query, "top_k": top_k})


@mcp.tool()
async def ingest_source(
    series_id: str,
    source_type: str,
    content: str,
    title: str = "",
    source_ref: str | None = None,
) -> dict:
    """텍스트 소스를 위키 RAG에 수집한다.
    source_type: youtube_transcript | news | manual | chapter
    """
    body: dict = {"source_type": source_type, "content": content, "title": title}
    if source_ref:
        body["source_ref"] = source_ref
    return await _post(f"/api/v1/wiki/{series_id}/sources/ingest", body)


@mcp.tool()
async def lint_wiki(series_id: str) -> dict:
    """위키 + 대본 건강성 33차원 점검 보고서를 생성한다."""
    return await _post(f"/api/v1/wiki/{series_id}/lint")


@mcp.tool()
async def architect_series(series_id: str) -> dict:
    """세계관을 바탕으로 6챕터 전체 설계도를 생성한다."""
    return await _post(f"/api/v1/wiki/{series_id}/architect")


@mcp.tool()
async def revise_chapters(series_id: str) -> dict:
    """lint 보고서 기반으로 수정 필요 챕터를 자동 재작성한다."""
    return await _post(f"/api/v1/wiki/{series_id}/revise")


# ─────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
