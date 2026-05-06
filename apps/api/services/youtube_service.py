"""YouTube 서비스 — OAuth2 + Resumable Upload + 메타데이터"""
import asyncio
import json
import os
import tempfile
from pathlib import Path
import httpx
from core.config import settings
from core.database import get_supabase


async def run_upload(series_id: str) -> dict:
    """최종 MP4 → YouTube 업로드"""
    db = get_supabase()

    # 시리즈 정보
    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("title,world_data,settings")
        .eq("id", series_id)
        .single()
        .execute()
    )
    series_data = res.data
    title: str = series_data.get("title", "")
    world: dict = series_data.get("world_data") or {}
    cfg: dict = series_data.get("settings") or {}

    final_url: str = cfg.get("finalMp4Url", "")
    if not final_url:
        raise RuntimeError("최종 MP4 URL 없음 — 렌더 완료 후 업로드 가능")

    token: str = cfg.get("youtubeToken", "")
    if not token:
        raise RuntimeError("YouTube 인증 토큰 없음 — /api/v1/youtube/auth 로 인증 필요")

    # 메타데이터 생성
    description = _build_description(world)
    tags = _build_tags(world)

    # MP4 다운로드
    with tempfile.TemporaryDirectory() as tmpdir:
        mp4_path = Path(tmpdir) / "final.mp4"
        await _download_file(final_url, mp4_path)

        # YouTube Resumable Upload
        video_id = await asyncio.to_thread(
            _resumable_upload,
            str(mp4_path),
            token,
            title,
            description,
            tags,
        )

    youtube_url = f"https://youtu.be/{video_id}"

    # v3_youtube_uploads 저장
    await asyncio.to_thread(
        lambda: db.table("v3_youtube_uploads").insert({
            "series_id": series_id,
            "video_id": video_id,
            "title": title,
            "status": "published",
            "upload_url": final_url,
            "youtube_url": youtube_url,
            "metadata": {"description": description, "tags": tags},
        }).execute()
    )

    # series 상태 업데이트
    await asyncio.to_thread(
        lambda: db.table("v3_series").update({
            "status": "published",
            "settings": {**cfg, "youtubeUrl": youtube_url, "videoId": video_id},
        }).eq("id", series_id).execute()
    )

    return {"ok": True, "video_id": video_id, "youtube_url": youtube_url}


async def run_youtube_manage(series_id: str) -> dict:
    """업로드 후 메타데이터 관리 — 썸네일 설정"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("settings")
        .eq("id", series_id)
        .single()
        .execute()
    )
    cfg: dict = (res.data or {}).get("settings") or {}
    video_id = cfg.get("videoId", "")
    token = cfg.get("youtubeToken", "")

    if not video_id or not token:
        return {"ok": True, "note": "video_id 또는 token 없음 — 메타데이터 관리 건너뜀"}

    # 훅 씬 키프레임을 썸네일로 설정
    hook_res = await asyncio.to_thread(
        lambda: db.table("v3_scenes")
        .select("keyframe_url")
        .eq("series_id", series_id)
        .eq("is_hook", True)
        .limit(1)
        .execute()
    )
    hook_scenes = hook_res.data or []
    if hook_scenes:
        thumb_url = hook_scenes[0].get("keyframe_url", "")
        if thumb_url:
            await asyncio.to_thread(_set_thumbnail, video_id, token, thumb_url)

    return {"ok": True, "video_id": video_id}


def _build_description(world: dict) -> str:
    title = world.get("title", "")
    topic = world.get("topic", "")
    genre = world.get("genre", "")
    char_a = world.get("charAName", "")
    char_b = world.get("charBName", "")
    return (
        f"{title}\n\n"
        f"{topic}\n\n"
        f"장르: {genre}\n"
        f"등장인물: {char_a}, {char_b}\n\n"
        f"#한국드라마 #웹소설 #시리즈 #{genre.replace(' ', '')}"
    )


def _build_tags(world: dict) -> list[str]:
    tags = ["한국드라마", "웹소설", "시리즈", "드라마"]
    genre = world.get("genre", "")
    if genre:
        tags.append(genre)
    for ct in world.get("conflictTypes") or []:
        tags.append(ct[:20])
    keyword = world.get("trendKeyword", "")
    if keyword:
        tags.append(keyword[:20])
    return tags[:15]


def _resumable_upload(
    mp4_path: str,
    access_token: str,
    title: str,
    description: str,
    tags: list[str],
) -> str:
    """YouTube Data API v3 Resumable Upload → video_id 반환"""
    import urllib.request
    file_size = os.path.getsize(mp4_path)

    # 1단계: 업로드 세션 URI 획득
    metadata = json.dumps({
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": "22",  # People & Blogs
        },
        "status": {"privacyStatus": "public"},
    }).encode("utf-8")

    init_req = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=metadata,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(file_size),
        },
        method="POST",
    )
    with urllib.request.urlopen(init_req) as resp:
        upload_uri = resp.headers["Location"]

    # 2단계: 파일 업로드
    with open(mp4_path, "rb") as f:
        upload_req = urllib.request.Request(
            upload_uri,
            data=f.read(),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "video/mp4",
                "Content-Length": str(file_size),
            },
            method="PUT",
        )
        with urllib.request.urlopen(upload_req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["id"]


def _set_thumbnail(video_id: str, access_token: str, thumb_url: str):
    """R2 키프레임 이미지 → YouTube 썸네일 설정"""
    import urllib.request
    # 썸네일 이미지 다운로드
    with urllib.request.urlopen(thumb_url) as r:
        img_data = r.read()

    req = urllib.request.Request(
        f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}",
        data=img_data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "image/png",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req)
    except Exception:
        pass  # 썸네일 실패는 무시 (업로드 자체는 성공)


async def upload_captions(
    series_id: str,
    chapter: int,
    langs: list[str],
    mp4_path: str = "",
) -> dict:
    """챕터 SRT 병합 → KR 번인 / EN·JP YouTube caption track 업로드.

    KR("ko"): SRT를 영상 픽셀에 burn-in → {mp4_path 기반}_kr_sub.mp4 생성.
              YouTube에 별도 caption track 업로드 안 함.
    EN/JP:    SRT 번역 후 YouTube captions.insert (소프트 자막 트랙).

    mp4_path: KR 번인 대상 MP4 경로. 미입력 시 로컬 output 폴더에서 자동 탐색.
    video_id / youtubeToken: v3_series.settings에서 로드.
    """
    from services.srt_service import merge_chapter_srt, translate_srt, burn_subtitles

    db = get_supabase()
    ser = await asyncio.to_thread(
        lambda: db.table("v3_series").select("series_code,settings").eq("id", series_id).single().execute()
    )
    data = ser.data or {}
    cfg: dict = data.get("settings") or {}
    series_code: str = data.get("series_code") or series_id
    video_id = cfg.get("videoId", "")
    token = cfg.get("youtubeToken", "")

    kr_srt = await merge_chapter_srt(series_id, chapter)
    if not kr_srt:
        raise RuntimeError(f"ch{chapter:02d} SRT 없음 — TTS 완료 후 실행 가능")

    results = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        for lang in langs:
            if lang == "ko":
                # KR: SRT 생성 후 영상에 burn-in (YouTube caption track 업로드 안 함)
                srt_path = tmp / f"ch{chapter:02d}_ko.srt"
                srt_path.write_text(kr_srt, encoding="utf-8")

                # 대상 MP4 경로 결정
                src_mp4 = Path(mp4_path) if mp4_path else (
                    Path(__file__).parent.parent.parent.parent
                    / "output" / series_code / f"ch{chapter:02d}" / f"ch{chapter:02d}_final.mp4"
                )
                if not src_mp4.exists():
                    results["ko"] = {"ok": False, "error": f"MP4 없음: {src_mp4}"}
                    continue

                out_mp4 = src_mp4.parent / f"ch{chapter:02d}_final_kr.mp4"
                try:
                    await asyncio.to_thread(burn_subtitles, src_mp4, srt_path, out_mp4)
                    results["ko"] = {"ok": True, "output": str(out_mp4)}
                except Exception as exc:
                    results["ko"] = {"ok": False, "error": str(exc)}

            else:
                # EN/JP: 번역 후 YouTube captions.insert
                if not video_id or not token:
                    results[lang] = {"ok": False, "error": "video_id 또는 youtubeToken 없음"}
                    continue

                content = await translate_srt(kr_srt, lang)
                srt_path = tmp / f"ch{chapter:02d}_{lang}.srt"
                srt_path.write_text(content, encoding="utf-8")

                lang_label = {"en": "English", "ja": "日本語"}.get(lang, lang)
                try:
                    caption_id = await asyncio.to_thread(
                        _insert_caption, video_id, token, str(srt_path), lang, lang_label
                    )
                    results[lang] = {"ok": True, "caption_id": caption_id}
                except Exception as exc:
                    results[lang] = {"ok": False, "error": str(exc)}

    return {"ok": True, "chapter": chapter, "results": results}


def _insert_caption(
    video_id: str,
    access_token: str,
    srt_path: str,
    lang: str,
    name: str,
) -> str:
    """YouTube Data API v3 captions.insert — multipart 업로드"""
    import urllib.request

    with open(srt_path, "rb") as f:
        srt_data = f.read()

    metadata = json.dumps({
        "snippet": {
            "videoId": video_id,
            "language": lang,
            "name": name,
            "isDraft": False,
        }
    }).encode("utf-8")

    boundary = b"---ld-caption-boundary"
    body = (
        b"--" + boundary + b"\r\n"
        b"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        + metadata + b"\r\n"
        b"--" + boundary + b"\r\n"
        b"Content-Type: text/plain; charset=UTF-8\r\n\r\n"
        + srt_data + b"\r\n"
        b"--" + boundary + b"--"
    )

    req = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/captions"
        "?uploadType=multipart&part=snippet",
        data=body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f"multipart/related; boundary={boundary.decode()}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["id"]


async def _download_file(url: str, dest: Path):
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
