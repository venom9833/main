#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
output 폴더 → R2 자동 업로드 + JSON URL 갱신 + Supabase DB 동기화

비교 기준 (3단계):
  1. R2에 파일이 없으면          → 업로드
  2. 파일 크기(byte)가 다르면    → 재업로드
  3. 로컬 mtime > R2 LastModified → 재업로드 (더 최신 파일)

사용법:
  python upload_output.py <chapter_folder>

예시:
  python upload_output.py "C:/LinkDropV3/output/20260413_095022_ch01s04hc05/ch01"
"""
import json
import os
import sys
from datetime import timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# .env 로드 (프로젝트 루트)
_env_path = Path(__file__).parents[3] / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path)

R2_ENDPOINT          = os.environ["R2_ENDPOINT"]
R2_ACCESS_KEY_ID     = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_BUCKET            = os.environ["R2_BUCKET"]
R2_PUBLIC_URL        = os.environ["R2_PUBLIC_URL"].rstrip("/")

# 확장자 → Content-Type
_EXT_CONTENT_TYPE: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".srt": "text/plain",
}

# 확장자 → JSON/DB 필드명
_EXT_TO_FIELD: dict[str, str] = {
    ".png": "bg_url",
    ".mp3": "tts_url",
    ".wav": "wav_url",
    ".mp4": "clip_url",
    ".srt": "srt_url",
}

# 확장자 → R2 저장 파일명
_EXT_TO_R2_NAME: dict[str, str] = {
    ".png": "bg.png",
    ".mp3": "tts.mp3",
    ".wav": "tts.wav",
    ".mp4": "clip.mp4",
    ".srt": "tts.srt",
}

# 필드 → 상태값 (status 자동 갱신용)
_FIELD_TO_STATUS: dict[str, str] = {
    "bg_url":      "keyframe_done",
    "tts_url":     "tts_done",
    "wav_url":     "tts_done",
    "srt_url":     "tts_done",
    "clip_url":    "render_done",
    "lipsync_url": "render_done",
}

# 상태 우선순위 (높을수록 앞선 상태)
_STATUS_PRIORITY: dict[str, int] = {
    "pending":       0,
    "keyframe_done": 1,
    "short_skipped": 1,
    "tts_done":      2,
    "render_done":   3,
    "failed":       -1,
}


# ─────────────────────────────────────────────────────────────────────────────

def _make_s3():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    )


def _r2_key_from_url(url: str | None) -> str | None:
    """기존 R2 Public URL → R2 key 추출. 다른 도메인이면 None."""
    if not url:
        return None
    prefix = R2_PUBLIC_URL + "/"
    if url.startswith(prefix):
        return url[len(prefix):]
    return None


def _needs_upload(s3, key: str, local: Path) -> tuple[bool, str]:
    """업로드 필요 여부 — (필요, 이유 메시지)"""
    local_size  = local.stat().st_size
    local_mtime = local.stat().st_mtime

    try:
        head     = s3.head_object(Bucket=R2_BUCKET, Key=key)
        r2_size  = head["ContentLength"]
        r2_mtime = head["LastModified"].replace(tzinfo=timezone.utc).timestamp()

        if local_size != r2_size:
            return True, f"크기 불일치 (로컬 {local_size:,}B ↔ R2 {r2_size:,}B)"
        if local_mtime > r2_mtime + 2:   # 2초 오차 허용
            delta = int(local_mtime - r2_mtime)
            return True, f"로컬이 더 최신 (+{delta}초)"
        return False, f"동일 (크기 {local_size:,}B)"

    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("404", "NoSuchKey"):
            return True, "R2에 없음"
        raise


def _upload(s3, key: str, local: Path) -> str:
    """파일 → R2 업로드 → Public URL 반환"""
    ext = local.suffix.lower()
    ct  = _EXT_CONTENT_TYPE.get(ext, "application/octet-stream")
    s3.upload_file(
        str(local),
        R2_BUCKET,
        key,
        ExtraArgs={"ContentType": ct},
    )
    return f"{R2_PUBLIC_URL}/{key}"


# ─────────────────────────────────────────────────────────────────────────────

def run(folder: Path):
    chapter_name = folder.name          # "ch01"
    json_path    = folder / f"{chapter_name}.json"

    if not json_path.exists():
        sys.exit(f"[ERROR] JSON 파일 없음: {json_path}")

    scenes: list[dict] = json.loads(json_path.read_text(encoding="utf-8"))
    if not scenes:
        sys.exit("[ERROR] JSON이 비어 있음")

    series_id = scenes[0].get("series_id")
    if not series_id:
        sys.exit("[ERROR] series_id를 JSON에서 찾을 수 없음")

    print(f"series_id : {series_id}")
    print(f"scenes    : {len(scenes)}개")
    print(f"폴더      : {folder}\n")

    # scene_code → 인덱스 매핑
    code_to_idx: dict[str, int] = {s["scene_code"]: i for i, s in enumerate(scenes)}

    # 업로드 대상 파일 수집 (지원 확장자만)
    targets = sorted(
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in _EXT_TO_FIELD
    )
    print(f"파일 {len(targets)}개 분석 중...\n")

    s3 = _make_s3()

    # scene_id → {field: url, ...}  (Supabase 업데이트용)
    db_updates: dict[str, dict] = {}
    stats = {"skip": 0, "upload": 0, "no_match": 0}

    for file in targets:
        ext        = file.suffix.lower()
        scene_code = file.stem          # 타임스탬프 포함 전체 코드 = scene_code
        field      = _EXT_TO_FIELD[ext]

        idx = code_to_idx.get(scene_code)
        if idx is None:
            print(f"  [SKIP] {file.name}  — scene_code 매칭 없음")
            stats["no_match"] += 1
            continue

        scene = scenes[idx]

        # R2 key 결정: 기존 URL의 key 재사용 → 없으면 신규 경로 생성
        existing_url = scene.get(field)
        r2_key = _r2_key_from_url(existing_url) or \
                 f"series/{series_id}/scenes/{scene_code}/{_EXT_TO_R2_NAME[ext]}"

        needed, reason = _needs_upload(s3, r2_key, file)

        if not needed:
            print(f"  [--] {file.name:<45}  {reason}")
            stats["skip"] += 1
            continue

        print(f"  [UP] {file.name:<45}  {reason}")
        try:
            url = _upload(s3, r2_key, file)
            scenes[idx][field] = url

            # 상태 자동 갱신 (현재 상태보다 높을 때만)
            new_status = _FIELD_TO_STATUS.get(field)
            if new_status:
                cur_status   = scene.get("status", "pending")
                cur_priority = _STATUS_PRIORITY.get(cur_status, 0)
                new_priority = _STATUS_PRIORITY.get(new_status, 0)
                if new_priority > cur_priority:
                    scenes[idx]["status"] = new_status
                    new_status_tag = new_status
                else:
                    new_status_tag = None
            else:
                new_status_tag = None

            # DB 업데이트 수집
            sid = scene["id"]
            if sid not in db_updates:
                db_updates[sid] = {}
            db_updates[sid][field] = url
            if new_status_tag:
                db_updates[sid]["status"] = new_status_tag

            stats["upload"] += 1
            print(f"       → {url}")

        except Exception as e:
            print(f"  [ERR] {file.name}  업로드 실패: {e}")

    # ── JSON 저장 ──────────────────────────────────────────────────────────────
    json_path.write_text(
        json.dumps(scenes, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n[JSON] 저장 완료: {json_path}")

    # ── Supabase DB 동기화 ─────────────────────────────────────────────────────
    if db_updates:
        _sync_db(db_updates)

    # ── 요약 ──────────────────────────────────────────────────────────────────
    print(f"\n{'─'*55}")
    print(f"  업로드  : {stats['upload']}개")
    print(f"  스킵    : {stats['skip']}개  (변경 없음)")
    print(f"  미매칭  : {stats['no_match']}개  (JSON에 scene_code 없음)")
    print(f"{'─'*55}")


def _sync_db(updates: dict[str, dict]):
    """v3_scenes 테이블 일괄 업데이트"""
    try:
        sys.path.insert(0, str(Path(__file__).parents[1]))
        from core.database import get_supabase
        db = get_supabase()
        for scene_id, fields in updates.items():
            db.table("v3_scenes").update(fields).eq("id", scene_id).execute()
            print(f"  [DB] {scene_id[:8]}...  {list(fields.keys())}")
        print(f"[DB] Supabase 동기화 완료 ({len(updates)}개 씬)")
    except Exception as e:
        print(f"  [WARN] Supabase 동기화 실패: {e}")
        print("         JSON만 갱신됨 — DB는 수동 확인 필요")


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    target = Path(sys.argv[1])
    if not target.is_dir():
        sys.exit(f"[ERROR] 폴더 없음: {target}")

    run(target)
