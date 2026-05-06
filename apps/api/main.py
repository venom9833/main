"""LinkDropV3 API — 포트 8001"""
import json
import os
import pathlib
import tempfile
import time
import uvicorn
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Any
from core.config import settings
from core.database import get_supabase
from routers import pipeline, wiki
from routers.chapters import router as chapters_router
from routers.youtube import router as youtube_router
from routers.chat import router as chat_router
from routers.parallax_test import router as parallax_test_router  # 임시 패럴랙스 테스트
from routers.admin import router as admin_router
from routers.html_templates import router as html_templates_router
from routers.html_docs import router as html_docs_router
from routers.template_hearts import router as template_hearts_router
from routers.transcribe import router as transcribe_router
from routers.pdf_docs import router as pdf_docs_router
from routers.prompts import router as prompts_router
from routers.img_prompts import router as img_prompts_router
from routers.prompt_ratings import router as prompt_ratings_router
from routers.public_content import router as public_content_router

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    integrations=[StarletteIntegration(), FastApiIntegration()],
    traces_sample_rate=0.1,
    environment="production",
)

app = FastAPI(title="LinkDrop V3", version="0.1.0")


# ── Windows ProactorEventLoop ConnectionResetError 억제 ──────────────────────
# Windows 환경에서 브라우저가 응답 수신 중 연결을 끊으면
# "ConnectionResetError: [WinError 10054]" 가 asyncio 콜백 예외로 출력된다.
# 기능에는 영향 없는 노이즈이므로 이벤트 루프 예외 핸들러로 조용히 무시한다.
def _suppress_connection_reset(loop, context):
    exc = context.get("exception")
    if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
        return  # 무시 — 클라이언트 측 연결 해제로 인한 정상 현상
    loop.default_exception_handler(context)


@app.on_event("startup")
async def _startup():
    import asyncio
    asyncio.get_event_loop().set_exception_handler(_suppress_connection_reset)
    # 이미지 프롬프트 캐시 프리로드 — D:\img_prompt\index_img.json 읽기
    try:
        from services.img_prompt_cache import get_index
        get_index()
        print("[img-prompts] 캐시 로드 완료")
    except Exception as e:
        print(f"[img-prompts] 캐시 로드 실패 (무시): {e}")
# ─────────────────────────────────────────────────────────────────────────────


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3100", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline.router)
app.include_router(wiki.router)
app.include_router(chapters_router)
app.include_router(youtube_router)
app.include_router(chat_router)
app.include_router(parallax_test_router)  # 임시 패럴랙스 테스트
app.include_router(admin_router)
app.include_router(html_templates_router)
app.include_router(html_docs_router)
app.include_router(template_hearts_router)
app.include_router(transcribe_router)
app.include_router(pdf_docs_router)
app.include_router(prompts_router)
app.include_router(img_prompts_router)
app.include_router(prompt_ratings_router)  # 프롬프트 하트 평점 API
app.include_router(public_content_router)  # V2 파트너 공개 콘텐츠 API

# 템플릿 프리뷰 이미지 정적 서빙 (향후 R2로 대체)
_TEMPLATE_IMG_DIR = pathlib.Path(__file__).parent / "data" / "html-templates" / "img"
_TEMPLATE_IMG_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/template-img", StaticFiles(directory=str(_TEMPLATE_IMG_DIR)), name="template-img")

_MEDIA_DIR = pathlib.Path(__file__).parent / "data" / "media"
_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_MEDIA_DIR)), name="media")

# 이미지 프롬프트 썸네일 정적 서빙 — D:\img_prompt\ 루트를 /img-prompts-static 으로 마운트
_IMG_PROMPT_DIR = pathlib.Path(r"D:\img_prompt")
if _IMG_PROMPT_DIR.exists():
    app.mount(
        "/img-prompts-static",
        StaticFiles(directory=str(_IMG_PROMPT_DIR)),
        name="img-prompts-static",
    )


@app.post("/api/v1/media/upload")
async def upload_media(file: UploadFile = File(...)):
    """미디어 파일 업로드 — 로컬 data/media/ 저장 후 서빙 URL 반환"""
    media_dir = pathlib.Path(__file__).parent / "data" / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{int(time.time() * 1000)}_{file.filename.replace(' ', '_')}"
    content = await file.read()
    (media_dir / safe_name).write_bytes(content)
    return {"url": f"http://localhost:8001/media/{safe_name}", "filename": safe_name}


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/v1/characters")
def get_characters(style: str = "polystyle"):
    """캐릭터 전체 목록 — _index.json + 개별 portrait URL + 화풍별 외형 데이터 병합.

    style: 화풍 키 (polystyle | polystyle). 해당 스타일 파일 없으면 polystyle로 폴백.
    """
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    index = json.loads((data_dir / "_index.json").read_text(encoding="utf-8"))
    result = []
    for c in index.get("characters", []):
        detail_path = data_dir / f"{c['id']}.json"
        if detail_path.exists():
            detail = json.loads(detail_path.read_text(encoding="utf-8"))
            core = detail.get("core") or {}
            # 요청 화풍 → polystyle 폴백 순서로 스타일 파일 로드
            style_appearance: dict = {}
            style_prompt_str = ""
            for candidate in ([style] if style != "polystyle" else []) + ["polystyle"]:
                candidate_path = data_dir / f"{c['id']}_{candidate}.json"
                if candidate_path.exists():
                    style_data = json.loads(candidate_path.read_text(encoding="utf-8"))
                    style_appearance = style_data.get("appearance_en") or {}
                    style_prompt_str = style_data.get("style_prompt", "")
                    break
            # style_prompt 없으면 art_styles.json base_style_prompt 폴백
            if not style_prompt_str:
                art_styles_path = pathlib.Path(__file__).parent / "data" / "art_styles.json"
                if art_styles_path.exists():
                    art_styles = json.loads(art_styles_path.read_text(encoding="utf-8"))
                    style_prompt_str = (art_styles.get(style) or art_styles.get("polystyle", {})).get("base_style_prompt", "")
            c = {**c,
                 "voice_id":             detail.get("voice_id", ""),
                 "supertone_voice_id":   detail.get("supertone_voice_id", ""),
                 "supertone_style":      detail.get("supertone_style", ""),
                 "photo_real_url":       detail.get("photo_real_url", ""),
                 "photo_polystyle_url":  (json.loads((data_dir / f"{c['id']}_polystyle.json").read_text(encoding="utf-8")).get("reference_url", "") if (data_dir / f"{c['id']}_polystyle.json").exists() else ""),
                 "situations":           detail.get("situations", []),
                 "personality":          core.get("personality", ""),
                 "speaking_style":       core.get("speaking_style", ""),
                 "speaking_examples":    core.get("speaking_examples", []),
                 "relationships":        detail.get("relationships", {}),
                 # 이미지 생성용 외형 데이터 (요청 화풍 기준)
                 "fal_identity_prompt":  style_appearance.get("fal_identity_prompt", ""),
                 "wardrobe":             style_appearance.get("wardrobe", {}),
                 "body_prompt":          (style_appearance.get("body") or {}).get("body_prompt", ""),
                 "style_prompt":         style_prompt_str,
                 "appearance_style":     style}  # 실제 로드된 화풍 키
        result.append(c)
    return result


class SituationPayload(BaseModel):
    situation: str


class VoicePayload(BaseModel):
    voice_id: str


@app.patch("/api/v1/characters/{char_id}/voice")
def update_voice(char_id: str, payload: VoicePayload):
    """캐릭터 voice_id 업데이트 — {id}.json voice_id 필드 갱신"""
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    detail_path = data_dir / f"{char_id}.json"
    if not detail_path.exists():
        raise HTTPException(status_code=404, detail=f"캐릭터 {char_id} 없음")
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    detail["voice_id"] = payload.voice_id.strip()
    detail_path.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "voice_id": detail["voice_id"]}


class SupertoneVoicePayload(BaseModel):
    supertone_voice_id: str   # Supertone voice ID (play.supertone.ai에서 확인)
    supertone_style: str = "" # 스타일 (neutral / happy / sad 등, 비워두면 기본값)


@app.patch("/api/v1/characters/{char_id}/supertone-voice")
def update_supertone_voice(char_id: str, payload: SupertoneVoicePayload):
    """캐릭터 Supertone voice 설정 — {id}.json supertone_voice_id / supertone_style 갱신"""
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    detail_path = data_dir / f"{char_id}.json"
    if not detail_path.exists():
        raise HTTPException(status_code=404, detail=f"캐릭터 {char_id} 없음")
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    detail["supertone_voice_id"] = payload.supertone_voice_id.strip()
    detail["supertone_style"] = payload.supertone_style.strip()
    detail_path.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "supertone_voice_id": detail["supertone_voice_id"],
        "supertone_style": detail["supertone_style"],
    }


class AddExamplePayload(BaseModel):
    sentence: str
    reason: str


@app.post("/api/v1/writing-guide/add-example")
def add_writing_example(payload: AddExamplePayload):
    """명문 예시를 writing_guide.md에 추가 + _SYSTEM_INSTRUCTION 즉시 갱신"""
    sentence = payload.sentence.strip()
    reason = payload.reason.strip()
    if not sentence:
        raise HTTPException(400, "sentence 필수")

    new_line = f'- ✓ "{sentence}" — {reason}\n'
    section_header = "## 수집된 예시 (자동)\n"

    base_dir = pathlib.Path(__file__).parent
    targets = [
        base_dir / "prompts" / "writing_guide.md",
        base_dir.parent.parent / "source" / "_shared" / "writing_guide.md",
    ]
    for path in targets:
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        if section_header in content:
            content = content.replace(section_header, section_header + new_line, 1)
        else:
            content = content.rstrip("\n") + f"\n\n---\n\n{section_header}{new_line}"
        path.write_text(content, encoding="utf-8")

    # 메모리상 _SYSTEM_INSTRUCTION 즉시 갱신 (서버 재시작 불필요)
    import services.script_service as ss
    ss._SYSTEM_INSTRUCTION = ss._load_system_instruction()

    return {"ok": True}


class EmolinePayload(BaseModel):
    edges: List[Any]
    node_positions: List[Any] = []


@app.delete("/api/v1/characters/{char_id}/situations/{index}")
def delete_situation(char_id: str, index: int):
    """캐릭터 상황 삭제 — {id}.json situations[index] 제거"""
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    detail_path = data_dir / f"{char_id}.json"
    if not detail_path.exists():
        raise HTTPException(status_code=404, detail=f"캐릭터 {char_id} 없음")
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    situations: list = detail.get("situations") or []
    if index < 0 or index >= len(situations):
        raise HTTPException(status_code=400, detail=f"index {index} 범위 초과")
    situations.pop(index)
    detail["situations"] = situations
    detail_path.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "situations": situations}


@app.post("/api/v1/characters/{char_id}/situations")
def add_situation(char_id: str, payload: SituationPayload):
    """캐릭터 상황 추가 — {id}.json situations 배열 맨 앞에 삽입"""
    situation = payload.situation.strip()
    if not situation:
        raise HTTPException(status_code=400, detail="situation은 비어있을 수 없습니다")
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    detail_path = data_dir / f"{char_id}.json"
    if not detail_path.exists():
        raise HTTPException(status_code=404, detail=f"캐릭터 {char_id} 없음")
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    situations: list = detail.get("situations") or []
    situations.insert(0, situation)
    detail["situations"] = situations
    detail_path.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "situations": situations}


@app.get("/api/v1/emoline")
def get_emoline():
    """전역 감정선 + 노드 위치 로드 — Supabase character_emoline"""
    db = get_supabase()
    res = db.table("character_emoline").select("edges, node_positions").eq("id", 1).single().execute()
    return {
        "edges": res.data.get("edges", []) if res.data else [],
        "node_positions": res.data.get("node_positions", []) if res.data else [],
    }


@app.post("/api/v1/emoline")
def save_emoline(payload: EmolinePayload):
    """전역 감정선 + 노드 위치 저장 — Supabase character_emoline"""
    db = get_supabase()
    db.table("character_emoline").upsert({
        "id": 1,
        "edges": payload.edges,
        "node_positions": payload.node_positions,
    }).execute()
    return {"ok": True, "count": len(payload.edges)}


@app.get("/api/v1/emoline/preview")
def get_emoline_preview():
    """감정선 → Gemini 실제 주입 텍스트 반환 (전달 검증용)

    _build_emoline_block()을 캐스트 필터 없이 실행 — 전체 캐릭터를 cast로 간주.
    시리즈별 캐스트 필터링은 run_script()에서 수행되므로, 여기서는 저장된 감정선이
    어떤 형식으로 Gemini에 전달되는지 정확히 보여준다.
    """
    from services.script_service import _build_emoline_block, _load_char_situations

    db = get_supabase()
    res = db.table("character_emoline").select("edges").eq("id", 1).single().execute()
    edges: list = (res.data or {}).get("edges", [])

    if not edges:
        return {"prompt": "", "edge_count": 0, "edges": []}

    # 전체 캐릭터 → cast로 간주 (필터 없이 모든 엣지 표시)
    data_dir = pathlib.Path(__file__).parent / "data" / "characters"
    index = json.loads((data_dir / "_index.json").read_text(encoding="utf-8"))
    all_chars = index.get("characters", [])
    fake_full_cast = [{"id": c["id"], "name": c["name"]} for c in all_chars]
    fake_world = {"fullCastDetails": fake_full_cast}

    prompt_text = _build_emoline_block(edges, fake_world)

    # 엣지별 상세 정보 (프론트 렌더링용)
    name_map = {c["id"]: c["name"] for c in all_chars}
    edge_details = []
    for e in edges:
        src_id = e.get("source", "")
        tgt_id = e.get("target", "")
        emotion = (e.get("data") or {}).get("label", "")
        color   = (e.get("data") or {}).get("color", "#6b7280")
        sits_src = [s for s in _load_char_situations(src_id) if not s.startswith("★ 투입된 비밀:")][:2]
        sits_tgt = [s for s in _load_char_situations(tgt_id) if not s.startswith("★ 투입된 비밀:")][:2]
        edge_details.append({
            "sourceName": name_map.get(src_id, src_id),
            "targetName": name_map.get(tgt_id, tgt_id),
            "emotion": emotion,
            "color": color,
            "sourceSituations": sits_src,
            "targetSituations": sits_tgt,
        })

    return {"prompt": prompt_text, "edge_count": len(edges), "edges": edge_details}


@app.get("/api/v1/world-options")
def get_world_options():
    """world_options.json — 세계관 옵션 카탈로그 (배경/관계/사회적균열/갈등구조)"""
    path = pathlib.Path(__file__).parent / "data" / "world_options.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # _meta 제외하고 반환
    return {k: v for k, v in data.items() if not k.startswith("_")}

async def _auto_kenburns(series_id: str, scene_code: str) -> None:
    """TTS 저장 직후 해당 scene_code 1개만 Ken Burns/Hybrid 처리 (fire-and-forget)"""
    import re as _re
    try:
        from services.kenburns_service import single_kenburns
        from services.grid_crop_service import _normalize_scene_code as _norm
        from core.database import get_supabase
        db = get_supabase()
        result = await single_kenburns(series_id, scene_code, db)
        print(f"[auto-kenburns] {scene_code} → {result}")
        if result.get("ok"):
            ch_m = _re.search(r"ch(\d+)", scene_code)
            ch_num = int(ch_m.group(1)) if ch_m else 1
            file_code_k = _norm(scene_code)
            local_mp4_url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{ch_num}/local-file/{file_code_k}/mp4"
            await asyncio.to_thread(
                lambda: db.table("v3_scenes")
                .update({"lipsync_url": local_mp4_url})
                .eq("series_id", series_id)
                .eq("scene_code", scene_code)
                .neq("type", "dialogue")
                .execute()
            )
            print(f"[auto-kenburns] DB lipsync_url 저장: {scene_code}")
    except Exception as e:
        print(f"[auto-kenburns] 실패 (무시): {e}")


@app.post("/api/v1/tts")
async def tts_preview(
    text: str = Form(...),
    voice: str = Form("ko-KR-SunHiNeural"),
    series_id: str = Form(""),
    scene_code: str = Form(""),
):
    """단일 컷 TTS 미리듣기 — Supertone(st:) 또는 edge-tts MP3 반환 + 로컬 저장"""
    import asyncio, re
    from services.tts_service import _edge_tts, _supertone_tts

    if not text.strip():
        raise HTTPException(400, "text 필수")

    word_events: list[dict] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        mp3_path = pathlib.Path(tmpdir) / "preview.mp3"
        if voice.startswith("st:"):
            st_part = voice[3:]
            st_parts = st_part.split(":", 1)
            st_voice_id = st_parts[0]
            st_style = st_parts[1] if len(st_parts) > 1 else "neutral"
            await _supertone_tts(text, st_voice_id, str(mp3_path), style=st_style)
        else:
            word_events = await _edge_tts(text, str(mp3_path), voice=voice)
        audio_bytes = mp3_path.read_bytes()

    # 로컬 저장 — series_id + scene_code 있을 때만
    if series_id and scene_code:
        try:
            db = get_supabase()
            ser_res = await asyncio.to_thread(
                lambda: db.table("v3_series").select("series_code").eq("id", series_id).single().execute()
            )
            series_code_val = (ser_res.data or {}).get("series_code") or series_id
            ch_match = re.search(r'ch(\d+)', scene_code)
            chapter = int(ch_match.group(1)) if ch_match else 1
            from services.grid_crop_service import _normalize_scene_code
            file_code = _normalize_scene_code(scene_code)
            out_dir = pathlib.Path(__file__).parent.parent.parent / "output" / series_code_val / f"ch{chapter:02d}"
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{file_code}.mp3").write_bytes(audio_bytes)
            # SRT 로컬 저장 — edge-tts word_events 있을 때만 (Supertone은 빈 리스트)
            from services.tts_service import _make_srt
            _make_srt(word_events, str(out_dir / f"{file_code}.srt"))
            print(f"[TTS] 저장: {out_dir / file_code}.mp3 + .srt ({len(word_events)}단어)")
            # DB tts_url 업데이트 — 로컬 서빙 URL
            tts_local_url = f"http://localhost:8001/api/v1/series/{series_id}/chapters/{chapter}/tts/{scene_code}"
            await asyncio.to_thread(
                lambda: db.table("v3_scenes")
                .update({"tts_url": tts_local_url})
                .eq("series_id", series_id)
                .eq("scene_code", scene_code)
                .execute()
            )
            # Ken Burns 자동 트리거 — 해당 scene_code 1개만 백그라운드 실행 (블로킹 없음)
            asyncio.create_task(_auto_kenburns(series_id, scene_code))
        except Exception as e:
            print(f"[TTS] 로컬 저장 실패 (무시): {e}")

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"inline; filename={scene_code or 'preview'}.mp3"},
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False)
