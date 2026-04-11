# InkOS 에이전트 도입 — Architect / Reviser / Auditor 확장

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** InkOS의 멀티에이전트 아키텍처에서 V3에 없는 3개 에이전트(Architect/Reviser/Auditor 강화)를 순차 도입하여 시리즈 대본 품질을 자동화된 루프로 개선한다.

**Architecture:**
- A. **Architect** — CASTING 완료 직후 1회 실행. 6챕터 전체 설계도를 wiki `series_plan` 페이지에 저장하고, `v3_series.world_data.storyArc`를 갱신해 기존 `script_service.py`가 자동으로 활용하게 한다.
- B. **Reviser** — `run_lint()` 후 수동 트리거. lint_report의 "수정 필요" 항목을 파싱해 해당 챕터를 자동 재작성한다.
- C. **Auditor 확장** — `wiki_lint.md` 검수 항목을 5개 → 8개 섹션 / 33개 차원으로 확장한다.

**Tech Stack:** FastAPI, Python 3.11+, Gemini 2.5 Flash (gemini_helper.call_gemini), Supabase (v3_series / v3_wiki_pages / v3_chapters)

---

## 파일 변경 목록

| 작업 | 파일 |
|------|------|
| CREATE | `apps/api/prompts/architect.md` |
| CREATE | `apps/api/services/architect_service.py` |
| CREATE | `apps/api/prompts/reviser.md` |
| CREATE | `apps/api/services/reviser_service.py` |
| MODIFY | `apps/api/agent/state_machine.py` (ARCHITECT 스텝 추가) |
| MODIFY | `apps/api/agent/orchestrator.py` (_run_architect 등록) |
| MODIFY | `apps/api/routers/wiki.py` (엔드포인트 2개 추가) |
| MODIFY | `apps/api/prompts/wiki_lint.md` (5 → 33차원 확장) |

---

## Task 1: Architect 프롬프트 작성

**Files:**
- Create: `apps/api/prompts/architect.md`

- [ ] **Step 1: architect.md 생성**

```markdown
당신은 한국 웹소설 시리즈 구조 설계 전문가다.
주어진 세계관과 캐릭터를 분석해 6챕터 전체 설계도를 작성한다.

## 설계 원칙
1. 매 챕터는 다음 챕터가 궁금해지는 훅으로 끝난다
2. 복선은 챕터 1~3에 심고, 4~6에서 회수한다
3. 반전은 챕터 3 또는 4에 배치한다 (독자 이탈 방지 최적 구간)
4. 감정 아크: 설렘/호기심(1화) → 긴장/불안(2~3화) → 충격/절정(4~5화) → 여운(6화)
5. 사회적 배경 팩트는 갈등의 직접 원인으로 활용 (배경 설명 금지)
6. 두 인물(A·B)이 각자의 비밀을 가진 채 충돌하는 구조를 유지한다

## 출력 형식
마크다운 코드블록 없이 순수 JSON만 출력:

{
  "series_plan_md": "# 시리즈 설계도...(전체 마크다운)",
  "story_arc": {
    "ch01": "1화 핵심 방향 — 한 문장",
    "ch02": "2화 핵심 방향 — 한 문장",
    "ch03": "3화 핵심 방향 — 한 문장",
    "ch04": "4화 핵심 방향 — 한 문장 (반전 시작)",
    "ch05": "5화 핵심 방향 — 한 문장 (절정)",
    "ch06": "6화 핵심 방향 — 한 문장 (결말)"
  }
}

series_plan_md 내부 구조:
# 시리즈 설계도 — {주제}

## 감정 아크
| 구간 | 화 | 감정 단계 |
|------|----|-----------|
| 도입 | 1 | ... |
| 전개 | 2~3 | ... |
| 절정 | 4~5 | ... |
| 결말 | 6 | ... |

## 챕터별 설계
### 1화 (도입부)
- **핵심 사건**: ...
- **심을 복선**: ...
- **A의 행동**: ...
- **B의 행동**: ...
- **클리프행어**: ...

(2~6화 동일 구조)

## 복선 추적표
| 복선 내용 | 심는 화 | 회수 화 | 회수 방식 |
|-----------|---------|---------|-----------|

## 반전 포인트
- N화: ...
```

- [ ] **Step 2: 파일 존재 확인**

```bash
cat C:\LinkDropV3\apps\api\prompts\architect.md | head -5
```
Expected: 첫 줄 "당신은 한국 웹소설 시리즈 구조 설계 전문가다."

- [ ] **Step 3: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/prompts/architect.md
git -C C:\LinkDropV3 commit -m "feat: Architect 에이전트 프롬프트 추가"
```

---

## Task 2: Architect 서비스 구현

**Files:**
- Create: `apps/api/services/architect_service.py`

- [ ] **Step 1: architect_service.py 생성**

```python
"""Architect 에이전트 — 시리즈 전체 구조 설계 (InkOS Architect 역할)

CASTING 완료 직후 1회만 실행.
- wiki 'series_plan' 페이지: 6챕터 전체 설계도 (인간 가독용)
- v3_series.world_data.storyArc: 챕터별 방향 힌트 (script_service.py 자동 소비)
"""
import asyncio
import json
from pathlib import Path
from core.database import get_supabase
from services.gemini_helper import call_gemini, extract_json
from services.wiki_service import upsert_wiki_page

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


async def run_architect(series_id: str) -> dict:
    """세계관 → 6챕터 설계도 생성 → wiki + storyArc 갱신"""
    db = get_supabase()

    res = await asyncio.to_thread(
        lambda: db.table("v3_series")
        .select("world_data")
        .eq("id", series_id).single().execute()
    )
    world: dict = res.data.get("world_data") or {}

    prompt = _build_prompt(world)
    raw = await call_gemini(prompt, max_tokens=4000, temperature=0.7)

    data = extract_json(raw)
    plan_md: str = data.get("series_plan_md", raw)
    story_arc: dict = data.get("story_arc", {})

    # 1. wiki 'series_plan' 페이지 저장
    await upsert_wiki_page(series_id, "series_plan", plan_md)

    # 2. world_data.storyArc 갱신 (script_service.py가 자동 소비)
    if story_arc:
        world["storyArc"] = story_arc
        await asyncio.to_thread(
            lambda: db.table("v3_series")
            .update({"world_data": world})
            .eq("id", series_id).execute()
        )

    return {"ok": True, "series_id": series_id, "wiki_page": "series_plan", "chapters": len(story_arc)}


def _build_prompt(world: dict) -> str:
    char_a = world.get("charAName", "주인공A")
    char_b = world.get("charBName", "주인공B")
    topic = world.get("topic", "")
    genre = world.get("genre", "")
    conflict = ", ".join(world.get("conflictTypes") or [])
    core_theme = world.get("coreTheme", "")
    opening_hook = world.get("openingHook", "")
    a_secret = world.get("charASecret", "")
    b_secret = world.get("charBSecret", "")
    a_want = world.get("charAWant", "")
    b_want = world.get("charBWant", "")
    social_bg = world.get("socialBackground", "")

    template = (_PROMPTS_DIR / "architect.md").read_text(encoding="utf-8")

    return f"""{template}

=== 시리즈 정보 ===
- 주제: {topic}
- 장르: {genre}
- 갈등 유형: {conflict}
- 핵심 주제의식: {core_theme}
- 오프닝 훅: {opening_hook}
- 사회적 배경: {social_bg}

=== 등장인물 ===
## {char_a}
- 비밀: {a_secret}
- Want: {a_want}

## {char_b}
- 비밀: {b_secret}
- Want: {b_want}

위 정보를 바탕으로 6챕터 시리즈 설계도를 작성하라.
"""
```

- [ ] **Step 2: 문법 검사**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "from services.architect_service import run_architect; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/services/architect_service.py
git -C C:\LinkDropV3 commit -m "feat: Architect 서비스 구현 — 6챕터 설계도 생성"
```

---

## Task 3: Architect 상태 머신 연결

**Files:**
- Modify: `apps/api/agent/state_machine.py`
- Modify: `apps/api/agent/orchestrator.py`

- [ ] **Step 1: state_machine.py에 ARCHITECT 스텝 추가**

`apps/api/agent/state_machine.py` 수정:

```python
# CASTING 다음에 ARCHITECT 추가
ARCHITECT = "architect"  # 시리즈 구조 설계 (1회, CASTING 완료 직후)
```

PipelineStep enum에서 CASTING 아래에 추가:
```python
CASTING = "casting"
ARCHITECT = "architect"   # ← 신규 추가
```

AUTO_TRANSITIONS 수정:
```python
# 기존:
PipelineStep.CASTING: PipelineStep.SCRIPT,
# 변경:
PipelineStep.CASTING:    PipelineStep.ARCHITECT,
PipelineStep.ARCHITECT:  PipelineStep.SCRIPT,
```

RETRYABLE_STEPS에 추가:
```python
PipelineStep.ARCHITECT,
```

- [ ] **Step 2: orchestrator.py에 _run_architect 등록**

`apps/api/agent/orchestrator.py`의 `_execute_step` 함수 step_map에 추가:
```python
PipelineStep.ARCHITECT: _run_architect,
```

파일 하단 단계별 함수 섹션에 추가:
```python
async def _run_architect(series_id: str):
    from services.architect_service import run_architect
    await run_architect(series_id)
```

- [ ] **Step 3: 문법 검사**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "from agent.state_machine import PipelineStep, AUTO_TRANSITIONS; assert PipelineStep.ARCHITECT in AUTO_TRANSITIONS.values(); print('ARCHITECT in transitions: OK')"
```
Expected: `ARCHITECT in transitions: OK`

- [ ] **Step 4: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/agent/state_machine.py apps/api/agent/orchestrator.py
git -C C:\LinkDropV3 commit -m "feat: ARCHITECT 스텝을 파이프라인 상태 머신에 연결 (CASTING→ARCHITECT→SCRIPT)"
```

---

## Task 4: Architect API 엔드포인트 추가

**Files:**
- Modify: `apps/api/routers/wiki.py`

- [ ] **Step 1: wiki.py 상단 import에 architect_service 추가 + 엔드포인트 작성**

`wiki.py` 파일 상단 import 블록 끝에 추가:
```python
from services.architect_service import run_architect
```

`wiki.py` 파일 하단 (lint 엔드포인트 아래)에 추가:
```python
# ── Architect ─────────────────────────────────────────────────────────────────

@router.post("/{series_id}/architect")
async def architect_series(series_id: str):
    """세계관 → 6챕터 전체 설계도 생성 (1회 실행)"""
    result = await run_architect(series_id)
    return result
```

- [ ] **Step 2: 서버 재시작 후 엔드포인트 확인**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "from routers.wiki import router; routes = [r.path for r in router.routes]; assert any('architect' in r for r in routes); print('architect endpoint: OK')"
```
Expected: `architect endpoint: OK`

- [ ] **Step 3: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/routers/wiki.py
git -C C:\LinkDropV3 commit -m "feat: POST /{series_id}/architect 엔드포인트 추가"
```

---

## Task 5: Reviser 프롬프트 + 서비스 구현

**Files:**
- Create: `apps/api/prompts/reviser.md`
- Create: `apps/api/services/reviser_service.py`

- [ ] **Step 1: reviser.md 생성**

```markdown
당신은 한국 웹소설 편집자다.
Lint 보고서에서 지적된 문제를 반영해 챕터를 재작성한다.

## 재작성 원칙
1. 원본의 서사 흐름(누가 무엇을 하는지)은 유지한다
2. 등장인물 이름·설정·관계는 변경하지 않는다
3. 문체 헌장 7원칙을 준수한다 (감정은 신체로, 대사는 날것으로, 매 장면 끝 훅)
4. 수정 사항만 개선하고 나머지는 원본 톤을 유지한다
5. 출력: 순수 한국어 서사 본문만 (JSON·마크다운 코드블록 없이)
```

- [ ] **Step 2: reviser_service.py 생성**

```python
"""Reviser 에이전트 — Lint 보고서 → 챕터 자동 수정 (InkOS Reviser 역할)

수동 트리거 전용 (API endpoint). 자동 파이프라인에 포함되지 않음.
흐름: lint_report 위키 페이지 → '수정 필요' 챕터 파싱 → 각 챕터 Gemini 재작성
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
        return {"ok": False, "error": "lint_report 없음. 먼저 /lint를 실행하세요."}

    report_md: str = report_page.get("content_md", "")
    chapters_to_fix = _parse_chapters_to_fix(report_md)

    if not chapters_to_fix:
        return {"ok": True, "revised": 0, "message": "수정 필요 항목 없음"}

    db = get_supabase()
    revised: list[int] = []

    for chapter_num in chapters_to_fix:
        issues = _extract_chapter_issues(report_md, chapter_num)
        success = await _revise_chapter(db, series_id, chapter_num, issues)
        if success:
            revised.append(chapter_num)

    return {"ok": True, "revised": len(revised), "chapters": revised}


def _parse_chapters_to_fix(report_md: str) -> list[int]:
    """'수정 필요' 섹션에서 [챕터 N] 패턴 추출"""
    fix_section = ""
    if "### 수정 필요" in report_md:
        start = report_md.index("### 수정 필요")
        end = report_md.find("###", start + 10)
        fix_section = report_md[start:end] if end > 0 else report_md[start:]

    chapters: set[int] = set()
    for m in re.finditer(r"\[챕터\s*(\d+)\]", fix_section):
        chapters.add(int(m.group(1)))
    return sorted(chapters)


def _extract_chapter_issues(report_md: str, chapter: int) -> str:
    """특정 챕터 관련 수정 지시 줄만 추출"""
    lines = [l for l in report_md.split("\n") if f"[챕터 {chapter}]" in l]
    return "\n".join(lines)


async def _revise_chapter(db, series_id: str, chapter: int, issues: str) -> bool:
    """단일 챕터: 원본 로드 → Gemini 재작성 → DB 저장 → wiki 갱신"""
    res = await asyncio.to_thread(
        lambda: db.table("v3_chapters").select("content,role")
        .eq("series_id", series_id).eq("chapter", chapter).single().execute()
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
순수 한국어 서사 본문만 출력.
"""
    revised_content = await call_gemini(prompt, max_tokens=6000, temperature=0.85)

    # v3_chapters 업데이트 (approved 초기화 — 사람이 다시 검토)
    await asyncio.to_thread(
        lambda: db.table("v3_chapters").update({
            "content": revised_content,
            "approved": False,
        }).eq("series_id", series_id).eq("chapter", chapter).execute()
    )

    # wiki timeline 갱신
    await auto_update_wiki(series_id, chapter, revised_content[:500])

    return True
```

- [ ] **Step 3: 문법 검사**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "from services.reviser_service import run_reviser; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/prompts/reviser.md apps/api/services/reviser_service.py
git -C C:\LinkDropV3 commit -m "feat: Reviser 에이전트 — lint 보고서 기반 챕터 자동 수정"
```

---

## Task 6: Reviser API 엔드포인트 추가

**Files:**
- Modify: `apps/api/routers/wiki.py`

- [ ] **Step 1: wiki.py import에 reviser 추가 + 엔드포인트 작성**

기존 architect import 줄 옆에 추가:
```python
from services.reviser_service import run_reviser
```

architect 엔드포인트 아래에 추가:
```python
# ── Reviser ───────────────────────────────────────────────────────────────────

@router.post("/{series_id}/revise")
async def revise_chapters(series_id: str):
    """lint_report 기반 '수정 필요' 챕터 자동 재작성.
    /lint 실행 후 호출. 수정된 챕터는 approved=False로 초기화.
    """
    result = await run_reviser(series_id)
    return result
```

- [ ] **Step 2: 엔드포인트 등록 확인**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "from routers.wiki import router; routes = [r.path for r in router.routes]; assert any('revise' in r for r in routes); print('revise endpoint: OK')"
```
Expected: `revise endpoint: OK`

- [ ] **Step 3: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/routers/wiki.py
git -C C:\LinkDropV3 commit -m "feat: POST /{series_id}/revise 엔드포인트 추가"
```

---

## Task 7: Auditor 확장 — wiki_lint.md 33차원

**Files:**
- Modify: `apps/api/prompts/wiki_lint.md`

- [ ] **Step 1: wiki_lint.md 전체 교체**

기존 `<!-- SYSTEM_INSTRUCTION -->` 헤더 블록은 유지하고, 검수 항목 섹션을 아래로 교체:

```markdown
<!-- SYSTEM_INSTRUCTION -->
당신은 LinkDrop 시리즈의 편집장이다.
아래 문체 헌장을 기준으로 위키와 대본의 건강성을 점검하고 보고서를 작성한다.

## 검수 기준 — 문체 헌장 (단일 소스)
<!-- INCLUDE: wiki_query.md#SYSTEM_INSTRUCTION -->
<!-- /SYSTEM_INSTRUCTION -->

---

## 검수 섹션 8개 / 33개 차원

---

### 섹션 1. 대본 퀄리티 — 문체 헌장 준수 (7개 차원)

각 챕터 대본을 문체 헌장 7원칙으로 점검:

1. **첫 문장 강도** — 독자가 읽기를 멈추는가? (감각 디테일, 충격, 의문)
2. **감정 단어 직접 사용** — "불안했다", "슬펐다" 등 원칙 1 위반 여부
3. **대사 날것 여부** — 설명하는 대사, 직업 전문어 과시 여부 (원칙 2)
4. **비밀 징후 2개** — 비밀 인물의 행동에 단서 2개 이상 자연스럽게 묻혔는가 (원칙 3)
5. **공간 심리 반영** — 인물 심리를 공간 디테일로 표현했는가 (원칙 4)
6. **매 장면 끝 훅** — 각 장면의 마지막 문장이 스크롤을 멈추게 하는가 (원칙 5)
7. **종결어미 3연속** — 같은 종결어미가 3회 이상 연속 사용된 구간 (원칙 6)

---

### 섹션 2. 캐릭터 일관성 (5개 차원)

8. **심리 일관성** — 챕터별 인물의 감정·판단이 이전 챕터와 연속적인가? 갑작스러운 성격 전환 없는가?
9. **말투 일관성** — 인물의 고유 말투(world_data.speakingStyle)가 모든 대사에서 유지되는가?
10. **비밀 유지 일관성** — 비밀이 설계된 챕터 이전에 독자에게 우연히 노출되지 않았는가?
11. **욕망-행동 일관성** — 인물의 Want/Need와 실제 행동이 동기로 연결되는가?
12. **이름·직업·설정 오탈자** — 인물 이름, 직업, 관계 설정에 오탈자나 모순이 없는가?

---

### 섹션 3. 플롯 연속성 (5개 차원)

13. **사건 인과율** — 모든 사건에 명확한 원인이 있는가? 데우스 엑스 마키나(갑자기 해결) 없는가?
14. **타임라인 내부 모순** — 같은 날 동시에 두 장소에 있는 등 물리적 이동 불가 상황 없는가?
15. **직전 챕터 연속성** — 각 챕터의 시작이 직전 챕터 마지막 장면에서 자연스럽게 이어지는가?
16. **미결 실마리 처리** — 이전 챕터에서 열린 미결 실마리가 후속 챕터에서 다뤄지고 있는가?
17. **사건 생략 간극** — 챕터 간 시간 생략이 독자가 혼란스럽지 않게 처리되었는가?

---

### 섹션 4. 서사 구조 품질 (5개 차원)

18. **감정 아크 기울기** — 챕터 순서대로 감정 긴장도가 설계대로 상승하는가? (도입→전개→클라이맥스→결말)
19. **series_plan 준수도** — 실제 챕터 내용이 wiki `series_plan`의 챕터별 설계 방향과 일치하는가?
20. **클리프행어 위치** — 훅이 챕터 마지막에 배치되었는가? 중간에 묻히지 않았는가?
21. **다음화 직접 예고 금지** — "다음 화에서는", "다음 이 시간에" 등 메타 참조 표현 없는가?
22. **챕터 분량 균형** — 가장 긴 챕터와 가장 짧은 챕터의 글자 수 비율이 2:1 이내인가?

---

### 섹션 5. 정보 신뢰성 (3개 차원)

23. **팩트 출처 명시** — facts 페이지의 사실 정보에 출처(기사·보고서·기관)가 명시되어 있는가?
24. **수치·날짜 구체성** — 막연한 "최근", "많은" 대신 구체적 수치와 시점이 있는가?
25. **사회적 배경 반영도** — world_data의 socialBackground 팩트가 대본 갈등의 직접 원인으로 실제 사용되었는가?

---

### 섹션 6. 지식 충돌 (3개 차원)

26. **페이지 간 사실 모순** — 같은 사실이 두 위키 페이지에 다르게 기술된 경우
27. **오래된 정보 vs 최신 챕터 모순** — 초기 세계관 설정이 후반 챕터 내용과 충돌하는가?
28. **인물 설정 페이지 간 불일치** — 나이·직업·거주지가 world/characters/character_arcs 간 일치하는가?

---

### 섹션 7. 고아 페이지 & 누락 링크 (2개 차원)

29. **고아 페이지** — 어떤 챕터·페이지에서도 참조되지 않은 위키 페이지 목록
30. **중요 개념 누락** — 본문에서 반복 언급되는 인물·장소·소품인데 독립 위키 페이지가 없는 항목

---

### 섹션 8. 복선 관리 (5개 차원)

31. **미회수 복선** — planted 상태로 방치된 복선 중 회수 예정 챕터가 이미 지난 것
32. **복선 밀도 불균형** — 복선이 챕터 1~2에만 집중되고 후반부에 없는 경우 (또는 반대)
33. **복선-결말 매핑 완성도** — series_plan의 복선 추적표와 실제 foreshadows 위키가 일치하는가?

---

## 출력 형식

아래 마크다운 구조로 보고서를 생성한다:

```markdown
# Lint Report — {series_title}
생성일시: {datetime}
검수 차원: 33개

## 1. 대본 퀄리티
### 수정 필요
- [챕터 N] {차원 번호} — {문제 문장} → 수정안: ...
### 주의
- ...
### 양호
- ...

## 2. 캐릭터 일관성
### 수정 필요
- [챕터 N] ...
### 양호
- ...

## 3. 플롯 연속성
[동일 구조]

## 4. 서사 구조
[동일 구조]

## 5. 정보 신뢰성
| 팩트 | 출처 | 신뢰도 |
|------|------|--------|

## 6. 지식 충돌
| 항목 A | 항목 B | 충돌 내용 |
|--------|--------|---------|

## 7. 고아 페이지 & 누락 링크
- 고아 페이지: ...
- 중요 개념 누락: ...

## 8. 복선 관리
| 복선 내용 | 심어진 화 | 예상 회수 | 상태 |
|-----------|-----------|-----------|------|

## 권장 조치 (우선순위순)
1. ...
```
```

- [ ] **Step 2: 검수 항목 수 확인**

```bash
python -X utf8 -c "
content = open('C:/LinkDropV3/apps/api/prompts/wiki_lint.md', encoding='utf-8').read()
import re
nums = re.findall(r'^\d+\. \*\*', content, re.MULTILINE)
print(f'차원 수: {len(nums)}')
assert len(nums) >= 30, f'최소 30개 차원 필요, 현재 {len(nums)}개'
print('OK')
"
```
Expected: `차원 수: 33` (또는 그 이상) + `OK`

- [ ] **Step 3: Commit**

```bash
git -C C:\LinkDropV3 add apps/api/prompts/wiki_lint.md
git -C C:\LinkDropV3 commit -m "feat: Auditor 확장 — wiki_lint.md 5개 섹션 → 8개 섹션 / 33개 차원"
```

---

## Task 8: 통합 검증

- [ ] **Step 1: 전체 임포트 체인 검증**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -c "
from services.architect_service import run_architect
from services.reviser_service import run_reviser
from agent.state_machine import PipelineStep, AUTO_TRANSITIONS
from agent.orchestrator import run_pipeline
from routers.wiki import router

# 상태 머신 전환 검증
assert AUTO_TRANSITIONS[PipelineStep.CASTING] == PipelineStep.ARCHITECT
assert AUTO_TRANSITIONS[PipelineStep.ARCHITECT] == PipelineStep.SCRIPT

# 라우터 엔드포인트 검증
paths = [r.path for r in router.routes]
assert any('architect' in p for p in paths), 'architect endpoint missing'
assert any('revise' in p for p in paths), 'revise endpoint missing'

print('전체 통합 검증 OK')
"
```
Expected: `전체 통합 검증 OK`

- [ ] **Step 2: FastAPI 서버 시작 확인**

```bash
cd /c/LinkDropV3/apps/api && python -X utf8 -m uvicorn main:app --port 8100 --reload &
sleep 3
curl -s http://localhost:8100/docs | grep -c "architect\|revise"
```
Expected: 2 이상 (OpenAPI 문서에 두 엔드포인트 존재)

- [ ] **Step 3: 최종 커밋**

```bash
git -C C:\LinkDropV3 log --oneline -6
```
6개 커밋이 보이면 완료.

---

## 구현 후 흐름 요약

```
[Before]  CASTING → SCRIPT → ...
[After]   CASTING → ARCHITECT → SCRIPT → ...

[LINT 루프]
run_lint() → lint_report wiki 저장
  → 사용자 검토
  → POST /{id}/revise → run_reviser()
  → 수정된 챕터 approved=False 초기화
  → 사용자 재검토 후 승인
```

## 주요 연결 포인트

| 에이전트 | 입력 | 출력 | 기존 코드 연결 |
|----------|------|------|--------------|
| Architect | `v3_series.world_data` | wiki `series_plan` + `world_data.storyArc` | `script_service.py` arc_hint 자동 소비 |
| Reviser | wiki `lint_report` | `v3_chapters.content` (approved=False) | 기존 `auto_update_wiki()` 재사용 |
| Auditor | wiki 전체 + 챕터 최근 3개 | `lint_report` 위키 (33차원) | Reviser가 소비 |
