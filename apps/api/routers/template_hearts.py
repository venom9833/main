"""템플릿 하트 — data/template-hearts.json 파일 기반 읽기/쓰기"""
import json
import pathlib
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/template-hearts", tags=["template-hearts"])

_HEARTS_FILE = pathlib.Path(__file__).parent.parent / "data" / "template-hearts.json"
_MAX = 5


def _read() -> dict:
    if not _HEARTS_FILE.exists():
        return {}
    try:
        return json.loads(_HEARTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write(data: dict) -> None:
    _HEARTS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@router.get("")
def get_hearts():
    """전체 하트 맵 반환 — { "template/id": count }"""
    return _read()


@router.post("/{template_id:path}/add")
def add_heart(template_id: str):
    """하트 1 추가 (최대 5). 반환: { "id": ..., "count": N }"""
    data = _read()
    cur = data.get(template_id, 0)
    if cur < _MAX:
        data[template_id] = cur + 1
        _write(data)
    return {"id": template_id, "count": data[template_id]}
