"""supabase MCP 서버 — V3용 커스텀 Supabase MCP

도구:
  execute_sql   — 모든 SQL 실행 (SELECT · INSERT · UPDATE · DELETE · DDL)
  list_tables   — 테이블 목록 + 컬럼 요약
  describe_table — 특정 테이블 상세 스키마
  apply_migration — SQL 파일 또는 SQL 문자열로 마이그레이션 적용

DDL 처리 방식:
  1. psycopg2 → Supabase pooler 직접 연결 (DDL 지원)
  2. 연결 실패 시 → supabase-py rpc fallback 시도
  3. 둘 다 실패 시 → SQL 반환 + 수동 실행 안내
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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
)
PROJECT_REF = SUPABASE_URL.replace("https://", "").split(".")[0] if SUPABASE_URL else ""

# Supabase pooler 연결 후보 (region 순서 — 한국 프로젝트 기준)
_POOLER_REGIONS = [
    "aws-0-ap-northeast-2",  # 서울
    "aws-0-ap-northeast-1",  # 도쿄
    "aws-0-ap-southeast-1",  # 싱가포르
    "aws-0-us-east-1",       # 버지니아
    "aws-0-us-west-1",       # 캘리포니아
    "aws-0-eu-central-1",    # 프랑크푸르트
]

_psycopg2_dsn: str | None = None  # 캐시된 성공 연결 DSN


def _get_psycopg2_conn():
    """psycopg2 연결 — 성공한 region DSN을 캐시."""
    global _psycopg2_dsn
    import psycopg2

    if _psycopg2_dsn:
        return psycopg2.connect(_psycopg2_dsn)

    for region in _POOLER_REGIONS:
        dsn = (
            f"postgresql://postgres.{PROJECT_REF}:{SERVICE_KEY}"
            f"@{region}.pooler.supabase.com:5432/postgres"
            f"?connect_timeout=5&sslmode=require"
        )
        try:
            conn = psycopg2.connect(dsn)
            _psycopg2_dsn = dsn
            return conn
        except Exception:
            continue

    # 직접 DB 호스트 시도 (구형 방식)
    dsn = (
        f"postgresql://postgres:{SERVICE_KEY}"
        f"@db.{PROJECT_REF}.supabase.co:5432/postgres"
        f"?connect_timeout=5&sslmode=require"
    )
    try:
        conn = psycopg2.connect(dsn)
        _psycopg2_dsn = dsn
        return conn
    except Exception as e:
        raise RuntimeError(f"Supabase DB 직접 연결 실패 (모든 region 시도). 마지막 오류: {e}")


def _is_ddl(sql: str) -> bool:
    """DDL 문 여부 판별."""
    first = sql.strip().upper().split()[0] if sql.strip() else ""
    return first in {"ALTER", "CREATE", "DROP", "TRUNCATE", "GRANT", "REVOKE", "COMMENT"}


def _run_sql_psycopg2(sql: str) -> dict:
    """psycopg2로 SQL 실행 — DDL + DML 모두 지원."""
    conn = _get_psycopg2_conn()
    try:
        conn.autocommit = False
        cur = conn.cursor()

        # 세미콜론으로 분리된 여러 문 처리
        statements = [s.strip() for s in sql.split(";") if s.strip()]
        results = []
        for stmt in statements:
            cur.execute(stmt)
            if cur.description:  # SELECT
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
                results.append({
                    "statement": stmt[:80] + "..." if len(stmt) > 80 else stmt,
                    "rows": [dict(zip(cols, r)) for r in rows],
                    "count": len(rows),
                })
            else:
                results.append({
                    "statement": stmt[:80] + "..." if len(stmt) > 80 else stmt,
                    "rowcount": cur.rowcount,
                })

        conn.commit()
        return {"ok": True, "results": results}
    except Exception as e:
        conn.rollback()
        raise
    finally:
        conn.close()


def _run_sql_supabase_py(sql: str) -> dict:
    """supabase-py로 SELECT 실행 (DDL 불가 — fallback용)."""
    from supabase import create_client
    client = create_client(SUPABASE_URL, SERVICE_KEY)

    # SELECT만 처리
    result = client.rpc("exec_sql_select", {"query": sql}).execute()
    return {"ok": True, "data": result.data}


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

    try:
        return _run_sql_psycopg2(sql)
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "hint": "Supabase SQL Editor에서 직접 실행하세요.",
            "sql": sql,
        }


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
    """테이블 목록 조회 — 컬럼 수와 대략적인 행 수 포함.

    Args:
        schema: 조회할 스키마 (기본: public)
    """
    sql = f"""
SELECT
    t.table_name,
    COUNT(c.column_name) AS column_count,
    pg_stat_user_tables.n_live_tup AS approx_rows
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
LEFT JOIN pg_stat_user_tables
    ON pg_stat_user_tables.relname = t.table_name
WHERE t.table_schema = '{schema}'
  AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name, pg_stat_user_tables.n_live_tup
ORDER BY t.table_name;
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
ORDER BY c.ordinal_position;
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
WHERE series_id = '{series_id}';
"""
    result = execute_sql(sql)
    if result.get("ok"):
        rows = result["results"][0].get("rows", []) if result.get("results") else []
        return {"ok": True, "series_id": series_id, **rows[0]} if rows else {"ok": True}
    return result


# ─────────────────────────────────────────────────────────────
# 엔트리포인트
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
