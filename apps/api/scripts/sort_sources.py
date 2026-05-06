"""
source-pdf/_inbox/ 자동 분류 스크립트
--------------------------------------
사용자가 _inbox/ 폴더에 파일을 던져 넣으면:
  1. 파일 텍스트 추출 (txt / md / pdf / srt / vtt 지원)
  2. 파일명 + 본문 앞 2,000자를 LLM에 전달해 랜딩 카테고리 분류
  3. 분류 결과에 따라 source-pdf/landing1~9 또는 common 폴더로 이동
  4. confidence < 0.6이면 _inbox/_review/ 로 이동 (수동 검토 필요)
  5. _sorted/sort_log.json 에 처리 이력 기록

실행: cd C:\LinkDropV3\apps\api && python -X utf8 scripts/sort_sources.py
LD-011 준수: call_free_llm (Cerebras → Gemini-Free 폴백 체인) 사용
"""

import asyncio
import json
import sys
import shutil
from datetime import datetime
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────────────────
# 이 스크립트가 있는 위치(apps/api/scripts)를 기준으로 apps/api를 sys.path에 추가
# 그래야 services.pdf_service, services.gemini_helper 등을 import 할 수 있음
_SCRIPT_DIR = Path(__file__).resolve().parent          # …/apps/api/scripts
_API_DIR    = _SCRIPT_DIR.parent                       # …/apps/api
_ROOT_DIR   = _API_DIR.parent.parent                   # C:\LinkDropV3

if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

# source-pdf 폴더 위치 (프로젝트 루트 기준)
_SOURCE_PDF_DIR = _ROOT_DIR / "source-pdf"
_INBOX_DIR      = _SOURCE_PDF_DIR / "_inbox"
_REVIEW_DIR     = _INBOX_DIR / "_review"
_SORTED_DIR     = _SOURCE_PDF_DIR / "_sorted"
_LOG_FILE       = _SORTED_DIR / "sort_log.json"

# 지원하는 파일 확장자 목록
_SUPPORTED_EXTS = {".txt", ".md", ".pdf", ".srt", ".vtt"}

# 카테고리 → 실제 폴더 이름 매핑
_CATEGORY_MAP: dict[str, str] = {
    "common":    "common",
    "landing1":  "landing1",
    "landing2":  "landing2",
    "landing3":  "landing3",
    "landing4":  "landing4",
    "landing5":  "landing5",
    "landing6":  "landing6",
    "landing7":  "landing7",
    "landing8":  "landing8",
    "landing9":  "landing9",
    "landing10": "landing10",
}

# ── LLM 분류 프롬프트 ──────────────────────────────────────────────────────
_CLASSIFY_PROMPT_TEMPLATE = """당신은 콘텐츠 자료 분류 전문가입니다.

아래 10개 랜딩페이지 카테고리 중 이 자료가 어디에 해당하는지 판단하세요:
- common: 3개 이상 랜딩에서 공통 활용 가능한 자료 (AI 도구, 수익화 기초, 1인 비즈니스, 마케팅 등)
- landing1: 웹소설 작가, 블로그·브런치 연재, 월수익
- landing2: 전자책 출간, 나만의 경험·노하우로 책 쓰기, ChatGPT 목차·초안
- landing3: 동화책 제작, AI 그림·글 생성, 어린이 책
- landing4: AI 기초 활용 강의, 강의 스크립트·PPT 자동 생성, 온라인 클래스 운영
- landing5: 유튜브 쇼츠 제작, 자막·썸네일·스크립트 자동화, 경험담 영상화
- landing6: 바이브코딩, AI로 웹사이트·웹앱 만들기, 코딩 없이 서비스 런칭
- landing7: 디지털 구술 생애사, 시니어 인터뷰·기록, 생애사 책·영상 제작
- landing8: 지역 소상공인 SNS 관리 대행, 1인기업 마케팅·CS 자동화
- landing9: 트레이딩 노하우, 주식·암호화폐 자동매매, 커뮤니티 운영
- landing10: 온라인 부업 주제 발굴, 나에게 맞는 부업 찾기, 1인 창업 방향 설정

[파일명]: {filename}
[내용 앞부분]:
{content_preview}

반드시 JSON으로만 답하세요:
{{"category": "common" 또는 "landing1"~"landing9", "reason": "한 줄 이유", "confidence": 0.0~1.0}}"""


def _load_log() -> dict:
    """이전 처리 이력 로드 — 파일 없으면 빈 딕셔너리 반환"""
    if _LOG_FILE.exists():
        try:
            return json.loads(_LOG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            # 로그 파일이 손상된 경우 빈 이력으로 시작
            print("[경고] sort_log.json 파싱 실패 — 빈 이력으로 시작합니다.")
            return {}
    return {}


def _save_log(log: dict) -> None:
    """처리 이력을 JSON 파일에 저장"""
    _SORTED_DIR.mkdir(parents=True, exist_ok=True)
    _LOG_FILE.write_text(
        json.dumps(log, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _collect_inbox_files() -> list[Path]:
    """_inbox/ 폴더에서 지원 확장자 파일만 수집 (_review 하위 폴더 제외)"""
    files = []
    for f in _INBOX_DIR.iterdir():
        # 하위 폴더(예: _review)는 건너뜀
        if f.is_dir():
            continue
        if f.suffix.lower() in _SUPPORTED_EXTS:
            files.append(f)
    return sorted(files)


def _extract_text(filepath: Path) -> str:
    """파일에서 텍스트 추출 — pdf_service.extract_text_from_bytes 재사용"""
    from services.pdf_service import extract_text_from_bytes
    raw_bytes = filepath.read_bytes()
    return extract_text_from_bytes(filepath.name, raw_bytes)


def _build_classify_prompt(filename: str, text: str) -> str:
    """LLM에 전달할 분류 프롬프트 조립 — 본문 앞 2,000자만 사용"""
    preview = text[:2000].strip()
    return _CLASSIFY_PROMPT_TEMPLATE.format(
        filename=filename,
        content_preview=preview,
    )


async def _classify_file(filename: str, text: str) -> dict:
    """LLM 호출로 카테고리 결정 — call_free_llm 사용 (LD-011 무료 우선 원칙)

    반환 예시: {"category": "landing1", "reason": "웹소설 작가 관련 내용", "confidence": 0.85}
    LLM 응답이 JSON 파싱 불가 시 {"category": "_error", "reason": "파싱 실패", "confidence": 0.0} 반환
    """
    from services.gemini_helper import call_free_llm, extract_json

    prompt = _build_classify_prompt(filename, text)

    try:
        # 🟢 CEREBRAS-FREE: LD-011 무료 우선 원칙 — Cerebras → Gemini-Free 폴백 체인
        raw_response = await call_free_llm(
            prompt=prompt,
            system_instruction="당신은 콘텐츠 분류 전문가입니다. 반드시 JSON으로만 응답합니다.",
            max_tokens=256,
            temperature=0.1,  # 분류는 결정론적으로 낮은 온도 사용
        )
        result = extract_json(raw_response)

        # 필수 필드 검증
        category  = str(result.get("category", "")).strip()
        reason     = str(result.get("reason", "")).strip()
        confidence = float(result.get("confidence", 0.0))

        if category not in _CATEGORY_MAP:
            # LLM이 유효하지 않은 카테고리를 반환한 경우
            return {
                "category": "_error",
                "reason": f"유효하지 않은 카테고리: {category}",
                "confidence": 0.0,
            }

        return {"category": category, "reason": reason, "confidence": confidence}

    except Exception as e:
        # JSON 파싱 실패 또는 LLM 호출 실패
        return {
            "category": "_error",
            "reason": f"LLM 오류: {str(e)[:100]}",
            "confidence": 0.0,
        }


def _move_file(src: Path, category: str, confidence: float) -> Path:
    """파일을 분류 결과 폴더로 이동하고 이동된 경로를 반환

    confidence < 0.6 또는 _error 카테고리 → _inbox/_review/ 로 이동 (수동 검토 필요)
    그 외 → source-pdf/{category}/ 로 이동
    """
    if category == "_error" or confidence < 0.6:
        # 신뢰도 낮거나 오류 — 수동 검토 폴더로 이동
        dest_dir = _REVIEW_DIR
    else:
        dest_dir = _SOURCE_PDF_DIR / _CATEGORY_MAP[category]

    dest_dir.mkdir(parents=True, exist_ok=True)

    # 동일 파일명이 대상 폴더에 이미 있으면 타임스탬프 접미사 붙임
    dest = dest_dir / src.name
    if dest.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = dest_dir / f"{src.stem}_{ts}{src.suffix}"

    shutil.move(str(src), str(dest))
    return dest


async def _process_file(filepath: Path, log: dict) -> dict | None:
    """파일 1개 처리 — 텍스트 추출 → LLM 분류 → 파일 이동 → 이력 기록

    이미 처리된 파일(로그에 있음)은 None 반환으로 건너뜀
    """
    filename = filepath.name

    # 이미 처리된 파일은 건너뜀 (중복 방지)
    if filename in log:
        print(f"  [건너뜀] {filename} — 이미 처리됨 (로그 존재)")
        return None

    print(f"\n  처리 중: {filename}")

    # 1단계: 텍스트 추출
    try:
        text = _extract_text(filepath)
        print(f"    텍스트 추출 완료 ({len(text):,}자)")
    except Exception as e:
        print(f"    [오류] 텍스트 추출 실패: {e}")
        # 추출 실패한 파일도 _review로 이동 후 로그 기록
        dest = _move_file(filepath, "_error", 0.0)
        entry = {
            "filename":   filename,
            "src_path":   str(filepath),
            "dest_path":  str(dest),
            "category":   "_error",
            "reason":     f"텍스트 추출 실패: {str(e)[:100]}",
            "confidence": 0.0,
            "review_needed": True,
            "timestamp":  datetime.now().isoformat(),
        }
        log[filename] = entry
        return entry

    # 2단계: LLM 분류
    print("    LLM 분류 중...")
    classification = await _classify_file(filename, text)
    category   = classification["category"]
    reason     = classification["reason"]
    confidence = classification["confidence"]
    print(f"    분류 결과: {category} (신뢰도: {confidence:.2f}) — {reason}")

    # 3단계: 파일 이동
    dest = _move_file(filepath, category, confidence)
    review_needed = (category == "_error" or confidence < 0.6)

    if review_needed:
        print(f"    → 수동 검토 필요: _inbox/_review/{dest.name}")
    else:
        print(f"    → 이동 완료: source-pdf/{_CATEGORY_MAP[category]}/{dest.name}")

    # 4단계: 이력 기록
    entry = {
        "filename":      filename,
        "src_path":      str(filepath),
        "dest_path":     str(dest),
        "category":      category,
        "reason":        reason,
        "confidence":    confidence,
        "review_needed": review_needed,
        "timestamp":     datetime.now().isoformat(),
    }
    log[filename] = entry
    return entry


async def main() -> None:
    """메인 실행 함수 — _inbox 파일 전체 처리"""
    print("=" * 60)
    print("LinkDrop V3 — 소스 PDF 자동 분류기")
    print("=" * 60)

    # 폴더가 없으면 생성 (첫 실행 대비)
    _INBOX_DIR.mkdir(parents=True, exist_ok=True)
    _REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    _SORTED_DIR.mkdir(parents=True, exist_ok=True)

    # 처리할 파일 목록 수집
    files = _collect_inbox_files()

    if not files:
        print(f"\n_inbox/ 폴더에 처리할 파일이 없습니다.")
        print(f"지원 형식: {', '.join(sorted(_SUPPORTED_EXTS))}")
        return

    print(f"\n_inbox/ 파일 {len(files)}개 발견")

    # 기존 처리 이력 로드 (이미 처리된 파일은 건너뜀)
    log = _load_log()

    # 파일 1개씩 순서대로 처리
    results = []
    for filepath in files:
        entry = await _process_file(filepath, log)
        if entry is not None:
            results.append(entry)
        # 처리할 때마다 로그 저장 (중간에 종료되어도 이력 보존)
        _save_log(log)

    # ── 결과 요약 출력 ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("분류 완료 요약")
    print("=" * 60)

    if not results:
        print("새로 처리된 파일이 없습니다. (모두 이미 처리된 파일)")
        return

    # 카테고리별 집계
    category_counts: dict[str, int] = {}
    review_count = 0
    for entry in results:
        cat = entry["category"]
        category_counts[cat] = category_counts.get(cat, 0) + 1
        if entry["review_needed"]:
            review_count += 1

    for cat, count in sorted(category_counts.items()):
        label = _CATEGORY_MAP.get(cat, "_review")
        print(f"  {label:12s}: {count}개")

    if review_count:
        print(f"\n  [주의] 수동 검토 필요: {review_count}개")
        print(f"  위치: source-pdf/_inbox/_review/")

    print(f"\n  로그 저장: {_LOG_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
