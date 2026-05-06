"""
이미지 프롬프트 수집 스크립트 (img_prompt_collector.py)

역할:
  prompts3.com/prompts.json 에서 ours=True 프롬프트를 수집.
  카테고리당 최대 100개, 마스터번호(IP{N:04d}) 부여.

실행:
  cd apps/api
  python -X utf8 services/img_prompt_collector.py --init
  python -X utf8 services/img_prompt_collector.py --category poster-flyer
  python -X utf8 services/img_prompt_collector.py --category all

저장 구조:
  D:\\img_prompt\\
    index_img.json          <- 경량 메타 (content/args 없음)
    master_map.json         <- 로컬 전용: id -> 전체 데이터 매핑
    thumbs\\IP0001.jpg ~    <- --category 실행 시 다운로드
    detail\\IP0001.json ~   <- --category 실행 시 생성 (content+args+image_url)

아키텍처 결정:
  - --init: 번호 부여만 (이미지 다운로드 없음)
  - --category: 해당 카테고리의 썸네일+detail JSON 다운로드
  - index_img.json: content/args 제외 (경량 메타만)
  - detail/IP*.json: 모달 열 때 on-demand fetch용 (content+args+image_url 포함)
  - master_map.json: 로컬 전용 중간 저장소 (--category가 참조)

설계 문서: archives/69_이미지_프롬프트_기능.md
"""
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# ── 상수 ──────────────────────────────────────────────────────────────────────
# prompts3.com 정적 JSON URL (버전 쿼리 불필요)
SOURCE_URL = "https://prompts3.com/prompts.json"

# 로컬 저장 디렉토리 구조
SAVE_DIR = Path(r"D:\img_prompt")
THUMB_DIR = SAVE_DIR / "thumbs"      # 썸네일 저장 폴더
DETAIL_DIR = SAVE_DIR / "detail"     # detail JSON 저장 폴더
INDEX_PATH = SAVE_DIR / "index_img.json"    # 경량 메타 인덱스
MASTER_MAP_PATH = SAVE_DIR / "master_map.json"  # 로컬 전용 전체 데이터 맵

# 카테고리당 최대 수집 건수 (전체 수집 시 한 카테고리가 너무 많지 않도록 제한)
MAX_PER_CATEGORY = 100


def _parse_args():
    """CLI 인수 파싱. --init 또는 --category 중 하나를 반드시 지정해야 함."""
    parser = argparse.ArgumentParser(description="이미지 프롬프트 수집 스크립트")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--init", action="store_true",
        help="전체 fetch -> 마스터번호 부여 -> index_img.json + master_map.json 저장 (이미지 다운로드 없음)"
    )
    group.add_argument(
        "--category", type=str, metavar="CAT_ID",
        help="특정 카테고리 썸네일+detail JSON 다운로드 (all=전체)"
    )
    return parser.parse_args()


def _fetch_raw(url: str) -> tuple[list[dict], dict]:
    """
    prompts3.com JSON 전체 다운로드.
    반환값: (prompts 배열, categoryLabels 딕셔너리)
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, */*",
        "Referer": "https://prompts3.com/",
    }
    print(f"[수집] {url} 요청 중...")
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError(f"예상과 다른 JSON 구조: {type(data)}")
    prompts = data.get("prompts", [])
    cat_labels = data.get("categoryLabels", {})
    return prompts, cat_labels


def _extract_args(content: str) -> list[dict]:
    """
    프롬프트 본문에서 {argument name="X" default="Y"} 패턴 추출.
    예: {argument name="브랜드명" default="내 브랜드"}
    -> [{"name": "브랜드명", "default": "내 브랜드"}]
    """
    pattern = r'\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}'
    return [
        {"name": m.group(1), "default": m.group(2)}
        for m in re.finditer(pattern, content)
    ]


def _abs_url(path: str, base: str = "https://prompts3.com") -> str:
    """
    상대 경로를 절대 URL로 변환.
    이미 http로 시작하면 그대로 반환.
    """
    if not path:
        return ""
    if path.startswith("http"):
        return path
    return f"{base}/{path.lstrip('/')}"


def _download_file(src_url: str, dest_path: Path) -> bool:
    """
    파일 1개 다운로드.
    - 이미 존재하면 skip (True 반환)
    - 실패해도 예외 raise 하지 않음 (전체 중단 방지)
    """
    if dest_path.exists():
        return True  # 이미 있으면 다운로드 skip
    if not src_url:
        return False  # URL 없으면 skip

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://prompts3.com/",
    }
    try:
        resp = requests.get(src_url, headers=headers, timeout=20)
        resp.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [경고] 다운로드 실패: {src_url} -> {e}")
        return False


def cmd_init():
    """
    --init 실행 로직.

    1. prompts3.com 전체 fetch
    2. ours=True 필터
    3. 카테고리당 최대 100개 선별 (1차 카테고리 기준)
    4. 마스터번호 부여 (IP0001~)
    5. index_img.json 저장 (경량 메타 — content/args 없음)
    6. master_map.json 저장 (로컬 전용 — 전체 데이터)

    이미지 다운로드는 --category 단계에서 수행.
    """
    # 저장 폴더 생성
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    DETAIL_DIR.mkdir(parents=True, exist_ok=True)

    # 1. 원본 데이터 수집
    all_prompts, cat_labels = _fetch_raw(SOURCE_URL)
    print(f"[init] 원본 총 {len(all_prompts)}건")

    # 2. ours=True 필터 (불리언 True 값만)
    ours_list = [p for p in all_prompts if p.get("ours") is True]
    print(f"[init] ours=True 필터 후 {len(ours_list)}건")

    # id 기준 알파벳 정렬 (마스터번호 안정성 보장 — 같은 데이터면 항상 같은 번호)
    ours_list.sort(key=lambda p: str(p.get("id", "")))

    # 3. 카테고리별 최대 100개 선별 (1차 카테고리 기준)
    cat_groups: dict[str, list] = {}
    for p in ours_list:
        cats = p.get("categories") or []
        if isinstance(cats, str):
            cats = [cats]
        primary = cats[0] if cats else "uncategorized"
        if primary not in cat_groups:
            cat_groups[primary] = []
        if len(cat_groups[primary]) < MAX_PER_CATEGORY:
            cat_groups[primary].append(p)

    # 카테고리 순서대로 선별 목록 구성
    selected: list[tuple[str, dict]] = []
    for cat_id in cat_groups:
        for p in cat_groups[cat_id]:
            selected.append((cat_id, p))

    print(f"[init] 카테고리 {len(cat_groups)}개, 선별 {len(selected)}건")

    # 4. 마스터번호 부여 + index/master_map 데이터 구성
    master_map: dict = {}
    index_prompts: list[dict] = []

    for n, (primary_cat, p) in enumerate(selected, start=1):
        master_no = f"IP{n:04d}"
        item_id = str(p.get("id", f"item-{n}"))

        # 카테고리 목록 정규화
        cats = p.get("categories") or []
        if isinstance(cats, str):
            cats = [cats]
        categories = [str(c).strip() for c in cats if c]

        # content 및 args 추출
        content = p.get("content") or ""
        raw_args = p.get("args") or []
        if raw_args and isinstance(raw_args[0], dict):
            # 원본에 args 구조가 있으면 그대로 사용
            args = [
                {"name": str(a.get("name", "")), "default": str(a.get("default", ""))}
                for a in raw_args
            ]
        else:
            # content 본문에서 패턴으로 추출
            args = _extract_args(content)

        # 원본 이미지 URL 변환 (상대경로 -> 절대URL)
        thumb_orig = _abs_url(str(p.get("thumb") or ""))
        image_orig = _abs_url(str(p.get("image") or ""))
        local_thumb_key = f"thumbs/{master_no}.jpg"

        # master_map: 전체 데이터 보관 (--category 단계에서 참조)
        # content/args/image_url 포함 — 로컬 전용 파일, R2/프론트에 노출 안 됨
        master_map[item_id] = {
            "master_no": master_no,
            "title": str(p.get("title") or f"프롬프트 {master_no}"),
            "description": str(p.get("description") or ""),
            "content": content,
            "args": args,
            "thumb_orig_url": thumb_orig,    # 원본 썸네일 URL (다운로드용)
            "image_url": image_orig,         # 원본 고해상도 이미지 URL
            "thumb": local_thumb_key,        # 로컬 저장 키
            "categories": categories,
            "featured": bool(p.get("featured")),
        }

        # index_img.json: 경량 메타만 (content/args/image_url 제외)
        # 서버 startup 시 전체를 메모리에 올리므로 용량 최소화
        index_prompts.append({
            "id": item_id,
            "master_no": master_no,
            "title": str(p.get("title") or f"프롬프트 {master_no}"),
            "description": str(p.get("description") or ""),
            "thumb": local_thumb_key,
            "categories": categories,
            "featured": bool(p.get("featured")),
        })

    # 5. index_img.json 저장
    today = time.strftime("%Y%m%d")
    index_data = {
        "version": today,
        "totalCount": len(index_prompts),
        "categoryLabels": cat_labels,   # 카테고리 라벨/이모지 포함
        "prompts": index_prompts,
    }
    INDEX_PATH.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"[init] index_img.json 저장: {INDEX_PATH} ({len(index_prompts)}건)")

    # 6. master_map.json 저장 (로컬 전용 — R2 업로드 대상 아님)
    MASTER_MAP_PATH.write_text(
        json.dumps(master_map, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"[init] master_map.json 저장: {MASTER_MAP_PATH} ({len(master_map)}건)")
    print("\n--init 완료. 다음 단계: python collector.py --category <카테고리ID>")


def cmd_category(cat_id: str):
    """
    --category <id|all> 실행 로직.

    master_map.json 을 참조하여 해당 카테고리 아이템의:
    - thumbs/IP*.jpg 썸네일 다운로드
    - detail/IP*.json 생성 (content + args + image_url)

    all 지정 시 전체 카테고리 처리.
    """
    if not MASTER_MAP_PATH.exists():
        print("[오류] master_map.json 없음 — 먼저 --init 실행")
        return

    # master_map 로드
    master_map: dict = json.loads(MASTER_MAP_PATH.read_text(encoding="utf-8"))
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    DETAIL_DIR.mkdir(parents=True, exist_ok=True)

    # 대상 아이템 필터 (all이면 전체)
    if cat_id == "all":
        targets = list(master_map.values())
        label = "전체"
    else:
        targets = [v for v in master_map.values() if cat_id in (v.get("categories") or [])]
        label = cat_id

    print(f"[category:{label}] 대상 {len(targets)}건")

    if not targets:
        print(f"  [경고] 카테고리 '{cat_id}' 에 해당하는 아이템 없음")
        return

    # 썸네일 병렬 다운로드 (5 workers)
    # thumb_orig_url: 원본 사이트 URL / 로컬 저장 경로: thumbs/IP{N:04d}.jpg
    thumb_tasks = [
        (v["thumb_orig_url"], THUMB_DIR / f"{v['master_no']}.jpg")
        for v in targets if v.get("thumb_orig_url")
    ]

    ok, fail = 0, 0
    with ThreadPoolExecutor(max_workers=5) as ex:
        fmap = {
            ex.submit(_download_file, src, dest): (src, dest)
            for src, dest in thumb_tasks
        }
        for future in as_completed(fmap):
            try:
                if future.result():
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                print(f"  [경고] 썸네일 예외: {e}")
                fail += 1

    print(f"[category:{label}] 썸네일 완료: 성공={ok}, 실패={fail}")

    # detail JSON 저장
    # 모달 열 때 on-demand fetch 되는 파일 (content+args+image_url만 포함)
    detail_ok = 0
    for v in targets:
        master_no = v["master_no"]
        dest = DETAIL_DIR / f"{master_no}.json"
        if dest.exists():
            # 이미 존재하면 skip (멱등 동작)
            detail_ok += 1
            continue
        detail_data = {
            "content": v.get("content", ""),
            "args": v.get("args", []),
            "image_url": v.get("image_url", ""),
        }
        dest.write_text(
            json.dumps(detail_data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        detail_ok += 1

    print(f"[category:{label}] detail JSON 완료: {detail_ok}건")
    print(f"\n--category {cat_id} 완료.")


if __name__ == "__main__":
    # Python -X utf8 플래그로 실행 권장 (Windows CP949 인코딩 방지)
    args = _parse_args()
    if args.init:
        cmd_init()
    else:
        cmd_category(args.category)
