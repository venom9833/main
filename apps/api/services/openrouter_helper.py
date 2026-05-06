"""Judge 헬퍼 — 멀티 프로바이더 라우팅 + 서킷 브레이커 + 슬롯별 폴백 체인

지원 프로바이더:
  - cerebras      : https://api.cerebras.ai/v1  (14,400 RPD — 주력)
  - huggingface   : https://api-inference.huggingface.co/v1  (Pro — Gemma 3 27B 한국어)
  - openrouter    : https://openrouter.ai/api/v1 (50 RPD — 보조)
  - nvidia_nim    : https://integrate.api.nvidia.com/v1
  - google_free   : Gemini 2.0 Flash 무료 티어

모델 정책 변경 시 apps/api/data/judge_config.json 만 편집하면 됩니다.
새 프로바이더 추가 시 _PROVIDER_CONFIG 에 항목 1개만 추가.
"""
import asyncio
import json
import re
import time
from pathlib import Path
from core.config import settings

# ── 설정 로드 ────────────────────────────────────────────────────────────────
_CONFIG_PATH = Path(__file__).parent.parent / "data" / "judge_config.json"
_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _load_config() -> dict:
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


# ── 프로바이더 라우팅 테이블 ─────────────────────────────────────────────────
# 새 프로바이더 추가: 이 딕셔너리에 항목 1개 + .env에 API 키만 추가하면 됩니다.
_PROVIDER_CONFIG: dict[str, dict] = {
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "api_key_fn": lambda: settings.CEREBRAS_API_KEY,
        "extra_headers": {},
        "json_mode": True,
        "rpm_note": "30 RPM / 14,400 RPD",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_fn": lambda: settings.OPENROUTER_API_KEY,
        "extra_headers": {
            "HTTP-Referer": "https://linkdrop.local",
            "X-Title": "LinkDrop V3",
        },
        "json_mode": True,
        "rpm_note": "20 RPM / 50 RPD",
    },
    "huggingface": {
        # HuggingFace Serverless Inference API (Pro) — OpenAI 호환 엔드포인트
        # 확인된 한국어 우수 모델: google/gemma-3-27b-it (12s, 한국어 57%+)
        # json_mode=False: HF 서버리스는 response_format 미지원 — 호출자가 직접 파싱
        "base_url": "https://api-inference.huggingface.co/v1",
        "api_key_fn": lambda: settings.HF_API_TOKEN,
        "extra_headers": {},
        "json_mode": False,
        "rpm_note": "Pro 구독 — 초당 1~2 req",
    },
    "nvidia_nim": {
        "base_url": "https://integrate.api.nvidia.com/v1",
        "api_key_fn": lambda: settings.NVIDIA_API_KEY,
        "extra_headers": {},
        "json_mode": True,
        "rpm_note": "40 RPM",
    },
    "google_free": {
        # OpenAI 호환 엔드포인트 — 생산용 GOOGLE_API_KEY와 완전 분리
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "api_key_fn": lambda: settings.GEMINI_FREE_API_KEY,
        "extra_headers": {},
        "json_mode": True,
        "rpm_note": "15 RPM / 1,500 RPD (gemini-2.0-flash 기준)",
    },
}


def is_provider_configured(provider: str) -> bool:
    """프로바이더 API 키가 설정되어 있는지 확인"""
    cfg = _PROVIDER_CONFIG.get(provider)
    if not cfg:
        return False
    return bool(cfg["api_key_fn"]())


# ── 서킷 브레이커 ─────────────────────────────────────────────────────────────
# 키 형식: "{provider}:{model_id}" — 같은 모델이라도 프로바이더가 다르면 독립 추적
_fail_counts: dict[str, int] = {}
_disabled_until: dict[str, float] = {}


def _cb_key(provider: str, model_id: str) -> str:
    return f"{provider}:{model_id}"


def _cb_threshold() -> int:
    return _load_config().get("circuit_breaker", {}).get("failure_threshold", 3)


def _cb_ttl() -> int:
    return _load_config().get("circuit_breaker", {}).get("disable_ttl_seconds", 600)


def is_model_available(provider: str, model_id: str) -> bool:
    """서킷 브레이커: 해당 provider+model 조합이 현재 사용 가능한지 확인"""
    key = _cb_key(provider, model_id)
    exp = _disabled_until.get(key, 0)
    if exp and time.time() < exp:
        return False
    if exp and time.time() >= exp:
        _disabled_until.pop(key, None)
        _fail_counts.pop(key, None)
    return True


def record_failure(provider: str, model_id: str) -> None:
    key = _cb_key(provider, model_id)
    _fail_counts[key] = _fail_counts.get(key, 0) + 1
    if _fail_counts[key] >= _cb_threshold():
        _disabled_until[key] = time.time() + _cb_ttl()


def record_success(provider: str, model_id: str) -> None:
    key = _cb_key(provider, model_id)
    _fail_counts.pop(key, None)
    _disabled_until.pop(key, None)


def get_circuit_status() -> dict:
    """현재 서킷 브레이커 상태 전체 조회 (디버그/모니터링용)"""
    now = time.time()
    all_keys = set(list(_fail_counts.keys()) + list(_disabled_until.keys()))
    return {
        k: {
            "disabled": now < _disabled_until.get(k, 0),
            "fail_count": _fail_counts.get(k, 0),
            "recovers_in_sec": max(0, int(_disabled_until.get(k, 0) - now)),
        }
        for k in all_keys
    }


# ── 단일 프로바이더 호출 ──────────────────────────────────────────────────────

def _call_huggingface_sync(
    prompt: str,
    model_id: str,
    system_instruction: str = "",
    max_tokens: int = 1200,
    temperature: float = 0.1,
    timeout: int = 60,
) -> str:
    """HuggingFace Serverless Inference — huggingface_hub 전용 경로.
    HF 서버리스는 모델별 URL 구조라 openai 클라이언트 대신 InferenceClient 사용.
    """
    from huggingface_hub import InferenceClient
    api_key = settings.HF_API_TOKEN
    if not api_key:
        raise ValueError("HF_API_TOKEN 미설정")
    client = InferenceClient(api_key=api_key, timeout=timeout)
    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})
    resp = client.chat_completion(
        model=model_id,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise ValueError(f"빈 응답 (huggingface/{model_id})")
    return text


def _call_provider_sync(
    prompt: str,
    provider: str,
    model_id: str,
    system_instruction: str = "",
    max_tokens: int = 1200,
    temperature: float = 0.1,
    timeout: int = 60,
) -> str:
    """동기 LLM 호출 — 프로바이더별 base_url + api_key 자동 라우팅"""
    # HuggingFace는 모델별 URL 구조 → 전용 경로 사용
    if provider == "huggingface":
        return _call_huggingface_sync(
            prompt, model_id, system_instruction, max_tokens, temperature, timeout
        )

    import openai

    pcfg = _PROVIDER_CONFIG.get(provider)
    if not pcfg:
        raise ValueError(f"알 수 없는 프로바이더: {provider}")

    api_key = pcfg["api_key_fn"]()
    if not api_key:
        raise ValueError(f"{provider} API 키 미설정")

    client = openai.OpenAI(
        api_key=api_key,
        base_url=pcfg["base_url"],
        default_headers=pcfg.get("extra_headers", {}),
        timeout=timeout,
    )

    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})

    kwargs: dict = dict(
        model=model_id,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    if pcfg.get("json_mode", False):
        kwargs["response_format"] = {"type": "json_object"}

    resp = client.chat.completions.create(**kwargs)
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise ValueError(f"빈 응답 ({provider}/{model_id})")
    return text


async def call_provider(
    prompt: str,
    provider: str,
    model_id: str,
    system_instruction: str = "",
    max_tokens: int = 1200,
    temperature: float = 0.1,
) -> str:
    """비동기 래퍼"""
    cfg = _load_config()
    timeout = cfg.get("timeout_seconds", 60)
    return await asyncio.to_thread(
        _call_provider_sync,
        prompt, provider, model_id, system_instruction, max_tokens, temperature, timeout,
    )


# ── JSON 티켓 파싱 ────────────────────────────────────────────────────────────

def _parse_tickets(raw: str) -> list[dict]:
    """LLM JSON 응답에서 tickets 배열 추출 — 실패 시 빈 리스트"""
    try:
        cleaned = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", raw).strip()
        obj = json.loads(cleaned)
        tickets = obj.get("tickets", [])
        if isinstance(tickets, list):
            return [t for t in tickets if isinstance(t, dict)]
    except Exception:
        pass
    try:
        from json_repair import repair_json
        obj = repair_json(raw, return_objects=True)
        if isinstance(obj, dict):
            tickets = obj.get("tickets", [])
            if isinstance(tickets, list):
                return [t for t in tickets if isinstance(t, dict)]
    except Exception:
        pass
    return []


# ── 슬롯별 폴백 호출 ─────────────────────────────────────────────────────────

async def call_judge_with_fallback(
    slot_name: str,
    prompt: str,
    system_instruction: str = "",
) -> tuple[str | None, list[dict]]:
    """슬롯 이름으로 Judge 호출 — 멀티 프로바이더 폴백 체인 자동 적용.

    judge_config.json 의 models 배열을 순서대로 시도:
      - 프로바이더 API 키 미설정 → 스킵
      - 서킷 브레이커 비활성 → 스킵
      - 호출 성공 → (provider:model, tickets) 반환
      - 400(프롬프트 오류) → 즉시 중단 (폴백 불필요)
      - 429/503/timeout → 다음 항목으로 폴백

    Returns:
        (used_key, tickets)  —  전체 실패 시 (None, [])
    """
    cfg = _load_config()
    slot = cfg.get("slots", {}).get(slot_name)
    if not slot:
        return None, []

    models: list[dict | str] = slot.get("models", [])
    max_tok = cfg.get("max_tokens", 1200)

    for entry in models:
        # 하위 호환: 문자열 형식(구버전 config)은 openrouter로 간주
        if isinstance(entry, str):
            provider, model_id = "openrouter", entry
        else:
            provider = entry.get("provider", "openrouter")
            model_id = entry.get("model", "")

        if not model_id:
            continue

        # API 키 미설정 → 스킵 (오류 아님)
        if not is_provider_configured(provider):
            continue

        # 서킷 브레이커 비활성 → 스킵
        if not is_model_available(provider, model_id):
            continue

        try:
            raw = await call_provider(
                prompt=prompt,
                provider=provider,
                model_id=model_id,
                system_instruction=system_instruction,
                max_tokens=max_tok,
                temperature=0.1,
            )
            tickets = _parse_tickets(raw)
            record_success(provider, model_id)
            return f"{provider}:{model_id}", tickets

        except Exception as e:
            err_str = str(e)
            record_failure(provider, model_id)
            # 400 계열(프롬프트 문제) → 폴백해도 같은 오류 → 즉시 중단
            if any(code in err_str for code in ("400", "invalid_request")):
                break
            # 그 외(429, 503, timeout, 401 등) → 다음 항목 폴백
            continue

    return None, []


# ── 슬롯 프롬프트 로더 ───────────────────────────────────────────────────────

def load_judge_prompt(slot_name: str) -> str:
    cfg = _load_config()
    slot = cfg.get("slots", {}).get(slot_name, {})
    fname = slot.get("prompt_file", f"judge_{slot_name}.md")
    path = _PROMPTS_DIR / fname
    return path.read_text(encoding="utf-8") if path.exists() else ""


def get_revise_threshold(active_judge_count: int) -> tuple[int, int]:
    """활성 Judge 수에 따른 Revise 트리거 임계치 (high_min, medium_min)"""
    cfg = _load_config()
    thresholds = cfg.get("revise_thresholds", {})
    key = f"judges_{active_judge_count}"
    t = thresholds.get(key, thresholds.get("judges_1", {}))
    return t.get("high_min", 1), t.get("medium_min", 999)
