# LinkDrop V3 — Claude 프로젝트 지침

## ★★★ V3 독립성 원칙
**V3는 V2와 완전히 독립된 프로젝트다.**
사용자가 명시적으로 지정하지 않는 한 `C:\LinkDropV2` 경로의 파일·문서·메모리를 읽거나 참조하지 않는다.

## 모든 에이전트는 최초 로드 시 해당 문서를 먼저 정독한다
C:/LinkDropV3/docs/rules/51_V3_시리즈_자동화_설계도.md

---

## 대화 시작 시 필독 문서 (51~62번 설계 문서 요약)

**51~62번 문서가 V3의 단일 소스입니다. 코드 수정 전 관련 문서를 반드시 확인할 것.**

| 문서 | 제목 | 핵심 요약 |
|------|------|----------|
| **51번** | 자동화 설계도 | Phase A-D 전략 / 1화 집중 원칙 / autoApprove 플래그 (`v3_series.settings`) |
| **52번** | 세계관 | resolution_methods + narrative_povs 2개 선택 → Gemini 제약 주입 / world_options.json v2.0 |
| **53번** | 마스터코드(씬과 컷) | **HOOK 2회 등장 = 설계 의도** (scene_index=0 복사본 + 원본 위치) / ch##s##nc## 체계 / dialogue 컷 상한 |
| **54번** | 캐릭터 | 27명 풀 / `{id}_masako.json` + `{id}_noir_oil.json` / `fal_params.lora_url=null` (Phase D) |
| **55번** | TTS | 1캐릭터=1Supertone 성우 / edge-tts 폴백 / 27명 배정 완료 / EXTRA_VOICE_MAP |
| **56번** | ~~NLM키프레임~~ | **폐기됨** — 참조 금지 |
| **57번** | API 키프레임 | `image_hint` 우선 사용 / `image_prompt` 사용 금지 (photorealistic 오염) |
| **58번** | 키프레임 UI | bg_url / char_url / lipsync_url 마이그레이션 완료 / 컷 타입별 LEFT 버튼 분기 |
| **59번** | 화풍 | `masako` + `noir_oil` 2종 확정 / `real` 삭제 완료 / art_styles.json 등록 완료 |
| **60번** | 캐스팅 | guest_cast POST-SCRIPT 후처리 **미구현** (`generate_guest_cast()` 없음) |
| **61번** | 이미지 프롬프트 | prompt_composer.py / cut_type 자동 분기 / OTS 구도 / build_bg_prompt / build_char_prompt |
| **62번** | 패럴랙스 렌더링 | `production` + `animation_type` 분기 → v3_scenes에 **미반영** (다음 구현 최우선) |

---

## ★★★ 절대 변경 불가 설계 결정

### 1. HOOK 컷 2회 등장 — 삭제·제거 금지 (53번)

```
재생순서  scene_index  마스터코드     설명
[1]        0        ch01s00hc01  ← HOOK 복사본 (_parse_scenes_json이 자동 생성, 콜드오픈)
[2]        1        ch01s01nc01  ← 대본 처음부터
...
[N]        4        ch01s04hc01  ← HOOK 원본 (서사 흐름 속 자연 위치)
```
→ scene_index=0 복사본 + 원본 위치 동일 컷 2개 = **정상 설계**, 버그 아님. 절대 삭제 금지.

### 2. dialogue 컷 상한 (53번)

| 챕터 | dialogue 컷 최대 |
|------|----------------|
| ch01 | 3개 |
| ch02 이후 | 5개 |

`_build_structure_prompt()` 프롬프트에 반드시 명시.

### 3. image_hint vs image_prompt (57번)

- **`image_hint`만 사용** — 한국어 시각 묘사, 렌더 기준
- **`image_prompt` 사용 금지** — Gemini 자동 `photorealistic` 추가 → masako 화풍 오염 발생

### 4. v3_scenes 미구현 필드 (62번 §1 — 다음 구현 최우선)

```python
# v3_scenes에 반드시 추가해야 할 필드
production      # "split" | "composite" | "bg_only"
animation_type  # "parallax" | "ken_burns" | "lipsync"

# 분기 기준
narration + 0인  → production="bg_only",    animation_type="ken_burns"
narration + 1인  → production="split",      animation_type="parallax"
narration + 2인+ → production="composite",  animation_type="ken_burns"
dialogue         → production="composite",  animation_type="lipsync"
```

---

## ★ 미구현 항목 (다음 대화 즉시 확인)

| 우선순위 | 항목 | 관련 문서 |
|----------|------|----------|
| **최우선** | v3_scenes에 `production` + `animation_type` 컬럼 추가 + compose-prompt 분기 구현 | 62번 §1 |
| **긴급** | ch01 클리프행어 수정 (series_plan "언니가 사라지기 직전" 내용 포함) | series_plan |
| **중요** | dialogue 30% 상한 강제 (`_build_structure_prompt()` 명시) | 53번 |
| **미구현** | guest_cast POST-SCRIPT 후처리 (`generate_guest_cast()`, `detect_guest_cast()`) | 60번 |
| **개선** | image_hint 우선 전환 (photorealistic 오염 차단) | 57번 |
| **장기** | LoRA 학습 파이프라인 (참조 이미지 수집부터 시작) | Phase D |

---

## Context7 자동 사용 규칙

아래 라이브러리 관련 코드를 **작성·수정·디버깅할 때 반드시** Context7로 최신 문서를 먼저 조회한 뒤 코드를 작성한다.
사용자가 별도로 요청하지 않아도 자동으로 실행한다.

| 라이브러리 | Context7 ID |
|-----------|-------------|
| Google Gemini / google-genai SDK | `/google/generative-ai` |
| Remotion | `/remotion/remotion` |
| edge-tts | `edge-tts` |
| Supabase Python (supabase-py) | `/supabase/supabase-py` |
| Next.js | `/vercel/next.js` |

## 1. 목적 및 배경 (Purpose)

LinkDrop V2의 `/series/` 파이프라인은 다음 구조적 문제를 안고 있다:

- 브라우저 저장소 3종 혼용 (IndexedDB 3개 + sessionStorage 12개 + localStorage 중복)
- 타입/인터페이스 page.tsx마다 개별 선언 (공유 타입 파일 없음)
- 각 page.tsx 700~1500줄 모놀리스 (상태·API·UI·IDB 혼재)
- 사용자가 5개 페이지를 수동으로 이동해야 함

**LinkDropV3는 `/series/` 파이프라인만을 위한 독립 프로젝트로 처음부터 올바르게 설계한다.**

### 핵심 목표

**사용자가 소스 파일만 업로드하면, AI 에이전트가 대본 → 영상 생산 → YouTube 업로드 → 채널 관리를 자동 완주한다.**
**1일 1챕터 생성, 사용자가 종결 시점을 결정한다.**

### ★ 1화 집중 원칙 (최우선)

**모든 역량은 챕터 1에 집중한다.**
1화가 네이버·유튜브에 최초 공개되고, 시청자는 1화만 보고 시리즈 구독 여부를 결정한다.
2화 이후는 1화 성공 이후에만 의미가 있다.

| 항목 | ch01 | ch02 이후 |
|------|------|----------|
| 씬(Scene) 수 | 6~8개 | 5~8개 |
| 씬당 컷(Cut) 수 | 3~5개 | 3~5개 |
| 챕터 총 컷 수 | 20~30개 | 20~30개 |
| 챕터 총 텍스트 | 2,500~4,000자 | 2,500~4,000자 |
| 프롬프트 | 1화 전용 강화 지침 포함 | 일반 지침 |
| 마지막 씬 마지막 컷 | "다음화가 궁금한" 열린 훅 필수 | 동일 |
| 연재 결정 | 시청자 반응으로 결정 | 반응 확인 후 진행 |

### 자동화 단계 전략 (핵심 로드맵)

**현재는 사용자 개입 게이트를 최대로 열어 품질을 검증한다.**
**결과물 품질이 표준화되는 시점마다 게이트를 하나씩 닫아 AI 완전 자율 제작 공정으로 수렴한다.**

| 단계 | 개입 게이트 수 | 설명 |
|------|-------------|------|
| Phase A (현재) | 5개 | 소스 업로드 / 세계관 / 대본 / 키프레임 / 업로드 — 모두 사용자 확인 |
| Phase B | 3개 | 세계관·키프레임 autoApprove ON — 품질 기준 충족 확인 후 |
| Phase C | 1개 | 대본 autoApprove ON — 소스 업로드만 남음 |
| Phase D (목표) | 0개 | 소스 업로드조차 스케줄러 자동화 — 완전 Zero-Hands |

**구현 메커니즘**: `v3_series.settings` JSON의 `autoApprove*` 플래그로 게이트별 독립 제어
```json
{
  "autoApproveSource":   false,
  "autoApproveWorld":    false,
  "autoApproveScript":   false,
  "autoApproveKeyframe": false,
  "autoApproveUpload":   false
}
```
플래그를 `true`로 바꾸면 해당 게이트를 건너뛰고 자동 진행. 코드 수정 없이 시리즈별 개별 설정 가능.

---

## 2. 전략적 결정 (Strategic Decisions)

| 항목 | 결정 | 이유 |
|------|------|------|
| Supabase | V2와 **공유** | 캐릭터 데이터 재활용, 별도 인프라 불필요 |
| V2 이전 트리거 | **Zero-Hands 자동화 완성** 시 | 소스 업로드 1번 → 전자동 완주 상태 |
| V2 통합 방식 | **V3 독립 API, V2 프론트엔드가 호출** | 사용자 UX 분산 방지, 코드 분리 유지 |
| 시리즈 길이 | **무제한** — 사용자가 명시적으로 종결 결정 | 소비자 반응 보고 継속/중단 결정 |
| 챕터 생산 | **1일 1챕터** — `run_script()` 1회 호출 = 1챕터만 생성 | 유튜브 1일 1업로드 목표 |
| 게재 플랫폼 | **YouTube MP4 + 네이버 웹소설** 이중 게재 | 영상+텍스트 플랫폼 동시 공략 |
| TREND 단계 | **제거** — 소스 파일 업로드로 대체 | 사용자가 직접 팩트 소재 제공 |

### V2 이전 완료 기준 (3가지)
1. 소스 파일 업로드만으로 MP4 생성 성공률 90% 이상
2. YouTube 업로드 자동화 동작 확인
3. 사용자 승인 포인트 3개 이하 유지

### 자동 조회 트리거
- Gemini API 함수(`call_gemini`, `GenerateContentConfig`, `ThinkingConfig` 등) 작성·수정 시
- Remotion 컴포넌트(`useCurrentFrame`, `AbsoluteFill`, `Composition` 등) 작성·수정 시
- edge-tts `Communicate` 클래스 사용 시
- supabase-py 쿼리(`table().select()`, `upsert()` 등) 작성 시


## MCP 서버

**MCP 관련 모든 정보는 `C:\LinkDropV3\packages\mcp-servers\` 에 집중한다.**

```
C:\LinkDropV3\packages\mcp-servers\
├── linkdrop-api\          # V3 FastAPI(포트 8001)를 MCP 도구로 노출 (FastMCP 3.x)
│   ├── server.py          # 도구 구현 (시리즈·챕터·위키·파이프라인 제어)
│   └── manifest.json      # 도구 목록 + 메타데이터
└── notebooklm\            # NotebookLM MCP (notebooklm-mcp-cli 0.5.21)
    └── manifest.json      # 도구 목록 + 메타데이터 (실행 파일: V3 venv)
```

**설정 파일**: `C:\LinkDropV3\.mcp.json` — 모든 MCP 서버 등록 단일 진입점

| 서버 | 종류 | 실행 |
|------|------|------|
| `linkdrop-api` | V3 커스텀 | `packages/mcp-servers/linkdrop-api/server.py` |
| `notebooklm` | 패키지 | `apps/api/.venv/Scripts/notebooklm-mcp.exe` |
| `context7` | 서드파티 | npx |
| `supabase` (plugin) | 서드파티 | `mcp__plugin_supabase_supabase__*` 도구군 |
| `code-review-graph` | 서드파티 | python 모듈 |

### Supabase DDL/마이그레이션 규칙
- **DDL(ALTER TABLE 등)은 반드시 `mcp__plugin_supabase_supabase__apply_migration` 사용**
- project_id: `fmjuhbcxkfuilvvdwvix`
- 인증이 필요한 경우 `mcp__plugin_supabase_supabase__authenticate` 호출 후 진행
- `mcp__supabase__*` 계열(npx)은 인증 토큰 없어 403 발생 — 사용 금지
- SQL 조회는 `mcp__plugin_supabase_supabase__execute_sql` 사용

### 규칙
- 새 MCP 서버 추가 시 `packages/mcp-servers/<서버명>/manifest.json` 생성 + `.mcp.json` 등록
- 커스텀 서버는 `server.py`도 함께 작성
- V3 API 엔드포인트 추가 시 `linkdrop-api/server.py` 도구도 함께 업데이트
- 인증 정보(토큰·쿠키)는 `manifest.json`에 경로만 기록, 파일 자체는 커밋 금지

---

## 프로젝트 구조

```
C:\LinkDropV3\
├── packages\
│   └── mcp-servers\       # ★ MCP 서버 집중 관리
│       └── linkdrop-api\
├── apps/
│   ├── api/                          # FastAPI 백엔드 (포트 8100)
│   │   ├── core/
│   │   │   ├── config.py             # 환경변수 + 설정
│   │   │   └── database.py           # Supabase 클라이언트
│   │   ├── routers/
│   │   │   ├── pipeline.py           # 파이프라인 CRUD + 실행 트리거 + 챕터 제어
│   │   │   ├── steps.py              # 개별 단계 재시도/상태 조회
│   │   │   ├── wiki.py               # 소스 파일 업로드 + RAG 인제스트
│   │   │   └── youtube.py            # YouTube 업로드 + 관리
│   │   ├── services/
│   │   │   ├── world_service.py      # 세계관 조립 (Gemini 1회 + RAG 소스 주입)
│   │   │   ├── script_service.py     # 대본 생성 (1챕터만, current_chapter 기준)
│   │   │   ├── wiki_service.py       # 위키 컨텍스트 관리 + RAG 검색
│   │   │   ├── keyframe_service.py   # 키프레임 생성 + R2 업로드
│   │   │   ├── tts_service.py        # edge-tts + SRT (씬별 병렬)
│   │   │   ├── render_service.py     # Remotion + FFmpeg (씬별 병렬)
│   │   │   ├── youtube_service.py    # YouTube Data API v3
│   │   │   ├── naver_service.py      # 네이버 웹소설 업로드 (stub → 실구현 예정)
│   │   │   └── casting_service.py    # 캐릭터 캐스팅 엔진
│   │   ├── agent/
│   │   │   ├── orchestrator.py       # 에이전트 상태 머신 (메인)
│   │   │   ├── state_machine.py      # 상태 전이 정의 (PipelineStep enum)
│   │   │   ├── retry_policy.py       # 단계별 재시도 전략
│   │   │   ├── event_bus.py          # SSE 이벤트 버스 (실시간 상태 푸시)
│   │   │   └── generation_queue.py   # 동시 렌더 제한 큐
│   │   ├── prompts/                  # LLM 프롬프트 MD
│   │   ├── data/                     # art_styles.json, characters 정적 데이터
│   │   └── main.py
│   └── web/                          # Next.js 14 (포트 3100)
│       └── src/
│           ├── app/
│           │   ├── page.tsx              # 대시보드 (시리즈 목록 + 상태)
│           │   ├── create/page.tsx       # ★ 소스 업로드 (드래그앤드롭 .txt/.srt/.pdf)
│           │   └── series/[id]/page.tsx  # 상세 (파이프라인 진행 + 승인 + 챕터 제어)
│           ├── lib/
│           │   └── seriesStore.ts        # ★ 통합 저장소 클라이언트 (유일한 진입점)
│           ├── types/
│           │   └── series.ts             # ★ 전체 타입 정의 (복사 금지)
│           └── components/
│               ├── PipelineStatus.tsx       # 파이프라인 진행률 스테퍼
│               ├── SourceUploadEditor.tsx   # 소스 파일 업로드 + 게이트 승인
│               ├── KeyframeSetupEditor.tsx  # 키프레임 방식 선택 (Gemini/Pillow)
│               ├── ChapterDonePanel.tsx     # 챕터 완료 패널 (다음화/종결 결정)
│               └── SeriesCard.tsx           # 시리즈 목록 카드
├── supabase/
│   └── migrations/                   # V3 전용 마이그레이션 (v3_ prefix)
├── docs/
│   └── rules/                        # V3 설계 규칙 (51~54번)
└── .env                              # Supabase + Gemini + R2 키
```

## 기술 스택

- **백엔드**: FastAPI, Python 3.11+, Supabase (supabase-py 2.x)
- **프론트엔드**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **AI**: Google Gemini API (`GOOGLE_API_KEY`), NotebookLM (`notebooklm_tools`)
- **영상**: FFmpeg, edge-tts, Pillow, PyMuPDF
- **인증**: Opal CDP Bearer Token (`~/.linkdrop-opal/profiles/default/session.json`)

## 환경 변수

`.env` (루트), `apps/web/.env.local` 사용.
절대 `.env` 파일을 git에 커밋하지 말 것.

## 코딩 규칙

- Python: `python -X utf8` 플래그 사용 (Windows CP949 인코딩 문제 방지)
- Python 가상환경: `apps/api/.venv` 사용
- API 라우트: `apps/api/services/` 하위에 서비스 분리
- 프론트엔드 데이터: `apps/web/src/data/*.json` (코드 수정 없이 편집 가능)

## 이미지 저장 정책 — R2 우선, 로컬 금지

> 핵심 원칙: **프로젝트 레포는 최대한 가볍게 유지한다.**
> 이미지·오디오·폰트 등 바이너리 자산은 모두 Cloudflare R2에 보관하고 URL로만 참조한다.

### R2 버킷 구성 (`.env`)

| 용도 | 버킷명 | 환경변수 | Public URL |
|---|---|---|---|
| 배경·이미지 라이브러리 | `flux-bg-library` | `R2_BUCKET` | `R2_PUBLIC_URL` |
| 공용 자산 (효과음·폰트 등) | `linkdrop-assets` | `R2_ASSETS_BUCKET` | `R2_ASSETS_PUBLIC_URL` |

### 규칙

1. **로컬 경로 참조 금지** — `public/`, `apps/web/public/`, `apps/api/static/` 등 프로젝트 내부 경로에 이미지를 저장하거나 코드에서 참조하지 않는다.
2. **R2 경로 미러링** — 로컬에서 작업한 이미지는 R2에 **동일한 경로 구조**로 업로드한 뒤 `R2_PUBLIC_URL/{경로}` 형태로 참조한다.
   ```
   로컬:  tmp/characters/kim_th_face.png
   R2:    flux-bg-library/characters/kim_th_face.png
   참조:  https://pub-3004911807a7429c89c576d1aa468160.r2.dev/characters/kim_th_face.png
   ```
3. **업로드 후 로컬 삭제** — R2 업로드가 완료된 이미지는 로컬에서 제거하여 레포를 가볍게 유지한다.
4. **git에 이미지 커밋 금지** — `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp3`, `.mp4`, `.ttf` 등 바이너리 자산은 git에 커밋하지 않는다. (`.gitignore`에 추가)
5. **코드에서는 URL만** — `<img src>`, CSS `background-image`, Python에서 이미지 경로를 쓸 때는 항상 R2 Public URL을 사용한다.

### R2 업로드 방법

```bash
# Python (boto3) — apps/api에서 사용
import boto3, os
s3 = boto3.client('s3',
    endpoint_url=os.environ['R2_ENDPOINT'],
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
)
s3.upload_file('local/path/image.png', os.environ['R2_BUCKET'], 'r2/path/image.png')
url = f"{os.environ['R2_PUBLIC_URL']}/r2/path/image.png"

# wrangler CLI (빠른 단건 업로드)
# wrangler r2 object put flux-bg-library/path/image.png --file=local/image.png
```

## 금지 사항

- `settings.local.json`에 API 키, 토큰, 시크릿을 직접 작성하지 말 것
- `git push --force` 금지
- `--no-verify` 플래그 사용 금지
- UI에서 "세션" 표현 금지 → "AI 연결", "AI 사용 가능 시간" 등 일반 언어 사용
- 임시 스크립트를 루트에 생성 금지 → `tmp/` 폴더에만 생성, 사용 후 삭제
- **이미지·바이너리 파일을 git에 커밋하지 말 것 → R2 업로드 후 URL 참조**

<investigate_before_answering>
코드에 대해 답하기 전에 반드시 해당 파일을 먼저 읽을 것. 열어보지 않은 코드에 대해 추측하지 말 것.
사용자가 특정 파일을 언급하면 반드시 Read 도구로 먼저 확인한 후 답변할 것.
근거 없는 답변보다 "확인하겠습니다"가 낫다.
실행하기 전 필요한 맥락을 파악할 수 있도록 사용자에게 질문하기.
복잡한 문제라면  사용자가 애초에 올바른 질문을 하고 있는지부터 점검해줘.
</investigate_before_answering>

<delete_protocol>
★★★ 기존 코드 삭제·대폭 수정 전 필수 절차 ★★★

이 프로젝트는 장기 설계 논의를 거쳐 구현됐다.
"버그처럼 보이는 코드"가 실제로는 설계 의도인 경우가 반복적으로 발생했다.
코드를 삭제하거나 크게 수정하기 전에 반드시:

  1. docs/DESIGN_DECISIONS.md 확인 — 해당 패턴이 등록되어 있는지
  2. 코드 내 "★ 설계 의도" 주석 확인
  3. 관련 설계 문서(51~62번) 해당 섹션 확인

위 세 가지를 확인하고도 의도를 모르겠으면 삭제하지 말고 사용자에게 먼저 확인할 것.

삭제 금지 패턴 (docs/DESIGN_DECISIONS.md 전체 목록):
  - v3_scenes에 동일 컷 2개 (scene_index=0 + 원본) → HOOK 설계 (53번)
  - _absorb_dialogue_cuts() 재호출 → Pass 2 대사 흡수 (53번)
  - _orig_scene_index / _orig_cut_index 임시 필드 → scene_code 계산용
  - mixed 컷 타입 분기 → Gemini 폴백 처리
</delete_protocol>

<debugging_protocol>
버그/오류 발생 시 반드시 이 순서를 따를 것:
1. git diff / git log 먼저 확인 — 최근 변경점에서 원인 파악
2. 에러 메시지와 경고(warning) 정확히 읽기
3. 1가지 가설 → 1가지 테스트 — 여러 개 동시에 바꾸지 말 것
4. 3회 실패 시 접근 방식 전환 — 같은 방법 반복 금지
</debugging_protocol>

<subagent_usage>
서브에이전트는 다음 경우에만 사용:
- 독립적인 작업을 병렬 실행할 때
- 격리된 컨텍스트가 필요할 때
- 3회 이상의 탐색이 필요한 넓은 범위 조사

단순 작업, 단일 파일 수정, 직접 grep/glob으로 충분한 경우에는 서브에이전트 대신 직접 수행할 것.
</subagent_usage>

## 모델 역할 분담

| 별칭 | 모델 | 용도 |
|------|------|------|
| haiku | claude-haiku-4-5 | 파일 탐색, 간단한 수정, 테스트 |
| sonnet | claude-sonnet-4-6 | 코드 리뷰, 기능 구현 |
| opus | claude-opus-4-6 | 아키텍처 설계, 큰 구조 결정 |

## 개발 백로그

- **`docs/BACKLOG.md`** — 모든 미완료 항목, 발견된 이슈, 우선순위 밀린 작업 기록
- 대화 시작 시 반드시 확인, 새 이슈 발견 시 즉시 추가, 완료 시 ✅ 섹션으로 이동

## 설계 원칙

- **Zero-Hands 자동화**: 사용자는 주제만 입력, 결과만 수신
- **시니어 친화 UI**: Gmarket Sans, 큰 폰트, 감성 안내 문구
- **저비용 우선**: edge-tts(무료) > Google TTS, Pillow 키프레임 > Opal HTML
- **클립별 재시도**: 실패 클립만 선택 재생성, 전체 재시작 없음

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
