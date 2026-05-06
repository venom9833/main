"""
프롬프트 하트 평점 라우터 (prompt_ratings.py)

저장 방식: data/prompt_hearts.json 파일 — { "A01": 3, "IP0762": 5, ... }
API:
  GET  /api/v1/prompt-ratings          — 전체 하트 맵 반환
  POST /api/v1/prompt-ratings/{id}/set — 하트 설정 (0=삭제, 1~5=저장)
"""
import json
import pathlib
from fastapi import APIRouter
from pydantic import BaseModel, Field

# 라우터 등록 — prefix로 모든 URL 앞에 /api/v1/prompt-ratings 붙음
router = APIRouter(prefix="/api/v1/prompt-ratings", tags=["prompt-ratings"])

# 저장 파일 경로 — 이 파일(routers/) 기준 상위 폴더의 data/ 아래
_RATINGS_FILE = pathlib.Path(__file__).parent.parent / "data" / "prompt_hearts.json"


class SetBody(BaseModel):
    """하트 설정 요청 본문 — hearts: 0(삭제) 또는 1~5"""
    hearts: int = Field(ge=0, le=5, description="하트 개수 (0=삭제, 1~5)")


def _read() -> dict:
    """JSON 파일에서 하트 맵 읽기. 파일 없거나 파싱 실패 시 빈 딕셔너리 반환."""
    if not _RATINGS_FILE.exists():
        return {}
    try:
        return json.loads(_RATINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write(data: dict) -> None:
    """하트 맵을 JSON 파일에 저장. sort_keys=True로 항상 정렬된 상태 유지."""
    _RATINGS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8"
    )


@router.get("")
def get_ratings():
    """전체 하트 맵 반환 — { "A01": 3, "IP0762": 5, ... }"""
    return _read()


@router.post("/{prompt_id:path}/set")
def set_rating(prompt_id: str, body: SetBody):
    """
    하트 설정.
    - hearts = 0 : 해당 ID 삭제 (평점 취소)
    - hearts = 1~5 : 해당 ID에 하트 개수 저장 (덮어쓰기)

    prompt_id에 슬래시(/)가 포함될 수 있어 :path 라우터 패턴 사용.
    """
    data = _read()
    if body.hearts == 0:
        # 평점 취소 — 해당 키 삭제
        data.pop(prompt_id, None)
    else:
        # 평점 저장 — 기존값 덮어쓰기
        data[prompt_id] = body.hearts
    _write(data)
    return {"id": prompt_id, "hearts": body.hearts}
