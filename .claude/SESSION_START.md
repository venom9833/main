---
# V3 SESSION START — 이 파일 하나만 먼저 읽을 것
> 업데이트: 2026-04-29 | 전체 규칙: LOCKED_DECISIONS.md | 전체 작업: BACKLOG.md
---

## 🚨 지금 해야 할 일 (BACKLOG 요약)

| 우선순위 | 항목 | 비고 |
|---------|------|------|
| 긴급 | V3-1: v3_scenes에 `production` / `animation_type` 컬럼 추가 | 62번 문서 |
| 긴급 | V3-2: ch01 클리프행어 — "언니가 사라지기 직전" 미반영 | series_plan 참조 |
| ~~완료~~ | ~~V3-6: 관계 모델링 3-Gate~~ | ✅ 2026-04-26 완료 |
| 긴급 | V3-7: consistency_judge 추가 — charA/charB 관계 위반 사후 검증 | LD-017 |
| Phase 2 | V3-3: `call_primary()` 헬퍼 → Cerebras 이전 | 63번 문서 |
| Phase 2 | V3-4: dialogue 립싱크 클립 자동화 | 62번 문서 |
| 인형극 | PA-2~6: 음성동기화·화자분리·DB마이그레이션·rain파티클 | 64번 문서 |
| 신규 | IMG-1: 이미지 프롬프트 기능 (ours=869건 R2 JSON + 마스터번호 리네임 + 4번째 탭 UI) | 69번 문서 |

---

## 🔒 잠금 결정 즉시 참조표 (전체: LOCKED_DECISIONS.md)

| LD | 핵심 규칙 | 절대 금지 |
|----|---------|---------|
| LD-001 | v3_scenes에 HOOK 레코드 2개 (scene_index=0 복사본 + 원본) | 중복 삭제, 병합 |
| LD-002 | ch01 대사컷 ≤3개, ch02+ ≤5개. 초과 → narration 흡수 | 상한 제거, absorb 호출 제거 |
| LD-003 | 이미지 생성: `image_hint` 필드만 사용 | `image_prompt` 활성화 금지 |
| LD-004 | narration+1인 컷 → ken_burns / dialogue 컷 → lipsync | ken_burns→parallax 전환 금지 |
| LD-005 | storyArc 있으면 Python 직접 조립 (Gemini 0회) | storyArc 조건 제거 금지 |
| LD-011 | LLM 우선순위: Python → Cerebras → Gemini-Free → Gemini-Paid | 편의상 Gemini-Paid 직접 호출 금지 |
| LD-012 | 유료 Gemini 호출 위에 `# ⚠️ GEMINI-PAID:` 마커 필수 | 마커 없이 call_gemini() 추가 금지 |
| LD-015 | HOOK = 단독 컬럼 / 정규컷 = 4컷 그룹(selectedIdx-1 기준) | HOOK을 정규 그룹에 포함 금지 |
| LD-016 | 캐릭터 의상 항상 "default" 유지 | scene_meta 조건으로 자동 전환 금지 |

---

## ⚡ 코드 수정 전 3초 체크

1. `LOCKED_DECISIONS.md` 해당 LD 있는지?
2. 코드에 `# 🔒 LD-` 주석 있는지?
3. `archives/53_V3_시리즈_마스터코드(씬과 컷).md` 관련 씬/컷 로직인지?

→ 하나라도 해당되면 **수정 전 LD 내용을 사용자에게 먼저 보여줄 것**

---

## 📁 추가 읽기가 필요한 경우만 (평상시 불필요)

| 상황 | 읽을 파일 |
|------|---------|
| 씬/컷 구조 변경 | `archives/53_V3_시리즈_마스터코드(씬과 컷).md` |
| 이미지 생성 변경 | `archives/57번`, `archives/62번` |
| LLM 비용 관련 | `archives/63번` |
| 인형극 애니메이션 | `archives/64번` |
| 프로젝트 구조/스택 | `archives/104_개발_환경_설정.md` |
| 이미지 프롬프트 기능 | `archives/69_이미지_프롬프트_기능.md` |
