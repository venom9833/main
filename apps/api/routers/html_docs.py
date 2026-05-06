"""HTML 문서 저장/조회 라우터 — Supabase html_docs 테이블"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.database import get_supabase

router = APIRouter(prefix="/api/v1/html-docs", tags=["html-docs"])


def _ms(ts_str: str) -> int:
    """ISO timestamp → JS 밀리초 정수"""
    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)


def _to_meta(row: dict) -> dict:
    return {
        "id":            row["id"],
        "template":      row.get("template", ""),
        "templateLabel": row.get("template_label", ""),
        "topic":         row.get("topic", ""),
        "status":        row.get("status", "draft"),
        "createdAt":     _ms(row["created_at"]),
        "updatedAt":     _ms(row["updated_at"]),
    }


def _to_doc(row: dict) -> dict:
    return {**_to_meta(row), "html": row.get("html", "")}


class SaveDocBody(BaseModel):
    id: str
    template: str
    templateLabel: str
    topic: str
    html: str
    status: str = "draft"


# ── 목록 ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_docs():
    sb = get_supabase()
    res = (
        sb.table("html_docs")
        .select("id,template,template_label,topic,status,created_at,updated_at")
        .order("created_at", desc=True)
        .execute()
    )
    return [_to_meta(r) for r in (res.data or [])]


# ── 저장(upsert) ───────────────────────────────────────────────────────────────

@router.post("")
def save_doc(body: SaveDocBody):
    sb = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "id":             body.id,
        "template":       body.template,
        "template_label": body.templateLabel,
        "topic":          body.topic,
        "html":           body.html,
        "status":         body.status,
        "updated_at":     now,
    }
    res = sb.table("html_docs").upsert(data).execute()
    row = res.data[0] if res.data else {**data, "created_at": now}
    return _to_doc(row)


# ── 단건 조회 ──────────────────────────────────────────────────────────────────

@router.get("/{doc_id}")
def get_doc(doc_id: str):
    sb = get_supabase()
    res = sb.table("html_docs").select("*").eq("id", doc_id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    return _to_doc(res.data)


# ── 삭제 ──────────────────────────────────────────────────────────────────────

@router.delete("/{doc_id}")
def delete_doc(doc_id: str):
    sb = get_supabase()
    sb.table("html_docs").delete().eq("id", doc_id).execute()
    return {"ok": True}
