---
name: HOOK 컷 반복 혼동 패턴
description: HOOK 컷 처리 로직에서 AI가 3~4회 반복 실수한 패턴과 최종 결론
type: feedback
---

HOOK 컷 관련 코드는 AI가 대화마다 혼동을 일으키는 고위험 영역이다. 아래 규칙을 매 세션 시작 시 반드시 숙지할 것.

**Why:** 2026-04-18까지 3~4번 반복 실수 발생. LD-013 → LD-014 → LD-015로 세 번 바뀜.

**최종 결론 (LD-015, 2026-04-18 확정):**
- HOOK 복사본(scenes[0])은 **단독 컬럼**으로 완전 분리 — 그룹화 대상 아님
- 씬1도 nc01부터 정상 시작 — nc01 gap 없음
- 정규 컷 그룹: `regularIdx = selectedIdx - 1`, `groupStart = groupIndex*4 + 1`
- HOOK 원본은 서사 위치에서 그 씬의 다른 컷들과 자연스럽게 그룹됨

**How to apply:**
- HOOK 관련 코드를 수정 제안하기 전에 LD-015를 반드시 먼저 확인
- "HOOK을 그룹에 포함시키자"는 제안은 이미 검토 후 기각된 것임 — 다시 제안하지 말 것
- HOOK의 image는 scene_code 공유로 자동 공유됨 — 별도 생성 불필요
