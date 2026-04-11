"""Gemini 공통 헬퍼"""
import asyncio
import json
import re
import time
from fastapi import HTTPException
from core.config import settings


def _call_gemini_sync(
    prompt: str,
    system_instruction: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.9,
    retries: int = 3,
) -> str:
    from google import genai as gai
    from google.genai import types as _types
    client = gai.Client(api_key=settings.GOOGLE_API_KEY)
    cfg = _types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_tokens,
        system_instruction=system_instruction if system_instruction else None,
        thinking_config=_types.ThinkingConfig(thinking_budget=0),
    )
    contents = prompt
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=cfg,
            )
            text = resp.text
            if not text:
                raise ValueError("Gemini 응답 없음 — Safety filter 가능성")
            return text
        except HTTPException:
            raise
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    raise HTTPException(500, f"Gemini 호출 실패 ({retries}회): {last_err}")


async def call_gemini(
    prompt: str,
    system_instruction: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.9,
) -> str:
    """비동기 래퍼 — 이벤트 루프 블로킹 방지"""
    return await asyncio.to_thread(
        _call_gemini_sync, prompt, system_instruction, max_tokens, temperature
    )


def extract_json(raw: str) -> dict:
    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', raw)
    if code_match:
        raw = code_match.group(1).strip()
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(500, f"JSON 파싱 실패: {raw[:300]}")
    json_str = match.group(0)
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass
    try:
        from json_repair import repair_json
        repaired = repair_json(json_str, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
    except Exception:
        pass
    raise HTTPException(500, f"JSON 디코딩 실패: {raw[:300]}")
