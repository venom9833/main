"""PDF 문서 생성 서비스 — writing_principles.md를 시스템 프롬프트로 주입

출력 형식: Markdown (MD 문법) → 프론트에서 A4 PDF 렌더링
"""
import json
import re
from pathlib import Path
from typing import Optional
from services.gemini_helper import call_gemini, call_free_llm

_PDF_PROMPT_DIR = Path(__file__).parent.parent / "pdf_prompt"
_PRINCIPLES: str = ""
_TEMPLATES: Optional[list] = None


def _load_principles() -> str:
    path = _PDF_PROMPT_DIR / "writing_principles.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _get_principles() -> str:
    global _PRINCIPLES
    if not _PRINCIPLES:
        _PRINCIPLES = _load_principles()
    return _PRINCIPLES


def reload_principles() -> None:
    global _PRINCIPLES, _TEMPLATES
    _PRINCIPLES = _load_principles()
    _TEMPLATES = None  # 템플릿 캐시도 함께 초기화


def load_templates() -> list[dict]:
    global _TEMPLATES
    if _TEMPLATES is None:
        path = _PDF_PROMPT_DIR / "templates.json"
        _TEMPLATES = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return _TEMPLATES


def get_template(template_id: str) -> Optional[dict]:
    return next((t for t in load_templates() if t["id"] == template_id), None)


def extract_text_from_bytes(filename: str, file_bytes: bytes) -> str:
    """파일 바이트 → 순수 텍스트 추출 (.txt / .srt / .vtt / .pdf / .md)"""
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            return "\n".join(page.get_text() for page in doc)
        except Exception as e:
            raise ValueError(f"PDF 파싱 실패: {e}")

    if ext == ".srt":
        raw = file_bytes.decode("utf-8", errors="ignore")
        raw = re.sub(r"^\d+\s*$", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}", "", raw)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()

    if ext == ".vtt":
        raw = file_bytes.decode("utf-8", errors="ignore")
        raw = re.sub(r"WEBVTT.*?\n\n", "", raw, flags=re.DOTALL)
        raw = re.sub(r"\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}[^\n]*\n", "", raw)
        raw = re.sub(r"<[^>]+>", "", raw)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()

    # .txt / .md / 기타
    return file_bytes.decode("utf-8", errors="ignore")


def _build_system_prompt(doc_type: str, template_id: str = "") -> str:
    principles = _get_principles()
    tmpl = get_template(template_id) if template_id else None
    tmpl_name = tmpl["name"] if tmpl else doc_type
    tmpl_addition = f"\n\n[템플릿 구조 규칙]\n{tmpl['system_addition']}" if tmpl else ""
    return f"""당신은 전문 문서 작성 AI입니다.
문서 유형: {tmpl_name}

[출력 형식 규칙]
- 출력은 반드시 Markdown(MD) 문법으로 작성한다
- 챕터 구분은 반드시 `---` (수평선)으로 표시한다
- 각 챕터는 `## 챕터 제목` 헤딩으로 시작한다
- 각 챕터 분량은 A4 용지 1장 기준 (본문 700~900자) 내외로 작성한다
- 마지막 챕터 뒤에는 `---`를 추가하지 않는다
{tmpl_addition}

[글쓰기 원칙]
{principles}

원칙에서 벗어나는 표현을 발견하면 스스로 수정한 뒤 출력한다."""


async def generate_from_source(
    source_text: str,
    title: str,
    doc_type: str = "문서형",
    chapter_count: int = 0,
    use_paid_ai: bool = False,
    template_id: str = "",
) -> str:
    """소스 텍스트 기반 문서 생성 — 창작 없이 소스 내용만 재구성

    use_paid_ai=False(기본): 🟢 call_free_llm() — Cerebras → Gemini-Free 체인 (LD-011)
    use_paid_ai=True:        ⚠️ call_gemini()   — Gemini-Paid (AI도움 옵션 ON 시)
    chapter_count=0이면 LLM이 적절한 챕터 수를 결정한다.
    template_id가 있으면 해당 템플릿 구조 규칙을 시스템 프롬프트에 주입한다.
    """
    system_prompt = _build_system_prompt(doc_type, template_id)

    # 챕터 수: 명시 > 템플릿 권장값 > 자동
    tmpl = get_template(template_id) if template_id else None
    effective_count = chapter_count or (tmpl.get("chapter_suggestion", 0) if tmpl else 0)
    chapter_guide = (
        f"총 {effective_count}개 챕터로 구성한다."
        if effective_count > 0
        else "내용 분량에 맞게 챕터 수를 결정한다."
    )

    user_prompt = f"""아래 소스 문서를 바탕으로 '{title}' 문서를 작성해 주세요.

[엄격한 제약]
- 소스에 있는 내용만 사용한다. 소스에 없는 내용을 추가하거나 창작하지 않는다.
- 소스의 사실·수치·주장을 변형하지 않는다.
- 소스를 글쓰기 원칙에 따라 재구성하고 명확하게 정리하는 것이 목표이다.
- {chapter_guide}

=== 소스 문서 ===
{source_text[:12000]}
================"""

    if use_paid_ai:
        # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 (AI도움 옵션 ON)
        return await call_gemini(
            prompt=user_prompt,
            system_instruction=system_prompt,
            temperature=0.4,
            max_tokens=8192,
        )
    else:
        # 🟢 CEREBRAS-FREE: LD-011 기본값 — Cerebras → Gemini-Free 폴백 체인
        return await call_free_llm(
            prompt=user_prompt,
            system_instruction=system_prompt,
            temperature=0.4,
            max_tokens=6000,
        )


async def revise_pdf_content(
    content: str,
    instruction: str,
    doc_type: str = "문서형",
) -> str:
    """기존 문서 + 수정 지시 → 원칙 준수 수정본 반환"""
    system_prompt = _build_system_prompt(doc_type)

    user_prompt = f"""아래 문서를 수정 지시에 따라 개선해 주세요.
글쓰기 원칙을 위반하는 표현이 있으면 함께 수정합니다.

수정 지시: {instruction}

=== 원본 문서 ===
{content}
================"""

    # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금
    return await call_gemini(
        prompt=user_prompt,
        system_instruction=system_prompt,
        temperature=0.5,
    )
