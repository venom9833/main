# LinkDrop V3 — 메모리 인덱스

> 위치: `C:\LinkDropV3\.claude\memory\`
> 규칙: 내용은 각 파일에. 여기는 한 줄 포인터만.

---

## ★★★★★ 잠금 시스템 (매 세션 필독)

- [feedback_lock_protocol.md](feedback_lock_protocol.md) — **Lock Protocol**: `.claude/rules/LOCKED_DECISIONS.md` 필독. LD- 주석 발견 시 레지스트리 조회. 번복 시 "LD-XXX 번복 확인" 명시 요구. LD-001~017 활성.
- [feedback_hook_confusion_pattern.md](feedback_hook_confusion_pattern.md) — HOOK 컷 고위험 영역 — LD-015 최종확정 (HOOK 단독 컬럼 + nc01 정상 시작)

---

## ★★★ 핵심 원칙

- [feedback_v3_independence.md](feedback_v3_independence.md) — V3는 V2와 독립 프로젝트 — 사용자 명시 없이 V2 파일/문서 참조 절대 금지
- [feedback_gstack_browser_default.md](feedback_gstack_browser_default.md) — GStack Browser = 기본 브라우저 — 모든 브라우저 작업에 `browse` 명령 사용
- [feedback_gnb_submenu_terminology.md](feedback_gnb_submenu_terminology.md) — "중메뉴" = children 배열만 수정 — 상위 NAV_ITEMS 구조 건드리지 말 것

---

## ★★★ 프로젝트 구조 및 전략

- [project_v2_v3_architecture.md](project_v2_v3_architecture.md) — V2=소비자 접점(랜딩·결제·CRM), V3=콘텐츠 생산 엔진 — V2가 팔고 V3가 이행
- [project_v3_automation_strategy.md](project_v3_automation_strategy.md) — 사용자 게이트 유지 → 품질 표준화 → 단계적 자동화 제거 전략

---

## ★★★ 설계 결정 (코드 수정 전 확인)

- [project_v3_hook_design.md](project_v3_hook_design.md) — HOOK 컷 2회 등장 = 53번 설계 의도 (삭제 금지 — LD-001)
- [project_default_artstyle.md](project_default_artstyle.md) — **기본 화풍 = `polystyle`** (2026-04-17 확정)
- [project_v3_scenes_missing_fields.md](project_v3_scenes_missing_fields.md) — v3_scenes에 production/animation_type 컬럼 없음 (62번 §1 최우선 — V3-1)
- [project_v3_pivot_reason_emoline.md](project_v3_pivot_reason_emoline.md) — V2→V3 피봇 동기: 감정선 복잡성 + `_emoline.json` 전역 단순화

---

## 참조

- [reference_v3_github.md](reference_v3_github.md) — V3 GitHub: https://github.com/venom9833/main / 로컬: `c:\LinkDropV3` / 브랜치: develop
