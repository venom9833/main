---
description: LinkDrop 코드베이스 전체 검증 — 타입/린트/보안/git 상태 순서로 점검
---

# /verify — LinkDrop 검증 커맨드

현재 코드베이스를 순서대로 검증하고 최종 리포트를 출력합니다.

## 실행 순서

### 1. TypeScript 타입 체크
```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -50
```
오류 있으면 `file:line` 형식으로 보고.

### 2. Python 린트 (ruff)
```bash
apps/api/.venv/Scripts/python.exe -m ruff check apps/api/ --statistics 2>&1 | head -30
```
ruff 없으면 건너뜀.

### 3. console.log 감사
```bash
grep -r "console\.log" apps/web/src --include="*.ts" --include="*.tsx" -n | grep -v "\.test\." | grep -v "__tests__"
```

### 4. Secrets 패턴 감사
```bash
grep -rn "sk-[a-zA-Z0-9]\{20,\}\|AKIA[A-Z0-9]\{16\}\|AIza[0-9A-Za-z-_]\{35\}" apps/ --include="*.ts" --include="*.tsx" --include="*.py" 2>/dev/null
```

### 5. Git 상태
```bash
git status --short
git diff --stat HEAD~1 2>/dev/null | tail -5
```

## 최종 리포트 형식

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERIFY: [PASS / FAIL]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TypeScript : [OK / X 오류]
Python Lint: [OK / X 이슈]
console.log: [OK / X 개]
Secrets    : [OK / ⚠️ 발견]
Git 상태   : [Clean / X 파일 변경]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR 준비    : [YES / NO]
```

오류 있으면 파일 경로 + 수정 제안 포함.

## 인수

- `$ARGUMENTS`가 없거나 `full` → 전체 검사
- `quick` → TypeScript + git 상태만
- `pre-commit` → TypeScript + console.log + secrets
- `pre-pr` → 전체 + Python 린트 강화
