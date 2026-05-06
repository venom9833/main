"""translate_hint.py — image_hint 한글 → 영문 번역 헬퍼

한글이 포함된 image_hint를 fal.ai 영문 프롬프트 구문으로 번역한다.
모듈 레벨 캐시로 동일 텍스트 재번역을 방지한다.
번역 실패 시 원문 반환 (하위 호환 폴백).
"""

import re

_KO_RE = re.compile(r'[가-힣]')
_cache: dict[str, str] = {}


def _is_korean(text: str) -> bool:
    return bool(_KO_RE.search(text))


async def translate_if_korean(text: str) -> str:
    """한글이 포함된 경우 영문으로 번역. 이미 영문이거나 빈 문자열이면 원문 반환."""
    if not text or not _is_korean(text):
        return text
    if text in _cache:
        return _cache[text]

    from services.gemini_helper import call_free_llm

    prompt = (
        "Translate the following Korean scene description into English "
        "for use as an image generation prompt. "
        "Output only the translated English as comma-separated descriptive phrases. "
        "No explanation, no quotes.\n\n"
        f"Korean: {text}\nEnglish:"
    )
    try:
        result = (await call_free_llm(prompt, max_tokens=200, temperature=0.2)).strip()
        if result.lower().startswith("english:"):
            result = result[8:].strip()
        _cache[text] = result
        return result
    except Exception:
        return text
