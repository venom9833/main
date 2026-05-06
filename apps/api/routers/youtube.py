"""YouTube 라우터 — 인증 + 업로드 + 상태 조회"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
from core.database import get_supabase

router = APIRouter(prefix="/api/v1/youtube", tags=["youtube"])


class MetadataRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    privacy: Optional[str] = "public"


class CaptionRequest(BaseModel):
    chapter: int
    langs: list[str] = ["ko", "en", "ja"]
    mp4_path: Optional[str] = None  # KR burn-in 대상 MP4. 미입력 시 로컬 output 폴더 자동 탐색


@router.get("/auth")
def youtube_auth():
    """Google OAuth2 인증 시작 — 사용자를 Google 동의 화면으로 리다이렉트"""
    from core.config import settings
    scope = (
        "https://www.googleapis.com/auth/youtube.upload"
        " https://www.googleapis.com/auth/youtube.force-ssl"
    )
    redirect = "http://localhost:8100/api/v1/youtube/callback"
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.YOUTUBE_CLIENT_ID}"
        f"&redirect_uri={redirect}"
        f"&response_type=code"
        f"&scope={scope}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return RedirectResponse(url)


@router.get("/callback")
async def youtube_callback(code: str, state: Optional[str] = None):
    """OAuth2 콜백 — authorization code → access_token 교환"""
    from core.config import settings
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.YOUTUBE_CLIENT_ID,
                "client_secret": settings.YOUTUBE_CLIENT_SECRET,
                "redirect_uri": "http://localhost:8100/api/v1/youtube/callback",
                "grant_type": "authorization_code",
            },
        )
        token_data = resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    return {"ok": True, "access_token": access_token, "refresh_token": refresh_token, "note": "이 토큰을 시리즈 settings.youtubeToken에 저장하세요"}


@router.post("/{series_id}/upload")
async def upload_video(series_id: str, background_tasks: BackgroundTasks):
    from services.youtube_service import run_upload
    background_tasks.add_task(run_upload, series_id)
    return {"ok": True, "status": "uploading"}


@router.get("/{series_id}/status")
async def get_upload_status(series_id: str):
    db = get_supabase()
    res = await asyncio.to_thread(
        lambda: db.table("v3_youtube_uploads")
        .select("*")
        .eq("series_id", series_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    uploads = res.data or []
    return uploads[0] if uploads else {"status": "not_uploaded"}


@router.post("/{series_id}/captions")
async def upload_captions(series_id: str, req: CaptionRequest, background_tasks: BackgroundTasks):
    """챕터 SRT 병합 → 번역 → YouTube 자막 업로드.

    chapter: 챕터 번호 (예: 1)
    langs: ["ko", "en", "ja"] — 원하는 언어만 선택 가능
    """
    from services.youtube_service import upload_captions as _upload
    background_tasks.add_task(_upload, series_id, req.chapter, req.langs, req.mp4_path or "")
    return {"ok": True, "status": "uploading_captions", "langs": req.langs}


@router.patch("/{series_id}/metadata")
async def update_metadata(series_id: str, req: MetadataRequest):
    """업로드된 영상 메타데이터 수정"""
    db = get_supabase()
    upload_res = await asyncio.to_thread(
        lambda: db.table("v3_youtube_uploads")
        .select("video_id,metadata")
        .eq("series_id", series_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    uploads = upload_res.data or []
    if not uploads:
        raise HTTPException(404, "업로드 기록 없음")

    meta = uploads[0].get("metadata") or {}
    patch = req.model_dump(exclude_none=True)
    meta.update(patch)

    await asyncio.to_thread(
        lambda: db.table("v3_youtube_uploads")
        .update({"metadata": meta})
        .eq("series_id", series_id)
        .execute()
    )
    return {"ok": True}
