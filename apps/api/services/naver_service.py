"""네이버 웹소설 업로드 서비스 — 챕터 텍스트 퍼블리싱"""
import asyncio
from core.database import get_supabase


async def run_naver_upload(series_id: str) -> dict:
    """
    현재 챕터 대본을 네이버 웹소설에 업로드.

    TODO: 네이버 웹소설 API 또는 자동화 연동 구현
    - 현재는 DB에 naver_url 필드 업데이트만 수행 (stub)
    - 실제 구현 시: 네이버 OAuth → 에피소드 등록 API 호출
    """
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("current_chapter,series_code,settings")
        .eq("id", series_id).single().execute()
    )
    chapter = res.data.get("current_chapter", 1) - 1  # 방금 완료한 챕터 (increment 후)
    settings: dict = res.data.get("settings") or {}
    naver_series_id = settings.get("naverSeriesId")

    if not naver_series_id:
        # 네이버 연동 미설정 — 건너뜀 (오류 아님)
        return {"ok": True, "skipped": True, "reason": "naverSeriesId 미설정"}

    # TODO: 실제 네이버 API 호출
    # chapter_res = db.table("v3_chapters").select("content").eq("series_id", series_id).eq("chapter", chapter).single().execute()
    # content = chapter_res.data.get("content", "")
    # naver_episode_url = await _post_naver_episode(naver_series_id, chapter, content)

    # stub: URL 기록
    naver_episode_url = f"https://novel.naver.com/webnovel/detail?novelId={naver_series_id}&volumeNo={chapter}"
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").update({
            "naver_url": naver_episode_url,
        }).eq("series_id", series_id).eq("chapter", chapter).execute()
    )

    return {"ok": True, "chapter": chapter, "naver_url": naver_episode_url}
