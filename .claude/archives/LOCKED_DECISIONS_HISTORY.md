# 🔒 잠금 결정 이력 — 번복된 결정 (자동 주입 안 됨)

> 활성 잠금 요약은 LOCKED_DECISIONS.md 참조.

---

## SUPERSEDED (번복된 결정)

### ~~LD-013~~ — 씬1 nc01 의도적 공백 *(2026-04-18 폐기 → LD-015 대체)*
- **폐기 사유**: HOOK 복사본을 단독 컬럼으로 분리하면 nc01 슬롯 충돌 없음. nc01 gap이 AI·사용자 양쪽에 반복 혼동 유발 (3~4회). LD-015에서 완전 해소.

### ~~LD-014~~ — HOOK을 group0에 포함 *(2026-04-18 폐기 → LD-015 대체)*
- **폐기 사유**: HOOK은 씬7, nc01~nc03은 씬1 — 다른 장소·분위기가 한 그리드에 섞임. 그리드 생성 품질 저하. LD-015에서 HOOK 단독 분리로 해소.

### ~~LD-006~~ — _python_lint_check() 게이트 *(2026-04-16 폐기)*
- **폐기 사유**: Judge 3종이 이미 무료 폴백 체인(Cerebras→NVIDIA→OpenRouter→Gemini-Free)에서 실행됨. 일 3회 호출은 Cerebras 14,400 RPD 대비 0.02% — Python 사전 게이트 ROI 없음. Python 정규식으로 문체·인과 위반을 정확히 탐지하기 어려워 false-negative 시 품질 저하 리스크만 증가.

### ~~LD-007~~ — _template_absorb() 우선 처리 *(2026-04-16 폐기)*
- **폐기 사유**: `_absorb_dialogue_cuts()` 및 `_extract_foreshadows()`의 Gemini 유료 호출이 `call_free_llm()` (Cerebras→NVIDIA→OpenRouter 체인)으로 직접 교체 완료 (2026-04-16). `call_primary()` 헬퍼 없이도 동일 절감 달성.

### ~~LD-008~~ — GUEST_APPEARANCE_MAP 9종 프리셋 *(2026-04-16 폐기)*
- **폐기 사유**: `generate_guest_cast()` 자체가 파이프라인에 미통합 상태(60번 문서). 프리셋은 씬 컨텍스트(`image_hint`) 반영 불가로 품질 저하 리스크. 기능 파이프라인 통합 후 실제 호출량을 보고 재평가.
