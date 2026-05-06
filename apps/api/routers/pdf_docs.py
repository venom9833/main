"""PDF 문서 라우터 — 소스 업로드 · AI 생성 · CRUD · 수정"""
from datetime import datetime, timezone
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from core.database import get_supabase
from services.pdf_service import (
    extract_text_from_bytes,
    generate_from_source,
    load_templates,
    revise_pdf_content,
    reload_principles,
)
from services.nlm_service import generate_with_nlm

router = APIRouter(prefix="/api/v1/pdf-docs", tags=["pdf-docs"])

ALLOWED_EXTS = {".txt", ".srt", ".vtt", ".pdf", ".md"}


def _ms(ts_str: str) -> int:
    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)


def _to_meta(row: dict) -> dict:
    return {
        "id":        row["id"],
        "title":     row.get("title", ""),
        "doc_type":  row.get("doc_type", "문서형"),
        "status":    row.get("status", "draft"),
        "createdAt": _ms(row["created_at"]),
        "updatedAt": _ms(row["updated_at"]),
    }


def _to_doc(row: dict) -> dict:
    return {**_to_meta(row), "content": row.get("content", "")}


# ── 템플릿 목록 ───────────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates():
    """사용 가능한 문서 템플릿 목록 반환"""
    return load_templates()


# ── 소스 파일 업로드 → 텍스트 추출 ────────────────────────────────────────────

@router.post("/upload-source")
async def upload_source(file: UploadFile = File(...)):
    """파일 업로드 → 텍스트 추출 반환 (.txt / .srt / .vtt / .pdf / .md)"""
    from pathlib import Path
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"지원 형식: {', '.join(ALLOWED_EXTS)}")
    file_bytes = await file.read()
    try:
        text = extract_text_from_bytes(file.filename or "", file_bytes)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not text.strip():
        raise HTTPException(422, "텍스트 추출 결과가 없습니다")
    return {"ok": True, "filename": file.filename, "text": text, "chars": len(text)}


# ── AI 생성 (소스 기반) ────────────────────────────────────────────────────────

class SourceItem(BaseModel):
    filename: str
    text: str


class GenerateBody(BaseModel):
    title: str
    sources: list[SourceItem]          # 1개 이상 다중 소스
    doc_type: str = "문서형"
    chapter_count: int = 0
    use_paid_ai: bool = False
    template_id: str = ""              # templates.json 의 id 값


def _merge_sources(sources: list[SourceItem]) -> str:
    """다중 소스를 LLM이 구분 가능하도록 병합"""
    if len(sources) == 1:
        return sources[0].text
    return "\n\n".join(
        f"[소스 {i + 1}: {s.filename}]\n{s.text}"
        for i, s in enumerate(sources)
    )


@router.post("/generate")
async def generate(body: GenerateBody):
    if not body.title.strip():
        raise HTTPException(400, "title 필수")
    if not body.sources:
        raise HTTPException(400, "sources 1개 이상 필수")
    if not any(s.text.strip() for s in body.sources):
        raise HTTPException(400, "추출된 텍스트가 없습니다")

    combined = _merge_sources(body.sources)
    content = await generate_from_source(
        source_text=combined,
        title=body.title,
        doc_type=body.doc_type,
        chapter_count=body.chapter_count,
        use_paid_ai=body.use_paid_ai,
        template_id=body.template_id,
    )
    return {"ok": True, "content": content}


# ── AI 생성 (NLM Direction B) ─────────────────────────────────────────────────

@router.post("/generate-with-nlm")
async def generate_nlm(body: GenerateBody):
    if not body.title.strip():
        raise HTTPException(400, "title 필수")
    if not body.sources:
        raise HTTPException(400, "sources 1개 이상 필수")
    if not any(s.text.strip() for s in body.sources):
        raise HTTPException(400, "추출된 텍스트가 없습니다")

    try:
        content = await generate_with_nlm(
            sources=[s.model_dump() for s in body.sources],
            title=body.title,
            doc_type=body.doc_type,
            chapter_count=body.chapter_count,
            use_paid_ai=body.use_paid_ai,
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"ok": True, "content": content}


# ── AI 수정 ──────────────────────────────────────────────────────────────────

class ReviseBody(BaseModel):
    content: str
    instruction: str
    doc_type: str = "문서형"


@router.post("/revise")
async def revise(body: ReviseBody):
    if not body.content.strip():
        raise HTTPException(400, "content 필수")
    if not body.instruction.strip():
        raise HTTPException(400, "instruction 필수")
    revised = await revise_pdf_content(
        content=body.content,
        instruction=body.instruction,
        doc_type=body.doc_type,
    )
    return {"ok": True, "content": revised}


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_docs():
    sb = get_supabase()
    res = (
        sb.table("pdf_docs")
        .select("id,title,doc_type,status,created_at,updated_at")
        .order("created_at", desc=True)
        .execute()
    )
    return [_to_meta(r) for r in (res.data or [])]


class SaveDocBody(BaseModel):
    id: str
    title: str
    doc_type: str = "문서형"
    content: str
    status: str = "draft"


@router.post("")
def save_doc(body: SaveDocBody):
    sb = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "id":         body.id,
        "title":      body.title,
        "doc_type":   body.doc_type,
        "content":    body.content,
        "status":     body.status,
        "updated_at": now,
    }
    res = sb.table("pdf_docs").upsert(data).execute()
    row = res.data[0] if res.data else {**data, "created_at": now}
    return _to_doc(row)


@router.get("/{doc_id}")
def get_doc(doc_id: str):
    sb = get_supabase()
    res = sb.table("pdf_docs").select("*").eq("id", doc_id).maybe_single().execute()
    if not res.data:
        raise HTTPException(404, "문서를 찾을 수 없습니다")
    return _to_doc(res.data)


@router.delete("/{doc_id}")
def delete_doc(doc_id: str):
    sb = get_supabase()
    sb.table("pdf_docs").delete().eq("id", doc_id).execute()
    return {"ok": True}


# ── 원칙 파일 핫리로드 ─────────────────────────────────────────────────────────

@router.post("/reload-principles")
def reload():
    reload_principles()
    return {"ok": True}
