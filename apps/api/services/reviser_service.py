"""Reviser 에이전트 — Lint 보고서 → 챕터 자동 수정 (InkOS Reviser 역할)

수동 트리거 전용 (API endpoint: POST /{series_id}/revise).
자동 파이프라인에는 포함되지 않음 — 사용자가 lint 보고서를 확인 후 선택적으로 실행.

흐름:
  lint_report wiki 페이지 로드
  → '### 수정 필요' 섹션에서 [챕터 N] 패턴 추출
  → 각 챕터: 원본 로드 → Gemini 재작성 → v3_chapters 업데이트 (approved=False)
  → wiki timeline 갱신
"""
import asyncio
import re
from pathlib import Path
from core.database import get_supabase
from services.gemini_helper import call_gemini
from services.wiki_service import read_wiki_page, auto_update_wiki

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


async def run_reviser(series_id: str) -> dict:
    """lint_report → '수정 필요' 챕터 목록 파싱 → 각 챕터 재작성"""
    report_page = await read_wiki_page(series_id, "lint_report")
    if not report_page:
        return {"ok": False, "error": "lint_report 없음. 먼저 POST /{series_id}/lint를 실행하세요."}

    report_md: str = report_page.get("content_md", "")
    chapters_to_fix = _parse_chapters_to_fix(report_md)

    if not chapters_to_fix:
        return {"ok": True, "revised": 0, "message": "수정 필요 항목 없음 — lint 보고서에 [챕터 N] 패턴이 없습니다."}

    db = get_supabase()
    revised: list[int] = []

    for chapter_num in chapters_to_fix:
        issues = _extract_chapter_issues(report_md, chapter_num)
        success = await _revise_chapter(db, series_id, chapter_num, issues)
        if success:
            revised.append(chapter_num)

    return {"ok": True, "revised": len(revised), "chapters": revised}


def _parse_chapters_to_fix(report_md: str) -> list[int]:
    """'### 수정 필요' 섹션(들)에서 [챕터 N] 패턴 추출"""
    chapters: set[int] = set()

    # 모든 '### 수정 필요' 블록 수집 (섹션별로 여러 개 존재 가능)
    for section_match in re.finditer(r"### 수정 필요([\s\S]*?)(?=###|\Z)", report_md):
        section_text = section_match.group(1)
        for m in re.finditer(r"\[챕터\s*(\d+)\]", section_text):
            chapters.add(int(m.group(1)))

    return sorted(chapters)


def _extract_chapter_issues(report_md: str, chapter: int) -> str:
    """특정 챕터 번호를 포함한 수정 지시 줄 전체 추출"""
    lines = [l for l in report_md.split("\n") if f"[챕터 {chapter}]" in l]
    return "\n".join(lines) if lines else f"챕터 {chapter} 전반적 품질 개선"


async def _revise_chapter(db, series_id: str, chapter: int, issues: str) -> bool:
    """단일 챕터: 원본 로드 → Gemini 재작성 → DB 저장 → wiki 갱신"""
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters")
        .select("content,role")
        .eq("series_id", series_id)
        .eq("chapter", chapter)
        .single().execute()
    )
    if not res.data:
        return False

    original: str = res.data.get("content", "")
    role: str = res.data.get("role", "전개")

    template = (_PROMPTS_DIR / "reviser.md").read_text(encoding="utf-8")

    prompt = f"""{template}

=== 원본 챕터 {chapter} ({role}) ===
{original[:3000]}

=== Lint에서 지적된 수정 항목 ===
{issues}

위 수정 항목을 반영해 챕터를 재작성하라.
원본의 서사 흐름과 등장인물은 유지하면서 지적된 문제만 개선한다.
순수 한국어 서사 본문만 출력.
"""
    revised_content = await call_gemini(prompt, max_tokens=6000, temperature=0.85)

    # v3_chapters 업데이트 (approved=False → 사람이 재검토 필요)
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").update({
            "content": revised_content,
            "approved": False,
        }).eq("series_id", series_id).eq("chapter", chapter).execute()
    )

    # wiki timeline 갱신
    await auto_update_wiki(series_id, chapter, revised_content[:500])

    return True
