---
description: 작업 스냅샷 생성/확인/목록 — .claude/checkpoints.log에 기록
---

# /checkpoint — 작업 체크포인트

## 사용법

`/checkpoint [create|verify|list|clear] [이름]`

## create — 체크포인트 생성

1. git 상태 확인 (uncommitted 파일 유무)
2. `.claude/checkpoints.log`에 기록:
```bash
echo "$(date +%Y-%m-%d-%H:%M) | $NAME | $(git rev-parse --short HEAD) | $(git diff --stat HEAD | tail -1)" >> .claude/checkpoints.log
```
3. 생성 완료 메시지 출력

## verify — 체크포인트 비교

1. `.claude/checkpoints.log`에서 해당 이름 검색
2. 현재 상태와 비교:

```
CHECKPOINT 비교: $NAME
══════════════════════════════
기준 커밋  : abc1234 (2026-03-29 10:00)
현재 커밋  : def5678 (2026-03-29 14:30)
변경된 파일: X개
추가된 파일: Y개
```

## list — 목록 표시

```bash
cat .claude/checkpoints.log 2>/dev/null || echo "(체크포인트 없음)"
```

각 항목: 날짜·시간 | 이름 | git SHA | 변경 요약

## clear — 오래된 항목 정리

최근 5개만 남기고 삭제.

## 전형적인 워크플로우

```
[작업 시작] → /checkpoint create "feature-start"
     ↓
[핵심 구현] → /checkpoint create "core-done"
     ↓
[테스트]    → /checkpoint verify "core-done"
     ↓
[리팩터링]  → /checkpoint create "refactor-done"
     ↓
[PR 전]     → /checkpoint verify "feature-start"
```

## 인수

- `create <이름>` — 이름 있는 체크포인트 생성
- `verify <이름>` — 해당 체크포인트와 현재 상태 비교
- `list` — 전체 목록 표시
- `clear` — 최근 5개 이외 삭제
