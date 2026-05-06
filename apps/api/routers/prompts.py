"""prompts — /api/v1/prompts

GET /api/v1/prompts/categories       카테고리 목록
GET /api/v1/prompts                  전체 or ?cat=cat01 필터
GET /api/v1/prompts/{code}           단일 프롬프트

V2-3 인증:
  Authorization: Bearer <V2_API_SECRET> 헤더가 있으면 is_premium 포함 반환.
  V2_API_SECRET 미설정 or 헤더 없으면 is_premium=false 항목만 반환.
"""
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from core.config import settings
from core.database import get_supabase

router = APIRouter(prefix="/api/v1/prompts", tags=["prompts"])


def _authorized(authorization: Optional[str]) -> bool:
    secret = settings.V2_API_SECRET
    if not secret:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    return authorization[7:].strip() == secret


@router.get("/categories")
def get_categories():
    """카테고리 목록 — id, letter, icon, label"""
    db = get_supabase()
    res = db.table("prompt_categories").select("*").order("sort_order").execute()
    return res.data or []


@router.get("")
def list_prompts(
    cat: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """프롬프트 목록. cat 파라미터로 카테고리 필터. 비인증 시 is_premium=false만 반환."""
    db = get_supabase()
    q = db.table("prompts").select("code,cat,title,description,body,is_premium")

    if cat:
        q = q.eq("cat", cat)

    if not _authorized(authorization):
        q = q.eq("is_premium", False)

    res = q.order("code").execute()
    return res.data or []


@router.get("/{code}")
def get_prompt(
    code: str,
    authorization: Optional[str] = Header(None),
):
    """단일 프롬프트. is_premium=true이면 인증 필요."""
    db = get_supabase()
    res = (
        db.table("prompts")
        .select("code,cat,title,description,body,is_premium")
        .eq("code", code.upper())
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(404, f"프롬프트 {code} 없음")

    prompt = res.data
    if prompt.get("is_premium") and not _authorized(authorization):
        raise HTTPException(403, "premium — Authorization 헤더 필요")

    return prompt
