# 63. LinkDrop V3 — LLM 호출 전략 (Gemini 최소화 설계)

**최초 작성: 2026년 4월 15일**
**최종 수정: 2026년 4월 16일**
**구현 상태: Phase 1 완료 / Phase 2 설계 확정**
**설계자: 공동감독 김감독 (AI)**
**승인자: 이감독 (사용자)**

---

## 핵심 철학

> **"LLM이 필요하다" ≠ "Gemini 유료 API가 필요하다"**

이전 설계의 근본 오류: `call_gemini()` = LLM 호출의 유일한 선택지라는 암묵적 가정.

### 4단계 우선순위 (반드시 이 순서로)

```
우선순위 1 ─ Python 결정론적 처리      (비용 0, 속도 최고)
우선순위 2 ─ Cerebras / NVIDIA NIM   (무료 API — llama-3.3-70b, gpt-oss-120b)
우선순위 3 ─ Gemini Free             (GEMINI_FREE_API_KEY — 무료 티어)
우선순위 4 ─ Gemini Paid             (GOOGLE_API_KEY — 마지막 수단)
```

**Gemini Paid는 Python / 무료 LLM으로 절대 대체할 수 없는 경우에만 사용한다.**

---

## 코드 마킹 규칙 (반드시 준수)

### ⚠️ 유료 Gemini 호출 마킹
```python
# ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 — 대체 불가 핵심 창작
result = await call_gemini(prompt, ...)
```

### ✅ 무료 Gemini 호출 마킹
```python
# ✅ GEMINI-FREE: GEMINI_FREE_API_KEY 무료 티어
result = await call_gemini_free(prompt, ...)
```

### 🟢 무료 LLM 마킹 (Cerebras / NVIDIA / OpenRouter)
```python
# 🟢 CEREBRAS-FREE: llama-3.3-70b 창작 경로
# 🟢 OPENROUTER-FREE: 3-Judge 교차 검증 경로
result = await call_primary(prompt, task="creative", ...)
```

> **시각 구분 목적**: 코드 리뷰 시 `⚠️ GEMINI-PAID:` 검색만으로 전체 유료 호출 목록 추출 가능.
> IDE에서 `# ⚠️` 로 Grep 시 즉시 위치 파악.

---

## 현황 — 챕터 1개 생성 시 최악 경로

★ gemini 유료 API  사용 자제
★ gemini 무료 API  부분적 사용 자제
★ 무료 API 적극활용 (openrouter, Cerebras, NVIDIA 등)

```
run_script() 1회 실행 기준

  PRE-PASS 청사진          1회  (gemini, 소형)
  STEP1 대본 생성          1회  (gemini, 대형 ★)
  Lint A — 문체            1회  (openrouter or gemini)
  Lint B — 구조            1회  (openrouter or gemini)
  Lint C — 인과            1회  (openrouter or gemini)
  Revise 재작성            1회  (gemini, 대형 ★)
  STEP2 씬/컷 구조화       1회  (gemini, 대형 ★)
  복선 추출 meta           1회  (gemini, 소형)
  대사 흡수 absorb         1회  (gemini, 소형)
  ─────────────────────────────────────────
  최대                     9회

별도 (시리즈 초기화)
  세계관 생성              1회  (gemini)
  architect 설계도         1회  (gemini)
  주인공 선택              1회  (gemini, 소형)
  wiki ingest              1회  (gemini)
  guest_cast 조연 N명      N회  (gemini 예정)
```

---

## 현재 유료 Gemini 호출 전체 목록

### script_service.py

| 라인 | 함수 | 역할 | 단계 | 대체 가능? |
|------|------|------|------|-----------|
| ~497 | `run_script()` | STEP 1: 한국어 서사 생성 | 핵심 | Phase 2 — Cerebras 1차 시도 |
| ~523 | `run_script()` | STEP 2: 씬/컷 JSON 구조화 | 핵심 | Phase 3 — Python 파서 |
| ~783 | `_generate_outline()` | PRE-PASS 청사진 (storyArc 없을 때만) | 조건부 | ✅ storyArc 있으면 Python 대체 완료 |
| ~249 | `_lint_and_revise_gemini_only()` | Lint (OpenRouter 없을 때 폴백) | 폴백 | 🟢 OpenRouter 3-Judge 우선 |
| ~272 | `_lint_and_revise_gemini_only()` | Revise (Lint 위반 시) | 조건부 | Phase 2 — Cerebras 시도 |
| ~420 | `_revise()` | 구조 위반 Revise | 조건부 | Phase 2 — Cerebras 시도 |
| ~1417 | `regenerate_chapter()` | 재생성 STEP 1 | 재생성 경로 | Phase 2 동일 |
| ~1437 | `regenerate_chapter()` | 재생성 STEP 2 | 재생성 경로 | Phase 3 동일 |
| ~1524 | `regenerate_chapter()` | 재생성 Revise | 재생성 경로 | Phase 2 동일 |
| ~1540 | `regenerate_chapter()` | 재생성 구조화 | 재생성 경로 | Phase 3 동일 |
| ~1885 | `_absorb_dialogue_cuts()` | 대사 → 서술 변환 배치 (잔여분만) | 후처리 | ✅ 템플릿 1차 처리 완료 |
| ~1923 | `_extract_chapter_meta()` | 복선·실마리 추출 | 후처리 | Phase 2 — Python regex 우선 |

### world_service.py

| 라인 | 함수 | 역할 | 대체 가능? |
|------|------|------|-----------|
| ~285 | `generate_world()` | 세계관 전체 생성 | ❌ 핵심 창작 — 유지 |

### architect_service.py

| 라인 | 함수 | 역할 | 대체 가능? |
|------|------|------|-----------|
| ~31 | `run_architect()` | 6챕터 설계도 생성 | ❌ 핵심 창작 — 유지 |

### wiki_service.py

| 라인 | 함수 | 역할 | 대체 가능? |
|------|------|------|-----------|
| ~244 | `init_wiki_from_world()` | 세계관 → wiki 4페이지 초기 생성 | Phase 2 — Cerebras 시도 |
| ~523 | `update_wiki_page()` 내부 | wiki 페이지 보강 | Phase 2 — Cerebras 시도 |
| ~702 | `lint_wiki_page()` | wiki Lint A (문체) | 🟢 OpenRouter 우선 이미 구현 |
| ~703 | `lint_wiki_page()` | wiki Lint B (구조) | 🟢 OpenRouter 우선 이미 구현 |
| ~704 | `lint_wiki_page()` | wiki Lint C (인과) | 🟢 OpenRouter 우선 이미 구현 |

### reviser_service.py

| 라인 | 함수 | 역할 | 대체 가능? |
|------|------|------|-----------|
| ~123 | `revise_scenes()` | 씬 재작성 (승인 후 수동 요청) | Phase 2 — Cerebras 시도 |
| ~169 | `revise_scenes()` | 재작성 후 구조화 | Phase 3 — Python 파서 |

### char_keyframe_service.py

| 라인 | 함수 | 역할 | 대체 가능? |
|------|------|------|-----------|
| ~90 | `generate_char_keyframe()` | 캐릭터 키프레임 생성 | fal.ai 전환 예정 (Phase D) |

---

## 현재 무료 LLM 호출 목록

| 서비스 | 모델 | 역할 | 상태 |
|--------|------|------|------|
| OpenRouter | judge_config.json 모델 | Lint Style Judge | ✅ 완료 |
| OpenRouter | judge_config.json 모델 | Lint Structure Judge | ✅ 완료 |
| OpenRouter | judge_config.json 모델 | Lint Causality Judge | ✅ 완료 |
| Cerebras | llama-3.3-70b | (Phase 2 예정: STEP 1 1차 시도) | ⏳ 미구현 |
| NVIDIA NIM | gpt-oss-120b | (Phase 2 예정: STEP 2 1차 시도) | ⏳ 미구현 |

---

## Phase 1 — 완료 (2026-04-16)

Python 대체 가능한 Gemini 호출 전량 제거.

| 항목 | 절감 | 구현 위치 |
|------|------|----------|
| `_gemini_select_protagonists()` 제거 | 1회/시리즈 | `casting_service.py` — 트롭 점수 결정론적 선택 |
| `ingest_source()` Gemini 경로 제거 | 1회/소스 | `wiki_service.py` — `_SOURCE_SLUG_MAP` 규칙 테이블 |
| PRE-PASS — storyArc 있으면 Python 조립 | 1회/챕터 | `script_service.py` — `_generate_outline()` 조건 분기 |
| Lint Python pre-check 게이트 | 0~3회/챕터 | `script_service.py` — `_python_lint_check()` |
| `_absorb_dialogue_cuts()` 템플릿 우선 | 0~1회/챕터 | `script_service.py` — `_template_absorb()` |
| `generate_guest_cast()` 프리셋 전환 | N회/챕터 | `casting_service.py` — `GUEST_APPEARANCE_MAP` |

**결과: 정상 경로 9회 → 최소 2회 (STEP1 + STEP2)**

---

## Phase 2 — 설계 확정 (구현 예정)

Gemini Paid의 창작 역할을 **Cerebras / NVIDIA NIM (무료)** 으로 이전.

### 핵심: `call_primary()` 헬퍼 설계

```python
# services/llm_router.py — 신규 파일
# 4단계 우선순위 라우터

from services.cerebras_helper import call_cerebras
from services.nvidia_helper    import call_nvidia
from services.gemini_helper    import call_gemini

_CEREBRAS_CREATIVE_MODEL  = "llama-3.3-70b"             # 14,400 RPD 무료
_NVIDIA_STRUCTURED_MODEL  = "meta/llama-3.3-70b-instruct"  # NIM 무료 티어

async def call_primary(
    prompt: str,
    task: str = "creative",     # "creative" | "structured" | "revision"
    system_instruction: str = "",
    max_tokens: int = 6000,
    temperature: float = 0.9,
) -> str:
    """
    4단계 우선순위 LLM 라우터.

    task="creative"    → Cerebras llama-3.3-70b  → Gemini Paid 폴백
    task="structured"  → NVIDIA gpt-oss-120b     → Gemini Paid 폴백
    task="revision"    → Cerebras llama-3.3-70b  → Gemini Paid 폴백
    """
    primary_fn = call_cerebras if task in ("creative", "revision") else call_nvidia
    model      = _CEREBRAS_CREATIVE_MODEL if task in ("creative", "revision") \
                 else _NVIDIA_STRUCTURED_MODEL

    try:
        result = await primary_fn(
            prompt, model=model,
            system_instruction=system_instruction,
            max_tokens=max_tokens, temperature=temperature,
        )
        if result and len(result.strip()) > 100:
            return result
    except Exception as e:
        logger.warning("call_primary [%s/%s] 실패: %s — Gemini 폴백", task, model, e)

    # ⚠️ GEMINI-PAID: GOOGLE_API_KEY 유료 과금 — Cerebras/NVIDIA 실패 시 최후 수단
    return await call_gemini(
        prompt, system_instruction=system_instruction,
        max_tokens=max_tokens, temperature=temperature,
    )
```

### Phase 2 마이그레이션 대상

| 현재 | 변경 후 | 절감 |
|------|---------|------|
| `call_gemini(STEP1)` | `call_primary(task="creative")` | 유료 → 무료 우선 |
| `call_gemini(Revise)` | `call_primary(task="revision")` | 유료 → 무료 우선 |
| `call_gemini(wiki init)` | `call_primary(task="creative")` | 유료 → 무료 우선 |
| `call_gemini(meta 추출)` | Python regex → `call_primary(task="structured")` | Python 우선 |

---

## Phase 3 — 장기 (STEP 2 Python 파서)

STEP 2 씬/컷 구조화를 Gemini 없이 처리.

```
현재: 한국어 서사 → call_gemini(STEP2) → JSON
목표: 한국어 서사 → Python 정규식 파서 → JSON
     (Gemini는 파서 실패 시 폴백으로만 유지)
```

**분리 마커 기반 파싱** (STEP 1 프롬프트 수정 필요):
```
=== 씬1: 도입부 ===
[컷1-나레이션] 서울의 아침이 밝아왔다.
[컷2-나레이션] 지하철역 앞 군중이 서둘러 계단을 내려갔다.
=== 씬2: 갈등 ===
...
```

Python이 `===`, `[컷N-타입]` 마커로 파싱 → JSON 조립.
마커 없는 자유 서사 → Gemini 폴백.

---

## 최적화 전후 비교

### run_script() 1회 (챕터 생성)

```
                         현재     Phase1 완료    Phase2 완료    Phase3 완료
PRE-PASS 청사진           1회      0회 ✅         0회            0회
STEP1 대본                1회      1회 ⚠️유료     🟢 무료우선    🟢 무료우선
Lint 3-Judge              3회      0~3회 ✅       0~3회 🟢무료   0~3회 🟢무료
Revise                    1회      0~1회 ✅       0~1회 🟢무료   0~1회 🟢무료
STEP2 구조화              1회      1회 ⚠️유료     1회 ⚠️유료    🟢 무료우선
대사 absorb               1회      0~1회 ✅       0~1회          0~1회
meta 추출                 1회      1회 ⚠️유료     🟢/Python      🟢/Python
─────────────────────────────────────────────────────────────────────────
합계 (정상 경로)           9회      최소 2회       최소 0~1회     최소 0회
유료 Gemini (정상)        7회      2회 ⚠️         1회 ⚠️         0~1회
```

### 시리즈 초기화 (최초 1회)

```
                         현재     Phase1 완료    Phase2 완료
세계관 생성               1회 ⚠️   1회 ⚠️유료     1회 ⚠️유료 (대체 불가)
architect 설계도          1회 ⚠️   1회 ⚠️유료     1회 ⚠️유료 (대체 불가)
주인공 선택               1회 ⚠️   0회 ✅         0회
wiki ingest               1회 ⚠️   0회 ✅         0회
guest_cast                N회 ⚠️   0회 ✅         0회
wiki 초기 생성 4페이지    1회 ⚠️   1회 ⚠️유료     🟢 무료우선
─────────────────────────────────────────────────────────────
합계                      5+N회   3회 ⚠️유료      2회 ⚠️유료
```

---

## 절대 유지 호출 (Gemini Paid 고정)

| 호출 | 이유 |
|------|------|
| `generate_world()` | 시리즈 최초 1회, 세계관 창작 출발점 |
| `run_architect()` | 시리즈 최초 1회, 6챕터 서사 설계 |

> 이 2개는 Phase 2/3 이후에도 Gemini Paid 유지.
> 창작 품질이 무료 LLM으로 검증되기 전까지 교체 금지.

---

## 구현 우선순위 현황

| 우선순위 | 항목 | 효과 | 상태 |
|---------|------|------|------|
| ✅ P1-1 | `_python_lint_check()` 게이트 | Lint 3회 → 0회 (정상 경로) | 완료 (2026-04-16) |
| ✅ P1-2 | `_template_absorb()` 우선 처리 | absorb 1회 → 0회 | 완료 (2026-04-16) |
| ✅ P1-3 | `GUEST_APPEARANCE_MAP` 프리셋 | N회 → 0회 | 완료 (2026-04-16) |
| ✅ P1-4 | `_gemini_select_protagonists()` 제거 | 1회/시리즈 → 0회 | 완료 (2026-04-16) |
| ✅ P1-5 | `_SOURCE_SLUG_MAP` 규칙 테이블 | 1회/인제스트 → 0회 | 완료 (2026-04-16) |
| ✅ P1-7 | storyArc 있으면 Python PRE-PASS 조립 | 1회/챕터 → 0회 | 완료 (2026-04-16) |
| ⏳ P2-1 | `services/llm_router.py` — `call_primary()` | STEP1 유료→무료 우선 | 예정 |
| ⏳ P2-2 | STEP1 `call_gemini` → `call_primary("creative")` | 유료 1회 → 무료 우선 | 예정 |
| ⏳ P2-3 | Revise `call_gemini` → `call_primary("revision")` | 유료 0~1회 → 무료 우선 | 예정 |
| ⏳ P2-4 | `_extract_chapter_meta()` Python regex 우선 | 유료 1회 → 0~1회 | 예정 |
| ⏳ P2-5 | wiki init `call_gemini` → `call_primary` | 유료 1회 → 무료 우선 | 예정 |
| ⏳ P1-6 | 임베딩 배치 처리 `batch_embed_contents` | N회 → 1회 | 예정 |
| ⏳ P2-8 | Revise 조건부 실행 (warning만이면 스킵) | 1회 조건부 절감 | 예정 |
| ⏳ P3-1 | STEP2 Python 파서 (분리 마커 기반) | 유료 1회 → 0회 | 장기 |

---

## `# ⚠️ GEMINI-PAID:` 마커 추가 예정 위치

Phase 2 구현 시 아래 위치에 마커를 먼저 추가한다.

```
script_service.py
  ~497  : STEP1 call_gemini
  ~523  : STEP2 call_gemini
  ~272  : Revise call_gemini (Gemini 단독 폴백)
  ~249  : Lint call_gemini (Gemini 단독 폴백)
  ~1885 : absorb 배치 call_gemini (잔여분)
  ~1923 : meta 추출 call_gemini

world_service.py
  ~285  : generate_world call_gemini

architect_service.py
  ~31   : run_architect call_gemini

wiki_service.py
  ~244  : init_wiki_from_world call_gemini
  ~523  : wiki update call_gemini

reviser_service.py
  ~123  : revise_scenes call_gemini
  ~169  : revise_scenes 구조화 call_gemini
```
