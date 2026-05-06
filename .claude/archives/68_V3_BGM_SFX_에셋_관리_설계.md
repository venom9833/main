# 68. V3 BGM·SFX 에셋 관리 설계

> 작성일: 2026-04-21
> 관련 파일: `apps/api/data/bgm/`, `apps/api/data/sfx/`, `apps/api/data/sfx_rules.json`

---

## 1. 현재 상태 (Phase 1 — 수동 수집)

### 1-1. 폴더 구조

```
apps/api/data/
├── bgm/
│   ├── watchdog-bgm.py      ← 폴더 감시 + 목차 관리
│   ├── bgm_index.json       ← 자동 생성 목차 (mood / genre)
│   └── *.mp3 / *.wav / ...  ← 사용자 수동 저장
│
├── sfx/
│   ├── watchdog-sfx.py      ← 폴더 감시 + 목차 관리
│   ├── sfx_index.json       ← 자동 생성 목차 (category / description)
│   └── *.mp3 / *.wav / ...  ← 사용자 수동 저장
│
└── sfx_rules.json           ← SFX 키워드→파일 라우팅 규칙 테이블
```

### 1-2. BGM 목차 스키마 (`bgm_index.json`)

```json
{
  "잔잔한 피아노.mp3": {
    "mood":     "잔잔한",
    "genre":    "피아노 발라드",
    "added_at": "2026-04-21T02:00:00Z"
  }
}
```

| 필드 | 설명 | 예시 |
|------|------|------|
| mood | 분위기 | 잔잔한 / 긴장감 / 웅장한 / 슬픈 / 설레는 / 경쾌한 / 무거운 / 신비로운 |
| genre | 장르 | 피아노 발라드 / 오케스트라 / 트로트 / 재즈 / 어쿠스틱 / 전자음악 / 국악 / 팝 |

### 1-3. SFX 목차 스키마 (`sfx_index.json`)

```json
{
  "칼소리2.mp3": {
    "category":    "전투/무기",
    "description": "칼 부딪히는 소리",
    "added_at":    "2026-04-21T02:00:00Z"
  }
}
```

| 필드 | 설명 | 허용 카테고리 |
|------|------|--------------|
| category | 소리 유형 | 전투/무기 / 이동/발소리 / 자연/환경 / 생활/일상 / 신체/생리 / 군대/전쟁 / 인파/환경 / 동물 / 기타 |
| description | 한국어 짧은 설명 | 10자 이내 |

### 1-4. watchdog 스크립트 공통 기능

| 명령 | 동작 |
|------|------|
| `python -X utf8 watchdog-bgm.py` | 상시 감시 — 파일 추가 시 Telegram 알림 + 목차 갱신 |
| `python -X utf8 watchdog-bgm.py --scan` | 전체 재색인 (미분류 파일 LLM 자동 분류) |
| `python -X utf8 watchdog-bgm.py --list` | 목차 콘솔 출력 (mood별 그룹) |
| `python -X utf8 watchdog-sfx.py` | 상시 감시 — 파일 추가 시 Telegram 알림 + 목차 갱신 |
| `python -X utf8 watchdog-sfx.py --scan` | 전체 재색인 (미분류 파일 LLM 자동 분류) |
| `python -X utf8 watchdog-sfx.py --list` | 목차 콘솔 출력 (category별 그룹) |

---

## 2. 향후 자동화 설계도 (Phase 2 — 에셋 충분 후)

> **트리거**: BGM ≥ 30개 / SFX ≥ 50개 수집 완료 시 구현 시작

### 2-1. SFX 자동화 파이프라인

```
[씬 텍스트 (image_hint)]
        │
        ▼
sfx_rules.json 키워드 매칭 (현재 동작 중)
        │
        ├─→ 매칭 성공 → sfx_rules의 파일 경로 사용
        │
        └─→ 매칭 실패 → [Phase 2 신규]
                  │
                  ▼
          sfx_index.json 조회
          (category + description 유사도 검색)
                  │
                  ▼
          최적 SFX 파일 선택
                  │
                  ▼
          sfx_rules.json에 자동 규칙 추가 (학습)
```

#### SFX Phase 2 구현 항목

| # | 항목 | 파일 |
|---|------|------|
| SFX-1 | `sfx_index.json` → `sfx_rules.json` 자동 동기화 스크립트 | `scripts/sync_sfx_rules.py` |
| SFX-2 | 씬 텍스트 + sfx_index 유사도 매칭 서비스 | `services/sfx_matcher.py` |
| SFX-3 | sfx_rules.json 갱신 API 엔드포인트 | `routers/audio.py` |

#### `sfx_rules.json` Phase 2 확장 스키마

```json
{
  "oneshot": [
    {
      "id": "sword_clash",
      "file": "칼공격소리1.wav",
      "text_keywords": ["칼", "검", "공격", "베었다", "찔렀다"],
      "category": "전투/무기",
      "description": "칼 공격 소리",
      "volume_db": -18,
      "priority": 9
    }
  ]
}
```

### 2-2. BGM 자동화 파이프라인

```
[씬 전체 텍스트 (씬 내 모든 컷)]
        │
        ▼
  분위기 키워드 추출 (LLM Free)
        │
        ▼
  bgm_index.json mood 컬럼 매칭
  예: "긴장감" → 긴장감 mood 파일 목록
        │
        ▼
  랜덤 선택 (seed 기반 재현 가능)
        │
        ▼
  chapter 렌더 파이프라인에 BGM 레이어 삽입
  (render_service.py FFmpeg -i bgm.mp3 -filter_complex amix)
```

#### BGM Phase 2 구현 항목

| # | 항목 | 파일 |
|---|------|------|
| BGM-1 | 씬 분위기 → bgm_index mood 매칭 서비스 | `services/bgm_matcher.py` |
| BGM-2 | render_service.py BGM 레이어 삽입 로직 | `services/render_service.py` |
| BGM-3 | 챕터 렌더 API `bgm_auto` 옵션 파라미터 | `routers/chapters.py` |

#### BGM FFmpeg 믹싱 설계 (render_service.py)

```python
# BGM 자동 믹싱 (Phase 2 — bgm_index 충분 후 구현)
# -filter_complex: BGM을 영상 길이에 맞게 루프 + 페이드아웃
# [0:a] 원본 TTS 음성, [1:a] BGM 파일
ffmpeg_args = [
    "ffmpeg", "-y",
    "-i", str(final_video_path),
    "-i", str(bgm_path),
    "-filter_complex",
    "[1:a]aloop=loop=-1:size=2e+09,atrim=duration={dur},"
    "afade=t=out:st={fade_start}:d=3,volume=0.15[bgm];"
    "[0:a][bgm]amix=inputs=2:duration=first[aout]",
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac",
    str(output_path),
]
```

### 2-3. 에셋 수집 자동화 (Phase 3 — 장기)

```
[freesound.org API]  [YouTube Audio Library]  [직접 제작]
         │                    │                     │
         └──────────┬─────────┘                     │
                    ▼                               │
         자동 다운로드 스크립트                       │
         (scripts/fetch_sfx.py)                    │
                    │                               │
                    └────────────┬──────────────────┘
                                 ▼
                    apps/api/data/sfx/ 저장
                                 │
                                 ▼
                    watchdog-sfx.py 자동 감지
                    → sfx_index.json 갱신
                    → Telegram 알림
```

---

## 3. 현재 sfx_rules.json 상태

### 3-1. 지원 타입

| 타입 | 설명 | 현재 파일 수 |
|------|------|------------|
| ambience | 공간 배경음 (사무실, 카페, 병원 등 10종) | 0 (경로만 정의) |
| bed | 감정 하층 음악 (우울, 긴장, 희망, 로맨틱, 서스펜스 5종) | 0 (경로만 정의) |
| oneshot | 단발 효과음 (전화, 노크, 발소리 등 10종) | 0 (경로만 정의) |

> **주의**: sfx_rules.json의 `file` 경로는 `ambience/office_night.ogg` 형식 (상대 경로).
> 실제 파일은 `apps/api/data/sfx/ambience/`, `sfx/bed/`, `sfx/oneshot/` 서브폴더에 위치 예정.
> 현재 최상위 sfx/ 폴더에는 rawFile만 존재 — Phase 2에서 서브폴더 정리 필요.

### 3-2. Phase 2 폴더 구조 목표

```
apps/api/data/sfx/
├── ambience/          ← 공간 배경음 (sfx_rules.json 참조)
│   ├── office_night.ogg
│   ├── cafe.ogg
│   └── ...
├── bed/               ← 감정 하층 음악
│   ├── melancholy.ogg
│   ├── tension.ogg
│   └── ...
├── oneshot/           ← 단발 효과음
│   ├── phone_ring.ogg
│   ├── door_knock.ogg
│   └── ...
├── raw/               ← 수동 수집 원본 (현재 최상위에 있는 파일들)
│   ├── 칼소리2.mp3
│   └── ...
├── sfx_index.json
└── watchdog-sfx.py
```

---

## 4. 의존성 / 환경

### 4-1. 필수 패키지

```bash
pip install watchdog httpx python-dotenv
```

### 4-2. 필수 환경변수 (`.env`)

```
TELEGRAM_BOT_TOKEN=...    # V3_watch_Bot 토큰
TELEGRAM_CHAT_ID=...      # 수신 채팅 ID
GEMINI_FREE_API_KEY=...    # 무료 티어 분류 (LD-011)
```

### 4-3. LLM 분류 정책 (LD-011 준수)

| 단계 | 사용 LLM | 용도 |
|------|---------|------|
| 1 | Python 결정론적 | 파일명 규칙 매칭 (미구현, Phase 2 검토) |
| 2 | Gemini Free | 파일명 → mood/genre/category 분류 |
| 3 | Gemini Paid | 사용 안 함 (에셋 분류에 불필요) |

---

## 5. 마일스톤

| 단계 | 조건 | 내용 |
|------|------|------|
| Phase 1 (현재) | 진행 중 | 수동 수집 + watchdog 목차 관리 |
| Phase 2 | BGM≥30 / SFX≥50 | sfx_rules.json 자동 동기화 + BGM 자동 믹싱 |
| Phase 3 | Phase 2 완료 후 | freesound API 자동 수집 파이프라인 |
