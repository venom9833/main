"""admin.py — Claude 워크스페이스 대시보드 API
server.py (claude-workspace-dashboard-template) 로직을 FastAPI로 포팅.
읽기 전용: ~/.claude 파일 시스템에서 데이터를 읽기만 한다.
"""
from __future__ import annotations

import json
import re
import socket
import time
from datetime import datetime, date
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/api/admin", tags=["admin"])

# ── 경로 상수 ─────────────────────────────────────────────────────────────────

CLAUDE_HOME       = Path.home() / ".claude"
CLAUDE_MD         = CLAUDE_HOME / "CLAUDE.md"
SETTINGS_JSON     = CLAUDE_HOME / "settings.json"
SKILLS_DIR        = CLAUDE_HOME / "skills"
AGENTS_DIR        = CLAUDE_HOME / "agents"
PROJECTS_DIR      = CLAUDE_HOME / "projects"
PLUGINS_DIR       = CLAUDE_HOME / "plugins"
INSTALLED_PLUGINS = PLUGINS_DIR / "installed_plugins.json"
SESSIONS_DIR      = CLAUDE_HOME / "sessions"
TODOS_DIR         = CLAUDE_HOME / "todos"
TASKS_DIR         = CLAUDE_HOME / "tasks"
SCHEDULED_DIR     = CLAUDE_HOME / "scheduled-tasks"
HISTORY_JSONL     = CLAUDE_HOME / "history.jsonl"
CLAUDE_JSON       = Path.home() / ".claude.json"

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


# ── 프로젝트 경로 탐색 ─────────────────────────────────────────────────────────

def _project_dir_name_to_path(name: str) -> "Path | None":
    """'c--LinkDropV3' → Path('C:/LinkDropV3') 변환."""
    parts = name.split("--")
    if not parts:
        return None
    first = parts[0]
    rest = parts[1:]
    if len(first) == 1 and first.isalpha():
        drive = first.upper() + ":"
        p = Path(drive + "/" + "/".join(rest)) if rest else Path(drive + "/")
    else:
        p = Path("/" + "/".join(parts)) if parts else None
    return p


def _iter_project_paths() -> list:
    """~/.claude/projects/ 디렉토리 이름으로 실제 프로젝트 경로 복원."""
    paths: list = []
    if not PROJECTS_DIR.exists():
        return paths
    for d in PROJECTS_DIR.iterdir():
        if not d.is_dir():
            continue
        p = _project_dir_name_to_path(d.name)
        if p and p.exists():
            paths.append(p)
    return paths


def _collect_hooks_from_settings(s: dict) -> list:
    out: list = []
    for event, items in (s.get("hooks") or {}).items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            sub = item.get("hooks")
            matcher = item.get("matcher")
            if isinstance(sub, list) and sub:
                for sh in sub:
                    entry: dict = {"event": event}
                    if matcher:
                        entry["matcher"] = matcher
                    if isinstance(sh, dict):
                        entry.update(sh)
                    out.append(entry)
            else:
                entry = {"event": event}
                entry.update({k: v for k, v in item.items() if k != "hooks"})
                out.append(entry)
    return out


def _add_mcp_entries(mcp: dict, platform: list, local: list, seen: set) -> None:
    for name, cfg in (mcp if isinstance(mcp, dict) else {}).items():
        if name in seen:
            continue
        seen.add(name)
        if not isinstance(cfg, dict):
            cfg = {}
        entry = {"id": name, "name": name, "type": cfg.get("type", "stdio"), "command": cfg.get("command", ""), "enabled": True}
        if any(s in name.lower() for s in ("claude_ai_", "anthropic_", "claude.ai")):
            platform.append(entry)
        else:
            local.append(entry)


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _safe_read(p: Path, limit: int | None = None) -> str:
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
        return text if limit is None else text[:limit]
    except Exception:
        return ""


def _parse_frontmatter(text: str) -> dict:
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    out: dict = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^(\w[\w-]*):\s*(.*)$", line.strip())
        if kv:
            out[kv.group(1)] = kv.group(2).strip().strip('"').strip("'")
    return out


def _parse_sections(raw: str) -> list:
    sections: list = []
    cur: dict | None = None
    for line in raw.splitlines():
        m = re.match(r"^(#{1,3})\s+(.*)", line)
        if m:
            if cur:
                sections.append(cur)
            cur = {"title": m.group(2).strip(), "content": []}
        else:
            if cur is None:
                cur = {"title": "intro", "content": []}
            if line.strip():
                cur["content"].append(line)
    if cur:
        sections.append(cur)
    return sections


def _get_settings() -> dict:
    if not SETTINGS_JSON.exists():
        return {}
    try:
        return json.loads(_safe_read(SETTINGS_JSON))
    except Exception:
        return {}


def _today_start_ts_ms() -> int:
    midnight = datetime.combine(date.today(), datetime.min.time())
    return int(midnight.timestamp() * 1000)


def _iter_history_recent(limit_lines: int = 5000):
    if not HISTORY_JSONL.exists():
        return
    try:
        lines = HISTORY_JSONL.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in lines[-limit_lines:]:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue
    except Exception:
        return


def _today_history_stats() -> dict:
    today_start = _today_start_ts_ms()
    cmd_count = 0
    projects_today: set = set()
    for entry in _iter_history_recent():
        ts = entry.get("timestamp")
        if not isinstance(ts, (int, float)):
            continue
        if ts >= today_start:
            cmd_count += 1
            proj = entry.get("project")
            if proj:
                projects_today.add(proj)
    return {"commandCount": cmd_count, "projectCount": len(projects_today)}


def _classify_device(cwd: str) -> str:
    if not cwd:
        return "맥북"
    home = str(Path.home()).rstrip("/").rstrip("\\")
    norm = cwd.rstrip("/").rstrip("\\")
    return "맥미니" if norm == home else "맥북"


def _running_sessions() -> list:
    if not SESSIONS_DIR.exists():
        return []
    out: list = []
    for p in sorted(SESSIONS_DIR.glob("*.json")):
        try:
            data = json.loads(_safe_read(p))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        cwd = data.get("cwd") or ""
        out.append({
            "pid": data.get("pid"),
            "sessionId": data.get("sessionId"),
            "workspace": cwd,
            "project": Path(cwd).name if cwd else (data.get("kind") or "Claude Code"),
            "kind": data.get("kind", ""),
            "startedAt": data.get("startedAt"),
        })
    return out


def _parse_tools_field(raw: str) -> list:
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("["):
        try:
            return [str(x) for x in json.loads(raw) if x]
        except Exception:
            pass
    return [t.strip().strip('"').strip("'") for t in raw.split(",") if t.strip()]


def _projects_summary() -> list:
    by_project: dict = {}
    for entry in _iter_history_recent(5000):
        proj = entry.get("project")
        ts = entry.get("timestamp")
        if not proj or not isinstance(ts, (int, float)):
            continue
        display = (entry.get("display") or "").strip()
        slot = by_project.setdefault(proj, {
            "displayName": Path(proj).name or proj,
            "cwd": proj,
            "device": _classify_device(proj),
            "sessionCount": 0,
            "lastActivity": 0,
            "firstTs": 0,
            "firstRequest": "",
            "lastResult": "",
        })
        slot["sessionCount"] += 1
        if ts > slot["lastActivity"]:
            slot["lastActivity"] = ts
            if display:
                slot["lastResult"] = display[:160]
        if slot["firstTs"] == 0 or ts < slot["firstTs"]:
            slot["firstTs"] = ts
            if display:
                slot["firstRequest"] = display[:160]
    for v in by_project.values():
        v.pop("firstTs", None)
    return sorted(by_project.values(), key=lambda x: x["lastActivity"], reverse=True)[:20]


def _read_scheduled_tasks() -> list:
    out: list = []
    if not SCHEDULED_DIR.exists():
        return out
    for d in sorted(SCHEDULED_DIR.iterdir()):
        if not d.is_dir():
            continue
        skill_md = d / "SKILL.md"
        meta: dict = {}
        updated_at = None
        if skill_md.exists():
            meta = _parse_frontmatter(_safe_read(skill_md, 4000))
            try:
                updated_at = int(skill_md.stat().st_mtime * 1000)
            except Exception:
                pass
        out.append({
            "id": d.name,
            "title": meta.get("name", d.name),
            "description": meta.get("description", ""),
            "updatedAt": updated_at,
        })
    return out


def _read_tasks() -> list:
    out: list = []
    if not TASKS_DIR.exists():
        return out
    device = socket.gethostname()
    for d in sorted(TASKS_DIR.iterdir()):
        if not d.is_dir():
            continue
        task_id = d.name
        is_uuid = bool(_UUID_RE.match(task_id))
        subtasks: list = []
        for f in sorted(d.glob("*.json")):
            try:
                data = json.loads(_safe_read(f))
                if isinstance(data, dict):
                    subtasks.append({
                        "id": data.get("id", f.stem),
                        "subject": data.get("subject", ""),
                        "status": data.get("status", "pending"),
                    })
            except Exception:
                continue
        total = len(subtasks)
        done = sum(1 for s in subtasks if s["status"] == "completed")
        try:
            updated_at = int(d.stat().st_mtime * 1000)
        except Exception:
            updated_at = None
        out.append({
            "id": task_id,
            "kind": "agent" if is_uuid else "named",
            "teamName": "" if is_uuid else task_id,
            "totalCount": total,
            "completedCount": done,
            "lockActive": (d / ".lock").exists(),
            "device": device,
            "updatedAt": updated_at,
            "subtasks": subtasks,
        })
    return out


# ── API 엔드포인트 ─────────────────────────────────────────────────────────────

@router.get("/claude-md")
async def get_claude_md():
    raw = _safe_read(CLAUDE_MD)
    return {"sections": _parse_sections(raw), "raw": raw}


@router.get("/system/status")
async def get_system_status():
    s = _get_settings()
    permissions = s.get("permissions") or {"allow": [], "deny": []}
    if not isinstance(permissions, dict):
        permissions = {"allow": [], "deny": []}
    permissions.setdefault("allow", [])
    permissions.setdefault("deny", [])

    hooks_out: list = []
    for event, items in (s.get("hooks") or {}).items():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    hooks_out.append({"event": event, **item})

    return {"hooks": hooks_out, "permissions": permissions, "sessions": _running_sessions(), "settings": s}


@router.get("/skills")
async def list_skills():
    if not SKILLS_DIR.exists():
        return []
    out: list = []
    for p in sorted(SKILLS_DIR.iterdir()):
        if not (p.is_dir() or p.is_symlink()):
            continue
        meta: dict = {}
        skill_md = p / "SKILL.md"
        if skill_md.exists():
            meta = _parse_frontmatter(_safe_read(skill_md, 2000))
        out.append({
            "id": p.name,
            "name": meta.get("name", p.name),
            "description": meta.get("description", ""),
            "source": "user",
        })
    return out


@router.get("/agents")
async def list_agents():
    agents: list = []
    seen: set = set()

    def _add_agents_from_dir(d: Path, scope: str) -> None:
        if not d.exists():
            return
        for p in sorted(d.glob("*.md")):
            key = p.stem
            if key in seen:
                continue
            seen.add(key)
            meta = _parse_frontmatter(_safe_read(p, 4000))
            agents.append({
                "id": p.stem,
                "name": meta.get("name", p.stem),
                "description": meta.get("description", ""),
                "model": meta.get("model", "inherit"),
                "tools": _parse_tools_field(meta.get("tools", "")),
                "scope": scope,
                "source": "user",
            })

    _add_agents_from_dir(AGENTS_DIR, "global")
    for proj_path in _iter_project_paths():
        _add_agents_from_dir(proj_path / ".claude" / "agents", proj_path.name)

    return {"agents": agents}


@router.get("/hooks")
async def get_hooks():
    s = _get_settings()
    permissions = s.get("permissions") or {"allow": [], "deny": []}
    if not isinstance(permissions, dict):
        permissions = {"allow": [], "deny": []}
    permissions.setdefault("allow", [])
    permissions.setdefault("deny", [])

    hooks_out: list = _collect_hooks_from_settings(s)

    # 프로젝트 레벨 settings.json 훅도 포함
    for proj_path in _iter_project_paths():
        proj_settings = proj_path / ".claude" / "settings.json"
        if proj_settings.exists():
            try:
                ps = json.loads(_safe_read(proj_settings))
                for h in _collect_hooks_from_settings(ps):
                    h["project"] = proj_path.name
                    hooks_out.append(h)
            except Exception:
                pass

    return {"hooks": hooks_out, "permissions": permissions}


@router.get("/plugins")
async def list_plugins():
    if not INSTALLED_PLUGINS.exists():
        return []
    try:
        data = json.loads(_safe_read(INSTALLED_PLUGINS))
    except Exception:
        return []
    plugins_raw = data.get("plugins", {}) if isinstance(data, dict) else {}
    s = _get_settings()
    enabled_map = s.get("enabledPlugins", {}) if isinstance(s, dict) else {}
    out: list = []
    for plugin_id, installs in (plugins_raw if isinstance(plugins_raw, dict) else {}).items():
        if not isinstance(installs, list) or not installs:
            continue
        latest = installs[-1] if isinstance(installs[-1], dict) else {}
        name = plugin_id.split("@")[0] if "@" in plugin_id else plugin_id
        out.append({
            "id": plugin_id,
            "name": name,
            "version": latest.get("version", ""),
            "enabled": bool(enabled_map.get(plugin_id, False)),
            "installedAt": latest.get("installedAt", ""),
        })
    return out


@router.get("/connectors")
async def list_connectors():
    platform: list = []
    local: list = []
    seen: set = set()

    # 글로벌 ~/.claude.json
    if CLAUDE_JSON.exists():
        try:
            data = json.loads(_safe_read(CLAUDE_JSON))
            _add_mcp_entries(data.get("mcpServers", {}), platform, local, seen)
        except Exception:
            pass

    # 프로젝트 레벨 .mcp.json
    for proj_path in _iter_project_paths():
        mcp_json = proj_path / ".mcp.json"
        if mcp_json.exists():
            try:
                data = json.loads(_safe_read(mcp_json))
                _add_mcp_entries(data.get("mcpServers", {}), platform, local, seen)
            except Exception:
                pass

    return {"platform": platform, "local": local}


@router.get("/projects")
async def list_projects():
    projects: list = []
    if PROJECTS_DIR.exists():
        for p in sorted(PROJECTS_DIR.iterdir()):
            if not p.is_dir():
                continue
            cmd = p / "CLAUDE.md"
            projects.append({
                "name": p.name,
                "path": str(p),
                "hasClaudeMd": cmd.exists(),
            })
    return {"projects": projects}


@router.get("/settings")
async def get_settings_api():
    return _get_settings()


@router.get("/briefing/overview")
async def briefing_overview():
    today = _today_history_stats()
    skills_count = sum(1 for p in SKILLS_DIR.iterdir() if p.is_dir() or p.is_symlink()) if SKILLS_DIR.exists() else 0

    # 에이전트: 글로벌 + 프로젝트 레벨 (stem 기준 중복 제거)
    seen_agents: set = set()
    if AGENTS_DIR.exists():
        for p in AGENTS_DIR.glob("*.md"):
            seen_agents.add(p.stem)
    for proj_path in _iter_project_paths():
        a_dir = proj_path / ".claude" / "agents"
        if a_dir.exists():
            for p in a_dir.glob("*.md"):
                seen_agents.add(p.stem)
    agents_count = len(seen_agents)

    # 훅: 글로벌 + 프로젝트 레벨
    s = _get_settings()
    hooks_count = len(_collect_hooks_from_settings(s))
    for proj_path in _iter_project_paths():
        proj_settings = proj_path / ".claude" / "settings.json"
        if proj_settings.exists():
            try:
                ps = json.loads(_safe_read(proj_settings))
                hooks_count += len(_collect_hooks_from_settings(ps))
            except Exception:
                pass

    plugins_count = 0
    if INSTALLED_PLUGINS.exists():
        try:
            pdata = json.loads(_safe_read(INSTALLED_PLUGINS))
            plugins_count = len(pdata.get("plugins", {}))
        except Exception:
            pass

    # 커넥터: 글로벌 ~/.claude.json + 프로젝트 .mcp.json
    seen_connectors: set = set()
    if CLAUDE_JSON.exists():
        try:
            cdata = json.loads(_safe_read(CLAUDE_JSON))
            seen_connectors.update((cdata.get("mcpServers", {}) or {}).keys())
        except Exception:
            pass
    for proj_path in _iter_project_paths():
        mcp_json = proj_path / ".mcp.json"
        if mcp_json.exists():
            try:
                mdata = json.loads(_safe_read(mcp_json))
                seen_connectors.update((mdata.get("mcpServers", {}) or {}).keys())
            except Exception:
                pass
    connectors_count = len(seen_connectors)

    project_count = sum(1 for p in PROJECTS_DIR.iterdir() if p.is_dir()) if PROJECTS_DIR.exists() else 0
    task_count = sum(
        len(list(json.loads(_safe_read(f)) if f.suffix == ".json" else []))
        for f in (TODOS_DIR.glob("*.json") if TODOS_DIR.exists() else [])
        if True
    )
    session_count = len(list(SESSIONS_DIR.glob("*.json"))) if SESSIONS_DIR.exists() else 0

    return {
        "projectCount": project_count,
        "sessionCount": session_count,
        "commandCount": today["commandCount"],
        "todayProjectCount": today["projectCount"],
        "skillsCount": skills_count,
        "agentsCount": agents_count,
        "hooksCount": hooks_count,
        "pluginsCount": plugins_count,
        "connectorsCount": connectors_count,
        "lastUpdate": int(time.time() * 1000),
    }


@router.get("/briefing/schedule")
async def briefing_schedule():
    return {"scheduled": _read_scheduled_tasks(), "tasks": _read_tasks()}


@router.get("/briefing/projects-summary")
async def briefing_projects_summary():
    return {"summaries": _projects_summary()}


@router.get("/briefing/activity")
async def briefing_activity():
    today = _today_history_stats()
    return {
        "today": {"commandCount": today["commandCount"], "projectCount": today["projectCount"]},
        "activities": [],
    }


@router.get("/guide/recommended-settings")
async def get_recommended_settings():
    profiles = [
        {
            "name": "균형형 (Balanced)",
            "description": "기본적인 안전과 자동화를 균형있게 — 대부분의 작업에 권장",
            "settings": {"permissions": {"allow": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"], "deny": ["Bash(rm -rf:*)", "Bash(sudo:*)", "Edit(.env*)"]}},
        },
        {
            "name": "개발자형 (Developer)",
            "description": "자주 쓰는 도구를 자동 승인 — 빠른 반복 작업에 최적",
            "settings": {"permissions": {"allow": ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"], "deny": ["Bash(rm -rf /:*)", "Bash(sudo:*)", "Edit(.env*)", "Edit(secrets/**)"]}},
        },
        {
            "name": "안전 우선 (Cautious)",
            "description": "모든 변경 작업에 수동 승인 필요 — 민감한 프로젝트에 권장",
            "settings": {"permissions": {"allow": ["Read", "Glob", "Grep"], "deny": []}},
        },
        {
            "name": "탐색 모드 (Read-only)",
            "description": "읽기만 가능 — 시연이나 코드 탐색 전용",
            "settings": {"permissions": {"allow": ["Read", "Glob", "Grep"], "deny": ["Edit", "Write", "Bash", "WebFetch"]}},
        },
    ]

    # 현재 settings과 각 프로필 비교 → 일치율 계산
    s = _get_settings()
    cur_allow: list = []
    cur_deny: list = []
    p = s.get("permissions", {})
    if isinstance(p, dict):
        cur_allow = p.get("allow", []) or []
        cur_deny = p.get("deny", []) or []

    for prof in profiles:
        ref_allow = prof["settings"]["permissions"]["allow"]
        ref_deny = prof["settings"]["permissions"]["deny"]
        allow_set = set(ref_allow)
        deny_set = set(ref_deny)
        # 현재 allow 중 프로필 allow에 포함된 비율
        if allow_set:
            cur_allow_tools = {a.split("(")[0] for a in cur_allow}
            match_allow = len(allow_set & cur_allow_tools) / len(allow_set)
        else:
            match_allow = 1.0
        # 현재 deny 중 프로필 deny에 포함된 비율
        if deny_set:
            cur_deny_tools = {d.split("(")[0] for d in cur_deny}
            ref_deny_tools = {d.split("(")[0] for d in ref_deny}
            match_deny = len(ref_deny_tools & cur_deny_tools) / len(ref_deny_tools)
        else:
            match_deny = 1.0
        score = round((match_allow * 0.6 + match_deny * 0.4) * 100)
        prof["score"] = score

    return {
        "profiles": profiles,
        "current": {"allow": cur_allow[:20], "deny": cur_deny[:20]},
    }


@router.get("/archives")
async def list_archives():
    out: list = []
    for proj_path in _iter_project_paths():
        arch_dir = proj_path / ".claude" / "archives"
        if not arch_dir.exists():
            continue
        for p in sorted(arch_dir.glob("*.md")):
            try:
                mtime = int(p.stat().st_mtime * 1000)
                size = p.stat().st_size
            except Exception:
                mtime, size = 0, 0
            preview = _safe_read(p, 500).strip()
            out.append({
                "id": p.stem,
                "filename": p.name,
                "project": proj_path.name,
                "size": size,
                "updatedAt": mtime,
                "preview": preview,
            })
    return out


@router.get("/briefing/pending-approvals")
async def briefing_pending_approvals():
    out: list = []
    if not SESSIONS_DIR.exists():
        return {"approvals": [], "pending": out}
    now_ms = int(time.time() * 1000)
    for p in sorted(SESSIONS_DIR.glob("*.json")):
        try:
            sd = json.loads(_safe_read(p))
        except Exception:
            continue
        if not isinstance(sd, dict):
            continue
        sid = sd.get("sessionId")
        cwd = sd.get("cwd") or ""
        if not sid:
            continue
        jsonl_files = list(PROJECTS_DIR.glob(f"*/{sid}.jsonl"))
        if not jsonl_files:
            continue
        last_tool = None
        last_ts_ms = None
        try:
            text = jsonl_files[0].read_text(encoding="utf-8", errors="replace")
            for line in reversed(text.splitlines()[-150:]):
                try:
                    msg = json.loads(line)
                except Exception:
                    continue
                if msg.get("type") != "assistant":
                    continue
                content = (msg.get("message") or {}).get("content", [])
                if not isinstance(content, list):
                    continue
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        last_tool = c.get("name")
                        ts_str = msg.get("timestamp", "")
                        try:
                            last_ts_ms = int(
                                datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp() * 1000
                            )
                        except Exception:
                            pass
                        break
                if last_tool:
                    break
        except Exception:
            continue
        if not last_tool:
            continue
        age = max(0, (now_ms - last_ts_ms) // 1000) if last_ts_ms else 0
        out.append({
            "project": Path(cwd).name or sid[:8],
            "tool": last_tool,
            "device": _classify_device(cwd),
            "ageSeconds": int(age),
            "sessionId": sid,
        })
    out.sort(key=lambda x: x["ageSeconds"])
    return {"approvals": [], "pending": out}
