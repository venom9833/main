#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
watchdog-scriptrule.py — 프롬프트 파일 변경 감시 + 규칙 중복·충돌 자동 검출
                          + 텔레그램 알림 (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)

동작 모드:
    python watchdog-scriptrule.py          # 상시 감시 모드 (Ctrl+C로 종료)
    python watchdog-scriptrule.py --scan   # 1회 즉시 스캔 후 종료
    python watchdog-scriptrule.py -v       # 상세 diff 출력 포함

트리거 조건:
    - 신규 .md 파일 생성 → 내용 요약 + 전체 규칙 재검사  → 텔레그램 알림
    - 기존 .md 파일 수정 → 변경 diff + 영향 규칙 식별   → 텔레그램 알림
    - 기존 .md 파일 삭제 → 경고                          → 텔레그램 알림
    - 규칙 충돌 감지     → 이슈 목록 (이슈 없으면 무음)  → 텔레그램 알림

감지 항목:
    1. 수치 충돌   — 같은 키워드에 다른 숫자값이 여러 파일에 존재
    2. 구문 중복   — 동일 규칙 문구가 3개+ 파일에 중복 선언
    3. 금지 패턴   — 이전에 제거된 패턴이 재등장
    4. 파일 크기   — 임계값 초과 (wiki_query.md: 10,000 bytes 목표)

텔레그램 설정 (.env):
    TELEGRAM_BOT_TOKEN=<BotFather에서 발급>
    TELEGRAM_CHAT_ID=<봇과 대화 후 /getUpdates 로 확인>
"""
import difflib
import io
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Windows CP949 환경에서 UTF-8 출력 강제
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── dotenv 로드 (프로젝트 루트 .env) ─────────────────────────────────────────

_ROOT = Path(__file__).parent.parent.parent.parent  # C:\LinkDropV3
_ENV_PATH = _ROOT / ".env"

try:
    from dotenv import load_dotenv
    load_dotenv(_ENV_PATH, override=False)
except ImportError:
    # dotenv 없으면 직접 파싱
    if _ENV_PATH.exists():
        for _line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ── 설정 ─────────────────────────────────────────────────────────────────────

PROMPTS_DIR   = Path(__file__).parent
POLL_INTERVAL = 1.0   # 감시 주기 (초)

TELEGRAM_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

SKIP_FILES = {
    "style_refs.md",
    "watchdog-scriptrule.md",
    "watchdog-scriptrule.py",
}

NUMERIC_RULES = [
    ("대사.*비율|비율.*대사",         r"(\d+)\s*%",      "%"),
    ("종결어미.*연속|연속.*종결어미",  r"(\d+)\s*회",     "회"),
    ("글자.*이상|최소.*자",           r"(\d[\d,]*)\s*자", "자"),
]

RULE_PHRASES = [
    "감정은 신체",
    "대사는 날것",
    "비밀.*단서 2개",
    "공간.*심리",
    "매 장면 끝.*훅",
    "종결어미.*3회",
]

FORBIDDEN_PATTERNS = [
    ("INCLUDE.*wiki_query",    "wiki_lint.md에서 INCLUDE 재등장 금지"),
    ("STEP 4.*자체 Lint",      "STEP 4 자체 lint 블록 금지"),
    ("대사.*비율.*40",         "대사 비율 40% (구 값) 금지 — 30% 이하가 올바름"),
]

FILE_LIMITS = {
    "wiki_query.md":  10_000,
    "wiki_lint.md":   12_000,
    "reviser.md":      3_000,
    "architect.md":    4_000,
    "wiki_ingest.md":  5_000,
}

VERBOSE   = "-v" in sys.argv or "--verbose" in sys.argv
SCAN_ONCE = "--scan" in sys.argv

# ── 색상 (콘솔) ───────────────────────────────────────────────────────────────

def _r(s): return f"\033[91m{s}\033[0m"
def _y(s): return f"\033[93m{s}\033[0m"
def _g(s): return f"\033[92m{s}\033[0m"
def _b(s): return f"\033[94m{s}\033[0m"
def _bold(s): return f"\033[1m{s}\033[0m"
def _dim(s): return f"\033[2m{s}\033[0m"

# ── 텔레그램 ──────────────────────────────────────────────────────────────────

def tg_send(text: str) -> bool:
    """텔레그램 HTML 메시지 전송.
    TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 시 무음 스킵.
    실패해도 예외를 올리지 않는다 — watchdog 자체는 계속 동작.
    """
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        import requests  # noqa: PLC0415
        resp = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
            },
            timeout=10,
        )
        return resp.ok
    except Exception as exc:
        print(_dim(f"  [Telegram] 전송 실패: {exc}"))
        return False


def _esc(text: str) -> str:
    """HTML 특수문자 이스케이프 (Telegram HTML 모드용)"""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# ── 파일 상태 추적 ────────────────────────────────────────────────────────────

class FileSnapshot:
    """파일의 현재 상태 스냅샷"""
    __slots__ = ("mtime", "size", "content")

    def __init__(self, path: Path):
        stat = path.stat()
        self.mtime   = stat.st_mtime
        self.size    = stat.st_size
        self.content = path.read_text(encoding="utf-8", errors="replace")


def scan_dir() -> dict[str, FileSnapshot]:
    """prompts/ 내 감시 대상 .md 파일 전체 스냅샷"""
    result = {}
    for p in PROMPTS_DIR.glob("*.md"):
        if p.name not in SKIP_FILES:
            try:
                result[p.name] = FileSnapshot(p)
            except Exception:
                pass
    return result

# ── diff 출력 ─────────────────────────────────────────────────────────────────

def print_diff(fname: str, old: str, new: str):
    old_lines = old.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    diff = list(difflib.unified_diff(
        old_lines, new_lines,
        fromfile=f"{fname} (이전)",
        tofile=f"{fname} (변경 후)",
        lineterm="",
    ))

    if not diff:
        print(_dim("  (내용 동일 — mtime만 변경)"))
        return

    added   = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
    print(f"  {_g(f'+{added}줄 추가')}  {_r(f'-{removed}줄 삭제')}")

    if VERBOSE:
        for line in diff[:60]:
            line = line.rstrip("\n")
            if line.startswith("+++") or line.startswith("---"):
                print(_dim(f"  {line}"))
            elif line.startswith("+"):
                print(_g(f"  {line}"))
            elif line.startswith("-"):
                print(_r(f"  {line}"))
            elif line.startswith("@@"):
                print(_b(f"  {line}"))
            else:
                print(_dim(f"  {line}"))
        if len(diff) > 60:
            print(_dim(f"  ... (+{len(diff)-60}줄 생략)"))


def identify_affected_rules(diff_text: str) -> list[str]:
    affected = []
    checks = [
        ("감정.*신체|신체.*감정",  "감정→신체 표현 원칙"),
        ("대사.*날것",            "대사 날것 원칙"),
        ("비밀.*단서",            "비밀 단서 원칙"),
        ("공간.*심리|심리.*공간", "공간-심리 반영 원칙"),
        ("종결어미",              "종결어미 3연속 금지"),
        (r"\d+\s*%",             "수치(%) 관련 규칙"),
        ("훅",                   "훅 원칙"),
        ("대사.*비율|비율.*대사", "대사 비율"),
    ]
    for pattern, label in checks:
        if re.search(pattern, diff_text, re.IGNORECASE):
            affected.append(label)
    return affected

# ── 분석 엔진 ─────────────────────────────────────────────────────────────────

def strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def check_numeric_conflicts(files: dict[str, str]) -> list[dict]:
    issues = []
    for kw_pattern, num_pattern, unit in NUMERIC_RULES:
        found: dict[str, list[str]] = {}
        for fname, content in files.items():
            clean = strip_comments(content)
            for line in clean.splitlines():
                if re.search(kw_pattern, line, re.IGNORECASE):
                    nums = re.findall(num_pattern, line)
                    if nums:
                        found.setdefault(fname, []).extend(f"{n}{unit}" for n in nums)

        if len(found) < 2:
            continue

        file_rep = {f: max(set(v), key=v.count) for f, v in found.items()}
        if len(set(file_rep.values())) > 1:
            issues.append({
                "type": "NUMERIC_CONFLICT",
                "keyword": kw_pattern,
                "detail": {f: [v] for f, v in file_rep.items()},
                "values": set(file_rep.values()),
            })
    return issues


def check_phrase_duplicates(files: dict[str, str]) -> list[dict]:
    issues = []
    for phrase in RULE_PHRASES:
        matched: dict[str, list[str]] = {}
        for fname, content in files.items():
            clean = strip_comments(content)
            lines = [l.strip() for l in clean.splitlines()
                     if re.search(phrase, l, re.IGNORECASE)]
            if lines:
                matched[fname] = lines
        if len(matched) >= 2:
            issues.append({"phrase": phrase, "files": matched, "count": len(matched)})
    return issues


def check_forbidden(files: dict[str, str]) -> list[dict]:
    issues = []
    for pattern, reason in FORBIDDEN_PATTERNS:
        for fname, content in files.items():
            clean = strip_comments(content)
            hits = [(i+1, l.strip()) for i, l in enumerate(clean.splitlines())
                    if re.search(pattern, l, re.IGNORECASE)]
            if hits:
                issues.append({"pattern": pattern, "reason": reason,
                               "file": fname, "lines": hits})
    return issues


def check_file_sizes() -> list[dict]:
    issues = []
    for fname, limit in FILE_LIMITS.items():
        path = PROMPTS_DIR / fname
        if not path.exists():
            continue
        size = path.stat().st_size
        if size > limit:
            issues.append({"file": fname, "size": size,
                           "limit": limit, "over": size - limit})
    return issues

# ── 보고서 출력 + 텔레그램 ────────────────────────────────────────────────────

def _build_analysis_tg(numeric, triples, forbidden, sizes) -> str | None:
    """이슈가 있을 때만 텔레그램용 분석 메시지 반환. 이슈 없으면 None."""
    lines = []

    if numeric:
        for i in numeric:
            lines.append(f"❌ <b>수치충돌</b> [{_esc(i['keyword'])}] → {_esc(str(i['values']))}")
            for f, v in i["detail"].items():
                lines.append(f"   {_esc(f)}: {_esc(str(v))}")

    if forbidden:
        for i in forbidden:
            lines.append(f"❌ <b>금지패턴</b> {_esc(i['file'])}")
            lines.append(f"   {_esc(i['reason'])}")
            for lineno, line in i["lines"][:2]:
                lines.append(f"   L{lineno}: <code>{_esc(line[:60])}</code>")

    if sizes:
        for i in sizes:
            lines.append(
                f"⚠️ <b>크기초과</b> {_esc(i['file'])} "
                f"{i['size']:,}B (한도 {i['limit']:,}B, +{i['over']:,})"
            )

    if triples:
        for p in triples:
            lines.append(f"⚠️ <b>3파일 중복</b> [{_esc(p['phrase'])}] → {_esc(str(list(p['files'].keys())))}")

    if not lines:
        return None

    header = f"🔍 <b>Watchdog 분석 결과</b> — {datetime.now().strftime('%H:%M:%S')}\n"
    return header + "\n".join(lines)


def print_analysis(snapshots: dict[str, FileSnapshot]):
    """현재 스냅샷 기준 전체 분석 보고서 출력 + 이슈 시 텔레그램 전송"""
    files = {n: s.content for n, s in snapshots.items()}

    numeric   = check_numeric_conflicts(files)
    phrases   = check_phrase_duplicates(files)
    forbidden = check_forbidden(files)
    sizes     = check_file_sizes()

    triples = [p for p in phrases if p["count"] >= 3]
    dups    = [p for p in phrases if p["count"] == 2]
    issues  = len(numeric) + len(forbidden) + len(sizes)

    print(f"\n  {_bold('── 규칙 충돌 분석 ──────────────────────────')}")

    if numeric:
        for i in numeric:
            print(f"  {_r('❌ 수치충돌')} [{i['keyword']}] → {i['values']}")
            for f, v in i["detail"].items():
                print(f"     {f}: {v}")
    else:
        print(f"  {_g('✓')} 수치 충돌 없음")

    if triples:
        print(f"  {_y('⚠')} 3개+ 파일 중복 {len(triples)}건 (watchdog-scriptrule.md 2번 표 확인)")
        if VERBOSE:
            for p in triples:
                print(f"     [{p['phrase']}] → {list(p['files'].keys())}")
    else:
        print(f"  {_g('✓')} 구문 중복 설계 범위 내  {_dim(f'(2파일 중복 {len(dups)}건 = 정상)')}")

    if forbidden:
        for i in forbidden:
            print(f"  {_r('❌ 금지패턴')} {i['file']} — {i['reason']}")
            for lineno, line in i["lines"][:2]:
                print(f"     L{lineno}: {line[:70]}")
    else:
        print(f"  {_g('✓')} 금지 패턴 재등장 없음")

    if sizes:
        for i in sizes:
            print(f"  {_y('⚠')} {i['file']} {i['size']:,}B (한도 {i['limit']:,}B, +{i['over']:,} 초과)")
    else:
        print(f"  {_g('✓')} 모든 파일 크기 정상")

    if issues == 0 and not triples:
        print(f"\n  {_g('✅ 이상 없음')}")
    elif issues == 0:
        print(f"\n  {_y('⚠ 경고')} {len(triples)}건 (이슈 없음)")
    else:
        print(f"\n  {_r(f'❌ 이슈 {issues}건')} | {_y(f'경고 {len(triples)}건')}")

    # 텔레그램 — 이슈 있을 때만 전송 (정상 상태는 무음)
    tg_msg = _build_analysis_tg(numeric, triples, forbidden, sizes)
    if tg_msg:
        tg_send(tg_msg)

# ── 이벤트 처리 ───────────────────────────────────────────────────────────────

def handle_created(fname: str, snap: FileSnapshot):
    now = datetime.now().strftime("%H:%M:%S")
    print()
    print(_bold(f"┌─ [{now}] 📄 신규 파일 생성: {fname}"))
    print(f"│  크기: {snap.size:,} bytes  |  줄 수: {snap.content.count(chr(10))+1}줄")

    preview = snap.content.splitlines()[:10]
    print("│  미리보기:")
    for line in preview:
        print(f"│    {_dim(line[:80])}")
    if len(snap.content.splitlines()) > 10:
        print(f"│    {_dim('...')}")
    print("└" + "─" * 50)

    # 텔레그램
    preview_text = "\n".join(snap.content.splitlines()[:5])
    tg_send(
        f"📄 <b>신규 파일 생성</b> [{now}]\n"
        f"파일: <code>{_esc(fname)}</code>\n"
        f"크기: {snap.size:,} bytes | {snap.content.count(chr(10))+1}줄\n"
        f"<pre>{_esc(preview_text[:300])}</pre>"
    )


def handle_modified(fname: str, old: FileSnapshot, new: FileSnapshot):
    now = datetime.now().strftime("%H:%M:%S")
    size_delta = new.size - old.size
    delta_str  = (f"{_g(f'+{size_delta}B')}" if size_delta >= 0
                  else f"{_r(f'{size_delta}B')}")

    print()
    print(_bold(f"┌─ [{now}] ✏️  파일 수정: {fname}"))
    print(f"│  크기: {old.size:,} → {new.size:,} bytes ({delta_str})")
    print("│  변경 내용:")

    old_lines = old.content.splitlines(keepends=True)
    new_lines = new.content.splitlines(keepends=True)
    diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=""))
    added   = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))

    if not diff:
        print(f"│    {_dim('(내용 동일 — mtime만 갱신)')}")
    else:
        print(f"│    {_g(f'+{added}줄 추가')}  {_r(f'-{removed}줄 삭제')}")
        if VERBOSE:
            for line in diff[:40]:
                line = line.rstrip("\n")
                if   line.startswith("+++"): print(f"│    {_dim(line)}")
                elif line.startswith("---"): print(f"│    {_dim(line)}")
                elif line.startswith("+"):   print(f"│    {_g(line)}")
                elif line.startswith("-"):   print(f"│    {_r(line)}")
                elif line.startswith("@@"): print(f"│    {_b(line)}")
                else:                        print(f"│    {_dim(line)}")
            if len(diff) > 40:
                print(f"│    {_dim(f'... (생략 {len(diff)-40}줄)')}")

    changed_text = "".join(l for l in diff if l.startswith("+") or l.startswith("-"))
    affected = identify_affected_rules(changed_text)
    if affected:
        print(f"│  영향 규칙: {_y(' / '.join(affected))}")

    print("└" + "─" * 50)

    # 텔레그램
    tg_lines = [
        f"✏️ <b>파일 수정</b> [{now}]",
        f"파일: <code>{_esc(fname)}</code>",
        f"크기: {old.size:,} → {new.size:,} bytes ({'+' if size_delta >= 0 else ''}{size_delta}B)",
    ]
    if diff:
        tg_lines.append(f"변경: +{added}줄 추가 / -{removed}줄 삭제")
        # diff 요약 (추가·삭제줄만 최대 10줄)
        diff_preview = [
            l.rstrip("\n") for l in diff
            if (l.startswith("+") and not l.startswith("+++"))
            or (l.startswith("-") and not l.startswith("---"))
        ][:10]
        if diff_preview:
            tg_lines.append(f"<pre>{_esc(chr(10).join(diff_preview))}</pre>")
    else:
        tg_lines.append("(내용 동일 — mtime만 갱신)")
    if affected:
        tg_lines.append(f"영향 규칙: {_esc(' / '.join(affected))}")
    tg_send("\n".join(tg_lines))

# ── 감시 루프 ─────────────────────────────────────────────────────────────────

def watch():
    tg_status = "✅ 연결됨" if (TELEGRAM_TOKEN and TELEGRAM_CHAT_ID) else "⚠️ 미설정 (무음)"

    print(_bold("\n╔══════════════════════════════════════════════════╗"))
    print(_bold("║  Watchdog — Script Rule 파일 감시자 (가동 중)    ║"))
    print(_bold("╚══════════════════════════════════════════════════╝"))
    print(f"감시 경로 : {PROMPTS_DIR}")
    print(f"감시 주기 : {POLL_INTERVAL}초  |  종료: Ctrl+C")
    print(f"상세 출력 : {'ON' if VERBOSE else 'OFF (-v 옵션으로 활성화)'}")
    print(f"텔레그램  : {tg_status}")

    prev = scan_dir()
    fnames = sorted(prev.keys())
    print(f"초기 파일 : {fnames}\n")

    print(_bold("▶ 초기 분석"))
    print_analysis(prev)

    # 감시 시작 알림 (텔레그램)
    tg_send(
        f"🐕 <b>Watchdog 가동</b>\n"
        f"감시 경로: <code>apps/api/prompts/</code>\n"
        f"파일 수: {len(fnames)}개\n"
        f"감시 주기: {POLL_INTERVAL}초\n"
        f"이벤트 발생 시 알림 전송"
    )

    print(f"\n{_dim('감시 중...')}")

    try:
        while True:
            time.sleep(POLL_INTERVAL)
            curr = scan_dir()

            for fname in sorted(set(curr) - set(prev)):
                handle_created(fname, curr[fname])
                print_analysis(curr)

            for fname in sorted(set(curr) & set(prev)):
                p = curr[fname]
                o = prev[fname]
                if p.mtime != o.mtime or p.size != o.size:
                    handle_modified(fname, o, p)
                    print_analysis(curr)

            for fname in sorted(set(prev) - set(curr)):
                now = datetime.now().strftime("%H:%M:%S")
                print()
                print(_bold(f"┌─ [{now}] 🗑  파일 삭제: {fname}"))
                print("└" + "─" * 50)
                tg_send(
                    f"🗑 <b>파일 삭제</b> [{now}]\n"
                    f"파일: <code>{_esc(fname)}</code>"
                )
                print_analysis(curr)

            prev = curr

    except KeyboardInterrupt:
        print(f"\n\n{_dim('감시 종료 (Ctrl+C)')}")
        tg_send("🛑 <b>Watchdog 종료</b> (Ctrl+C)")


def scan_once():
    """--scan 모드: 즉시 1회 분석 후 종료"""
    print(_bold("\n╔══════════════════════════════════════════════════╗"))
    print(_bold("║  Watchdog — Script Rule 즉시 스캔                ║"))
    print(_bold("╚══════════════════════════════════════════════════╝\n"))
    snaps = scan_dir()
    fnames = sorted(snaps.keys())
    print(f"스캔 파일: {fnames}")

    print()
    for fname, snap in sorted(snaps.items()):
        size = snap.size
        bar  = "█" * (size // 1000) + "░" * max(0, 14 - size // 1000)
        over = _r(" ← 초과") if size > FILE_LIMITS.get(fname, 99999) else ""
        print(f"  {fname:<22} {size:>7,} B  {bar}{over}")

    print_analysis(snaps)
    print()

# ── 진입점 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if SCAN_ONCE:
        scan_once()
    else:
        watch()
