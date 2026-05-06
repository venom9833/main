# 🔒 잠금 결정 레지스트리 — 요약
> 상세 정보: `.claude/archives/LOCKED_DECISIONS_DETAILS.md` | 번복 이력: `.claude/archives/LOCKED_DECISIONS_HISTORY.md`
> 번복 절차: LD-XXX 내용 보여주기 → 사용자가 "LD-XXX 번복 확인" 명시 → 진행
> 코드의 `# 🔒 LD-` 주석 발견 시 이 파일 즉시 조회. 변경 전 항상 확인.

| LD | 결정 요약 | 절대 금지 | 코드 위치 |
|----|---------|---------|---------|
| LD-001 | v3_scenes에 HOOK 레코드 2개 (scene_index=0 복사본 + 원본 위치) | 중복 삭제·병합·is_hook=True 단일화 | `script_service.py` `_parse_scenes_json()`, `_save_scenes()` |
| LD-002 | ch01 대사컷 ≤3, ch02+ ≤5. 초과→narration 자동 흡수 | 상한 제거, `_absorb_dialogue_cuts()` 호출 제거 | `script_service.py` `_absorb_dialogue_cuts()` |
| LD-003 | 이미지 생성은 `image_hint` 전용. `image_prompt` 사용 금지 | `image_prompt` 활성화, image_hint→image_prompt 리네이밍 | `keyframe_service.py`, `prompt_composer.py` |
| LD-004 | narration+1인 컷 → `ken_burns`. dialogue 컷 → `lipsync` (수동) | ken_burns→parallax 복구, lipsync→ken_burns 자동 전환 | `script_service.py` `_compute_production_type()` |
| LD-005 | storyArc 있으면 Python 직접 조립, Gemini 호출 0회 | storyArc 조건 제거 후 항상 Gemini 호출 | `script_service.py` `_generate_outline()` |
| LD-009 | wiki ingest 슬러그는 규칙 테이블 결정. text 타입은 Gemini Free | 규칙 테이블 제거 후 유료 Gemini 라우팅, text→유료 call_gemini() | `wiki_service.py` `_SOURCE_SLUG_MAP`, `_resolve_file_slug()` |
| LD-010 | `_gemini_select_protagonists()` 영구 제거. 트롭 점수로 결정론적 캐스팅 | 함수 재도입, 주인공 선택에 Gemini 호출 추가 | `casting_service.py` (함수 삭제됨) |
| LD-011 | LLM 우선순위: Python→Cerebras/NVIDIA→Gemini Free→Gemini Paid | 무료 대안 탐색 없이 유료 Gemini 직접 호출 | 전체 서비스 파일 |
| LD-012 | 유료 Gemini 호출 위에 `# ⚠️ GEMINI-PAID:` 주석 필수 | 마커 주석 제거, 새 call_gemini() 마커 없이 작성 | 전체 서비스 파일 |
| LD-015 | HOOK은 단독 컬럼. nc01부터 정상 시작. 정규 컷 4개씩 그룹 | HOOK을 정규 그룹 포함, nc01 gap 코드 재도입 | `script_service.py` `_parse_scenes_json()`, `page.tsx` |
| LD-016 | 모든 캐릭터 의상은 항상 `"default"`. 씬 조건 자동 전환 금지 | 씬 메타 조건으로 casual/stressed 자동 전환 재도입 | `prompt_composer.py` `_pick_wardrobe()` |
| LD-017 | charA/charB 관계 6개 필드 world_data 필수 저장. STEP1 프롬프트에 관계 블록 포함 | STEP1에서 관계 블록 제거, relationships 객체 무시, 필드 없이 대본 생성 | `casting_service.py`, `architect_service.py`, `script_service.py` |
