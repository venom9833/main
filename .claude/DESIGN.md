# LinkDrop — 공통 디자인 시스템

> **원칙**: 이 파일은 결정 사항과 토큰 값만 기록한다. CSS 구현은 `.claude/archives/링크드랍 공통디자인스타일.html` 참조.

---

## 1. 철학

- **Liquid Glass** — backdrop-filter blur 기반 반투명 유리 질감
- **Dark-first** — 다크 테마 기본, 라이트 테마는 오버라이드
- **Springy motion** — 딱딱한 ease-out 대신 살짝 튀는 탄성 easing 사용
- **Accessibility** — `prefers-reduced-motion` 완전 지원 / WCAG AA 대비 보장
- **모든 페이지는 각각 고유의 대표 콤보색상을 갖는다
1. #0D0D0D - #00F5FF
2. #2B2D6E - #CDB4FF
3. #1C1C1C - #FF6A00
4. #0A1F44 - #D6F0FF
5. #FD802E - #233D4C
6. #CCDA47 - #0A3625
7. #000F08 - #FB3640
8. #222222 - #89E900
9. #2A2A2A - #CFFF04
10.  #5A0F2E - #F1E9E4

---

## 2. 색상 토큰

### 다크 테마 (기본)

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--color-bg` | `#0b0e1a` | 페이지 배경 |
| `--color-surface` | `rgba(255,255,255,0.04)` | 카드/패널 표면 |
| `--color-text` | `#ffffff` | 본문 텍스트 |
| `--color-text-muted` | `rgba(255,255,255,0.55)` | 보조 텍스트 |
| `--color-text-subtle` | `rgba(255,255,255,0.35)` | 약한 텍스트 |
| `--accent-aqua` | `#5ee7df` | 주 강조색 (cyan) |
| `--accent-violet` | `#b490f5` | 보조 강조색 |
| `--accent-rose` | `#f7a8c4` | 경고/삭제 |
| `--accent-amber` | `#ffd27f` | 주의/HOOK 강조 |
| `--accent-lime` | `#a8f08a` | 성공/완료 |

### 라이트 테마 오버라이드 (`[data-theme="light"]`)

| 토큰 | 값 |
|------|-----|
| `--color-bg` | `#e8f0fa` |
| `--color-surface` | `rgba(255,255,255,0.55)` |
| `--color-text` | `#0f172a` |
| `--accent-aqua` | `#0891b2` |
| `--accent-violet` | `#6d28d9` |
| `--accent-rose` | `#be185d` |
| `--accent-amber` | `#b45309` |
| `--accent-lime` | `#15803d` |

---

## 3. 애니메이션 배경 (Blob Scene)

배경은 **베이스 단색 + 3개 Blob 레이어** 합성이다. 단색만 쓰면 안 됨.

| Blob | 그라디언트 | 크기 | 위치 | 용도 |
|------|-----------|------|------|------|
| blob-1 | `#5ee7df → #3b82f6` | 700px | 좌상단 (-200px, -150px) | cyan-blue 분위기 |
| blob-2 | `#b490f5 → #ec4899` | 600px | 우하단 (-200px, -100px) | violet-pink 분위기 |
| blob-3 | `#ffd27f → #f7a8c4` | 400px | 중앙 (40%, 50%) | amber-rose 포인트 |

**공통 속성**: `border-radius: 50%` / `filter: blur(80px)` / `animation: blob-drift` (17–25s)

| 테마 | Blob opacity | 결과 |
|------|-------------|------|
| 다크 | **0.55** | blob이 강하게 보임 — 청록·보라 빛이 뚜렷 |
| 라이트 | **0.30** | blob이 흐릿하게 깔림 — 부드러운 파랑-라벤더-핑크 그라디언트처럼 보임 |

---

## 4. Glass 토큰

| 토큰 | 값 | 설명 |
|------|-----|------|
| `--glass-white` / `-md` / `-lg` | 12% / 20% / 30% | 흰 유리 표면 농도 |
| `--glass-border` | 25% 흰색 | 기본 테두리 |
| `--glass-border-subtle` | 12% 흰색 | 약한 테두리 |
| `--blur-sm` / `-md` / `-lg` / `-xl` | 8 / 18 / 32 / 60px | backdrop-filter 강도 |
| `--shadow-glass` | 0 8px 32px + inner highlight | 카드 기본 그림자 |
| `--shadow-float` | 0 20px 60px | 모달/팝업 부유감 |
| `--shadow-glow` | 0 0 40px rgba(120,200,255,0.35) | 네온 글로우 |

---

## 5. 타이포그래피

| 역할 | 폰트 | 특이사항 |
|------|------|---------|
| Display / 제목 | `"Italiana"`, serif | 얇고 우아한 세리프 |
| Body / UI | `"DM Sans"`, sans-serif | 기본 weight 300 |
| Code / 숫자 | `"JetBrains Mono"` | weight 400–500 |

### 타입 스케일

`2xs(0.68) → xs(0.75) → sm(0.82) → md(0.9) → base(1) → lg(1.125) → xl(1.3) → 2xl(1.6) → 3xl(2) → 4xl(2.8)` rem

---

## 6. 스페이싱 & 반경

**스페이싱**: `2xs(4) → xs(8) → sm(12) → md(16) → lg(24) → xl(32) → 2xl(48) → 3xl(64) → 4xl(96)` px

**Radius**: `xs(6) → sm(10) → md(14) → lg(20) → xl(24) → 2xl(32) → full(9999)` px

---

## 7. 모션 토큰

### Easing

| 토큰 | 곡선 | 성격 |
|------|------|------|
| `--ease-glass` | `cubic-bezier(0.22, 0.68, 0, 1.2)` | 살짝 튀는 탄성 |
| `--ease-liquid` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 오버슈트 (액체감) |
| `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | Material 표준 |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | 빠른 감속 |

**Duration**: `fast(180ms)` / `mid(360ms)` / `slow(600ms)`

### 12 Liquid Glass 애니메이션

`liquid-morph` / `shimmer` / `float` / `refraction` / `ripple` / `edge-glow` / `breathing-blur` / `depth-shift` / `cascade-in` / `hue-shift` / `liquid-drain` / `tension`

---

## 8. Z-index 계층

`base(1)` → `raised(10)` → `overlay(100)` → `modal(500)` → `toast(800)` → `tooltip(900)`

---

## 9. 컴포넌트 목록 (19개)

Card / Button / Badge & Tag / Input / Checkbox & Radio / Switch /
Navigation / Tabs + Panels / Accordion / Modal·Dialog / Toast·Snackbar /
Tooltip / Dropdown·Select / Chip / Avatar Group / Breadcrumb /
Skeleton Loader / Stepper / Data Table

> 구현 클래스명·HTML 구조: `.claude/archives/링크드랍 공통디자인스타일.html`

---

## 10. 혼합 레이아웃 (Hybrid Layout)

> **정의**: 사이드바는 다크 테마, 메인 콘텐츠는 라이트 테마인 좌우 분할 레이아웃.
> 현재 `/utility/prompt` 페이지가 이 구조를 사용한다.

### 왜 blob scene을 쓸 수 없는가

blob scene은 `position: fixed; z-index: 0`으로 **전역 단일 opacity**를 가진다.
라이트 테마에서 blob opacity를 0.30으로 낮추려면 `[data-theme="light"]`를 전체 페이지에 적용해야 하는데,
사이드바(다크)가 같은 페이지에 공존하므로 **부분 적용 불가**.

### 혼합 레이아웃 라이트 영역 구현 규칙

| 항목 | 금지 | 허용 |
|------|------|------|
| 메인 배경 | `backdropFilter` + 반투명 rgba — 다크 blob이 회색 블러로 변질 | 정적 `radial-gradient` CSS |
| 베이스색 | `#e8f0fa` solid 단색만 사용 — blob 없이 평평하게 보임 | `#f0f4ff` + radial-gradient 합성 |
| 카드(PromptCard 등) | `backdropFilter` + 이중 투명 — 회색 이중 배경 발생 | `rgba(255,255,255,0.48~0.60)` border/shadow만 |

### 라이트 영역 기준 그래디언트 (lite.png 재현)

blob-1(cyan-blue) / blob-2(violet-pink) / blob-3(rose)의 위치·색을 CSS로 수동 재현한다.

```
radial-gradient(ellipse at 10% 65%,  rgba(180,144,245,0.45) → transparent)  ← violet
radial-gradient(ellipse at 92% 12%,  rgba(94,231,223,0.35)  → transparent)  ← cyan
radial-gradient(ellipse at 52% 98%,  rgba(247,168,196,0.22) → transparent)  ← rose
#f0f4ff  ← 베이스 (불투명)
```

### 전체 페이지 라이트 테마 전환 시 (미래)

페이지 전체가 라이트일 때는 blob scene 방식으로 돌아간다:
- `[data-theme="light"] .scene__blob { opacity: 0.30 }`
- 메인 배경: `rgba(232,240,250,0.60)` + `backdropFilter: blur(48px)`
- 정적 radial-gradient 제거

---

## 11. 접근성 규칙

- `prefers-reduced-motion`: 모든 transition/animation → 0.01ms로 강제 비활성
- `backdrop-filter` 미지원 시: `rgba(20,25,45,0.88)` solid 폴백 자동 적용
- 라이트 테마 accent: WCAG AA 충족을 위해 다크 테마보다 어둡게 조정
