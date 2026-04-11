# 117 — 미드저니 배경이미지 자동 생성 & R2 업로드

> 최종 업데이트: 2026-03-22
> 상태: 📋 설계 문서 (미구현)
> 우선순위: 🟡 중간

## ★ 아키텍처 방향 수정 (2026-03-22)

**기존 설계**: Playwright 독립 프로세스로 미드저니 자동화
**변경 방향**: **Electron BrowserView** 기반으로 전환

- LinkDrop 데스크톱 앱(Electron)이 다용도 컨테이너로 확장 예정
- `iframe` 차단 문제 → Electron BrowserView는 크로스 오리진 제한 없음
- 미드저니 WebView를 LinkDrop 앱 **창 안 패널**로 임베딩
- Playwright 별도 프로세스 불필요 → `webContents.executeJavaScript()`로 DOM 제어
- 로그인 세션: Electron `session.defaultSession` 퍼시스턴트 프로필 재사용

```
[LinkDrop 데스크톱 앱]
┌─────────────────┬──────────────────────────┐
│  LinkDrop UI    │  Midjourney BrowserView  │
│  (스케줄/큐)    │  (실제 MJ 화면 임베딩)   │
│  프롬프트 주입  │  생성 완료 감지 → 저장   │
└─────────────────┴──────────────────────────┘
```

> 구현 전 Playwright 기반 코드(`mj_browser.py`)는 참고용으로 유지.

---

## 1. 목적

현재 배경이미지를 미드저니에서 수동 생성 후 R2에 수동 업로드하는 작업을 완전 자동화한다.

- **입력**: 화풍 ID (art_styles.json 기준) + 미드저니 전용 고급 프롬프트
- **출력**: R2 버킷(`flux-bg-library`)에 화풍별 PNG 자동 누적
- **주기**: 5분마다 4장 생성 (백그라운드 데몬)

---

## 2. 전체 흐름

```
[APScheduler 5분 주기]
        ↓
[MidjourneyBrowser]
  ├── 1. Playwright persistent context 실행
  ├── 2. .env 크리덴셜로 자동 로그인
  ├── 3. 화풍 큐에서 스타일 1개 선택 (라운드로빈)
  ├── 4. 미드저니 전용 고급 프롬프트 입력 + /imagine 실행
  ├── 5. 생성 완료 감지 (DOM 폴링, 최대 5분 대기)
  ├── 6. 4장 이미지 개별 다운로드 (U1~U4 업스케일)
  └── 7. r2_client.upload_bg() × 4회 → R2 저장
        ↓
[R2 버킷: flux-bg-library]
  └── {style_id}/{index:03d}.png
```

---

## 3. 모듈 구조

```
packages/tools/skill-2-video-longform1/opal-manager/
└── midjourney_automation/
    ├── mj_browser.py          # Playwright 브라우저 + 로그인 + 이미지 생성
    ├── mj_prompt_builder.py   # 화풍별 미드저니 전용 프롬프트 생성
    ├── mj_scheduler.py        # APScheduler 5분 주기 실행기
    ├── mj_queue.py            # 화풍 라운드로빈 큐 관리
    └── mj_styles.json         # 화풍별 미드저니 전용 프롬프트 정의
```

---

## 4. mj_browser.py — 핵심 클래스 설계

```python
class MidjourneyBrowser:
    """
    Playwright persistent context 기반 미드저니 자동화 브라우저
    세션을 유지하여 매 주기마다 재로그인 없이 동작
    """

    MIDJOURNEY_URL = "https://www.midjourney.com"
    SESSION_DIR = "~/.linkdrop-mj/session"

    # --- 초기화 ---
    async def start(self)
        # launch_persistent_context(SESSION_DIR, channel="chrome")
        # 첫 실행 시에만 로그인 필요, 이후 세션 재사용

    async def stop(self)

    # --- 로그인 ---
    async def login(self, email: str, password: str)
        # .env에서 MJ_EMAIL, MJ_PASSWORD 읽기
        # /signin 페이지 → 이메일/비번 입력 → 로그인
        # 로그인 성공 여부 확인 (리다이렉트 URL 또는 DOM 기준)

    async def is_logged_in(self) -> bool
        # 세션 쿠키 또는 특정 DOM 요소 존재 여부로 판단

    # --- 이미지 생성 ---
    async def generate(self, prompt: str, style_id: str) -> list[Path]
        """
        1. /imagine 페이지로 이동
        2. 프롬프트 텍스트 입력
        3. 생성 시작
        4. 완료 감지 (wait_for_completion)
        5. U1~U4 업스케일 순차 실행
        6. 4장 다운로드 → 로컬 tmp 경로 반환
        """

    async def _wait_for_completion(self, timeout: int = 300) -> bool
        """
        DOM 폴링으로 생성 완료 감지
        - 생성 중: 이미지 블러 상태 또는 프로그레스 표시
        - 완료: 4개 이미지 썸네일 선명하게 표시됨
        - 폴링 간격: 5초, 최대 timeout(초) 대기
        """

    async def _upscale_and_download(self) -> list[Path]
        """
        U1, U2, U3, U4 버튼 순차 클릭
        각 업스케일 완료 후 이미지 URL 추출 → 로컬 저장
        저장 경로: tmp/mj_{style_id}_{timestamp}_{n}.png
        """
```

---

## 5. mj_styles.json — 화풍별 프롬프트 구조

```json
{
  "_comment": "미드저니 전용 고급 프롬프트. art_styles.json HTML 화풍과 1:1 대응",
  "_version": "1.0",

  "ghibli-real": {
    "label": "지브리 실사풍",
    "prompt": "Studio Ghibli pastoral landscape, golden hour warm light, layered misty mountains, lush meadow foreground, floating pollen particles, god rays through clouds, watercolor soft edges, no people, no text, cinematic wide shot --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, letters, watermark, people, faces, urban"
  },

  "anime-sf": {
    "label": "애니메이션 SF",
    "prompt": "vibrant anime sci-fi cityscape, deep violet purple sky gradient, neon cyan electric blue, megacity silhouette with glowing windows, holographic haze, bioluminescent ground, speed lines, epic establishing shot, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, faces, people"
  },

  "pixar-3d": {
    "label": "픽사 3D",
    "prompt": "Pixar-style warm 3D rendered landscape, bright sky blue, sunshine yellow, rolling green hills, volumetric puffy clouds, radial sun glow, light shafts, cheerful and optimistic, family friendly, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, dark, scary"
  },

  "reality": {
    "label": "실사 다큐풍",
    "prompt": "BBC Planet Earth cinematic golden hour landscape, dramatic directional light, atmospheric haze horizon, terrain silhouette, lens vignette, light rays, film grain, photorealistic, national geographic quality, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, artificial"
  },

  "ghibli-night": {
    "label": "지브리 야경",
    "prompt": "Ghibli magical night scene, deep indigo star-filled sky, milky way band, glowing full moon with halo, village silhouette with warm amber lit windows, fireflies floating, reflection lake, deeply nostalgic and magical, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, daylight"
  },

  "health-senior-1": {
    "label": "시니어건강 - 따뜻한 치유",
    "prompt": "warm healing morning garden, soft golden green light, healing energy aura, gentle bokeh, morning mist low ground, soft cream gold tones, peaceful and reassuring atmosphere, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, dark, cold, urban"
  },

  "health-senior-2": {
    "label": "시니어건강 - 자연 치유",
    "prompt": "forest nature therapy scene, layered tree silhouettes, golden light shafts through canopy, falling leaves, misty forest stream reflection, ancient healing forest atmosphere, peaceful, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, dark, scary"
  },

  "tech-trend-1": {
    "label": "기술트렌드 - 사이버 미래",
    "prompt": "futuristic cyber dark space, electric blue neon cyan data streams, floating hexagonal grids, circuit network traces, particle field, deep navy background, intelligent digital future visualization, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, organic, nature"
  },

  "tech-trend-2": {
    "label": "기술트렌드 - 디지털 파동",
    "prompt": "abstract digital wave landscape, deep purple blue, glowing data flow lines, aurora borealis inspired tech, energy field visualization, quantum computing aesthetic, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people"
  },

  "stock-news-1": {
    "label": "주식/금융 - 상승장",
    "prompt": "financial market bull run, golden upward light rays, prosperity energy, warm amber gold tones, abstract ascending lines, optimism and momentum, cinematic wide --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, charts, numbers, watermark, people"
  },

  "stock-news-2": {
    "label": "주식/금융 - 글로벌",
    "prompt": "global financial network, deep blue world sphere concept, glowing connection nodes, city lights from above, economic power visualization, prestige and authority, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, numbers, charts, watermark, people"
  },

  "wisdom-quotes-1": {
    "label": "명언/지혜 - 동양",
    "prompt": "East Asian philosophy aesthetic, ink wash mountain landscape, misty zen garden, bamboo forest, morning mist, serene and contemplative atmosphere, traditional ink painting style, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, western, people, faces"
  },

  "wisdom-quotes-2": {
    "label": "명언/지혜 - 우주",
    "prompt": "cosmic wisdom universe scene, galaxy nebula background, starfield, deep space purple gold, transcendent spiritual light, timeless and infinite, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces"
  },

  "lifestyle-1": {
    "label": "라이프스타일 - 모던",
    "prompt": "modern minimal lifestyle background, clean warm interior light, soft neutral beige cream, elegant bokeh, morning coffee atmosphere, calm and aspirational, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, cluttered"
  },

  "lifestyle-2": {
    "label": "라이프스타일 - 자연",
    "prompt": "natural outdoor lifestyle, golden hour soft light, lush green nature, fresh air energy, wellness and vitality atmosphere, aspirational and uplifting, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, urban"
  },

  "news-anchor": {
    "label": "뉴스 앵커",
    "prompt": "broadcast news studio abstract background, dark blue professional, subtle bokeh light nodes, authoritative and trustworthy atmosphere, clean modern broadcast aesthetic, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, watermark, people, faces, cluttered"
  },

  "economy-global": {
    "label": "글로벌 경제",
    "prompt": "global economy abstract visualization, world map light nodes, international trade energy, blue gold prestige tones, macro economic power concept, no people, no text --ar 16:9 --style raw --v 6.1 --q 2",
    "negative": "text, numbers, charts, watermark, people"
  }
}
```

---

## 6. mj_queue.py — 라운드로빈 큐

```python
"""
화풍 순환 방식:
- 전체 17개 화풍을 큐에 넣고 순서대로 1개씩 소비
- 한 바퀴 완료 시 자동 리필
- 특정 화풍 R2 재고 부족 시 우선순위 큐에 삽입
- 상태 파일: ~/.linkdrop-mj/queue_state.json
"""

class MJStyleQueue:
    def next_style(self) -> str          # 다음 화풍 ID 반환
    def mark_done(self, style_id: str)   # 완료 처리
    def prioritize(self, style_id: str)  # 재고 부족 화풍 우선 삽입
    def status(self) -> dict             # 현재 큐 상태 반환
```

---

## 7. mj_scheduler.py — 5분 주기 실행기

```python
"""
APScheduler IntervalTrigger(minutes=5) 기반
매 사이클:
1. R2 재고 부족 화풍 체크 (count_bgs < 50이면 우선순위 큐 삽입)
2. 큐에서 화풍 1개 선택
3. MidjourneyBrowser.generate() 실행 → 4장 다운로드
4. r2_client.upload_bg() × 4회
5. 로컬 tmp 파일 정리
"""

# 실행 방법
# python -X utf8 mj_scheduler.py              # 데몬 시작
# python -X utf8 mj_scheduler.py --once       # 1회만 즉시 실행
# python -X utf8 mj_scheduler.py --style ghibli-real  # 특정 화풍 즉시 실행
```

---

## 8. .env 추가 항목

```env
# Midjourney 자동화
MJ_EMAIL=your_midjourney_email@example.com
MJ_PASSWORD=your_midjourney_password
MJ_SESSION_DIR=~/.linkdrop-mj/session

# 자동화 설정
MJ_INTERVAL_MINUTES=5        # 생성 주기 (기본 5분)
MJ_MIN_STOCK=50              # 화풍별 최소 재고 (이하면 우선 생성)
MJ_TARGET_STOCK=200          # 화풍별 목표 재고
```

---

## 9. R2 저장 경로

기존 `r2_client.py`의 경로 규칙 그대로 사용:

```
flux-bg-library/
├── ghibli-real/
│   ├── 000.png
│   ├── 001.png
│   └── ...
├── anime-sf/
│   └── ...
└── (17개 화풍)
```

미드저니 생성분과 FLUX 생성분이 동일 경로에 혼합 저장됨.
→ `r2_client.count_bgs(style_id)`로 총 재고 관리.

---

## 10. 생성 완료 감지 전략

미드저니 웹 UI는 생성 중 이미지가 블러 처리되고 완료 시 선명해짐.

```
폴링 방법 (5초 간격):
1. 이미지 컨테이너 DOM 요소 존재 확인
2. 이미지 src 또는 srcset 로드 완료 확인
3. 프로그레스 바 또는 로딩 스피너 사라짐 확인
4. U1~U4 업스케일 버튼 활성화 확인 (가장 확실)

타임아웃: 5분 (미드저니 최대 생성 시간 기준)
실패 시: 큐에 해당 화풍 재삽입 + 에러 로그
```

---

## 11. 구현 순서 (Phase)

| Phase | 작업 | 난이도 |
|-------|------|--------|
| 1 | `mj_styles.json` 프롬프트 작성 + 검증 | 낮음 |
| 2 | `mj_browser.py` 로그인 + 기본 DOM 탐색 | 중간 |
| 3 | 프롬프트 입력 + 생성 완료 감지 로직 | 높음 |
| 4 | U1~U4 업스케일 + 이미지 다운로드 | 중간 |
| 5 | `r2_client.py` 연동 업로드 | 낮음 (기존 코드 재사용) |
| 6 | `mj_queue.py` 라운드로빈 큐 | 낮음 |
| 7 | `mj_scheduler.py` APScheduler 통합 | 낮음 |
| 8 | 에러 핸들링 + 재시도 로직 | 중간 |

---

## 12. 의존성

```txt
# 추가 필요
playwright>=1.40.0       # 기존 Opal 토큰 캡처에서 이미 사용 중
apscheduler>=3.10.0      # 스케줄러
python-dotenv>=1.0.0     # .env 로딩 (이미 사용 중)

# 기존 재사용
boto3                    # r2_client.py에서 이미 사용
Pillow                   # 이미지 후처리
```

---

## 13. ⚠️ 주의사항

**미드저니 ToS**
미드저니 이용약관은 자동화 도구를 통한 접근을 금지합니다.
본인 유료 계정에서 개인 프로젝트 목적으로 사용하지만, 적발 시 계정 정지 위험이 있습니다.
→ 요청 간격(5분)을 사람이 수동 작업하는 속도처럼 유지하여 탐지 위험 최소화.

**로그인 방식 사전 확인 필요**
미드저니 계정이 이메일/비번 직접 가입인지, Google/Discord OAuth인지 확인 후 구현.
OAuth 방식이면 `login()` 로직이 더 복잡해짐.

---

## 14. 연관 파일

| 파일 | 역할 |
|------|------|
| `opal-manager/keyframe_providers/r2_client.py` | R2 업로드 클라이언트 (재사용) |
| `opal-manager/art_styles.json` | 17개 화풍 정의 (HTML/Opal용) |
| `opal-manager/midjourney_automation/mj_styles.json` | 17개 화풍 미드저니 전용 프롬프트 |
| `opal-manager/generate_bg_library.py` | FLUX 라이브러리 생성 (대안) |
