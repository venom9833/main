# 🔒 잠금 결정 상세 정보 (자동 주입 안 됨 — 필요 시 수동 참조)

> 활성 잠금 요약은 LOCKED_DECISIONS.md 참조.
> 번복된 결정은 LOCKED_DECISIONS_HISTORY.md 참조.

---

## LD-001 — HOOK 컷 2회 등장
- **잠금 날짜**: 2026-04-13
- **관련 문서**: 53번 §HOOK 컷 규칙
- **이유**: 영상 재생 구조 설계 — `[HOOK 복사본 콜드오픈] → [1화 처음부터 정순] → [HOOK 원본 서사 위치]`. 시청자를 초반에 낚은 뒤 서사 흐름 속 감정 클라이맥스에서 다시 만나게 하는 의도.

## LD-002 — dialogue 컷 상한 (ch01: 3개 / ch02+: 5개)
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 53번 §대사 컷 상한
- **이유**: 웹소설 독자는 대사보다 서사 흐름에서 몰입. 대사 과다 시 "드라마 대본 같은" 느낌으로 이탈 증가.
- **구현 상태**: `_python_lint_check()` 함수 미존재 — 사전 검사 미구현. `_absorb_dialogue_cuts()` 흡수 로직(cap 3/5)만 동작 중. Phase 1 재구현 대기.

## LD-003 — image_hint 사용 / image_prompt 금지
- **잠금 날짜**: 2026-04-13
- **관련 문서**: 57번
- **이유**: Gemini가 `image_prompt`에 `photorealistic` 키워드를 자동 삽입하여 masako/noir_oil 화풍이 오염된다. `image_hint`는 한국어 묘사이므로 Gemini 자동 추가 없음.

## LD-004 — animation_type 분기 기준 (parallax 보류)
- **잠금 날짜**: 2026-04-14
- **관련 문서**: 62번
- **이유**: parallax 렌더링은 배경/캐릭터 2레이어 누끼 분리가 선행 필요. 현재 미구현 상태로 ken_burns 임시 처리.

## LD-005 — PRE-PASS: storyArc 있으면 Python 직접 조립 (Gemini 0회)
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 63번 Phase 1
- **이유**: architect가 이미 6챕터 전체 방향을 설계했으므로 PRE-PASS Gemini 호출은 중복. 63번의 근본 철학 — Python으로 할 수 있으면 Gemini 호출 금지.
- **구현 상태**: storyArc 있으면 Python 직접 조립 분기 구현 완료. arc 없을 때만 Gemini PRE-PASS 호출 (2026-04-16).

## LD-009 — _SOURCE_SLUG_MAP 규칙 테이블 (wiki ingest Gemini 감축)
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 63번 Phase 1
- **이유**: source_type은 구조화된 값 — Gemini 라우팅 불필요. `text`는 자유 서술이라 Python 결정 불가하나 무료 API로 처리.
- **구현 상태**: `_SOURCE_SLUG_MAP` + `_FILE_EXT_SLUG_MAP` + `_resolve_file_slug()` 구현 완료. `text`는 `call_free_llm()` (Cerebras→NVIDIA→OpenRouter→Gemini-Free 체인) 사용 (2026-04-16).

## LD-010 — _gemini_select_protagonists() 완전 제거
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 63번 Phase 1
- **이유**: 트롭 점수 정렬 + seed 기반 셔플로 동일한 품질의 다양한 캐스팅 가능. Gemini 1회/시리즈 절감.
- **구현 상태**: `_gemini_select_protagonists()` 코드에 미존재 확인 완료 — 결정 이행됨.

## LD-011 — 4단계 LLM 우선순위 철학
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 63번
- **이유**: "LLM이 필요하다" ≠ "Gemini 유료 API가 필요하다". 무료 대안이 있는 경우 유료 호출 금지.

## LD-012 — `# ⚠️ GEMINI-PAID:` 마킹 규칙
- **잠금 날짜**: 2026-04-16
- **관련 문서**: 63번
- **이유**: 유료 호출 위치를 코드에서 즉시 식별 가능하게. `grep "⚠️ GEMINI-PAID"` 한 줄로 전체 과금 포인트 추출.

## LD-015 — HOOK 단독 컬럼 + nc01부터 정상 시작
- **잠금 날짜**: 2026-04-18
- **이유**: HOOK 때문에 AI가 3~4회 반복 혼동 발생 → HOOK을 시각적·논리적으로 완전 분리.
- **UI 구조**: `[HOOK 단독] | [nc01, nc02, nc03, nc04] [nc05, nc06, nc07, nc08] ...` (amber 점선 구분선)

## LD-016 — 캐릭터 의상 고정 (default 유지)
- **잠금 날짜**: 2026-04-19
- **이유**: 씬 조건(밤/긴장 등)에 따라 casual/stressed로 자동 전환하면 같은 화 안에서도 캐릭터 의상이 바뀌어 시각적 일관성이 깨진다.

## LD-017 — charA/charB 관계 상태는 파이프라인 1급 필드
- **잠금 날짜**: 2026-04-26
- **관련 문서**: 56번 (신규), BACKLOG V3-6/V3-7
- **이유**: script LLM이 charA+charB를 로맨스 장르 기본값(기혼 부부)으로 추론하여 두 캐릭터의 실제 가족 관계(배우자, 자녀 등)를 무시하는 환각이 반복 발생. yang_sy(남편=최민성) + kim_th(아내=한은정) 시리즈에서 LLM이 두 사람을 동거 부부로 묘사한 것이 직접적 트리거.
- **발생 경위**: casting/architect/script 3단계 모두 두 주인공의 "현재 관계"를 명시적으로 정의·전달하지 않음. 특히 캐릭터 JSON의 `relationships` 객체(배우자, 자녀 등)가 STEP1 프롬프트에 단 한 번도 주입되지 않음.
- **world_data 저장 필드**: `relationshipAtCh01Start` / `relationshipAtCh01Description` / `charAFamilyGroup` / `charBFamilyGroup` / `charARelationships` / `charBRelationships`
