"""
이미지 프롬프트 R2 업로드 스크립트 (img_prompt_r2_upload.py)

역할:
  D:\img_prompt\ 의 수집 결과물을 Cloudflare R2 에 업로드.
  멱등 동작 — 이미 존재하는 키는 HEAD 200 확인 후 skip (--force 없으면).

업로드 대상:
  D:\img_prompt\index_img.json     → V2/img_prompt/index_img.json
  D:\img_prompt\thumbs\IP*.jpg    → V2/img_prompt/thumbs/IP*.jpg
  D:\img_prompt\detail\IP*.json   → V2/img_prompt/detail/IP*.json

캐시 제어:
  index_img.json   → Cache-Control: public, max-age=300  (5분, 자주 갱신 가능)
  thumbs/*.jpg     → Cache-Control: public, max-age=2592000 (30일, 불변)
  detail/*.json    → Cache-Control: public, max-age=2592000 (30일, 불변)

실행:
  cd apps/api
  python -X utf8 services/img_prompt_r2_upload.py            # skip 기존 파일
  python -X utf8 services/img_prompt_r2_upload.py --force    # 모두 재업로드

설계 문서: archives/69_이미지_프롬프트_기능.md
"""
import argparse
import mimetypes
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# ── 경로 설정 ─────────────────────────────────────────────────────────────────
SAVE_DIR   = Path(r"D:\img_prompt")
THUMB_DIR  = SAVE_DIR / "thumbs"
DETAIL_DIR = SAVE_DIR / "detail"
INDEX_FILE = SAVE_DIR / "index_img.json"

# R2 경로 접두사 (버킷 내 폴더)
R2_PREFIX = "V2/img_prompt"


def _get_r2_client():
    """settings 에서 R2 자격증명을 읽어 boto3 S3 클라이언트 반환."""
    import sys, os
    # apps/api 기준으로 실행되므로 상위 경로 추가 불필요
    # config.py 에서 .env 경로를 자동 탐색
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from core.config import settings

    if not settings.R2_ENDPOINT:
        print("[오류] R2_ENDPOINT 환경 변수 미설정 (.env 확인)")
        sys.exit(1)
    if not settings.R2_ACCESS_KEY_ID or not settings.R2_SECRET_ACCESS_KEY:
        print("[오류] R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY 환경 변수 미설정")
        sys.exit(1)

    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    ), settings.R2_BUCKET


def _exists_in_r2(client, bucket: str, key: str) -> bool:
    """HEAD 요청으로 키 존재 여부 확인."""
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return False
        raise


def _upload_file(
    client,
    bucket: str,
    local_path: Path,
    r2_key: str,
    cache_control: str,
    force: bool,
    stats: dict,
):
    """파일 1개 업로드. --force 없으면 이미 존재하는 파일 skip."""
    if not force and _exists_in_r2(client, bucket, r2_key):
        stats["skipped"] += 1
        return

    content_type, _ = mimetypes.guess_type(str(local_path))
    if not content_type:
        content_type = "application/octet-stream"

    try:
        client.upload_file(
            Filename=str(local_path),
            Bucket=bucket,
            Key=r2_key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": cache_control,
            },
        )
        stats["uploaded"] += 1
        print(f"  ✓ {r2_key}")
    except Exception as e:
        stats["failed"] += 1
        print(f"  ✗ {r2_key} — {e}")


def run_upload(force: bool):
    """전체 업로드 실행."""
    client, bucket = _get_r2_client()

    stats = {"uploaded": 0, "skipped": 0, "failed": 0}

    # ── 1. index_img.json ─────────────────────────────────────────────────────
    if not INDEX_FILE.exists():
        print(f"[오류] {INDEX_FILE} 없음 — --init 먼저 실행")
        sys.exit(1)

    print(f"\n[1/3] index_img.json 업로드 → {R2_PREFIX}/index_img.json")
    _upload_file(
        client, bucket,
        local_path=INDEX_FILE,
        r2_key=f"{R2_PREFIX}/index_img.json",
        cache_control="public, max-age=300",
        force=force,
        stats=stats,
    )

    # ── 2. thumbs/IP*.jpg ────────────────────────────────────────────────────
    thumb_files = sorted(THUMB_DIR.glob("IP*.jpg")) if THUMB_DIR.exists() else []
    print(f"\n[2/3] 썸네일 {len(thumb_files)}개 업로드 → {R2_PREFIX}/thumbs/")
    for f in thumb_files:
        _upload_file(
            client, bucket,
            local_path=f,
            r2_key=f"{R2_PREFIX}/thumbs/{f.name}",
            cache_control="public, max-age=2592000",
            force=force,
            stats=stats,
        )

    # ── 3. detail/IP*.json ───────────────────────────────────────────────────
    detail_files = sorted(DETAIL_DIR.glob("IP*.json")) if DETAIL_DIR.exists() else []
    print(f"\n[3/3] detail JSON {len(detail_files)}개 업로드 → {R2_PREFIX}/detail/")
    for f in detail_files:
        _upload_file(
            client, bucket,
            local_path=f,
            r2_key=f"{R2_PREFIX}/detail/{f.name}",
            cache_control="public, max-age=2592000",
            force=force,
            stats=stats,
        )

    # ── 완료 요약 ─────────────────────────────────────────────────────────────
    total = stats["uploaded"] + stats["skipped"] + stats["failed"]
    print(f"\n{'='*50}")
    print(f"업로드 완료: 총 {total}개")
    print(f"  ✓ 업로드: {stats['uploaded']}개")
    print(f"  → skip:   {stats['skipped']}개 (이미 존재)")
    print(f"  ✗ 실패:   {stats['failed']}개")
    if stats["failed"] > 0:
        print("실패 항목이 있습니다. 재실행하거나 --force 로 재업로드하세요.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="이미지 프롬프트 R2 업로드")
    parser.add_argument(
        "--force", action="store_true",
        help="이미 존재하는 파일도 강제 재업로드"
    )
    args = parser.parse_args()
    run_upload(force=args.force)
