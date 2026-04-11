# 119 — NLM 템플릿 라이브러리 구축 계획

> 최종 업데이트: 2026-03-22
> 상태: 계획 수립 완료 / 실행 대기

---

## 목적

NotebookLM(NLM-05)으로 고품질 시나리오를 사전 대량 생성하여 Supabase에 저장.
사용자가 주제 선택 시 즉시 NLM 시나리오 매칭 → 씬별 수정 → 영상 생성.

**기존 Gemini 즉석 생성(부실) → NLM 사전 생성 라이브러리로 전환**

---

## 전체 워크플로우

```
[Step 1] 카테고리 / 주제 선정
         LinkDrop 운영팀이 주제 목록 확정

[Step 2] 소스 수집 (주제당 10개)
         YouTube URL + 웹 아티클 + PDF 자동 수집
         → skill-0-vault-source-fetcher 활용

[Step 3] NLM 소스 주입
         notebooklm-tools: create_notebook + add_url_sources
         → 주제당 전용 노트북 1개

[Step 4] NLM-05 시나리오 생성
         NLM query: 전문 프롬프트 → 자연어 대본 (8~12씬)

[Step 5] Gemini 구조화 변환
         NLM 대본 → visual_type JSON
         (씬별 visual_type + data + 나레이션 텍스트)

[Step 6] 품질 검토
         운영팀 1회 검토 → 통과 / 재생성

[Step 7] Supabase 저장
         scenarios 테이블 → 라이브러리 누적

[Step 8] 사용자 매칭
         사용자 주제 선택 → 유사 시나리오 검색 → 제공
```

---

## Step 1 — 카테고리 / 주제 선정

### 1차 카테고리 (7종)

| # | 카테고리 | 목표 주제 수 | 예시 주제 |
|---|---------|------------|----------|
| C-1 | 건강·시니어 | 50개 | 멀티비타민 효과, 무릎 통증 관리, 수면 개선 |
| C-2 | 재테크·주식 | 50개 | 배당주 투자, ETF 기초, 부동산 입문 |
| C-3 | AI·기술 트렌드 | 50개 | ChatGPT 실무 활용, AI 이미지 생성, 자동화 도구 |
| C-4 | 자기계발 | 50개 | 습관 형성, 시간 관리, 독서법 |
| C-5 | 부업·1인 기업 | 50개 | 스마트스토어 시작, 전자책 출판, 유튜브 수익화 |
| C-6 | 라이프스타일 | 30개 | 미니멀 라이프, 주말 루틴, 혼자 여행 |
| C-7 | 지혜·명언 | 30개 | 스토아 철학, 성공한 사람들의 공통점 |

**1차 목표: 310개 주제 × 1개 시나리오 = 310개 NLM 시나리오**

---

## Step 2 — 소스 수집 방법 (주제당 10개)

### 소스 유형별 수집 방법

| 소스 유형 | 수집 방법 | 도구 |
|---------|---------|------|
| YouTube URL | 주제 키워드 검색 → 상위 7개 영상 URL | YouTube Data API (`YOUTUBE_API_KEY`) |
| 웹 아티클 | 네이버/구글 검색 → 상위 블로그/뉴스 3개 | httpx + BeautifulSoup 크롤러 |
| PDF | 공공 보고서 / 연구자료 (선택) | 수동 업로드 or URL |

### 자동 수집 스크립트 필요 항목
```
packages/tools/skill-0-nlm-source-collector/
├── youtube_search.py     # YouTube API → 주제별 상위 영상 URL 수집
├── web_crawler.py        # 키워드 → 웹 아티클 URL + 본문 추출
└── source_builder.py     # 주제 → 소스 10개 목록 → JSON 출력
```

---

## Step 3~4 — NLM 노트북 생성 + 시나리오 생성

### NLM-05 전용 프롬프트 (시나리오 생성)

```
제공된 소스들을 교차 분석하여 YouTube 쇼츠/롱폼 영상 대본을 작성해줘.

조건:
- 씬 수: 8~12개
- 각 씬: 나레이션 텍스트 (3~5문장) + 핵심 키워드 1개
- 시작: 강한 훅 (첫 5초 시청자 잡기)
- 중간: 소스 기반 구체적 데이터/사례 포함
- 마지막: 행동 유도 (댓글/구독/저장)
- 출력: 씬 번호 + 나레이션 + 핵심키워드 형식
```

### NLM 노트북 관리 전략

- 주제당 전용 노트북 1개 생성
- 노트북 ID → Supabase `nlm_notebooks` 테이블 저장
- 재활용: 같은 카테고리 추가 주제 → 소스 교체 + 재쿼리

---

## Step 5 — Gemini 구조화 변환

NLM 자연어 대본 → visual_type JSON 변환

```python
# 변환 프롬프트 예시
prompt = f"""
다음 영상 대본을 씬별 JSON으로 변환해줘.
각 씬은 visual_type과 data, narration을 포함해야 해.

visual_type 종류:
- key_point: 핵심 메시지
- stat_card: 숫자/통계
- quote_hero: 인용구
- comparison_table: 비교 표
- timeline: 단계별 흐름
- icon_grid: 항목 나열
- ranking_list: 순위
- split_screen: 좌우 비교
- full_visual: 감성 장면

대본:
{nlm_script}

출력: JSON 배열만
"""
```

---

## Step 7 — Supabase 저장 구조

### scenarios 테이블 확장 (신규 컬럼 추가)

| 컬럼 | 타입 | 내용 |
|------|------|------|
| `id` | uuid | PK |
| `category` | text | C-1~C-7 |
| `topic` | text | 주제명 |
| `topic_keywords` | text[] | 검색 키워드 |
| `source` | text | `nlm` / `gemini` |
| `nlm_notebook_id` | text | NLM 노트북 ID |
| `source_urls` | text[] | 수집된 소스 URL 목록 |
| `nlm_script` | text | NLM 원본 자연어 대본 |
| `scenes_json` | jsonb | visual_type JSON (Gemini 변환) |
| `scene_count` | int | 씬 수 |
| `quality_checked` | bool | 운영팀 검토 완료 여부 |
| `use_count` | int | 사용자 선택 횟수 |
| `created_at` | timestamp | 생성일 |

---

## Step 8 — 사용자 매칭 로직

```
사용자 주제 입력 ("건강한 수면 루틴")
       ↓
1순위: topic_keywords 정확 매칭
2순위: category 내 use_count 높은 순
3순위: Gemini 임베딩 유사도 매칭
       ↓
NLM 시나리오 3개 제안 → 사용자 선택
       ↓
씬별 검토·수정 → 영상 생성
```

---

## 필요한 개발 항목

| # | 항목 | 우선순위 | 비고 |
|---|------|---------|------|
| D-1 | 소스 자동 수집 스크립트 | 높음 | YouTube API + 웹크롤러 |
| D-2 | NLM 배치 실행 스크립트 | 높음 | 주제 목록 → 자동 노트북 생성 + 쿼리 |
| D-3 | Gemini 구조화 변환 스크립트 | 높음 | NLM 대본 → visual_type JSON |
| D-4 | scenarios 테이블 마이그레이션 | 중간 | 신규 컬럼 추가 |
| D-5 | 사용자 매칭 API | 중간 | `/api/v1/scenarios/match` |
| D-6 | 운영팀 품질 검토 UI | 낮음 | 어드민 페이지 |

---

## 생산 목표 및 일정

| 단계 | 목표 | 비고 |
|------|------|------|
| 1차 | 100개 시나리오 확보 | 개발 환경 검증용 |
| 2차 | 310개 시나리오 확보 | 7개 카테고리 완성 |
| 3차 | 1,000개 시나리오 확보 | 주제 세분화 + 스타일 다양화 |

**NLM 무료 계정 제약**: 노트북당 소스 25개 이하, 일일 쿼리 한도 존재
→ 배치 실행 시 계정 여러 개 분산 또는 유료 계정 고려

---

## 기존 자산 연계

- `skill-0-vault-source-fetcher` — NLM 소스 주입 로직 재활용
- `skill-0-youtube-fetcher` — YouTube URL 수집 재활용
- Supabase `scenarios` 테이블 — 기존 5,917개(Gemini) + NLM 생성분 추가
- `YOUTUBE_API_KEY`, `GOOGLE_API_KEY` — 기존 환경변수 재활용

---

## 연관 문서

- `118-notebooklm-video-skill.md` — NLM-05 활용 설계
- `BACKLOG.md` U-4 — longform 시나리오 NLM 전환
- `BACKLOG.md` M-8 — 시나리오 수집/구성 전면 개편
- `BACKLOG.md` M-12 — NLM-01→소스수집→NLM-05 파이프라인
