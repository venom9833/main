/* 스킬 한국어 번역 테이블
 * 새 스킬 설치 시 slug: { description, triggers } 추가
 * 번역이 없는 스킬은 SKILL.md 원문 영어 사용
 */
export type KoTranslation = {
  description: string;
  triggers: string[];
};

const translations: Record<string, KoTranslation> = {
  'adaptive-communication': {
    description:
      '사용자의 소통 방식(고맥락 관계형 vs 저맥락 거래형)을 자동 감지해 응답 스타일을 조정한다. 모호한 의도·헤징 표현이 감지되면 자동 활성화.',
    triggers: [
      '"~인 것 같은데", "혹시" 등 모호한 표현 감지 시 자동',
      '답변보다 탐색·대화가 필요해 보일 때',
      '사용자 의도가 명확하지 않을 때',
    ],
  },

  'bencium-aeo': {
    description:
      'ChatGPT·Claude·Gemini 등 AI 검색엔진에서 인용되도록 콘텐츠를 최적화한다. Answer Engine Optimization — AI 검색 가시성 향상.',
    triggers: [
      '블로그·문서·랜딩페이지 AI 검색 노출 필요 시',
      '"AI 검색에서 인용되게 해줘"',
      'FAQ·가이드 페이지 AEO 적용 시',
    ],
  },

  'bencium-code-conventions': {
    description:
      'React·Next.js·TypeScript·TailwindCSS v3·Supabase 프로젝트의 코딩 스타일과 스택 컨벤션을 적용한다. V3 스택과 완전 일치.',
    triggers: [
      '"어떻게 작성하는 게 맞아?" 규칙 확인 시',
      '새 프로젝트 구조 잡을 때',
      'TailwindCSS 클래스·Supabase 쿼리 작성 방식 점검 시',
    ],
  },

  'bencium-controlled-ux-designer': {
    description:
      'WCAG 2.1 AA 접근성·수학적 스케일·항상 먼저 묻는 프로토콜을 적용하는 엔터프라이즈·규제 산업용 UX 설계.',
    triggers: [
      '접근성이 필수인 서비스(의료·금융·공공) 설계 시',
      '기업용 관리자 대시보드 UI 개발 시',
      '"안전하고 예측 가능한" UX 필요 시',
    ],
  },

  'bencium-impact-designer': {
    description:
      '제네릭 AI 미학을 피한 프로덕션급 인터페이스 설계. Anthropic Frontend Designer Skill 기반. "AI가 만든 티" 없는 고품질 UI.',
    triggers: [
      '"AI가 만든 것 같은 디자인 말고 진짜 느낌으로"',
      '프로덕션 배포용 UI 완성도 높이기',
      '고품질 인터페이스 신규 개발 시',
    ],
  },

  'bencium-innovative-ux-designer': {
    description:
      '대담한 그래디언트·실험적 타이포그래피·독특한 방향성을 가진 랜딩페이지·캠페인용 창의적 UX 설계.',
    triggers: [
      '랜딩페이지를 임팩트 있게 만들 때',
      '"특별하게", "눈에 띄게" 요청 시',
      '브랜드 차별화가 필요한 UI 신규 설계 시',
    ],
  },

  'composition-patterns': {
    description:
      '확장 가능한 React 합성 패턴. Compound Component·Render Props·Custom Hooks 등 재사용 가능한 컴포넌트 구조 설계.',
    triggers: [
      '"이 컴포넌트 재사용 가능하게 만들어줘"',
      'props drilling 문제가 있을 때',
      '컴포넌트 구조 설계 논의 시',
    ],
  },

  'context7-cli': {
    description:
      'ctx7 CLI로 라이브러리 최신 문서를 조회하고, AI 코딩 스킬을 검색·설치·생성하며, Context7 MCP를 설정한다.',
    triggers: [
      '"ctx7", "context7" CLI 명령 필요 시',
      '특정 라이브러리 최신 문서가 필요할 때',
      '스킬 검색·설치(ctx7 skills install/suggest) 시',
    ],
  },

  'context7-mcp': {
    description:
      '라이브러리·프레임워크 API 참조가 필요할 때 Context7 MCP 도구(resolve-library-id → query-docs)로 최신 문서를 가져온다.',
    triggers: [
      'React·Next.js·Supabase 등 라이브러리 API 질문 시',
      '"이 함수 시그니처가 맞아?" 확인 시',
      '특정 라이브러리 설정·코드 예시 필요 시',
    ],
  },

  'deploy-to-vercel': {
    description:
      'Vercel 프로젝트 생성·환경변수 설정·도메인 연결·빌드 최적화를 안내한다. Next.js 프로젝트 첫 배포 포함.',
    triggers: [
      '"Vercel에 배포해줘"',
      '환경변수·도메인 연결 설정 필요 시',
      'Next.js 프로젝트 첫 배포 시',
    ],
  },

  'design-audit': {
    description:
      '기존 UI를 체계적으로 감사해 단계별 구현 가능한 디자인 개선 플랜을 생성한다. 기능은 건드리지 않고 시각적 품질만 높임.',
    triggers: [
      '"이 UI 개선해줘", "더 좋아 보이게 해줘"',
      '"디자인 리뷰해줘", "폴리시 해줘"',
      '기존 페이지 전체 시각적 점검 필요 시',
    ],
  },

  'find-docs': {
    description:
      '어떤 라이브러리·프레임워크·SDK·CLI 도구든 Context7로 최신 문서와 코드 예시를 조회한다. 훈련 데이터 대신 항상 최신 공식 문서 사용.',
    triggers: [
      '라이브러리 API 문서·코드 예시 필요 시 자동',
      '"이 함수 어떻게 써?" 라이브러리 질문 시',
      '"use context7" 키워드 감지 시',
    ],
  },

  'gemini-api-dev': {
    description:
      'Gemini API 개발 스킬. 현재 유효한 모델 목록·SDK 사용법(google-genai)·멀티모달·함수 호출·구조화 출력을 다룬다. gemini-2.0/1.5는 deprecated.',
    triggers: [
      'Gemini API / google-genai SDK 코드 작성 시 자동',
      '모델명 지정 필요 시 (현재 모델 강제 적용)',
      '멀티모달·함수 호출·structured output 구현 시',
    ],
  },

  'human-architect-mindset': {
    description:
      '도메인 모델링·시스템 씽킹·제약 네비게이션으로 다중 컴포넌트 아키텍처를 결정한다. 설계 논의·기술 선택 감지 시 자동 활성화.',
    triggers: [
      '다중 컴포넌트·서비스 설계 논의 시 자동',
      '"어떤 구조로 잡아야 해?" 초기 설계 질문 시',
      '레거시·예산·컴플라이언스 제약이 있는 아키텍처 결정 시',
    ],
  },

  'negentropy-lens': {
    description:
      '엔트로피(시스템 붕괴)↔네겐트로피(질서·성장) 관점으로 기술 결정을 평가하고 암묵적 지식 갭을 발굴하는 의사결정 프레임워크.',
    triggers: [
      '"이 결정이 장기적으로 괜찮아?" 확신 없을 때',
      '기술 부채 vs 기능 개발 우선순위 결정 시',
      '시스템의 지속 가능성 평가가 필요할 때',
    ],
  },

  'next-best-practices': {
    description:
      'Next.js App Router 파일 컨벤션·RSC 경계·Suspense·캐싱·이미지·폰트·메타데이터·라우트 핸들러 등 20개 영역의 best practices.',
    triggers: [
      'Next.js App Router 패턴 확인 필요 시',
      'hydration 오류·RSC/CC 경계 문제 발생 시',
      '이미지·폰트·메타데이터 최적화 작업 시',
    ],
  },

  'next-cache-components': {
    description:
      'Next.js PPR(Partial Prerendering)·서버 컴포넌트 캐싱·데이터 페칭 패턴·스트리밍 경계 분리 전략을 다룬다.',
    triggers: [
      'Next.js 캐싱 전략 결정 시',
      '서버 컴포넌트·클라이언트 컴포넌트 분리 설계 시',
      'PPR·스트리밍 경계 구조 설계 시',
    ],
  },

  'react-best-practices': {
    description:
      'React·Next.js 번들 크기·리렌더링 최소화·Waterfall 데이터 페칭 방지·메모이제이션 등 성능 최적화 가이드.',
    triggers: [
      '"왜 이렇게 느리지?", "성능 개선해줘"',
      '불필요한 리렌더링 문제 발생 시',
      'useEffect 의존성·메모이제이션 최적화 시',
    ],
  },

  'react-native-skills': {
    description:
      'React Native·Expo 앱 개발의 best practices. 컴포넌트 구조·내비게이션·리스트 최적화·플랫폼별 차이 대응.',
    triggers: [
      'React Native / Expo 앱 개발 시',
      '모바일 앱 내비게이션·리스트 최적화 시',
      'iOS·Android 플랫폼 차이 대응 시',
    ],
  },

  'react-view-transitions': {
    description:
      'View Transitions API 기반 자연스러운 페이지 전환·공유 요소 애니메이션 구현. SPA 네이티브 앱 느낌 전환.',
    triggers: [
      '"페이지 전환 부드럽게 해줘"',
      '"애니메이션 있는 라우팅 만들어줘"',
      'View Transitions API 적용 시',
    ],
  },

  'renaissance-architecture': {
    description:
      '"X의 클론"이 아닌 진짜 새로운 것을 만드는 퍼스트 프린시플 아키텍처 원칙. 파생작 방지·기존 방식에 대한 근본적 재검토.',
    triggers: [
      '새 기능·제품 기획 초기 구상 단계',
      '"이걸 처음부터 어떻게 만들어야 해?" 질문 시',
      '기존 방식을 의심하고 싶을 때',
    ],
  },

  'typography': {
    description:
      'HTML·CSS·JSX 생성 시 올바른 따옴표·대시·행간·계층 구조를 자동 적용한다. Matthew Butterick Practical Typography 기준. UI 코드 생성 시 자동 실행.',
    triggers: [
      'HTML/CSS/JSX 코드 생성 시 자동 적용',
      '"타이포그래피 고쳐줘", "폰트 계층 잡아줘"',
      '텍스트가 보이는 UI 컴포넌트 모두 해당',
    ],
  },

  'ui-ux-pro-max': {
    description:
      '67개 스타일·96개 팔레트·57개 폰트페어링·99개 UX 가이드라인·13개 기술 스택 데이터베이스. 디자인 시스템 자동 생성 및 UI 품질 검토.',
    triggers: [
      'UI 컴포넌트 신규 작성·디자인 시스템 정립 시',
      '색상·타이포그래피·레이아웃 결정 시',
      '페이지 전체 신규 설계 시',
    ],
  },

  'vanity-engineering-review': {
    description:
      '에고·이력서 중심의 과설계를 탐지한다. 불필요한 추상화·조기 최적화·기술 과시 패턴 자동 검출 및 경고.',
    triggers: [
      '"이게 진짜 필요해?", "너무 복잡한 거 아냐?"',
      '프레임워크·라이브러리 도입 타당성 검토 시',
      '코드 공유 시 과설계 패턴 감지되면 자동 경고',
    ],
  },

  'vercel-cli-with-tokens': {
    description:
      'Vercel CLI 토큰 기반 배포. GitHub Actions 등 CI/CD 파이프라인 자동화 배포 설정. 토큰 기반 인증으로 대화형 로그인 없이 배포.',
    triggers: [
      'CI/CD에서 Vercel 자동 배포 설정 시',
      'GitHub Actions Vercel 배포 스크립트 필요 시',
      '토큰 기반 인증 배포 자동화 시',
    ],
  },

  'web-design-guidelines': {
    description:
      'ARIA·포커스·키보드 내비게이션·시맨틱 HTML·가상화 등 웹 인터페이스 가이드라인 준수 여부를 코드 레벨에서 검토한다.',
    triggers: [
      '접근성 감사·ARIA 속성 점검 시',
      '"이 코드 웹 가이드라인 맞아?" 확인 시',
      '시맨틱 HTML 구조 점검 필요 시',
    ],
  },
};

export default translations;
