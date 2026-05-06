# ============================================================
# WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
# 이 파일은 V3(LinkDropV3)에서만 수정합니다.
# V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
# 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
# ============================================================
"""
공개 콘텐츠 API (public_content.py)

V2 파트너 이상 회원 대상 — 웹소설 + 영상 URL 제공
인증: Authorization: Bearer <V2_API_SECRET>

GET /api/v1/public/series                        — 시리즈 목록
GET /api/v1/public/series/{series_id}            — 시리즈 상세
GET /api/v1/public/series/{series_id}/chapters   — 챕터 목록 (본문 제외, 영상 URL 포함)
GET /api/v1/public/series/{series_id}/chapters/{chapter} — 챕터 상세 (본문 + 영상 URL)
"""
import asyncio
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from core.config import settings
from core.database import get_supabase

router = APIRouter(prefix="/api/v1/public", tags=["public-content"])


def _authorized(authorization: Optional[str]) -> bool:
    secret = settings.V2_API_SECRET
    if not secret:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    return authorization[7:].strip() == secret


def _require_auth(authorization: Optional[str]) -> None:
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="인증 필요 — V2_API_SECRET 확인")


@router.get("/series")
async def list_series(authorization: Optional[str] = Header(None)):
    """시리즈 목록 — id, series_code, settings(제목 등), status, created_at"""
    _require_auth(authorization)
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("id, series_code, title, topic, settings, status, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


@router.get("/series/{series_id}")
async def get_series(series_id: str, authorization: Optional[str] = Header(None)):
    """시리즈 상세 — world_data(등장인물·배경) 포함"""
    _require_auth(authorization)
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("id, series_code, title, topic, settings, world_data, status, created_at")
        .eq("id", series_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="시리즈 없음")
    return res.data


@router.get("/series/{series_id}/chapters")
async def list_chapters(series_id: str, authorization: Optional[str] = Header(None)):
    """챕터 목록 — 본문 제외, 영상 URL(lipsync_url) 포함"""
    _require_auth(authorization)
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("id, series_id, chapter, approved, lipsync_url, created_at")
        .eq("series_id", series_id)
        .order("chapter")
        .execute()
    )
    return res.data or []


@router.get("/series/{series_id}/chapters/{chapter}")
async def get_chapter(
    series_id: str,
    chapter: int,
    authorization: Optional[str] = Header(None),
):
    """챕터 상세 — 웹소설 본문(content) + 영상 URL(lipsync_url)"""
    _require_auth(authorization)
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("id, series_id, chapter, content, approved, lipsync_url, created_at")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail=f"챕터 {chapter} 없음")
    return res.data
