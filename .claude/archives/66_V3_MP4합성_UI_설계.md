# 66. LinkDrop V3 — 챕터 MP4 합성 UI

**최초 작성: 2026년 4월 19일**
**설계자: 공동감독 김감독 (AI)**
**승인자: 이감독 (사용자)**

---

## 1. 개요

각 컷 단위 mp4가 완성된 뒤 챕터 전체를 하나의 mp4로 합성하는 UI 페이지.

- **URL**: `http://localhost:3100/series/mp4combine`
- **진입 경로**: 키프레임 페이지(`/series/keyframe`) 툴바 → "▶ MP4 합성" 버튼 (series_id 쿼리 파라미터 자동 전달)
- **API 엔드포인트**: `POST /api/v1/series/{series_id}/chapters/{chapter}/render`
- **UI 파일**: `apps/web/src/app/series/mp4combine/page.tsx`
- **서비스 파일**: `apps/api/services/render_service.py`
- **라우터**: `apps/api/routers/chapters.py` (line 1132)

---

## 2. 3단계 합성 파이프라인

```
각 컷 mp4 (output/{series_code}/ch{N}/{scene_code}.mp4)
  ↓
[1단계] 표준화 재인코딩 (_normalize_clip)
        libx264 crf18 / 30fps / 1920×1080 / aac 44100
        오디오 없는 클립(ken_burns 원본) → anullsrc 무음 트랙 자동 추가
        scale+pad → letterbox (원본 비율 유지, 검은 여백)
  ↓
[2단계] concat (-c copy)
        파라미터 통일 보장 후 -c copy → 재인코딩 없이 빠른 연결
        임시 list.txt → FFmpeg concat demuxer
  ↓
[3단계] 챕터 최종 MP4
        output/{series_code}/ch{N}/ch{N:02d}_final.mp4
```

### 설계 근거

| 문제 | 원인 | 해결 |
|------|------|------|
| concat -c copy 깨짐 | 컷별 코덱/fps/해상도 불일치 | normalize 단계에서 강제 통일 |
| ken_burns 클립 오디오 없음 | TTS mp3를 별도로 믹싱했던 구조 | anullsrc → aac 무음 트랙 자동 추가 |
| lipsync 클립 코덱 불명 | 사용자 수동 제작 mp4, 코덱 다양 | normalize 단계에서 libx264로 통일 |
| TTS 씹힘 | ken_burns 영상 길이 = mp3 길이 (tail 잘림) | +0.5s 패딩 (kenburns_service.py) |

---

## 3. API 명세

### POST `/api/v1/series/{series_id}/chapters/{chapter}/render`

**요청**: Body 없음

**응답 (성공)**:
```json
{
  "ok": true,
  "output": "/abs/path/output/series_code/ch01/ch01_final.mp4",
  "clips": 28,
  "missing": ["s03nc04", "s05nc02"]
}
```

**응답 (실패)**:
```json
{
  "ok": false,
  "reason": "표준화 실패: s02nc01.mp4",
  "stderr": "..."
}
```

**처리 흐름** (`render_service.py → render_chapter()`):
1. `v3_series` 테이블에서 `series_code` 조회
2. `v3_scenes` 테이블 `scene_index / cut_index` 순 정렬 조회  
   ※ **LD-001**: HOOK 레코드 2개 포함 — 중복 제거 금지
3. 로컬 `output/{series_code}/ch{N}/` 폴더에서 `{scene_code}.mp4` 수집
4. 없는 컷 → `missing` 목록에만 기록 후 건너뜀 (전체 실패 아님)
5. `_normalize_clip()` × N → `_concat_clips()` → `ch{N:02d}_final.mp4`

---

## 4. UI 구성

### 상태 정보 (씬 목록 테이블)

| 컬럼 | 설명 |
|------|------|
| 컷코드 | scene_code (타임스탬프 접두사 제거), HOOK 컷 amber 강조 |
| 타입 | `dialogue` / `narr` 뱃지 |
| TTS | `tts_url` 존재 여부 — OK / MISS 뱃지 |
| MP4 | `kb_mode` 또는 `lipsync_url` 존재 여부 — 값 또는 MISS 뱃지 |
| 텍스트 | 컷 대사/나레이션 텍스트 (말줄임 처리) |

### 요약 카드

| 카드 | 기준 |
|------|------|
| 전체 컷 | `scenes.length` |
| mp4 준비 | `kb_mode` 또는 `lipsync_url` 있는 컷 수 |
| lipsync | `type=dialogue` + `lipsync_url` 있는 컷 수 |
| mp4 미완 | `type≠dialogue` + `kb_mode` 없는 컷 수 |
| TTS 없음 | `tts_url` 없는 컷 수 |

### URL 파라미터

- `series_id` 쿼리 파라미터로 시리즈 자동 선택  
  예: `/series/mp4combine?series_id=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- 키프레임 페이지 "▶ MP4 합성" 버튼이 자동 전달

---

## 5. 파일 위치 규칙

| 항목 | 경로 |
|------|------|
| 컷 mp4 입력 | `output/{series_code}/ch{N:02d}/{scene_code}.mp4` |
| 챕터 최종 출력 | `output/{series_code}/ch{N:02d}/ch{N:02d}_final.mp4` |
| 표준화 임시 파일 | `tempfile.TemporaryDirectory()` — 합성 완료 후 자동 삭제 |
| concat list.txt | `tempfile.NamedTemporaryFile` — concat 완료 후 자동 삭제 |

`OUTPUT_ROOT = apps/api/../../../output` (render_service.py line 24)

---

## 6. 제약 사항 및 주의사항

- **타임아웃**: `_normalize_clip` = 300초 / `_concat_clips` = 600초 (클립 수에 비례)
- **누락 컷**: 로컬 mp4 없는 컷은 `missing` 목록에 기록하고 건너뜀 — 있는 클립끼리 합성 진행
- **HOOK LD-001**: `render_chapter()`는 `scene_index/cut_index` 기준 정렬만 수행. HOOK 레코드(scene_index=0) 중복 제거 로직을 추가하면 안 됨.
- **오디오 없는 클립**: ken_burns 원본 mp4는 오디오 스트림 없음 → anullsrc로 무음 트랙 강제 추가 후 aac 인코딩
- **렌더 중 UI 잠금**: 합성 버튼 비활성화 (`rendering` 상태) — 중복 실행 방지

---

## 7. 관련 문서

| 문서 | 관계 |
|------|------|
| 62번 (켄번스 렌더링) | `+0.5s` 규칙 / animation_type 분기 — 컷 mp4 생성 방식 |
| 53번 (마스터코드) | scene_code 체계 / HOOK LD-001 — 컷 순서 기준 |
| 58번 (키프레임 UI) | "▶ MP4 합성" 버튼 진입점 |

---

## 8. 9:16 미리보기 — Modal9x16 (구현 완료, 2026-04-19)

### 8-1. 개요

키프레임 페이지(`/series/keyframe`)에서 컷 선택 후 **"▣ 9:16 미리보기" 버튼** 클릭 시 모달로 9:16 뷰어를 제공한다.

- **진입**: `/series/keyframe` 툴바 `▣ 9:16 미리보기` 버튼 → `Modal9x16` 컴포넌트 오픈
- **컴포넌트**: `apps/web/src/components/Modal9x16.tsx`
- **영상 소스**: `GET /api/v1/series/{id}/chapters/{ch}/scenes/{code}/preview` (원본 16:9 mp4 직접 스트리밍, FFmpeg 변환 없음)

### 8-2. CSS Center-Crop 구조 (미리보기 전용)

미리보기는 FFmpeg 재인코딩 없이 CSS만으로 1:1 체감 구조를 구현한다.

```
9:16 컨테이너 (black bg, aspect-ratio: 9/16)
│
├─ 상단 검은 여백 (21.875%)
│
├─ 내부 wrapper div (height: 56.25%, overflow: hidden)
│    └─ <video> (height: 100%, width: auto, left: 50%, translateX(-50%))
│         ← 16:9 원본을 height 기준으로 표시 → 좌우 넘침을 overflow:hidden으로 센터크롭
│         ← 결과: 원본 중앙 1:1 정사각 영역만 표시
│
└─ 하단 검은 여백 (21.875%)
```

**geometry 근거**: 9:16 컨테이너 height H = W×16/9. 내부 정사각(W×W) 높이 비율 = 9/16 = 56.25%, 상하 여백 각 (1-56.25%)/2 = 21.875%.

### 8-3. 자막 시스템

| 항목 | 값 |
|------|-----|
| 로직 | `useSubtitleOverlay` 훅 공유 (16:9와 동일 코드) |
| Y 위치 | 16:9 자막 Y에서 **▲ 2칸(-10%) 자동 파생** — 독립 조정 없음 |
| 배경 토글 | 16:9와 동일 localStorage 키(`ld_subtitle_bg`) 공유 — 모달에 별도 버튼 없음 |
| Y 맵 | 16:9와 동일 키(`ld_subtitle_y_map`) 읽기 전용 |

### 8-4. `keyframe-9x16/page.tsx` 삭제 이유 (2026-04-19)

`apps/web/src/app/series/keyframe-9x16/page.tsx`는 **삭제**되었다.

| 이유 | 내용 |
|------|------|
| 기능 완전 대체 | Modal9x16이 `/series/keyframe`에 통합되어 동일 기능 제공 |
| 중복 유지 비용 | 독립 localStorage 키(`ld_subtitle_y_map_9x16`), 별도 FFmpeg 경로(`preview-9x16` 캐시 파일) 동기화 부채 |
| 자막 정책 위반 | 독립 Y 조정 및 배경 토글 — "9:16 Y는 16:9에서 파생" 정책에 위배 |
| 번인 자막 위험 | `preview-9x16` 엔드포인트가 캐시 mp4를 반환할 때 이전 FFmpeg 번인 자막이 잔존할 수 있음 |

---

## 9. 9:16 최종 MP4 합성 — 미구현 (설계 보류)

**최초 설계: 2026-04-19 / 설계 확정: 2026-04-20 / 구현 보류**

MP4합성 페이지에 **16:9 / 9:16 해상도 선택 옵션**을 추가하는 설계. 미리보기(섹션 8)와 별개로, 배포용 최종 mp4를 9:16으로 합성하는 파이프라인이다.

### 9-1. 핵심 원칙

**Center Crop + 검은 띠** 방식 채택.

- 미리보기(Modal9x16 CSS)와 **동일한 시각 구조** — 상하 대칭 검은 띠 + 중앙 1:1 정사각 크롭
- 원본 16:9 영상의 중앙 1:1 구간만 표시, 좌우는 잘림
- 자막은 프론트엔드 오버레이로 처리 (FFmpeg burn-in 없음)

> ※ 초기 설계(2026-04-19)에서 "Blurred Padding" 방식을 제안했으나 폐기.
> 실제 원하는 결과물은 검은 띠 + center-crop이며 미리보기와 동일한 구조.

### 9-2. 9:16 캔버스 구조 (1080 × 1920)

```
┌──────────── 1080px ────────────┐  y=0
│   검은 띠 상단 (420px)          │  21.875%
├────────────────────────────────┤  y=420
│                                │
│   1:1 정사각 크롭  1080 × 1080  │  56.25%  ← 16:9 원본 중앙 크롭
│     (center, y=420~1499)       │           좌우 각 420px 잘림
│                                │
├────────────────────────────────┤  y=1500
│   검은 띠 하단 (420px)          │  21.875%
└────────────────────────────────┘  y=1920
         Total: 1080 × 1920
         검산: 420 + 1080 + 420 = 1920 ✓
```

**기하학 근거:**
- 캔버스: 1080 × 1920 (9:16 세로)
- 상단 검은 띠: (1920 − 1080) / 2 = **420px**
- 중앙 영상: **1080 × 1080** (원본 16:9에서 중앙 1:1 크롭)
- 하단 검은 띠: 420px (상단과 대칭)

**FFmpeg filter graph (`_normalize_clip_9x16()` 현재 구현 — 이미 정확함):**
```python
_PAD_Y = (_H * 16 // 9 - _H) // 2   # (1920-1080)/2 = 420
vf = ",".join([
    f"scale={_W}:{_H}:force_original_aspect_ratio=decrease",  # 1920×1080 letterbox
    f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2:black",               # 중앙 정렬
    f"crop={_H}:{_H}:({_W}-{_H})/2:0",                        # 중앙 1080×1080 크롭
    f"pad={_H}:{_H9}:0:{_PAD_Y}:black",                        # 상하 420px 검은 띠
    "setsar=1",
])
```

> ✅ `render_service.py`의 `_normalize_clip_9x16()`이 이 구조를 이미 정확히 구현하고 있다.
> 별도 blurred 함수 불필요. 챕터 렌더에서 이 함수를 재사용하면 된다.
### 9-2-REF. 확정 레퍼런스 이미지 (혼선 방지용)

> **이 이미지가 최종 9:16 포맷의 기준이다. 이후 설계 변경 시 이 이미지와 반드시 대조할 것.**
>
> - 상단 검은 띠 → 중앙 1:1 center-crop 영상 → 하단 검은 띠 (상하 대칭)
> - Blurred Padding / 흐림 배경 방식 **절대 아님**

### 9-3. 구현 완료 기준 (미구현)

- [ ] `render_chapter(aspect="16:9")` 파라미터 추가 + 9:16 분기 로직
      → 9:16이면 `_normalize_clip()` 대신 `_normalize_clip_9x16()` 호출
- [ ] `chapters.py` → `RenderRequest(BaseModel)` body 파싱 추가
- [ ] `POST .../render` body `{"aspect":"9:16"}` → 200 응답
- [ ] 출력 파일명: `ch{N:02d}_final_9x16.mp4`
- [ ] 출력 `ch01_final_9x16.mp4` 재생 시 1080×1920, 상하 대칭 검은 띠 확인
- [ ] `/series/mp4combine` 해상도 토글 후 합성 → 파일명 해상도별 분기 확인
- [ ] body 없는 기존 호출이 16:9 기본값으로 동작 (하위 호환)
