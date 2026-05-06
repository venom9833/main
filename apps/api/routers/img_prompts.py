"""
이미지 프롬프트 API 라우터 (img_prompts.py)

엔드포인트:
  GET  /api/v1/img-prompts/categories           -- 카테고리 목록
  GET  /api/v1/img-prompts                      -- 프롬프트 목록 (필터/페이징)
  GET  /api/v1/img-prompts/{master_no}          -- 상세 (content + args + image_url)
  GET  /api/v1/img-prompts/{master_no}/download -- 원본 이미지 프록시 다운로드

아키텍처 결정:
  - 목록 API는 content/args 미포함 (경량 메타만 반환)
  - 상세 API는 모달 열 때 호출 (on-demand, D:\img_prompt\detail\IP*.json 읽기)
  - 다운로드 API는 prompts3.com 원본 이미지를 프록시로 브라우저에 전달
  - 검색 기능 없음 (index에 content 없으므로 full-text 검색 불가)

설계 문서: archives/69_이미지_프롬프트_기능.md
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from services.img_prompt_cache import get_categories, filter_prompts, reload_index

router = APIRouter(prefix="/api/v1/img-prompts", tags=["img-prompts"])

# detail JSON 저장 폴더 (--category 실행 시 생성됨)
_DETAIL_DIR = Path(r"D:\img_prompt\detail")


# ── 캐시 리로드 ─────────────────────────────────────────────────────────────

@router.post("/reload")
def reload_img_prompts():
    """index_img.json 파일 변경 후 캐시를 강제 재로드한다."""
    data = reload_index()
    return {"ok": True, "totalCount": data.get("totalCount", 0)}


# ── 카테고리 목록 ────────────────────────────────────────────────────────────

@router.get("/categories")
def get_img_categories():
    """
    이미지 프롬프트 카테고리 목록 반환.
    각 카테고리의 프롬프트 개수를 함께 반환.

    반환 형태:
    [{"id": "poster-flyer", "label": "포스터/전단", "emoji": "...", "count": 42}, ...]
    """
    return get_categories()


# ── 프롬프트 목록 ────────────────────────────────────────────────────────────

@router.get("")
def list_img_prompts(
    cat: str | None = Query(default=None, description="카테고리 ID 필터"),
    featured: bool = Query(default=False, description="featured 항목만 필터"),
    page: int = Query(default=1, ge=1, description="페이지 번호 (1-indexed)"),
    page_size: int = Query(default=20, ge=1, le=1000, description="페이지당 항목 수 (최대 1000 — 하트 정렬 시 전체 로드용)"),
):
    """
    이미지 프롬프트 목록 반환 (메모리 필터 + 페이지네이션).
    content/args 미포함 — 상세는 /{master_no} 에서 별도 요청.

    반환 형태:
    {
        "total": 849,
        "page": 1,
        "page_size": 60,
        "items": [
            {
                "id": "ours-001",
                "master_no": "IP0001",
                "title": "...",
                "description": "...",
                "thumb_url": "http://localhost:8001/img-prompts-static/thumbs/IP0001.jpg",
                "categories": ["poster-flyer"],
                "featured": false
            }
        ]
    }
    """
    return filter_prompts(
        cat=cat,
        featured=featured,
        page=page,
        page_size=page_size,
    )


# ── 상세 (content + args + image_url) ───────────────────────────────────────

@router.get("/{master_no}")
def get_img_detail(master_no: str):
    """
    모달 열 때 호출. detail/IP*.json 에서 content + args + image_url 반환.

    detail 파일이 없으면 404 반환.
    detail 파일은 img_prompt_collector.py --category 실행 시 생성됨.

    반환 형태:
    {
        "master_no": "IP0001",
        "content": "...",
        "args": [{"name": "변수명", "default": "기본값"}],
        "image_url": "https://prompts3.com/..."
    }
    """
    detail_path = _DETAIL_DIR / f"{master_no}.json"
    if not detail_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"detail 파일 없음: {master_no} (--category 실행 필요)"
        )
    data = json.loads(detail_path.read_text(encoding="utf-8"))
    return {
        "master_no": master_no,
        "content": data.get("content", ""),
        "args": data.get("args", []),
        "image_url": data.get("image_url", ""),
        "notice": data.get("notice", ""),
    }


# ── 원본 이미지 프록시 다운로드 ──────────────────────────────────────────────

@router.get("/{master_no}/download")
async def download_original_image(master_no: str):
    """
    원본 이미지를 prompts3.com 에서 fetch 하여 브라우저에 attachment 스트리밍.

    CORS 우회 및 Referer 헤더 필요 이슈를 서버 프록시로 해결.
    detail 파일의 image_url 을 사용하여 원본 이미지 다운로드.
    """
    detail_path = _DETAIL_DIR / f"{master_no}.json"
    if not detail_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"detail 파일 없음: {master_no}"
        )

    data = json.loads(detail_path.read_text(encoding="utf-8"))
    image_url = data.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=404, detail="원본 이미지 URL 없음")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                image_url,
                headers={
                    "Referer": "https://prompts3.com/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
                follow_redirects=True,
            )
            resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"원본 이미지 fetch 실패: {e}")

    content_type = resp.headers.get("content-type", "image/jpeg")
    ext = "jpg" if ("jpeg" in content_type or "jpg" in content_type) else "png"

    return Response(
        content=resp.content,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{master_no}.{ext}"',
        },
    )
