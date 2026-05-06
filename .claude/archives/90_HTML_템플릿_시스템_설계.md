# 90 — HTML 문서 생성 시스템 설계

> 최종 업데이트: 2026-04-23
> 담당 경로: `C:\LinkDropV3\apps\api\` (백엔드) + `C:\LinkDropV3\apps\web\src\app\html\` (프런트엔드)

---

## 1. 시스템 개요

HTML 문서 생성기는 세 가지 원칙을 기반으로 설계됐다.

1. **서버가 구조를 소유한다** — HTML 골격(skeleton) + CSS는 서버 파일. Gemini는 콘텐츠 JSON만 생성.
2. **Gemini는 판단하지 않는다** — DOM 구조·CSS 클래스명·레이아웃은 사전 고정. Gemini는 텍스트 값만 채운다.
3. **type / variant 계층** — 같은 문서 유형(type)이 여러 디자인(variant)을 가질 수 있다.

---

## 2. 디렉토리 구조

```
C:\LinkDropV3\apps\api\data\html-templates\
│
├── {type}/               ← 문서 유형 (one-page, product, resume …)
│   └── {variant}/        ← 디자인 variant (minimalist, classic, dark …)
│       ├── spec.json     ← 명세 (mode, palette, content_schema …)
│       ├── skeleton.html ← Jinja2 HTML 템플릿
│       └── styles.css    ← 고정 CSS (수정 금지 = 디자인 규칙)
│
├── _shared/
│   ├── base.css          ← CSS 변수·리셋·공통 유틸 클래스
│   ├── fonts.css         ← Pretendard Variable + JetBrains Mono CDN
│   └── print.css         ← @page A4, page-break-inside 규칙
│
├── img/                  ← 프리뷰 이미지 저장소 (향후 R2 대체)
│   └── {type}-{variant}.png   ← 파일명 규칙 (예: one-page-minimalist.png)
│
└── {id}.json             ← 레거시 ai_freeform 명세 (blank·report·proposal 등)
```

### 2-1. 현재 등록된 skeleton 템플릿

| type | variant | 디자인 특성 |
|------|---------|------------|
| `one-page` | `minimalist` | 직각·1px 선·배경 없음·타이포그래피 계층 |
| `product` | `minimalist` | flat 버튼·통계 텍스트 전용·1px 컬럼 구분선 |
| `resume` | `classic` | 2컬럼 (사이드바 260px 다크 + 본문 흰색) |
| `portfolio` | `dark` | 다크 배경·핑크 액센트·갤러리 카드 그리드 |
| `guide` | `standard` | 스티키 사이드바 TOC·STEP/CALLOUT/TIP 블록 |

### 2-2. ai_freeform 레거시 템플릿 (flat json)

`blank`, `report`, `proposal`, `newsletter`, `landing`, `infographic`  
→ spec.json 없음, Gemini가 HTML 전체 자유 생성 (8192 토큰 소비)

---

## 3. 렌더링 모드

### 3-1. skeleton 모드 (권장)

```
topic 입력
  └→ _build_content_prompt() → Gemini (JSON only, ~1500~3000 토큰)
       └→ content_json (dict)
            └→ render_skeleton(template_id, spec, content_json)
                 ├─ skeleton.html (Jinja2) + _DotDict(content_json)
                 ├─ styles.css (고정)
                 ├─ _shared/base.css + fonts.css + print.css
                 └─ palette → :root { --c-xxx } CSS vars
                      └→ 완성 HTML (단일 파일, self-contained)
```

**장점**: CSS 일관성 보장 / 토큰 절약 / 구조 검증 가능  
**조건**: `spec.json`에 `"mode": "skeleton"` + `content_schema` 필수

### 3-2. ai_freeform 모드 (레거시)

```
topic + spec.json (구 포맷)
  └→ _build_system_prompt() + _build_user_prompt()
       └→ Gemini (HTML 직접 생성, 8192 토큰)
            └→ html (Gemini가 구조·CSS·내용 모두 결정)
```

**단점**: CSS 클래스명 매 호출마다 다름 / 구조 검증 불가 / 토큰 낭비

---

## 4. spec.json 구조

```json
{
  "id": "one-page",
  "mode": "skeleton",
  "label": "원페이지",
  "description": "이름·소개·링크를 담은 미니멀 원페이지",
  "skeleton_file": "skeleton.html",
  "styles_file": "styles.css",

  "palette": {
    "background": "#ffffff",
    "text_primary": "#0f172a",
    "text_secondary": "#64748b",
    "divider": "#e2e8f0",
    "accent": "#6366f1"
  },

  "content_schema": {
    "type": "object",
    "required": ["name", "role", "links"],
    "properties": {
      "name":          { "type": "string", "description": "이름 또는 닉네임" },
      "role":          { "type": "string", "description": "직함·역할 (짧게)" },
      "avatar_emoji":  { "type": "string", "description": "프로필 이모지 (1자)" },
      "tagline":       { "type": "string", "description": "한 줄 태그라인" },
      "about":         { "type": "string", "description": "3~4문장 소개" },
      "links": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "icon":  { "type": "string" },
            "label": { "type": "string" },
            "desc":  { "type": "string" },
            "url":   { "type": "string" }
          }
        }
      },
      "footer": { "type": "string" }
    }
  }
}
```

**palette 키 규칙**: `snake_case` → CSS 변수 `--c-kebab-case`  
예: `"text_primary"` → `--c-text-primary`

---

## 5. skeleton.html Jinja2 규칙

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <style>{{ shared_base_css }}</style>
  <style>{{ shared_fonts_css }}</style>
  {{ palette_vars }}
  <style>{{ template_css }}</style>
  <style>{{ shared_print_css }}</style>
</head>
<body>
  <div class="op-wrap">
    <header class="op-header">
      <span class="op-avatar">{{ content.avatar_emoji }}</span>
      <h1 class="op-name">{{ content.name }}</h1>
      <p class="op-role">{{ content.role }}</p>
    </header>

    {% for link in content.links %}
    <a class="op-link" href="{{ link.url }}">
      <span class="op-link__icon">{{ link.icon }}</span>
      <span class="op-link__body">
        <span class="op-link__label">{{ link.label }}</span>
        <span class="op-link__desc">{{ link.desc }}</span>
      </span>
      <span class="op-link__arrow">→</span>
    </a>
    {% endfor %}
  </div>
</body>
</html>
```

**주입 변수 목록**:
- `content` — Gemini 생성 JSON (_DotDict으로 래핑, dot notation 접근)
- `shared_base_css` — _shared/base.css 전체 텍스트
- `shared_fonts_css` — _shared/fonts.css 전체 텍스트
- `shared_print_css` — _shared/print.css 전체 텍스트
- `template_css` — {variant}/styles.css 전체 텍스트
- `palette_vars` — `<style>:root { --c-xxx: value; }</style>` 문자열

---

## 6. _DotDict 클래스 (html_renderer.py)

Jinja2 템플릿에서 `{{ content.name }}`처럼 dot notation으로 dict에 접근하기 위한 래퍼.

**핵심 구현**:
```python
class _DotDict(dict):
    def __getattribute__(self, name):
        if not name.startswith('_'):
            try:
                val = dict.__getitem__(self, name)
                if isinstance(val, dict):  return _DotDict(val)
                if isinstance(val, list):
                    return [_DotDict(i) if isinstance(i, dict) else i for i in val]
                return val
            except KeyError:
                pass
        return dict.__getattribute__(self, name)

    def __getattr__(self, name):
        return ""   # 키 없으면 빈 문자열 반환 (템플릿 오류 방지)

    def __bool__(self):
        return dict.__len__(self) > 0
```

**⚠️ 주의**: `__getattribute__` 오버라이드는 dict 내장 메서드(`.items`, `.keys`, `.values`)와의  
충돌 방지를 위해 KeyError 발생 시 `dict.__getattribute__`로 폴백한다.  
`__getattr__`만 오버라이드하면 이미 존재하는 dict 메서드는 캡처되지 않아 버그 발생.

---

## 7. API 라우터 구조

파일: `C:\LinkDropV3\apps\api\routers\html_templates.py`  
프리픽스: `/api/v1/html-templates`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/` | 레거시 flat 템플릿 목록 |
| `GET` | `/{type}/{variant}` | skeleton 템플릿 명세 반환 |
| `GET` | `/{template_id}` | 레거시 flat 명세 반환 |
| `POST` | `/{type}/{variant}/generate` | skeleton/freeform 자동 분기 → HTML 반환 |
| `POST` | `/{template_id}/generate` | 레거시 flat ID 생성 (blank 등) |

**모드 분기 로직**:
```python
spec_v2 = _load_spec_v2(template_id)   # {type}/{variant}/spec.json 로드 시도

if spec_v2 and spec_v2.get("mode") == "skeleton":
    content_json = await call_gemini_json(prompt, schema=spec_v2["content_schema"])
    html = render_skeleton(template_id, spec_v2, content_json)
else:
    # ai_freeform: Gemini가 HTML 전체 생성
    html = await call_gemini(system_prompt, user_prompt)
```

---

## 8. 프리뷰 이미지 시스템

**현재**: `data/html-templates/img/` 폴더 → FastAPI StaticFiles  
**서빙 URL**: `http://localhost:8001/template-img/{type}-{variant}.png`  
**파일명 규칙**: `{type}-{variant}.png` (슬래시 → 하이픈)  
**향후**: Cloudflare R2 버킷으로 대체 → `IMG_BASE` 상수만 교체

**프런트 카드 이미지 fallback 구조**:
```tsx
backgroundImage: `url('${IMG_BASE}/${imgSlug}.png'), ${t.previewBg}`
```
이미지 파일 없으면 CSS gradient `previewBg`가 자동으로 표시됨 (브라우저 다중 background 레이어 동작).

---

## 9. 프런트엔드 연동

파일: `C:\LinkDropV3\apps\web\src\app\html\new\page.tsx`

**Template 인터페이스**:
```tsx
interface Template {
  id: string;        // '{type}/{variant}' 또는 flat id ('blank' 등)
  icon: string;
  label: string;
  variant?: string;  // 카드에 표시할 variant 이름
  desc: string;
  accent: string;    // 선택 시 테두리·태그 색상
  tags: string[];
  badge?: string;    // 'MINIMALIST' 등 특수 배지
  previewBg: string; // CSS gradient fallback (이미지 없을 때)
}
```

**생성 요청 URL**: `${API_BASE}/api/v1/html-templates/${templateId}/generate`  
→ `templateId = 'one-page/minimalist'` 이면 URL에 슬래시 그대로 포함  
→ FastAPI `/{template_type}/{variant}/generate` 라우트가 2-segment 분리 처리

**문서 저장**: `C:\LinkDropV3\apps\web\src\lib\htmlDocs.ts`  
→ doc.id = `crypto.randomUUID()` (슬래시 포함 template_id와 무관)  
→ template field에 `'one-page/minimalist'` 그대로 저장

---

## 10. 신규 variant 추가 절차

1. **폴더 생성**:  
   `data/html-templates/{type}/{variant}/`

2. **spec.json 작성**:  
   - `"mode": "skeleton"` 설정
   - `palette` 색상 정의
   - `content_schema` JSON Schema 작성 (기존 variant 참조)

3. **skeleton.html 작성**:  
   - Jinja2 문법으로 `{{ content.xxx }}` / `{% for %}` 사용
   - `shared_base_css`, `palette_vars`, `template_css` 등 변수 주입

4. **styles.css 작성**:  
   - CSS 변수 `var(--c-xxx)` 만 사용 (하드코딩 금지)
   - 디자인 variant 원칙 준수 (미니멀리스트: 배경 제거, 직각, 1px 선)

5. **프런트 page.tsx TEMPLATES 배열에 추가**:  
   ```tsx
   {
     id: '{type}/{variant}',
     label: '...',
     variant: '...',
     accent: '#...',
     previewBg: 'linear-gradient(...)',
   }
   ```

6. **프리뷰 이미지 추가** (선택):  
   `img/{type}-{variant}.png` 파일 저장 → 카드에 자동 반영

---

## 11. 디자인 variant 원칙

현재 등록된 디자인 철학:

### Minimalist (one-page, product)
- 배경 색상 없음 (배경은 항상 `var(--c-background)` = 흰색/검은색)
- `border-radius: 0` — 직각만 허용
- 그림자·그라데이션 없음
- 구분은 1px 선(`var(--c-divider)`)과 여백으로만
- 버튼: flat 직사각형, hover 시 opacity만 변경
- 타이포그래피: uppercase + letter-spacing으로 계층 표현

### Dark (portfolio)
- 배경 `#0f172a` (slate-900)
- 카드: `#1e293b` (slate-800)
- 액센트: 핑크 `#db2777`

### Classic (resume)
- 2컬럼 구조: 사이드바(다크) + 본문(흰색)
- 인쇄 최적화 (`@media print` 포함)

### Standard (guide)
- 스티키 사이드바 TOC
- STEP(원형 번호) + CALLOUT(점선 테두리) + TIP 블록

---

## 12. 관련 코드 파일

| 역할 | 파일 경로 |
|------|----------|
| HTML 렌더러 | `apps/api/services/html_renderer.py` |
| Gemini JSON 호출 | `apps/api/services/gemini_helper.py` → `call_gemini_json()` |
| API 라우터 | `apps/api/routers/html_templates.py` |
| 공통 CSS | `data/html-templates/_shared/` |
| 프런트 생성 페이지 | `apps/web/src/app/html/new/page.tsx` |
| 프런트 문서 저장 | `apps/web/src/lib/htmlDocs.ts` |
| 에디터 페이지 | `apps/web/src/app/html/editor/page.tsx` |
