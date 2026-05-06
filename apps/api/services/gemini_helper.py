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


# LD-011 우선순위 2~3단계 무료 LLM 폴백 체인
# Cerebras(무료) → HuggingFace Pro(Gemma 3 27B 한국어) → NVIDIA NIM → OpenRouter → Gemini Free → Gemini Paid(최후)
_FREE_LLM_CHAIN: list[dict] = [
    {"provider": "cerebras",     "model": "llama-3.3-70b"},
    {"provider": "huggingface",  "model": "google/gemma-3-27b-it"},   # 한국어 최적 — HF Pro 서버리스
    {"provider": "nvidia_nim",   "model": "meta/llama-3.3-70b-instruct"},
    {"provider": "openrouter",   "model": "meta-llama/llama-3.3-70b-instruct:free"},
    {"provider": "google_free",  "model": "gemini-2.0-flash"},
]


async def call_free_llm(
    prompt: str,
    system_instruction: str = "",
    max_tokens: int = 3000,
    temperature: float = 0.3,
) -> str:
    """🟢 무료 LLM 호출 — LD-011 우선순위 2~3단계 폴백 체인.

    Cerebras → NVIDIA NIM → OpenRouter → Gemini Free
    무료 키가 하나라도 설정된 경우: 체인 전체 실패 시 HTTPException 발생 (유료 Gemini 차단).
    무료 키가 전혀 없는 경우: 유료 Gemini 최후 수단.
    """
    from services.openrouter_helper import (
        call_provider, is_provider_configured, is_model_available,
        record_success, record_failure,
    )

    any_free_configured = any(
        is_provider_configured(e["provider"]) for e in _FREE_LLM_CHAIN
    )

    for entry in _FREE_LLM_CHAIN:
        provider = entry["provider"]
        model_id = entry["model"]

        if not is_provider_configured(provider):
            continue
        if not is_model_available(provider, model_id):
            continue

        try:
            raw = await call_provider(
                prompt=prompt,
                provider=provider,
                model_id=model_id,
                system_instruction=system_instruction,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            record_success(provider, model_id)
            return raw
        except Exception as e:
            record_failure(provider, model_id)
            err = str(e)
            # 400(프롬프트 오류)는 폴백해도 동일 실패 → 즉시 중단
            if any(c in err for c in ("400", "invalid_request")):
                break
            continue

    # 무료 키 설정됨 → 유료 Gemini 자동 전환 차단 (상위 호출자가 예외 처리)
    if any_free_configured:
        raise HTTPException(503, "무료 LLM 체인 전체 실패 — 유료 Gemini 자동 전환 차단")

    # 무료 키 전혀 없음 → 최후 수단
    # ⚠️ GEMINI-PAID: 무료 프로바이더 키 미설정 환경에서만 실행
    return await call_gemini(prompt, system_instruction, max_tokens, temperature)


def _call_gemini_json_sync(
    prompt: str,
    system_instruction: str = "",
    response_schema: dict | None = None,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    retries: int = 3,
) -> dict:
    """Gemini structured output — response_schema 강제, JSON dict 반환"""
    import json as _json
    from google import genai as gai
    from google.genai import types as _types
    client = gai.Client(api_key=settings.GOOGLE_API_KEY)
    cfg = _types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_tokens,
        system_instruction=system_instruction if system_instruction else None,
        thinking_config=_types.ThinkingConfig(thinking_budget=0),
        response_mime_type="application/json",
        response_schema=response_schema,
    )
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=cfg,
            )
            text = resp.text
            if not text:
                raise ValueError("Gemini JSON 응답 없음")
            # response_schema 강제 시 이미 JSON 문자열로 옴
            return _json.loads(text)
        except HTTPException:
            raise
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                import time as _time
                _time.sleep(3 * (attempt + 1))
    raise HTTPException(500, f"Gemini JSON 호출 실패 ({retries}회): {last_err}")


async def call_gemini_json(
    prompt: str,
    system_instruction: str = "",
    response_schema: dict | None = None,
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """비동기 JSON 생성 — Gemini structured output"""
    return await asyncio.to_thread(
        _call_gemini_json_sync, prompt, system_instruction, response_schema, max_tokens, temperature
    )


def extract_json(raw: str) -> dict:
    """LLM 응답에서 JSON을 안전하게 추출한다.

    처리 순서:
    1단계: BOM/공백 제거
    2단계: 닫는 펜스가 있는 정상 마크다운 코드블록 처리 (```json ... ```)
    3단계: 닫는 펜스가 없는 잘린 응답 — 시작 펜스만 제거
    4단계: 첫 '{' 위치부터 JSON 문자열 시작
    5단계: 마지막 '}' 위치까지 자른 뒤 json.loads 시도
    6단계: 잘린/손상 JSON은 json_repair 폴백으로 복구
    """
    if not isinstance(raw, str):
        raise HTTPException(500, f"JSON 파싱 실패(타입 불일치): {type(raw).__name__}")

    # 1단계: BOM/공백 제거
    text = raw.strip().lstrip("﻿")

    # 2단계: 닫는 펜스가 있는 정상 케이스 — 우선 시도
    closed = re.search(r'```(?:json|JSON)?\s*([\s\S]*?)```', text)
    if closed:
        text = closed.group(1).strip()
    else:
        # 3단계: 닫는 펜스가 없는 잘린 응답 — 시작 펜스만 제거
        opened = re.search(r'```(?:json|JSON)?\s*', text)
        if opened:
            text = text[opened.end():].strip()
        # 끝에 남은 백틱(부분 닫힘) 제거
        text = re.sub(r'`+\s*$', '', text).strip()

    # 4단계: 첫 '{' 부터 끝까지 자르기 (잘린 JSON도 repair_json이 복구 가능)
    brace_idx = text.find("{")
    if brace_idx == -1:
        raise HTTPException(500, f"JSON 파싱 실패: {raw[:300]}")
    json_str = text[brace_idx:]

    # 5단계: 끝에 마지막 '}' 가 있으면 그 위치까지로 다듬기 (greedy)
    last_brace = json_str.rfind("}")
    if last_brace != -1:
        candidate = json_str[: last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # 6단계: repair_json 폴백 — 잘린/말단 손상 JSON 복구
    try:
        from json_repair import repair_json
        repaired = repair_json(json_str, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
    except Exception:
        pass

    raise HTTPException(500, f"JSON 디코딩 실패: {raw[:300]}")
