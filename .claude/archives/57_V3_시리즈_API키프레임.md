# 57. LinkDrop V3 — API 키프레임 제작

**최초 작성: 2026년 4월 11일**
**최종 수정: 2026년 4월 18일**
**설계자: 공동감독 김감독 (AI)**
**승인자: 이감독 (사용자)**

---

## 1. 목적

시리즈 대본의 씬/컷 단위로 이미지 생성용 프롬프트를 자동 조합한다.  
Gemini 호출 없이 캐릭터 JSON + 화풍 JSON + 씬 힌트를 파이썬으로 조합하여 fal.ai 등 이미지 생성 API에 바로 투입 가능한 영문 프롬프트를 만든다.

---

## 2. 아키텍처 결정 사항

### 2-1. Gemini-free 프롬프트 조합 원칙

- `compose-prompt` 엔드포인트는 **Gemini 호출 0회**
- 씬 설명은 DB에 저장된 `image_hint`(한국어) 또는 `image_prompt`(Gemini가 STEP2에서 이미 생성) 재사용
- 캐릭터 묘사, 화풍은 로컬 JSON 파일에서 조합
- 응답 시간 < 50ms, API 비용 없음

### 2-2. 프롬프트 조합 순서 (우선순위)

```
1. 씬 설명   : image_hint (한국어 원본) 또는 image_prompt (Gemini 번역본)
2. 캐릭터    : data/characters/{id}_{art_style}.json
               → fal_identity_prompt (외형)
               → body.body_prompt (체형)
               → wardrobe.default.wardrobe_prompt (의상)
               → style_prompt (캐릭터별 화풍)
3. 글로벌 화풍: data/art_styles.json → base_style_prompt (캐릭터 있을 때)
                                      → bg_prompt_suffix (캐릭터 없을 때)
4. 기술 suffix: cinematic composition, 16:9 aspect ratio, no text overlay, no watermark
```

### 2-3. 캐릭터 인덱스

- `data/characters/_index.json` — 이름 → ID 매핑 (27명 등록)
- 씬의 `scene_meta.characters` 목록에서 이름 조회 → JSON 로드
- 인덱스에 없는 인물(송현아, 아들(회상), 김부장 등)은 묘사 생략

---

## 3. 구현 파일

| 파일 | 역할 |
|------|------|
| `apps/api/services/prompt_composer.py` | Gemini-free 프롬프트 조합 서비스 |
| `apps/api/services/translate_hint.py` | 한글 image_hint → 영문 자동번역 헬퍼 |
| `apps/api/services/grid_crop_service.py` | 2×2 그리드 크롭 + 1920×1080 리사이즈 + R2/로컬 저장 |
| `apps/api/routers/chapters.py` | compose-prompt / compose-grid-prompt / generate-grid-image 엔드포인트 |
| `apps/api/data/characters/_index.json` | 이름→ID 매핑 인덱스 |
| `apps/api/data/characters/{id}_{style}.json` | 캐릭터별 화풍별 외형 데이터 |
| `apps/api/data/art_styles.json` | 화풍별 스타일 프롬프트 |

---

## 4. API 엔드포인트

### 4-1. 단일 컷 프롬프트 조합

```
GET /api/v1/series/{series_id}/scenes/{scene_code}/compose-prompt
```

**응답:**
```json
{
  "prompt": "...[씬 설명(영문 번역)], ...[캐릭터 외형/체형/의상], ...[화풍]...",
  "negative_prompt": "photorealistic, 3d render, ugly, deformed...",
  "bg_prompt": "...[배경 전용 프롬프트(영문)]...",
  "char_prompt": "...[캐릭터 전용 프롬프트]...",
  "art_style": "masako",
  "_debug_char_names": ["최민성", "양서연"]
}
```

### 4-2. 4컷 그리드 프롬프트 조합

```
POST /api/v1/series/{series_id}/compose-grid-prompt
Body: { "scene_codes": ["ch01s01nc01", "ch01s01nc02", "ch01s02nc01", "ch01s02nc02"] }
```

**응답:**
```json
{
  "grid_prompt": "...[화풍], single continuous 16:9 image, four scenes arranged 2x2...",
  "cut_count": 4,
  "scene_codes": ["ch01s01nc01", ...],
  "art_style": "masako",
  "char_urls": ["https://r2.../ch01s01nc01_char.png", ...]
}
```

### 4-3. 4컷 그리드 이미지 생성

```
POST /api/v1/series/{series_id}/generate-grid-image
Body: { "scene_codes": ["ch01s01nc01", "ch01s01nc02", "ch01s02nc01", "ch01s02nc02"] }
```

**파이프라인:**
1. `compose-grid-prompt` → 그리드 텍스트 프롬프트 + char_urls 수집
2. char_urls → `httpx` 다운로드 → Gemini 멀티모달 레퍼런스 이미지로 전달
3. `gemini-3-pro-image-preview` 호출 → 16:9 그리드 PNG 생성
4. `grid_crop_service.crop_grid()` → 4등분 크롭 → **1920×1080 LANCZOS 리사이즈**
5. R2 업로드: `v3/{series_id}/keyframes/{scene_code}.png`
6. 로컬 저장: `output/{series_code}/ch{N}/{scene_code}.png` (kenburns 파이프라인 입력용)
7. `v3_scenes.keyframe_url` + `bg_url` DB 업데이트

**응답:**
```json
{
  "status": "ok",
  "cut_count": 4,
  "art_style": "masako",
  "results": [
    { "scene_code": "ch01s01nc01", "url": "https://r2.../...", "width": 1920, "height": 1080 },
    ...
  ]
}
```

---

## 5. 화풍 — masako 스타일

```
masako style illustration, bold clean manga ink lines, strong contrast screen tone,
earthy muted grey-brown palette, cinematic Korean drama composition,
physical solidity expressing emotional silence, heavy weight in stillness
```

- **negative**: photorealistic, 3d render, ugly, deformed, extra limbs, western comic, bright saturated colors, childish, chibi, pretty, slim, youthful

---

## 6. 알려진 문제점 (2026-04-12 기준)

### 6-1. image_prompt 내 tech 토큰 오염

Gemini가 STEP2에서 `image_prompt`를 생성할 때 자동으로 `cinematic, 16:9, no text, **photorealistic**`을 뒤에 붙인다.  
→ 마사코(만화 일러스트) 화풍과 `photorealistic`이 **충돌**, 동일 tech 토큰이 **2회 중복** 삽입된다.

**해결 방향**: `image_hint`(순수 씬 의도만 담긴 원본)를 우선 사용하도록 전환.

### 6-2. style_prompt 중복

`{id}_masako.json`의 `style_prompt`와 `art_styles.json`의 `base_style_prompt`가 유사 내용으로 중복 삽입된다.  
→ masako 화풍 설명이 2회 반복됨.

**해결 방향**: 캐릭터 JSON의 `style_prompt`를 조합에서 제외하거나 `base_style_prompt`와 병합.

### 6-3. 등장인물 미등록

시리즈 고유 인물(아들(회상), 김부장 등)은 `_index.json`에 없어 캐릭터 묘사 생략됨.

---

## 7. 서버 기동

```
run_servers.bat
  ├─ 포트 정리: 8001 (Backend), 3100 (Frontend)
  ├─ Backend:  apps/api/.venv/Scripts/python.exe -X utf8 main.py  (Port 8001)
  └─ Frontend: npm run dev  (Port 3100)
```

**키프레임 테스트 페이지:**  
`http://localhost:3100/series/keyframe?series_id={series_id}`

---

## 8. 프론트엔드 — 키프레임 페이지

`apps/web/src/app/series/keyframe/page.tsx`

- 씬 선택 시 `compose-prompt` 자동 호출 → 오른쪽 하단 textarea에 프롬프트 표시
- **복사 버튼**: `navigator.clipboard.writeText` + fallback(`execCommand`) — 복사 후 "복사됨 ✓" 1.5초 표시
- **textarea rows**: 10 (넉넉한 세로 크기)
- 프롬프트 직접 편집 후 "이미지 생성" 버튼으로 단일 컷 재생성 가능

---

## 9. 한글 자동번역 (translate_if_korean) — 2026-04-18 구현 완료

### 동작 원리

`apps/api/services/translate_hint.py` — 한글이 포함된 텍스트를 fal.ai/Gemini 이미지 생성용 영문 프롬프트로 번역한다.

```python
async def translate_if_korean(text: str) -> str:
    # 한글 없으면 원문 반환 (0비용)
    # 캐시 히트 시 즉시 반환
    # call_free_llm (Cerebras→NVIDIA→OpenRouter→Gemini Free 체인) 호출
    # 실패 시 원문 폴백 (하위 호환)
```

### 번역 주입 순서 (chapters.py `compose-prompt`)

```
1. scene["image_hint_en"] = await translate_if_korean(scene["image_hint"])
2. bg_context_en = await translate_if_korean(scene_meta 4개 필드 합산)
3. scene["bg_context_en"] = bg_context_en
4. build_cut_image_prompt(scene, ...)   ← 번역본 우선 사용
```

> ⚠️ **순서 중요**: `bg_context_en` 주입이 반드시 `build_cut_image_prompt` 호출 **이전**에 완료되어야 한다.

### 번역 적용 범위

| 필드 | 번역 여부 | 비고 |
|------|----------|------|
| `image_hint` | ✅ → `image_hint_en` | 컷 시각 묘사 |
| `scene_meta.scene_hint` | ✅ → `bg_context_en` | 배경 분위기 |
| `scene_meta.location` | ✅ (bg_context에 포함) | 장소 |
| `scene_meta.time_of_day` | ✅ (bg_context에 포함) | 시간대 |
| `scene_meta.atmosphere` | ✅ (bg_context에 포함) | 분위기 |
| `image_hint` (HINT 박스 표시) | ❌ 원문 유지 | 사용자 확인용 |

---

## 10. 4컷 그리드 설계 원칙 — 2026-04-18 확정

### 경계면 없는 그리드 (Borderless Grid)

Gemini에 "2x2 storyboard panel layout" 전달 시 패널 경계선이 생성된다.
→ **"single continuous 16:9 image, four scenes arranged 2x2, panels touch directly at exact center"** 로 교체 확정.

```python
grid_prompt = (
    f"{base_style},\n"
    "single continuous 16:9 image, four scenes arranged 2x2, "
    "panels touch directly at exact center — no borders, no lines, no frames, "
    "no color separation, no dark edges between panels,\n"
    + ",\n".join(panel_parts) + ",\n"
    "consistent lighting and color palette across all four panels, "
    "no text no watermark, no panel border, no frame, no dividing line, "
    "no grid line, no separator, no dark edge, no vignette at boundary"
)
```

### char_url 레퍼런스 이미지 멀티모달 전달

Gemini에 텍스트 프롬프트만 전달하면 캐릭터 외형 일관성이 보장되지 않는다.
→ `v3_scenes.char_url`(캐릭터 누끼 PNG)을 Gemini 멀티모달 Part로 먼저 전달한다.

```python
# types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg") 를 레퍼런스 이미지로 먼저 전달
contents = [Part.from_bytes(...), Part.from_bytes(...), grid_prompt_text]
```

- 4컷의 고유 char_url 중복 제거 후 순서대로 전달
- char_url 없는 씬은 텍스트 프롬프트만 전달 (폴백)

### 크롭 + 1920×1080 리사이즈

```python
# grid_crop_service.crop_grid()
cell = img.crop(box)                               # 원본 크기 크롭
cell_hd = cell.resize((1920, 1080), Image.LANCZOS) # 1920×1080 업스케일
cell_hd.save(buf, format="PNG")                    # R2 업로드용
cell_hd.save(out_dir / f"{norm_code}.png")         # 로컬 저장 (kenburns 입력)
```

### 로컬 저장 경로

```
C:\LinkDropV3\output\{series_code}\ch{N}\{scene_code}.png
```

- kenburns 파이프라인이 `OUTPUT_ROOT/{series_code}/ch{N}/` 에서 PNG를 직접 읽음
- series_code는 `v3_series.series_code` DB 필드에서 조회
- series_code 없으면 로컬 저장 생략 (R2만)

---

## 11. 다음 단계 (미구현)

- [ ] fal.ai 이미지 생성 API 연동 (단일 컷 고해상도 생성)
- [ ] 미등록 캐릭터 자동 등록 흐름
- [ ] 캐릭터 `style_prompt` 중복 제거 (art_styles.json 병합)

