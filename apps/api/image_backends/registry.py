import json
import os
from pathlib import Path
from image_backends.pillow_backend import PillowBackend
from image_backends.gemini_backend import GeminiBackend

_REGISTRY = {
    "pillow": PillowBackend,
    "gemini": GeminiBackend,
}

_ART_STYLES_PATH = Path(__file__).parent.parent / "data" / "art_styles.json"
_ART_STYLES: dict = {}


def get_art_styles() -> dict:
    global _ART_STYLES
    if not _ART_STYLES:
        _ART_STYLES = json.loads(_ART_STYLES_PATH.read_text(encoding="utf-8"))
        _ART_STYLES.pop("_note", None)
    return _ART_STYLES


def get_art_style_config(art_style: str = "masako") -> dict:
    """화풍 설정 반환 — 없으면 masako 기본"""
    styles = get_art_styles()
    return styles.get(art_style, styles.get("masako", {}))


def get_image_backend():
    provider = os.environ.get("IMAGE_PROVIDER", "pillow")
    cls = _REGISTRY.get(provider, PillowBackend)
    return cls()
