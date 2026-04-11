# 120 — 120UI: LinkDrop 표준 웹뷰 패턴

> 최종 업데이트: 2026-03-22

---

## 용어 정의

> **120UI** — LinkDrop 모든 웹뷰에 적용되는 표준 UI 패턴.
> 카드 그리드 + 우측 리사이즈 사이드 패널 구조.
> 이 문서(120)에서 확정되었으므로 **120UI** 로 통일하여 사용한다.

대화, 문서, 코드 주석 어디서든 이 패턴을 지칭할 때는 **120UI** 로 표기.

---

## ★ 120UI 구조: 카드 그리드 + 우측 사이드 패널

**기준 페이지**: `/prompt/library` (`apps/web/src/app/prompt/library/page.tsx`)

모든 "목록 → 세부보기" 구조의 페이지는 120UI를 따른다.

---

## 레이아웃 구조

```
┌─────────────────────────────────────────────────┐
│  헤더                                            │
│  - 브레드크럼 (LinkDrop › 섹션 › 페이지명)      │
│  - 타이틀 (그라데이션 텍스트)                   │
│  - 검색창 (우측 정렬)                            │
├─────────────────────────────────────────────────┤
│  카테고리 필터 (sticky top-[52px])               │
│  - 가로 스크롤 탭 (전체 + N개 카테고리)         │
│  - 활성: 그라데이션 배경 / 비활성: 반투명        │
│  - 우측: 현재 개수 표시                          │
├─────────────────────────────────────────────────┤
│  카드 그리드                                     │
│  - 배경: bg-slate-50 (밝은 흰색 영역)           │
│  - grid: 1→2→3→4 컬럼 (반응형)                 │
│  - 카드: bg-white + border + hover 효과          │
│    - 상단: 카테고리 배지 + 아이콘               │
│    - 중단: 제목 (line-clamp-2) + 내용 미리보기  │
│    - 하단: "Detail View ›" + 액션 버튼          │
└──────────────────────────────────────────────────┘

클릭 시 →
┌─────────────────────────────┐
│  오버레이 (bg-black/60)      │  ← 클릭 시 패널 닫기
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│  우측 사이드 패널 (w-[520px])│
│  bg-[#0D1528]               │
│                             │
│  헤더: 카테고리배지 + X버튼  │
│  본문: 세부 내용 (스크롤)    │
│  푸터: 주요 액션 버튼        │
└─────────────────────────────┘
```

---

## 디자인 토큰

| 항목 | 값 |
|------|-----|
| 페이지 배경 | `#050B1E` |
| 사이드 패널 배경 | `#0D1528` |
| 카드 그리드 배경 | `bg-slate-50` |
| 카드 배경 | `bg-white` |
| 카드 호버 그림자 | `shadow-indigo-100` |
| 필터 활성 | `from-cyan-500 to-purple-500` |
| 사이드 패널 너비 | 기본 `520px` / 사용자 드래그 조절 가능 / min `360px` / max `80vw` |
| 사이드 패널 z-index | `z-[10001]` |
| 오버레이 z-index | `z-[10000]` |

---

## 카테고리 배지 색상 패턴

```typescript
// 카테고리별 배지 스타일 (페이지마다 커스텀)
const CAT_BADGE: Record<string, string> = {
  카테고리1: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  카테고리2: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  카테고리3: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  카테고리4: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  카테고리5: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};
```

---

## ★ 120UI 사용 시기 (3가지 원칙)

### 1. 외부 사이트로 이동해야 할 때
iframe 차단으로 직접 임베딩 불가한 외부 서비스 연동 시.
사이드 패널이 가이드 + 컨텍스트 유지 역할.
예) NLM Studio, Midjourney, Quiver AI

### 2. 다수 항목을 탐색·선택해야 할 때
카드 그리드로 목록 표시 + 사이드 패널로 세부 확인.
예) 씬별 이미지 50개 표시, 시나리오 라이브러리, 배경이미지 선택, 효과음 선택

### 3. 영상제작 관련 콘텐츠 — 모바일 대응 원칙
영상제작 페이지(`/content/longform`, `/content/shorts` 등)는
**스마트폰 환경에서 120UI를 구현하지 않는다.**
모바일 접속 시 다음 안내 화면으로 대체:

```
┌─────────────────────────────┐
│                             │
│   💻                        │
│   PC 환경에서 이용해 주세요  │
│                             │
│   영상 제작은 화면이 넓은    │
│   PC에서 더 편리합니다.     │
│                             │
└─────────────────────────────┘
```

- 감지 기준: `window.innerWidth < 768px` (md 브레이크포인트)
- 적용 범위: 영상제작 관련 모든 페이지
- 정보성 페이지(`/prompt/library` 등)는 모바일 정상 지원

---

## 이 패턴을 적용할 페이지 목록

| 페이지 | URL | 카드 단위 | 사이드 패널 | 주요 액션 |
|--------|-----|----------|------------|----------|
| NLM 시나리오 라이브러리 | `/content/longform/scenarios` | 시나리오 (주제+카테고리+씬수) | 전체 씬 목록 + 나레이션 | 이 시나리오로 영상 만들기 |
| 배경이미지 선택 | `/content/backgrounds` | R2 배경 썸네일 + 화풍명 | 큰 미리보기 + 태그 | 선택 |
| 캐릭터 선택 | `/content/characterimage` | 캐릭터 이미지 + 이름 | 포즈 미리보기 + 성우 샘플 | 선택 |
| 효과음 라이브러리 | `/prompt/sfx` | SFX명 + 카테고리 + 길이 | 파형 시각화 + 미리듣기 | 영상에 추가 |
| 화풍 선택 | `/content/styles` | 화풍 예시 이미지 + 이름 | 색상팔레트 + 샘플 씬 미리보기 | 선택 |

---

## ★ 사이드 패널 리사이즈 (드래그 조절)

고정 너비 대신 사용자가 직접 패널 크기를 조절할 수 있어야 한다.

### 동작 방식

```
패널 좌측 끝에 드래그 핸들 배치
사용자가 핸들을 좌우로 드래그 → 패널 너비 실시간 변경

├── 드래그 핸들 (4px 선 + hover 시 강조)
│
└── 사이드 패널 본문
```

### 스펙

| 항목 | 값 |
|------|-----|
| 기본 너비 | `520px` |
| 최소 너비 | `360px` (콘텐츠 깨짐 방지) |
| 최대 너비 | `80vw` (카드 그리드 최소 20% 보장) |
| 너비 유지 | `localStorage` 저장 → 다음 방문 시 복원 |
| 핸들 UI | 좌측 `4px` 세로선, hover 시 `cyan-400` 강조 + 커서 `col-resize` |

### 구현 패턴

```tsx
const [panelWidth, setPanelWidth] = useState(() => {
  return Number(localStorage.getItem('ld_panel_width')) || 520;
});

const handleMouseDown = (e: React.MouseEvent) => {
  const startX = e.clientX;
  const startWidth = panelWidth;

  const onMove = (e: MouseEvent) => {
    const delta = startX - e.clientX;
    const next = Math.min(Math.max(startWidth + delta, 360), window.innerWidth * 0.8);
    setPanelWidth(next);
  };
  const onUp = () => {
    localStorage.setItem('ld_panel_width', String(panelWidth));
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// 패널 JSX
<aside style={{ width: panelWidth }} className="fixed top-0 right-0 h-full ...">
  {/* 드래그 핸들 */}
  <div
    onMouseDown={handleMouseDown}
    className="absolute left-0 top-0 w-1 h-full cursor-col-resize
               hover:bg-cyan-400/60 transition-colors"
  />
  {/* 패널 내용 */}
</aside>
```

---

## 구현 시 체크리스트

- [ ] `selectedItem` state — 선택된 항목 관리
- [ ] `isMounted` state — hydration 방지
- [ ] `searchTerm` + `activeCategory` — 필터링
- [ ] `useMemo` — 필터링 결과 메모이제이션
- [ ] 카드 `onClick` → `setSelectedItem`
- [ ] 사이드 패널: `fixed top-0 right-0 h-full`
- [ ] 오버레이: `fixed inset-0` + 클릭 시 닫기
- [ ] 토스트: `fixed bottom-8 left-1/2` — 액션 피드백

---

## ★ 외부 사이트 연동 패턴 (사이드 패널 활용)

### 배경
NLM Studio / Midjourney / Quiver AI 등 대부분의 외부 서비스는
`X-Frame-Options` 또는 `CSP` 정책으로 **iframe 직접 임베딩 불가**.

### 해결 전략: 사이드 패널 = "가이드 + 컨텍스트 유지" 역할

외부 사이트로 이동이 필요한 시점에 새 탭을 열되,
**사이드 패널이 열린 상태로 유지**하여 LinkDrop UI 일관성 보존.

```
사용자 액션 버튼 클릭
       ↓
사이드 패널 오픈 (LinkDrop UI 유지)
  ① 자동 복사된 컨텍스트 확인 (주제 / 프롬프트)
  ② 외부 사이트에서 해야 할 단계별 가이드
  ③ 완료 후 LinkDrop으로 돌아오는 방법 안내
  [외부 사이트 열기 →]   ← 새 탭
  [완료 · 다음 단계로]   ← 패널 닫고 LinkDrop 계속
```

### 적용 대상

| 외부 사이트 | 트리거 | 패널 제공 내용 |
|------------|--------|--------------|
| NLM Studio | 118 Step 4 "NLM Studio 열기" | 주제 자동 복사 + Audio/Video 생성 가이드 + 완료 후 다운로드 안내 |
| Midjourney | 117 배경이미지 생성 | 화풍별 프롬프트 자동 복사 + 이미지 저장 경로 안내 |
| Quiver AI | SVG 오버레이 생성 | SVG 생성 프롬프트 복사 + 다운로드 후 R2 업로드 안내 |

### 구현 포인트
- 외부 사이트 열기: `window.open(url, '_blank')` — 사이드 패널은 닫지 않음
- 클립보드 자동 복사: 패널 오픈 시 `navigator.clipboard.writeText()` 자동 실행
- "완료" 버튼: 다음 단계 상태로 전환 (job_id 폴링 시작 or 파일 업로드 대기)

---

## 참고

- 기준 구현체: `apps/web/src/app/prompt/library/page.tsx`
- 데이터: `apps/web/src/data/*.json` (코드 수정 없이 편집 가능)
