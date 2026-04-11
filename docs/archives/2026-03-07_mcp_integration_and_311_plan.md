# Milestone: MCP Integration & Python 3.11 Upgrade Decision
**Date:** 2026-03-07
**Status:** In Progress (Awaiting Python 3.11 Installation)

## 1. Summary of Achievements
- **MCP Unification:** Successfully integrated `fastapi-mcp` into `apps/api/main.py`.
- **SSE Support:** Configured `mount_sse()` for real-time Agent-Backend communication.
- **Diagnostic Success:** Identified and resolved 8000-port ghost processes, Windows CP949 encoding crashes, and path discrepancies for NotebookLM session files.
- **Login Verified:** Confirmed `venom9833@gmail.com` session is active and reachable via absolute path: `C:\Users\User\.notebooklm-mcp-cli\profiles\default\metadata.json`.

## 2. Identified Infrastructure Issues
- **Python Version Mismatch:** The current `.venv` is 3.10, but `notebooklm-mcp-cli` requires 3.11+. This led to using temporary `subprocess` and `uvx` hacks.
- **Ghost Processes:** Older FastAPI runs were not terminating correctly, blocking port 8000.
- **Encoding Crashes:** Unicode emojis and Korean strings in `print()` statements caused the server to crash on Windows consoles.

## 3. Agreed Strategy (Next Steps)
- **Standardization:** Entire system will be upgraded to **Python 3.11**.
- **Clean Reconstruction:** 
    1. Delete `apps/api/.venv`.
    2. Rebuild `.venv` using Python 3.11.
    3. Install all libraries directly (`fastapi-mcp`, `notebooklm-mcp-cli`, etc.).
- **Code Refactoring:**
    - Revert `subprocess` bridge in `services/notebooklm.py` to clean `import` logic.
    - Keep absolute paths for 100% stability on Windows.
    - Maintain English-only logging for console stability.

## 4. Continuity Note for Next Session
When starting the next session, the Agent must:
1. Verify if Python 3.11 is installed (`py --list`).
2. Execute the `.venv` reconstruction.
3. Remove the `CORE DEBUG` and `subprocess` logic in `main.py` and `notebooklm.py` to restore idiomatic library usage.
