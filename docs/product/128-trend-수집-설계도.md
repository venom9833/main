# 128 — /series/trend 트랜드 수집 설계도

> 상태: 2단계 완료 — 세계관 데이터 템플릿 기반 순수 Python 생성 (2026-04-04)
> 담당: bbtanmanai
> 원칙: **설계 완성 후 구현**

---

## 0. 콘텐츠 공식 (핵심 방향)

> **팩트(트랜드) × 막장(드라마) = 시리즈 대본**

- **팩트 레이어**: 트랜드 키워드에서 수집한 실제 사회 문제
  - 예) 부동산 역전세, 전세 사기, 육아휴직 차별, 1인 가구 고립, 청년 취업난
- **드라마 레이어**: 막장 드라마 소재로 시청자 감정 몰입 극대화
  - 불륜 / 이혼 위기 / 오피스 애정물 / 가족 갈등 / 세대 충돌 / 배신
- **조합 공식**: 팩트의 심각성을 막장 드라마 구조 위에 얹어 재구성
  - 예) "전세 사기 피해자 가정 → 남편의 은폐 → 아내의 독립 결심 → 처남과 처제의 개입"
  - 예) "구조조정 위기 직장인 → 오피스 불륜 발각 → 가정 붕괴 → 1인 가구로의 전락"

---

## 0-1. 대본 생성 핵심 원칙 (확정)

### 캐릭터 재사용 정책
- **이름은 고정, 설정은 매 시리즈 재구성**
- 시리즈 종결(폐기) 시 동일 캐릭터 이름으로 새 시리즈 시작 — 성격/직업/상황 전면 재설정
- 예) 박준혁은 A 시리즈에서 IT 대리, B 시리즈에서 건설 현장 감독으로 재등장 가능
- **why**: 시청자가 이름에 친숙해지되, 매번 다른 스토리로 피로감 없이 재소비 유도

### 교차 서사 구조
- 두 인물(A·B)의 이야기가 별개로 시작해 교차하며 얽힘
- 예시 설정:
  - 박준혁 = 전세 사기 피해로 고통받는 가장
  - 이수진 = 옆집 김태호와 불륜 진행 중
  - → 두 이야기가 같은 공간(동네·아파트)에서 충돌

### NLM 팩트 주입 원칙
- 대본 전체에서 **NotebookLM 팩트 기반 내용을 지속적으로 노출**
- 단순 배경 설명이 아닌 **등장인물의 대사·행동·갈등의 직접적 원인**으로 활용
- 예) "전세 사기 피해 가구 수 XX만 건" → 박준혁 대사로 자연스럽게 녹임
- 팩트 = 심각성·현실감 부여 장치

### 결말 방식
- **결말 미결정 — 자유 형식**
- 매 챕터는 다음 챕터를 궁금하게 만드는 훅으로 종결
- 자극적이고 예측 불가능한 방향으로 전개
- 해피엔딩/새드엔딩 고정 없음 → 시청자 반응에 따라 방향 가변

---

## 1. 목표

**2개 소스(YouTube, Naver DataLab)**에서 한국 트랜드 키워드를 **4시간마다 자동 수집**,
상위 5개를 Supabase에 저장 → 사용자는 페이지 열면 즉시 결과 확인.

> Google Trends(pytrends) 제거 — 404 오류로 한국 엔드포인트 미지원 확인 (2026-04-04)

- 사용자 액션 없음 (Zero-Hands 원칙)
- AI 호출 없이 (정규식 + 빈도 분석)
- 무료/공식 API 우선
- 특정 소스 실패해도 나머지 결과 반환

---

## 2. 전체 구조

```
[Vercel Cron — 4시간마다]
    ↓ GET /api/series/cron-trends
    ↓ spawn python
collect_trends.py  (2개 소스 ThreadPoolExecutor 병렬)
    ├─ fetch_youtube_trends()   → YouTube API v3 카테고리별(뉴스/교육/하우투 등) 인기영상 제목
    └─ fetch_naver_trends()     → Naver DataLab 분야별 인기 검색어
    ↓
정규식 unigram 추출 + 불용어 필터
    ↓
중복 병합 → 상위 10개 선정
    ↓
generate_world_data()  (순수 Python, API 호출 없음)
    └─ world_templates.json 에서 random.sample(3) → {keyword} 슬롯 치환
    ↓
Supabase trends 테이블 저장 (collected_at, keywords[], world_data{})


[사용자가 /series/trend 접속]
    ↓ GET /api/series/latest-trends
    ↓ Supabase에서 최신 row 1개 조회 (즉시)
    ↓
트랜드 카드 5개 즉시 표시
    + "N시간 전 수집" 안내
    + 수동 새로고침 버튼 (선택)
```

---

## 3. Supabase 테이블 스펙

```sql
-- series_trends 테이블
id           uuid  primary key
collected_at timestamptz
keywords     jsonb   -- [{ keyword, sources[] }, ...]
source_status jsonb  -- { youtube, naver_datalab }
world_data   jsonb   -- { "키워드": { titles[], subjects[] }, ... }
```

- 매 수집마다 새 row insert (히스토리 보존)
- 조회 시 `ORDER BY collected_at DESC LIMIT 1`
- `world_data`: 키워드 선택 시 실시간 AI 호출 없이 즉시 표시

---

## 4. API 엔드포인트 2개

### 4-1. Cron 수집 API (백그라운드)

**Request**: `GET /api/series/cron-trends`
- Vercel Cron에서 4시간마다 호출
- `Authorization: Bearer {CRON_SECRET}` 헤더로 외부 호출 차단

**Response**:
```json
{
  "collected_at": "2026-04-04T14:00:00Z",
  "keywords": [
    { "keyword": "부동산 역전세", "sources": ["유튜브", "네이버"] },
    { "keyword": "AI 일자리",     "sources": ["유튜브", "트랜드"] },
    { "keyword": "저출생 대책",   "sources": ["네이버"] },
    { "keyword": "청년 취업난",   "sources": ["트랜드"] },
    { "keyword": "전세 사기",     "sources": ["유튜브", "네이버", "트랜드"] }
  ],
  "source_status": {
    "youtube":       "ok",
    "naver_datalab": "ok"
  }
  /* google_trends 제거됨 — 404 한국 미지원 (2026-04-04) */
}
```

### 4-2. 최신 트랜드 조회 API (프론트엔드용)

**Request**: `GET /api/series/latest-trends`

**Response**:
```json
{
  "keywords": [ ... ],
  "collected_at": "2026-04-04T14:00:00Z",
  "age_hours": 2
}
```

---

## 4-3. 개발 환경 인증 정책

- `NODE_ENV=development` 시 CRON_SECRET 검사 완전 생략 → 로컬에서 즉시 수집 테스트 가능
- 프로덕션(Vercel)에서만 `Authorization: Bearer {CRON_SECRET}` 헤더 검증

---

## 5. Vercel Cron 설정

`vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/series/cron-trends",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

- Pro 플랜: 1시간 단위까지 가능
- Hobby 플랜: 1일 1회 제한 → 로컬 스케줄러(APScheduler) 대안 검토

---

## 6. 소스별 수집 방법

### 6-1. YouTube 인기영상

- API: `youtube.videos().list(part="snippet", chart="mostPopular", regionCode="KR", maxResults=30)`
- 환경변수: `YOUTUBE_API_KEY` (이미 존재 ✅)
- Quota 비용: 1 unit (무시 가능)
- 출력: 영상 제목 30개 → 키워드 추출

### 6-2. Naver DataLab 인기 검색어

- API: Naver DataLab 검색어 트랜드 (공식, 무료)
  - 엔드포인트: `POST https://openapi.naver.com/v1/datalab/search`
- 환경변수: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (✅ 발급 완료, `.env` 저장됨)
- 수집 방법:
  - 분야별 키워드 그룹 (부동산, 경제, 사회, 취업, 육아 등 5~6개 그룹)
  - 각 그룹 내 후보 키워드들의 최근 30일 검색량 비교
  - 검색 지수 상위 키워드 추출
- 출력: 분야별 인기 검색어 (이미 키워드 형태)
- 주의: 비교 대상 후보 키워드를 `naver_datalab_keywords.json`으로 사전 정의 필요

---

## 7. 키워드 추출 로직

YouTube 제목에서 의미 있는 키워드를 뽑는 방법 (Naver DataLab은 이미 키워드 형태):

```
Step A: 불필요 패턴 제거
  → [속보], [단독], (영상), 【】「」《》 브래킷 제거
  → "채널명 - OOO" 형태 대시 이후 제거

Step B: 한글 단어 추출
  → 정규식 r'[가-힣]{3,}' (3글자 이상, 표준 한글만)
  → 특수문자·오타 포함 단어 제외 (valid_re = r'^[가-힣]+$')

Step C: 불용어 제거
  → collect_trends_stopwords.json 외부파일로 관리 (코드 수정 없이 튜닝 가능)

Step D: 빈도 정렬 → 상위 N개 (unigram Counter 기반)
  → 동일 단어의 등장 횟수 내림차순 → 상위 top_n개 반환
```

> **왜 2글자가 아닌 3글자인가?**: "나", "것", "수" 등 짧은 단어가 불용어 처리 전에 유입되는 것을 방지. 3글자 기준이 실운영에서 더 안정적.
>
> **왜 2-gram을 쓰지 않는가?**: YouTube 제목 특성상 단어가 짧고 단독 명사가 트랜드 신호로 충분. konlpy 없이 구현 복잡도 대비 효과가 낮아 unigram으로 단순화. 필요 시 `kiwi` (순수 C++, JVM 없음) + 2-gram으로 업그레이드 가능.

**왜 형태소 분석기(konlpy)를 안 쓰는가?**
- konlpy = JVM 의존성 → Windows 설치 복잡
- 트랜드 키워드 추출은 완벽한 형태소 분석 불필요
- 필요 시 `kiwi` (순수 C++, JVM 없음)로 업그레이드 가능

---

## 8. 중복 병합 알고리즘

```
1. 2개 소스(YouTube, Naver DataLab)에서 각각 keyword list 수집
2. { keyword: set(sources) } 딕셔너리로 병합 (완전 일치 기준)
3. 정렬: 두 소스 모두 등장한 키워드 우선 → 나머지는 YouTube/Naver 번갈아 채움
4. 상위 10개 반환
```

> **부분 포함 병합 미구현**: "역전세" + "역전세 위기" → 긴 쪽 우선 로직은 현재 미구현.
> 완전 일치 병합만 적용 중. 실운영 키워드 품질 검증 후 필요 시 추가 예정.

---

## 9. 프론트엔드 변경 포인트

### 단계별 UI 전략

**1단계 (검증 기간)**: `/series/trend` 페이지 유지
- 수집 결과 실시간 확인
- 소스별 키워드 품질 검증 (YouTube/Naver/pytrends 각각 어떤 결과가 나오는지)
- 수집 방향이 영상 주제로 적합한지 사람이 판단
- 수동 "지금 수집" 버튼 유지 → 즉시 재수집 후 결과 확인 가능

**2단계 (검증 완료 후)**: `/series/trend` 페이지 제거 → `/series/world` 상단 칩 통합
- 수집 방향 확정 후 자동화로 전환
- world 페이지 상단에 트랜드 5개 칩 노출
- 칩 클릭 → 주제 입력란 자동 입력

### 1단계 /series/trend 페이지 구성

```
┌─────────────────────────────────────────────┐
│  트랜드 수집 결과                             │
│  마지막 수집: 3시간 전  [지금 수집]           │
├─────────────────────────────────────────────┤
│  소스 상태: 유튜브 ● 네이버 ● 트랜드 ●       │
├─────────────────────────────────────────────┤
│  [부동산 역전세]  유튜브 네이버               │
│  [AI 일자리]      유튜브 트랜드               │
│  [저출생 대책]    네이버                      │
│  [청년 취업난]    트랜드                      │
│  [전세 사기]      유튜브 네이버 트랜드        │
└─────────────────────────────────────────────┘
```

- 페이지 마운트 시 DB 최신 결과 자동 조회
- "지금 수집" 버튼 → 즉시 재수집 후 결과 갱신
- 카드 선택 → `/series/world?topic=키워드` 이동

---

## 10. 파일 목록

| 파일 | 작업 | 상태 |
|------|------|------|
| `packages/tools/skill-0-youtube-trend-fetcher/collect_trends.py` | 신규 스킬 분리 | ✅ 완료 |
| `packages/tools/skill-0-youtube-trend-fetcher/collect_trends_stopwords.json` | 불용어 외부파일 | ✅ 완료 |
| `packages/tools/skill-0-youtube-trend-fetcher/naver_datalab_keywords.json` | 분야별 후보 키워드 | ✅ 완료 |
| `packages/tools/skill-0-youtube-trend-fetcher/world_templates.json` | 제목/주제 템플릿 (50개 제목 + 30개 주제 패턴, {keyword} 슬롯) | ✅ 완료 |
| `packages/tools/skill-0-youtube-trend-fetcher/manifest.json` | 스킬 메타 | ✅ 완료 |
| `packages/tools/skill-0-youtube-fetcher/` | 원래 취지로 복구 | ✅ 완료 |
| `apps/web/src/app/api/series/cron-trends/route.ts` | Cron 수집 API + 듀얼모드(FastAPI/spawn) + 개발환경 인증 생략 | ✅ 완료 |
| `apps/web/src/app/api/series/latest-trends/route.ts` | 최신 조회 API | ✅ 완료 |
| `supabase/migrations/20260404000001_series_trends_table.sql` | DB 마이그레이션 | ✅ 완료 |
| `supabase/migrations/20260404000002_fix_series_trends_insert_rls.sql` | RLS INSERT service_role 전용 | ✅ 완료 |
| `supabase/migrations/20260404000003_add_world_data_to_series_trends.sql` | world_data 컬럼 추가 | ✅ 완료 |
| `apps/web/src/app/series/trend/page.tsx` | mock → DB 조회 + 배지 UI (10개) + world_data URL 전달 | ✅ 완료 |
| `apps/web/src/app/series/world/page.tsx` | URL 파라미터로 titles/subjects 수신, 실시간 Gemini 호출 제거 | ✅ 완료 |
| `apps/web/vercel.json` | crons 항목 추가 | ✅ 완료 |
| `apps/api/routers/trends.py` | FastAPI trends 수집 라우터 | ✅ 완료 |

---

## 11. 의존성

| 패키지 | 상태 | 용도 |
|--------|------|------|
| `google-api-python-client` | ✅ 이미 설치됨 | YouTube Data API v3 |
| `urllib.request` | ✅ 내장 모듈 | Naver DataLab API HTTP 요청 |
| `concurrent.futures` | ✅ 내장 모듈 | 병렬 수집 |

### 환경변수

| 변수 | 상태 |
|------|------|
| `YOUTUBE_API_KEY` | ✅ 존재 |
| `NAVER_CLIENT_ID` | ✅ 발급 완료 |
| `NAVER_CLIENT_SECRET` | ✅ 발급 완료 |
| `CRON_SECRET` | 프로덕션 필수 (개발 환경에서는 불필요) |
| `TRENDS_COLLECTOR_URL` | 프로덕션 선택 — FastAPI 서버 URL (미설정 시 로컬 Python spawn) |
| `GOOGLE_API_KEY` | ~~collect_trends.py 불필요~~ — world_data는 템플릿 기반, AI 호출 없음 |

---

## 12. 리스크

| 항목 | 대응 |
|------|------|
| Vercel Hobby 플랜 Cron 1일 1회 제한 | FastAPI APScheduler로 대체 또는 Pro 플랜 전환 |
| Naver DataLab 후보 키워드 범위 협소 | `naver_datalab_keywords.json` 편집으로 분야 추가 |
| YouTube 인기영상 장르 편향 (게임/엔터 위주) | 카테고리별 수집으로 분산 (25뉴스/22사람/26하우투/27교육/28과학) |
| YouTube 키워드 품질 저하 | `collect_trends_stopwords.json` 외부화 → 코드 수정 없이 튜닝 |
| YouTube Quota 소진 | crawl.py 등 타 도구와 공유 → 총량 모니터링 |
| DB 데이터 없을 때 첫 접속 | "아직 수집된 트랜드가 없습니다" 안내 + 수동 수집 버튼 표시 |

---

## 13. 향후 추가 예정 소스

### 인스타그램 / 쓰레드 해시태그 트랜드

- **목적**: 사람들이 지금 이 순간 이야기하는 주제 → 가장 생생한 트랜드
- **API 현황 (2026-04 기준)**:
  - 인스타그램: Meta Graph API — 해시태그 검색 2020년 이후 비즈니스 계정만 허용, 제한적
  - 쓰레드: Threads API 존재하나 트랜드/해시태그 검색 엔드포인트 없음
- **수집 후보 방법**:
  - Apify Instagram Hashtag Scraper (유료, 월 $49~)
  - 소셜 리스닝 SaaS — 블랙키위, 판다랭크 (한국 특화, 유료)
  - 쓰레드 API 업데이트 모니터링 → 공식 트랜드 엔드포인트 추가 시 우선 적용
- **결정**: 1단계(YouTube + Naver DataLab + pytrends) 완료 후 2단계로 추가

---

## 14. 완료 기준 (구현 시 체크)

- [x] Vercel Cron 4시간마다 자동 수집 설정 (`apps/web/vercel.json`)
- [x] Supabase `series_trends` 테이블 생성 및 마이그레이션 적용 (2026-04-04)
- [x] `/series/trend` 페이지 — DB 최신 결과 자동 조회 + "지금 수집" 버튼
- [x] 소스별 상태 뱃지 표시 (유튜브/네이버 성공/실패)
- [x] "N시간 전 수집" 안내 문구 표시
- [x] 소스 1개 실패해도 나머지 결과 저장
- [x] DB 데이터 없을 때 빈 상태 UI 처리 ("아직 수집된 트랜드가 없습니다")
- [x] 불용어 파일 외부화 (`collect_trends_stopwords.json`)
- [x] 수집 시 `world_templates.json` 템플릿으로 키워드별 제목/주제 사전 생성 → `world_data` DB 저장 (API 호출 없음)
- [x] 키워드 선택 시 실시간 AI 호출 없이 DB 데이터 즉시 표시
- [ ] **[2단계]** 검증 완료 후 `/series/world` 상단 칩 통합 + trend 페이지 제거
