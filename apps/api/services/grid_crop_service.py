"""grid_crop_service.py — 2x2 그리드 이미지 정밀 크롭 (1px 단위)

패널 배치:
  c01 (좌상) | c02 (우상)
  -----------+----------
  c03 (좌하) | c04 (우하)

크롭 기준:
  cut_x = W // 2   (홀수 폭: 좌패널이 1px 더 넓음)
  cut_y = H // 2   (홀수 높이: 상패널이 1px 더 높음)

  c01: (0,     0,     cut_x, cut_y)
  c02: (cut_x, 0,     W,     cut_y)
  c03: (0,     cut_y, cut_x, H    )
  c04: (cut_x, cut_y, W,     H    )

파일명 규칙:
  DB scene_code(타임스탬프·ch## 포함)와 무관하게 s##nc## 형식만 사용.
  예: s02nc01.png  (ch01s02nc01, 20260413_095022_ch01s02nc01 모두 → s02nc01)
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path
from typing import NamedTuple

import boto3
from PIL import Image
from core.config import settings

# kenburns 파이프라인과 동일한 output 루트
OUTPUT_ROOT = Path(__file__).parent.parent.parent.parent / "output"
_OUT_W, _OUT_H = 1920, 1080


# ── R2 클라이언트 ─────────────────────────────────────────────────────────────

def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
    )


def _r2_upload(data: bytes, r2_key: str) -> str:
    """PNG bytes → R2 업로드 → public URL 반환"""
    bucket = settings.R2_BUCKET
    pub_url = settings.R2_PUBLIC_URL.rstrip("/")
    s3 = _r2_client()
    s3.put_object(
        Bucket=bucket,
        Key=r2_key,
        Body=data,
        ContentType="image/png",
    )
    return f"{pub_url}/{r2_key}"


# ── scene_code 정규화 ─────────────────────────────────────────────────────────

_SC_PATTERN_FULL = re.compile(r"(ch\d+s\d+[a-z]+\d+)$", re.IGNORECASE)
_SC_PATTERN_SHORT = re.compile(r"(s\d+[a-z]+\d+)$", re.IGNORECASE)


def _normalize_scene_code(scene_code: str) -> str:
    """타임스탬프 prefix 제거 → ch##s##nc## 형식 반환.

    예: "20260413_095022_ch01s02nc01" → "ch01s02nc01"
        "ch01s02nc01"                 → "ch01s02nc01"
        "s02nc01"                     → "s02nc01"  (ch 없으면 그대로)
    """
    m = _SC_PATTERN_FULL.search(scene_code)
    if m:
        return m.group(1).lower()
    m = _SC_PATTERN_SHORT.search(scene_code)
    return m.group(1).lower() if m else scene_code


# ── 크롭 좌표 계산 ────────────────────────────────────────────────────────────

class CropCoords(NamedTuple):
    left: int
    top: int
    right: int
    bottom: int


def calc_crop_coords(
    w: int, h: int, inner_trim: int = 0
) -> tuple[CropCoords, CropCoords, CropCoords, CropCoords]:
    """그리드 이미지 크기(w, h)로 4개 크롭 좌표를 계산한다.

    inner_trim: AI가 생성한 패널 구분선(separator) 픽셀을 제거하기 위해
                내부 경계(패널이 맞닿는 가장자리)에서만 트림할 픽셀 수.
                외부 가장자리(이미지 테두리)는 트림하지 않는다.
                일반적으로 4~8 px 설정.

    예) inner_trim=6, w=2752, h=1536:
        cx=1376, cy=768
        c01: (0, 0, 1370, 762)  ← 오른쪽·아래 6px 제거
        c02: (1382, 0, 2752, 762) ← 왼쪽·아래 6px 제거
    """
    cx = w // 2
    cy = h // 2
    t = inner_trim
    c01 = CropCoords(0,      0,      cx - t, cy - t)  # 좌상: 우·하 trim
    c02 = CropCoords(cx + t, 0,      w,      cy - t)  # 우상: 좌·하 trim
    c03 = CropCoords(0,      cy + t, cx - t, h)       # 좌하: 우·상 trim
    c04 = CropCoords(cx + t, cy + t, w,      h)       # 우하: 좌·상 trim
    return c01, c02, c03, c04


# ── 메인 함수 ─────────────────────────────────────────────────────────────────

class CropResult:
    def __init__(self, scene_code: str, url: str, width: int, height: int):
        self.scene_code = scene_code   # 정규화된 ch##s##nc## 코드
        self.url = url                 # R2 public URL
        self.width = width
        self.height = height

    def to_dict(self) -> dict:
        return {
            "scene_code": self.scene_code,
            "url": self.url,
            "width": self.width,
            "height": self.height,
        }


def crop_grid(
    grid_bytes: bytes,
    series_id: str,
    scene_codes: list[str],
    r2_prefix: str = "v3",
    series_code: str = "",
    inner_trim: int = 8,
) -> list[CropResult]:
    """2x2 그리드 이미지를 4등분 크롭 → 1920×1080 리사이즈 → R2 업로드 + 로컬 저장.

    Args:
        grid_bytes:   그리드 PNG bytes (가로 2 × 세로 2 패널)
        series_id:    시리즈 UUID
        scene_codes:  최대 4개 scene_code 리스트 (DB 원본 코드 OK — 자동 정규화)
        r2_prefix:    R2 경로 prefix (기본: "v3")
        series_code:  로컬 output 경로용 시리즈 코드
                      (제공 시 OUTPUT_ROOT/{series_code}/ch{N}/{norm_code}.png 저장)
        inner_trim:   패널 구분선 제거를 위해 내부 경계에서 트림할 픽셀 수.
                      이미지 해상도에 관계없이 비율로 자동 조정됨 (기본 8px @ 2752px 기준).

    Returns:
        CropResult 리스트 (scene_code 순서 보장, 최대 4개, 1920×1080)

    크롭 파일명: {r2_prefix}/{series_id}/keyframes/{norm_code}.png
      예: v3/abc-123/keyframes/s02nc01.png
    """
    img = Image.open(io.BytesIO(grid_bytes)).convert("RGBA")
    w, h = img.size

    # 해상도 기준(2752px) 대비 비율로 trim 스케일 조정 — 1K/2K 모두 동일 비율 제거
    trim_scaled = max(1, round(inner_trim * w / 2752))
    coords = calc_crop_coords(w, h, inner_trim=trim_scaled)

    results: list[CropResult] = []

    for i, sc in enumerate(scene_codes[:4]):
        norm_code = _normalize_scene_code(sc)
        box = coords[i]

        cell = img.crop(box)

        # 1920×1080 리사이즈 (LANCZOS — kenburns 파이프라인 입력 표준)
        cell_hd = cell.resize((_OUT_W, _OUT_H), Image.LANCZOS)

        # PNG bytes 변환
        buf = io.BytesIO()
        cell_hd.save(buf, format="PNG", optimize=False)
        cell_bytes = buf.getvalue()

        # R2 업로드: v3/{series_id}/keyframes/s##nc##.png
        r2_key = f"{r2_prefix}/{series_id}/keyframes/{norm_code}.png"
        url = _r2_upload(cell_bytes, r2_key)

        # 로컬 저장: OUTPUT_ROOT/{series_code}/ch{N}/{norm_code}.png
        if series_code:
            ch_m = re.search(r"ch(\d+)", norm_code, re.IGNORECASE)
            chapter = int(ch_m.group(1)) if ch_m else 1
            out_dir = OUTPUT_ROOT / series_code / f"ch{chapter:02d}"
            out_dir.mkdir(parents=True, exist_ok=True)
            cell_hd.save(out_dir / f"{norm_code}.png", format="PNG")

        results.append(CropResult(
            scene_code=norm_code,
            url=url,
            width=_OUT_W,
            height=_OUT_H,
        ))

    return results


# ── 그리드 원본 저장 (디버깅/재크롭용) ──────────────────────────────────────

def save_grid_to_r2(
    grid_bytes: bytes,
    series_id: str,
    chapter: int,
    scene_index: int,
    r2_prefix: str = "v3",
) -> str:
    """그리드 원본 이미지를 R2에 저장하고 URL을 반환한다.

    경로: {r2_prefix}/{series_id}/keyframes/ch{chapter:02d}_s{scene_index:02d}_grid.png
    """
    r2_key = f"{r2_prefix}/{series_id}/keyframes/ch{chapter:02d}_s{scene_index:02d}_grid.png"
    return _r2_upload(grid_bytes, r2_key)


# ── 로컬 테스트 헬퍼 (R2 없이 로컬 파일로 크롭 검증) ─────────────────────────

def crop_grid_local(
    grid_path: str,
    out_dir: str,
    scene_codes: list[str] | None = None,
    inner_trim: int = 8,
) -> list[dict]:
    """R2 없이 로컬에서 크롭 검증용.

    Args:
        grid_path:   그리드 이미지 로컬 경로
        out_dir:     크롭 결과 저장 디렉터리
        scene_codes: None이면 c01~c04 기본 사용
        inner_trim:  패널 구분선 제거 픽셀 수 (2752px 기준, 자동 스케일)

    Returns:
        [{"scene_code": str, "path": str, "width": int, "height": int}, ...]
    """
    if scene_codes is None:
        scene_codes = ["c01", "c02", "c03", "c04"]

    img = Image.open(grid_path).convert("RGBA")
    w, h = img.size
    trim_scaled = max(1, round(inner_trim * w / 2752))
    coords = calc_crop_coords(w, h, inner_trim=trim_scaled)

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    results = []

    for i, sc in enumerate(scene_codes[:4]):
        norm_code = _normalize_scene_code(sc)
        box = coords[i]
        cell = img.crop(box)
        out_path = str(Path(out_dir) / f"{norm_code}.png")
        cell.save(out_path, format="PNG")
        cw, ch_ = cell.size
        results.append({"scene_code": norm_code, "path": out_path, "width": cw, "height": ch_})
        print(f"  [{norm_code}] box={box} → {cw}x{ch_} → {out_path}")

    return results


if __name__ == "__main__":
    # 사용법: python grid_crop_service.py <grid_image_path> <out_dir>
    import sys
    if len(sys.argv) >= 3:
        res = crop_grid_local(sys.argv[1], sys.argv[2])
        print("완료:", res)
    else:
        print("사용법: python grid_crop_service.py <grid.png> <out_dir>")
