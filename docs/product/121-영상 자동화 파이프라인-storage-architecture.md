# 121 — 영상 자동화 파이프라인

> 최종 업데이트: 2026-03-28
> 상태: 구현 완료 (테스트 진행 중)

---

## 1. 개요

대본 → 키프레임 → 성우 더빙으로 이어지는 콘텐츠 파이프라인에서
각 단계의 데이터를 어떤 저장소에 보관하는지 정의한다.
디자인 : Liquid Glass

---

## 2. 저장소 역할 분리 원칙

```
[대본 단계]          [키프레임 단계]         [성우 더빙 단계]
script page    →    keyframe page    →    voice-dubbing page
     │                    │                      │
 localStorage           localStorage          IndexedDB
 (텍스트 데이터)        (읽기 전용)           (이미지 blob)
                         +
                      IndexedDB
                    (이미지 blob,
                     파생 캐시)
```

| 저장소 | 담당 데이터 | 이유 |
|--------|------------|------|
| **localStorage** | 대본 텍스트, 씬 목록, 채널 분석, 아이디어 | 소용량, 동기 접근, 페이지 이동 후에도 유지 |
| **IndexedDB** | 이미지 blob, 번역 캐시, 화풍, 프롬프트 수정 | 대용량 binary 지원 |

---

## 3. localStorage 키 정의

| 키 | 내용 | 저장 시점 |
|----|------|----------|
| `ld_keyframe_data` | `{scenes, analysis, idea, channelName}` | script → keyframe 이동 버튼 클릭 시 |
| `ld_script_id` | 새 대본 식별 UUID (`crypto.randomUUID()`) | 위와 동시 |
| `ld_img_script_id` | 마지막으로 처리한 `ld_script_id` 값 | keyframe 최초 로드 시 기록 |
| `ld_img_session` | 현재 이미지 세션 UUID | 새 대본 감지 시 교체 |
| `ld_google_api_key` | Google API Key | 설정 저장 시 |

---

## 4. 새 대본 감지 로직

```
keyframe 페이지 로드
        ↓
localStorage['ld_script_id'] 읽기          ← script 페이지가 발급한 UUID
        ↓
localStorage['ld_img_script_id'] 읽기      ← 이전에 처리한 UUID
        ↓
두 값이 다른가?
  YES → 새 대본
        └─ ld_img_session = crypto.randomUUID()   (이미지 세션 교체)
        └─ ld_img_script_id = ld_script_id        (기록 갱신)
        └─ IDB 파생 캐시 초기화
             (translated_scenes, translated_style_id, nl_edits, scene_accents)
  NO  → 기존 대본 재진입
        └─ IDB에서 이미지, 번역, 수정 내용 복원
```

**핵심 효과**: 새 대본 이동 시 이미지 세션이 자동 교체되므로
이전 이미지가 새 대본 씬에 로드되는 문제가 구조적으로 차단된다.

---

## 5. IndexedDB 스토어 정의 (`ld_keyframe` DB)

| 스토어 | 키 형식 | 내용 |
|--------|---------|------|
| `state` | 문자열 키 | 번역 캐시, 화풍 ID, 프롬프트 수정, 성조 데이터 |
| `images` | `{sessionId}_{sceneIdx}` | 씬별 이미지 blob |

> `keyframe_data` (대본 텍스트)는 과거 IDB에 저장했으나 **localStorage로 이관 완료**.
> IDB에서 해당 키를 더 이상 읽거나 쓰지 않는다.

---

## 6. 씬 단위 이미지 슬롯 매핑

씬 삽입(+ 씬 추가) 시 서버 이미지 인덱스와 씬 인덱스가 어긋나는 문제를 방지하기 위해
`serverImageSlots` React 상태로 매핑을 관리한다.

```
초기 (씬3개):   serverIdx 0→sceneIdx 0,  1→1,  2→2

씬1 뒤에 삽입:  serverIdx 0→sceneIdx 0,  1→2,  2→3
                                          ↑ 새 씬(sceneIdx 1)은 매핑 없음
                                            → loadBrowserImages 미할당
```

---

## 7. 테스트 기간 임시 설정 (TODO: 완료 후 복원)

| 파일 | 현재 설정 | 복원값 |
|------|----------|--------|
| `script/page.tsx` | 씬 개수 3개 고정 | `6~10개로 구성해` |
| `keyframe/page.tsx` | `SCENE_LIMIT = 3` | `null` (전체) |
| `voice-dubbing/page.tsx` | `slice(0, 3)` | `data.scenes` 직접 사용 |

복원 시 `grep -r "TODO: 테스트 완료 후"` 로 전체 위치 확인 가능.

---

## 8. 성우 더빙 스토리지

voice-dubbing 페이지는 IndexedDB (`ld_voice_dubbing`) 사용.

| 키 | 내용 |
|----|------|
| `tts_{sceneIdx}` | 씬별 TTS MP3 blob |

**개발 기간 제한사항**:
- 무료 성우(edge-tts)만 TTS 생성 가능
- 슈퍼톤 유료 성우: 미리듣기만 허용, TTS 생성 버튼 비활성화 (`🔒 유료 전용`)
- TODO: 개발 완료 후 슈퍼톤 생성 활성화

---

## 10. MP4 프롬프트 생성기

> 별도 문서로 분리: [122-MP4-프롬프트-생성기.md](./122-MP4-프롬프트-생성기.md)

---



### 이미지 프롬프트 순서도

subject (씬 기본설명)
→ character
→ camera (구도)
→ [lens] ← 신규 삽입
→ depth
→ [lighting] ← 신규 삽입
→ art style
→ quality

### 영상 자동화의 근본적인 질문들

1. 좋은 대본 생산
2. 씬을 어떻게 나눌것인가?(현재 2~3문장 단위)
3. 나누어진 각 씬에서 어떻게  품질 좋은 이미지 생산용 프롬프트를 만들것인가?
4. 이미지 생산용 프롬프트를 어떻게 전달을 해야 이미지를 쉽게 확보가 가능한가?
5. 어떻게 하면 이미지의 일관성을 유지할것인가?
6. 어떻게 하면  초보사용자가 편하게 이미지를 만들수 있겠는가?
7. 어떤 UI 면 초보사용자가 간편하게 TTS파일을 생산할수 있겠는가?
8. 어떻게 하면 정교하게 TTS파일과 자막을 맞출수 있는가?
9. 현재의 자막 배치가 최상인가?
10. 어떻게 하면  각 씬당 클립(조각영상)을 잘 만들수 있는가?
11. 어떻게 하면 각 클립을  안정적으로 합칠수 있는가?
12. 최종 MP4파일만 제공하면 사용자는 만족하겠는가?





### 관련 파일

| 역할 | 경로 |
|------|------|
| 링크브라우저 실행 스크립트 | `apps/browser/run.py` |
| 링크브라우저 API 라우터 | `apps/api/routers/browser.py` |
| 이미지 브라우저 UI | `apps/web/src/app/content/image-browser/` |

---

## 12. gemini-2.5-flash-image Python SDK 검증 결과

> 기록일: 2026-04-02

### 테스트 결과

`C:\LinkDropV2\tmp\test_imagen.py` 로 직접 검증 완료.  
출력: 2,055,966 bytes PNG 정상 생성 확인.

### 핵심 호출 패턴

```python
from google import genai
from google.genai import types

client = genai.Client(api_key=api_key)

response = client.models.generate_content(
    model="gemini-2.5-flash-image",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE", "TEXT"],
    ),
)

for cand in response.candidates:
    for part in cand.content.parts:
        inline = getattr(part, 'inline_data', None)
        if inline:
            # inline.data 는 이미 raw bytes — base64.b64decode 절대 금지
            out_path.write_bytes(inline.data)
```

### JS SDK vs Python SDK 차이점

| 항목 | Python SDK | JS SDK (App.tsx) |
|------|-----------|-----------------|
| 필드명 | `inline_data` (snake_case) | `inlineData` (camelCase) |
| data 타입 | **raw bytes** | base64 string |
| 쓰기 | `write_bytes(inline.data)` | `base64.b64decode(part.inlineData.data)` |

### API 키 출처

- **운영진 키 아님** — 사용자 본인의 Google API Key 사용
- 저장 위치: GNB 오른쪽 끝 설정 모달 → `localStorage('ld_google_api_key')`
- 프론트엔드 읽기: `localStorage.getItem('ld_google_api_key') ?? ''`
- translate.py, characterimage, script 페이지 등 전체 동일 패턴으로 이미 사용 중
- 이미지 생성 호출량은 사용자 본인 할당량에서 차감됨

### 주의사항

- `response_modalities=["IMAGE", "TEXT"]` 없으면 텍스트만 반환됨
- 응답 구조: part[0]=텍스트, part[1]=이미지 (2개 part 반환)
- 95바이트 파일 버그 원인: raw bytes에 `base64.b64decode()` 잘못 적용
- 씬 1개씩 순차 요청 시 Rate Limit 문제 없음 (무료 티어 15 RPM 대비 여유)

---

## 9. 관련 파일

| 역할 | 경로 |
|------|------|
| 대본 생성 UI | `apps/web/src/app/content/script/page.tsx` |
| 키프레임 UI | `apps/web/src/app/content/keyframe/page.tsx` |
| 성우 더빙 UI | `apps/web/src/app/content/voice-dubbing/page.tsx` |
| 성우 목록 | `apps/web/src/data/voices.json` |
| 대본 생성 API | `apps/api/routers/nlm_video.py` |
