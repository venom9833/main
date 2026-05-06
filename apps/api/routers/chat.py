"""챗봇 라우터 — Gemini 스트리밍"""
import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from core.config import settings

router = APIRouter(prefix="/api/v1", tags=["chat"])


class ChatMessage(BaseModel):
    role: str   # "user" | "model"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[dict] = None  # 현재 컷 정보


def _build_system_prompt(context: dict | None) -> str:
    base = """\
당신은 LinkDrop 한국 드라마 시리즈 영상 제작 AI 어시스턴트입니다.

[핵심 역할]
- 이미지 생성 프롬프트 분석·개선·신규 작성
- 대본과 이미지 프롬프트의 불일치 탐지 및 교정
- 대본 수정 제안, 연출 방향 조언

[이미지 프롬프트 작성 원칙]
1. 반드시 영어로 작성한다
2. 구성 순서:
   (a) 카메라 구도 — Medium shot / Close-up / Wide shot / Over-the-shoulder shot 등
   (b) 등장인물 외형 — 아래 [등장인물 외형 템플릿]의 fal_identity_prompt를 그대로 사용
   (c) 감정 상태·자세 — 대본과 상황에서 도출
   (d) 의상 — wardrobe_prompt 중 감정 상태에 맞는 것 선택
   (e) 배경·분위기·조명
   (f) 아트 스타일 태그 — [아트 스타일] 섹션의 style_prompt를 그대로 붙인다 (절대 생략 금지)
3. fal_identity_prompt 없이 캐릭터 외형을 창작하지 않는다

[대화 씬 — 전화 통화 판별]
- 화자(speaker)가 현장에 물리적으로 존재하지 않을 수 있다
- 전화 통화 판별 힌트: "아직 안 잤어?", "어디야?", "나야", "뭐해?" 같은 안부·위치 확인 대화
- 전화 통화로 판단되면:
  * 이미지에는 전화를 받는 쪽(현장 인물)만 등장
  * 화자는 물리적으로 등장시키지 않는다 — 목소리로만 존재
  * 스마트폰을 들거나 화면을 보는 동작으로 통화 상황 표현

[불일치 감지]
이미지 힌트와 대본이 맞지 않으면:
1. "⚠️ 불일치:" 로 시작해서 문제점 설명 (한국어)
2. 수정된 프롬프트 제시 (영어)

[답변 형식]
- 분석·설명: 한국어, 짧고 직접적으로
- 이미지 프롬프트 제안: 코드블록 없이 순수 영어 텍스트
- 마크다운 헤더(##)·불릿(-)은 꼭 필요한 경우만 사용\
"""
    if not context:
        return base

    lines = [base, "\n\n[현재 작업 중인 컷 정보]"]
    if context.get("sceneCode"):
        lines.append(f"씬 코드: {context['sceneCode']}")
    if context.get("type"):
        lines.append(f"타입: {'대사' if context['type'] == 'dialogue' else '나레이션'}")
    if context.get("speaker"):
        lines.append(f"화자: {context['speaker']}")
    if context.get("text"):
        lines.append(f"대본:\n{context['text']}")
    if context.get("imageHint"):
        lines.append(f"이미지 힌트: {context['imageHint']}")
    if context.get("seriesTitle"):
        lines.append(f"시리즈 제목: {context['seriesTitle']}")
    if context.get("genre"):
        lines.append(f"장르: {context['genre']}")

    # 이 컷 등장인물
    scene_chars = context.get("sceneCharacters") or []
    if scene_chars:
        lines.append(f"이 컷 등장인물: {', '.join(scene_chars)}")

    # 전체 캐스팅 (등장인물만 발췌)
    full_cast: list = context.get("fullCast") or []
    if full_cast and scene_chars:
        cast_map = {c["name"]: c for c in full_cast if isinstance(c, dict)}
        relevant = [cast_map[n] for n in scene_chars if n in cast_map]
        if relevant:
            lines.append("\n[등장인물 요약]")
            for c in relevant:
                lines.append(f"- {c['name']} ({c.get('id','?')}): {c.get('role','')}")
    elif full_cast and not scene_chars:
        lines.append("\n[전체 캐스팅]")
        for c in full_cast[:6]:
            if isinstance(c, dict):
                lines.append(f"- {c.get('name','?')}: {c.get('role','')[:40]}")

    # 캐릭터 상세 정보
    char_details: dict = context.get("characterDetails") or {}
    if char_details:
        all_names = list(char_details.keys())

        # ── 외형 템플릿 (이미지 프롬프트 생성용) ──────────────────────────────
        lines.append("\n[등장인물 외형 템플릿 — 이미지 프롬프트에 그대로 사용]")
        art_style_collected = ""
        for name, d in char_details.items():
            lines.append(f"\n■ {name}")
            if d.get("fal_identity_prompt"):
                lines.append(f"  fal_identity_prompt: {d['fal_identity_prompt']}")
            if d.get("body_prompt"):
                lines.append(f"  body_prompt: {d['body_prompt']}")
            wardrobe = d.get("wardrobe") or {}
            for mood in ("default", "stressed", "casual"):
                wp = (wardrobe.get(mood) or {}).get("wardrobe_prompt", "")
                if wp:
                    lines.append(f"  의상({mood}): {wp}")
            if not art_style_collected and d.get("style_prompt"):
                art_style_collected = d["style_prompt"]

        # ── 아트 스타일 ────────────────────────────────────────────────────────
        if art_style_collected:
            lines.append(f"\n[아트 스타일 — 프롬프트 마지막에 반드시 추가]\n{art_style_collected}")

        # ── 심리·상황 정보 (연출 판단용) ───────────────────────────────────────
        lines.append("\n[등장인물 심리·상황]")
        for name, d in char_details.items():
            lines.append(f"\n■ {name}")
            if d.get("personality"):
                lines.append(f"  성격: {d['personality']}")
            if d.get("speaking_style"):
                lines.append(f"  말투: {d['speaking_style']}")
            examples = d.get("speaking_examples") or []
            if examples:
                lines.append(f"  대사 예시: {' / '.join(examples[:2])}")
            sits = [s for s in (d.get("situations") or []) if not s.startswith("★")][:3]
            if sits:
                lines.append("  상황:")
                for s in sits:
                    lines.append(f"    - {s}")
            rels = d.get("relationships") or {}
            rel_entries = [(k, v) for k, v in rels.items()
                           if any(n in k for n in all_names if n != name)]
            if rel_entries:
                lines.append("  관계:")
                for k, v in rel_entries[:2]:
                    lines.append(f"    - {k}: {v}")

    return "\n".join(lines)


async def _gemini_stream(messages: List[ChatMessage], system_prompt: str):
    """Gemini 스트리밍 → SSE 청크 제너레이터"""
    from google import genai as gai
    from google.genai import types as _types

    client = gai.Client(api_key=settings.GOOGLE_API_KEY)
    contents = [
        {"role": m.role, "parts": [{"text": m.content}]}
        for m in messages
    ]
    cfg = _types.GenerateContentConfig(
        temperature=0.85,
        max_output_tokens=1024,
        system_instruction=system_prompt,
        thinking_config=_types.ThinkingConfig(thinking_budget=0),
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    def _run():
        try:
            for chunk in client.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=contents,
                config=cfg,
            ):
                if chunk.text:
                    loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, f"\n[오류: {e}]")
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    future = loop.run_in_executor(None, _run)

    while True:
        text = await queue.get()
        if text is None:
            break
        yield f"data: {json.dumps({'t': text}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"

    # future 완료 대기 (예외 전파)
    try:
        await asyncio.wrap_future(future)
    except Exception:
        pass


@router.post("/chat")
async def chat(req: ChatRequest):
    system_prompt = _build_system_prompt(req.context)
    return StreamingResponse(
        _gemini_stream(req.messages, system_prompt),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
