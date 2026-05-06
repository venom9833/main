"""Gemini API 키 로테이터 — 5회 호출마다 키 순환 (최대 3개)"""
import threading
from core.config import settings

_lock = threading.Lock()
_call_count = 0


def get_image_api_key() -> str:
    """5회 단위로 등록된 키를 순환 반환.
    설정된 키만 풀에 포함 — 미설정 키는 자동 제외.
    """
    global _call_count

    pool = [k for k in [
        settings.GOOGLE_API_KEY,
        settings.GOOGLE_API_KEY_2,
        settings.GOOGLE_API_KEY_3,
    ] if k]

    if not pool:
        return ""

    with _lock:
        idx = (_call_count // 5) % len(pool)
        _call_count += 1

    return pool[idx]
