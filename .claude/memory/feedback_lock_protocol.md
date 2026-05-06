---
name: Lock Protocol — 잠금된 결정 보호 시스템
description: 매 세션마다 같은 결정이 번복되는 문제를 막기 위한 강제 프로토콜. 설계 의도 코드 삭제 방지 규칙 포함.
type: feedback
---

**매 대화 시작 시 `.claude/rules/LOCKED_DECISIONS.md`를 반드시 읽을 것.**

**Why:** 구현된 설계 결정(LD-001~017)이 다음 세션에서 "개선 대상"으로 오판되어 번복되는 순환이 반복됐다. 사용자도 매 세션마다 맥락을 기억하지 못해 AI가 제안하면 OK를 누르는 구조.

**How to apply:**
1. 코드 수정 제안 전 `.claude/rules/LOCKED_DECISIONS.md` 확인
2. 코드에서 `# 🔒 LD-` 주석 발견 시 즉시 레지스트리 조회
3. 잠금 항목 변경 시: LD-XXX 내용을 사용자에게 보여주고 `"LD-XXX 번복 확인"` 명시적 허가 필요
4. "개선처럼 보이는 것"이 잠금된 결정일 수 있음 — 먼저 확인, 나중에 제안

**설계 의도 코드 삭제 방지:**
- 기존 코드를 삭제·수정하기 전 `LOCKED_DECISIONS.md`와 `# ★ 설계 의도` 주석 확인
- "이게 왜 이렇게 되어 있지?" 생각 → 먼저 확인, 의도 불명 시 사용자에게 먼저 물어볼 것
- 새로 발견한 의도적 패턴은 `LOCKED_DECISIONS.md`에 등록

**현재 잠금 목록 (LD-001~017, 활성):**
- LD-001: HOOK 컷 2회 등장 (scene_index=0 복사본 + 원본)
- LD-002: dialogue 상한 ch01:3 / ch02+:5
- LD-003: image_hint 사용, image_prompt 금지
- LD-004: animation_type ken_burns 기본 (parallax 보류)
- LD-005: PRE-PASS storyArc→Python 직접 조립
- LD-009: _SOURCE_SLUG_MAP 규칙 테이블
- LD-010: _gemini_select_protagonists() 영구 제거
- LD-011: 4단계 LLM 우선순위 철학
- LD-012: # ⚠️ GEMINI-PAID: 마킹 규칙
- LD-015: HOOK 복사본 단독 컬럼 + nc01 정상 시작 (2026-04-18)
- LD-016: 캐릭터 의상 항상 "default" 유지
- LD-017: charA/charB 관계 상태를 파이프라인 1급 필드로 (2026-04-26)
