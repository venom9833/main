# LinkDrop V3 — 개발 백로그

> 최종 업데이트: 2026-04-29
> 규칙: 새 항목 발견 시 즉시 추가. 완료 시 ✅ 섹션으로 이동. 대화마다 이 파일 확인.

---

## 🚨 긴급

| # | 항목 | 상태 | 관련 문서 |
|---|------|------|----------|
| V3-1 | v3_scenes `production` / `animation_type` 컬럼 추가 (DB 마이그레이션) | ⬜ | 62번 |
| V3-2 | ch01 클리프행어 수정 — series_plan "언니가 사라지기 직전" 미반영 | ⬜ | series_plan |
| V3-6 | 관계 모델링 3-Gate 구현 — casting/architect/script 3단계에 `relationshipAtCh01Start` + 가족 컨텍스트 주입 | ✅ 완료 (2026-04-26) | LD-017, 56번 |
| V3-7 | consistency_judge 추가 — charA/charB 관계 위반(부부 혼동 등) 사후 검증 Judge | ⬜ | LD-017 |

---

## 🔵 Phase 2

| # | 항목 | 상태 | 관련 문서 |
|---|------|------|----------|
| V3-3 | `call_primary()` 헬퍼 구현 → STEP1/Revise Gemini → Cerebras 이전 | ⬜ | 63번 |
| V3-4 | dialogue 립싱크 클립 자동화 (현재 사용자 수동 제작) | ⬜ | 62번 |
| V3-5 | EN/JP 더빙 파이프라인 — en/jp 폴더 원본에서 오디오 무음 처리 후 EN/JP TTS mp3 합성 | ⬜ | — |

---

## 🎨 이미지 프롬프트

| # | 항목 | 상태 | 관련 문서 |
|---|------|------|----------|
| IMG-1 | prompts3.com `ours=true` ~869건 수집 → **IP{N:04d} 리네임** → R2 업로드 → 4번째 탭 UI 구현 | ✅ 전체 761건 완료 (2026-04-29) — 25카테고리, thumbs+detail JSON 생성 | 69번 |
| IMG-2 | 전체 761건 R2 업로드 (`img_prompt_r2_upload.py`) | ✅ 완료 (2026-04-29) — flux-bg-library/V2/img_prompt/ (1,523파일, 실패 0) | 69번 |

---

## 🌐 V2 상용화 연동

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| V2-1 | 프롬프트 DB 이전 — `page.tsx` 하드코딩 배열 → Supabase `prompts` 테이블 마이그레이션 | ✅ 완료 (2026-04-28) | 컬럼: id, cat, title, description, body, is_premium, created_at |
| V2-2 | FastAPI 프롬프트 엔드포인트 — `GET /api/prompts?cat=` / `GET /api/prompts/{id}` | ✅ 완료 (2026-04-28) | routers/prompts.py 신규 생성 |
| V2-3 | V2 API Key 인증 연동 — V2 구독 상태 검증 후 호출 허용 | ✅ 완료 (2026-04-28) | V2_API_SECRET env 비교. 없으면 비인증 처리 |
| V2-4 | EN/JP 프롬프트 세트 추가 — lang 컬럼 기반 다국어 확장 | ⬜ | KR→EN→JP 로드맵 순서 (미구현) |
| V2-5 | 다크경제학 카테고리 (cat12, L) — L01~L07 7개 프롬프트 추가 | ✅ 완료 (2026-04-28) | SMB AI 에이전시 운영 전용. index.json + Supabase + API 완료 |

---

## 🎭 인형극 애니메이션 (64번 문서 — dialogue 컷 전용)

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| PA-2 | 음성 분석 → 입 열림 동기화 | ⬜ | 현재 sine 상수 파형 → pyaudio/librosa 음량 기반 mouthOpen 연동 |
| PA-3 | talkingA / talkingB 플래그 분리 | ⬜ | 현재 두 캐릭터 동시 입 움직임 → 화자 정보로 한 명만 동작 |
| PA-4 | v3_scenes `animation_type='puppet'` DB 마이그레이션 | ⬜ | V3-1과 묶어서 처리 |
| PA-5 | rain 파티클 → PuppetDialogueScene 통합 옵션 | ⬜ | 배경 날씨 효과 오버레이 |
| PA-6 | TRELLIS.2 다각도 스프라이트 자동 추출 파이프라인 | ⬜ | 장기. GLB → 다각도 렌더 → rembg → 스프라이트 시트 |

---

## ✅ 완료

| # | 항목 | 완료일 |
|---|------|--------|
| PA-1 | PuppetDialogueScene MVP 렌더 (270프레임 / 1920×1080) | 2026-04-16 |
| LD-013 | nc01 의도적 공백 잠금 등록 + 4컷 그룹화 page.tsx 수정 | 2026-04-18 |
| DB-FIX | DB orphan ch01s01nc01 레코드 삭제 (remaining=0 확인) | 2026-04-18 |
