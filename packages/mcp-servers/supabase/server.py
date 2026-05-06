"""supabase MCP 서버 — V3용 커스텀 Supabase MCP

연결 방식: Supabase Management API (HTTP) — psycopg2 직접 TCP 불필요
  이유: DB 호스트가 IPv6 전용, 현재 네트워크 IPv6 불통 (2026-04-16 확인)

도구:
  execute_sql    — 모든 SQL 실행 (SELECT · INSERT · UPDATE · DELETE · DDL)
  list_tables    — 테이블 목록 + RLS 상태 + 대략적인 행 수
  describe_table — 특정 테이블 상세 스키마
  apply_migration — SQL 마이그레이션 적용
  get_series_cost — V3 시리즈 API 비용 합계
"""

import os
import sys
from pathlib import Path

# .env 로드 (V3 루트)
_ENV = Path(__file__).parent.parent.parent.parent / ".env"
if _ENV.exists():
    from dotenv import load_dotenv
    load_dotenv(_ENV)

from fastmcp import FastMCP

mcp = FastMCP(
    name="supabase-v3",
    instructions=(
        "Supabase V3 데이터베이스 직접 접근 MCP. "
        "execute_sql로 모든 SQL(DDL 포함)을 실행하고 "
        "list_tables · describe_table로 스키마를 확인할 수 있다. "
        "apply_migration으로 마이그레이션을 적용한다."
    ),
)

# ─────────────────────────────────────────────────────────────
# 연결 설정
# ─────────────────────────────────────────────────────────────

SUPABASE_URL  = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY   = (
    os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
)
ACCESS_TOKEN  = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
PROJECT_REF   = SUPABASE_URL.replace("https://", "").split(".")[0] if SUPABASE_URL else ""

_MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


def _run_sql_http(sql: str) -> dict:
    """Supabase Management API로 SQL 실행 (HTTP POST)."""
    import requests

    if not ACCESS_TOKEN:
        return {
            "ok": False,
            "error": "SUPABASE_ACCESS_TOKEN 미설정 — .env에 추가하세요.",
            "sql": sql,
        }

    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }

    # 세미콜론으로 분리된 여러 문 처리
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    all_results = []

    for stmt in statements:
        try:
            resp = requests.post(
                _MGMT_URL,
                headers=headers,
                json={"query": stmt},
                timeout=30,
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                all_results.append({
                    "statement": stmt[:80] + "..." if len(stmt) > 80 else stmt,
                    "rows": data if isinstance(data, list) else [],
                    "count": len(data) if isinstance(data, list) else 0,
                })
            else:
                return {
                    "ok": False,
                    "error": f"HTTP {resp.status_code}: {resp.text[:300]}",
                    "sql": stmt,
                }
        except Exception as e:
            return {"ok": False, "error": str(e), "sql": stmt}

    return {"ok": True, "results": all_results}


# ─────────────────────────────────────────────────────────────
# MCP 도구
# ─────────────────────────────────────────────────────────────

@mcp.tool()
def execute_sql(sql: str) -> dict:
    """SQL 실행 — SELECT · INSERT · UPDATE · DELETE · DDL(ALTER/CREATE/DROP) 모두 지원.

    Args:
        sql: 실행할 SQL 문 (세미콜론으로 여러 문 구분 가능)

    Returns:
        {"ok": True, "results": [...]}  또는  {"ok": False, "error": "...", "sql": "..."}
    """
    if not sql.strip():
        return {"ok": False, "error": "SQL이 비어있습니다."}
    return _run_sql_http(sql)


@mcp.tool()
def apply_migration(sql: str, migration_name: str = "migration") -> dict:
    """DDL 마이그레이션 적용.

    Args:
        sql: 마이그레이션 SQL (ALTER TABLE, CREATE INDEX 등)
        migration_name: 마이그레이션 이름 (로그용)

    Returns:
        성공 시 {"ok": True, "migration": "..."}, 실패 시 {"ok": False, "error": "...", "sql": "..."}
    """
    result = execute_sql(sql)
    if result.get("ok"):
        return {"ok": True, "migration": migration_name, "results": result.get("results", [])}
    return result


@mcp.tool()
def list_tables(schema: str = "public") -> dict:
    """테이블 목록 조회 — RLS 상태 + 대략적인 행 수 포함.

    Args:
        schema: 조회할 스키마 (기본: public)
    """
    sql = f"""
SELECT
    t.table_name,
    p.rowsecurity AS rls_enabled,
    COALESCE(s.n_live_tup, 0) AS approx_rows
FROM information_schema.tables t
JOIN pg_tables p
    ON p.schemaname = t.table_schema AND p.tablename = t.table_name
LEFT JOIN pg_stat_user_tables s
    ON s.relname = t.table_name
WHERE t.table_schema = '{schema}'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name
"""
    result = execute_sql(sql)
    if result.get("ok"):
        rows = result["results"][0].get("rows", []) if result.get("results") else []
        return {"ok": True, "schema": schema, "tables": rows}
    return result


@mcp.tool()
def describe_table(table_name: str, schema: str = "public") -> dict:
    """테이블 스키마 상세 조회 — 컬럼명, 타입, NULL 허용, 기본값, PK 여부.

    Args:
        table_name: 테이블 이름
        schema: 스키마 (기본: public)
    """
    sql = f"""
SELECT
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
FROM information_schema.columns c
LEFT JOIN (
    SELECT ku.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_name = '{table_name}'
      AND tc.table_schema = '{schema}'
) pk ON pk.column_name = c.column_name
WHERE c.table_name = '{table_name}'
  AND c.table_schema = '{schema}'
ORDER BY c.ordinal_position
"""
    result = execute_sql(sql)
    if result.get("ok"):
        rows = result["results"][0].get("rows", []) if result.get("results") else []
        return {"ok": True, "table": table_name, "columns": rows}
    return result


@mcp.tool()
def get_series_cost(series_id: str) -> dict:
    """V3 시리즈 API 비용 합계 조회.

    Args:
        series_id: 시리즈 UUID
    """
    sql = f"""
SELECT
    COUNT(*) AS scene_count,
    SUM(COALESCE(cost_usd, 0)) AS total_cost_usd,
    SUM(CASE WHEN kling_clip_url IS NOT NULL THEN 1 ELSE 0 END) AS kling_generated
FROM v3_scenes
WHERE series_id = '{series_id}'
"""
    result = execute_sql(sql)
    if result.get("ok"):
        rows = result["results"][0].get("rows", []) if result.get("results") else []
        return {"ok": True, "series_id": series_id, **(rows[0] if rows else {})}
    return result


# ─────────────────────────────────────────────────────────────
# 엔트리포인트
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
