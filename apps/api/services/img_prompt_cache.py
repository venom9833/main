"""
이미지 프롬프트 메모리 캐시 서비스 (img_prompt_cache.py)

역할:
  D:\img_prompt\index_img.json (경량 메타) 을 서버 startup 시 1회 로드.
  content/args 는 포함하지 않음 — 상세 내용은 detail/IP*.json 에서 별도 제공.

아키텍처 결정:
  - index_img.json 은 content/args 없는 경량 메타만 보관 (메모리 절약)
  - detail 데이터는 GET /api/v1/img-prompts/{master_no} 에서 on-demand 반환
  - 검색 기능 없음 (index에 content 없으므로 full-text 검색 불가)

설계 문서: archives/69_이미지_프롬프트_기능.md
"""
from __future__ import annotations

import json
from pathlib import Path

from core.config import settings

# ── 전역 캐시 변수 (None이면 아직 로드 전) ──────────────────────────────────
_INDEX: dict | None = None

# 로컬 JSON 파일 경로
_LOCAL_INDEX_PATH = Path(r"D:\img_prompt\index_img.json")

# 로컬 썸네일 루트 (D:\img_prompt\)
_LOCAL_THUMB_ROOT = Path(r"D:\img_prompt")

# 지원 확장자 탐색 순서
_THUMB_EXTS = (".jpg", ".jpeg", ".png")

# R2 퍼블릭 URL 기준 썸네일 서빙 접두사
# flux-bg-library 버킷 → V2/img_prompt/ 경로
_THUMB_URL_BASE = settings.R2_PUBLIC_URL.rstrip("/") + "/V2/img_prompt"


def _build_thumb_url(stored: str) -> str:
    """
    썸네일 URL을 결정한다.

    로컬 파일이 존재하면 → /img-prompts-static/{resolved} (로컬 static 서빙)
    로컬에 없으면       → R2 URL/{stored}               (R2 업로드된 파일)

    .jpg → .jpeg → .png 순서로 로컬 탐색.
    """
    if not stored:
        return ""
    p = Path(stored)
    for ext in _THUMB_EXTS:
        candidate = _LOCAL_THUMB_ROOT / p.parent / f"{p.stem}{ext}"
        if candidate.exists():
            resolved = f"{p.parent}/{p.stem}{ext}"
            return f"http://localhost:8001/img-prompts-static/{resolved}"
    # 로컬에 없으면 R2 URL (기존 761건)
    return f"{_THUMB_URL_BASE}/{stored}"


def load_index() -> dict:
    """
    index_img.json 파일을 읽어 반환.
    파일이 없으면 빈 인덱스 반환 (서버 시작 실패 방지).
    """
    if not _LOCAL_INDEX_PATH.exists():
        print(f"[img-prompts] 인덱스 파일 없음: {_LOCAL_INDEX_PATH}")
        return {
            "version": "",
            "totalCount": 0,
            "categoryLabels": {},
            "prompts": [],
        }
    raw = _LOCAL_INDEX_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    print(f"[img-prompts] 인덱스 로드: {data.get('totalCount', 0)}건 (v{data.get('version', '?')})")
    return data


def get_index() -> dict:
    """
    캐시된 인덱스 반환.
    최초 호출 시 load_index() 실행 후 메모리에 보관, 이후 재사용.
    """
    global _INDEX
    if _INDEX is None:
        _INDEX = load_index()
    return _INDEX


def reload_index() -> dict:
    """캐시를 강제 초기화하고 파일에서 재로드한다."""
    global _INDEX
    _INDEX = None
    return get_index()


def get_categories() -> list[dict]:
    """
    카테고리 목록 반환.
    각 카테고리의 프롬프트 개수를 집계하여 함께 반환.

    반환 형태:
    [{"id": "poster-flyer", "label": "포스터/전단", "emoji": "...", "count": 42}, ...]
    """
    idx = get_index()
    prompts = idx.get("prompts", [])
    cat_labels: dict[str, dict] = idx.get("categoryLabels", {})

    # 카테고리별 프롬프트 개수 집계
    count_map: dict[str, int] = {}
    for p in prompts:
        for cat_id in (p.get("categories") or []):
            count_map[cat_id] = count_map.get(cat_id, 0) + 1

    # categoryLabels 순서대로 반환
    result: list[dict] = []
    for cat_id, meta in cat_labels.items():
        cnt = count_map.get(cat_id, 0)
        if cnt == 0:
            continue  # 실제 프롬프트 없는 카테고리 제외
        result.append({
            "id": cat_id,
            "label": meta.get("label", cat_id),
            "emoji": meta.get("emoji", ""),
            "count": cnt,
        })

    # categoryLabels에 없는 카테고리도 누락 방지를 위해 추가
    known_ids = {r["id"] for r in result}
    for cat_id, cnt in count_map.items():
        if cat_id not in known_ids:
            result.append({
                "id": cat_id,
                "label": cat_id,  # 라벨 없으면 id 그대로 사용
                "emoji": "",
                "count": cnt,
            })

    return result


def filter_prompts(
    cat: str | None = None,
    featured: bool = False,
    page: int = 1,
    page_size: int = 60,
) -> dict:
    """
    메모리 필터 + 페이지네이션.

    content/args 는 포함하지 않음.
    상세 데이터는 GET /api/v1/img-prompts/{master_no} 에서 별도 제공.

    thumb_url 조립:
      {_THUMB_URL_BASE}/{item.thumb}
      예: http://localhost:8001/img-prompts-static/thumbs/IP0001.jpg

    반환:
    {
        "total": 849,
        "page": 1,
        "page_size": 60,
        "items": [...]
    }
    """
    idx = get_index()
    all_prompts: list[dict] = idx.get("prompts", [])

    # 1. 카테고리 필터
    if cat:
        all_prompts = [p for p in all_prompts if cat in (p.get("categories") or [])]

    # 2. featured 필터 (True이면 추천 항목만 반환)
    if featured:
        all_prompts = [p for p in all_prompts if p.get("featured")]

    total = len(all_prompts)

    # 페이지네이션 (1-indexed, 최대 100건 제한)
    page = max(1, page)
    page_size = min(max(1, page_size), 1000)  # 하트 정렬 모드에서 전체 로드 허용
    start = (page - 1) * page_size
    page_items = all_prompts[start:start + page_size]

    # 반환 아이템 구성 (thumb_url 조립 포함)
    items: list[dict] = []
    for p in page_items:
        thumb_url = _build_thumb_url(p.get("thumb") or "")
        items.append({
            "id": p.get("id", ""),
            "master_no": p.get("master_no", ""),
            "title": p.get("title", ""),
            "description": p.get("description", ""),
            "thumb_url": thumb_url,
            "categories": p.get("categories", []),
            "featured": p.get("featured", False),
        })

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }
