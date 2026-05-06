'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Template {
  id: string;        // '{type}/{variant}' 또는 flat id
  num: number;       // 고정 고유번호 (불변)
  icon: string;
  label: string;
  variant?: string;  // 디자인 variant 표시명
  desc: string;
  accent: string;
  tags: string[];
  badge?: string;    // 디자인 분류 배지 (MINIMALIST, C·MARKER 등)
  warning?: string;  // 브라우저 호환성 경고 배지 (CHROME 등) — 빨간색
  previewBg: string; // 이미지 없을 때 CSS gradient fallback
  img?: string;      // /template-img/ 하위 파일명 (있으면 gradient 위에 오버레이)
}

const TEMPLATES: Template[] = [
  {
    id: 'resume/classic', num: 1,
    icon: '👤', label: '이력서', variant: 'Classic',
    desc: '경력·기술·학력을 구조화한 1페이지 이력서',
    accent: '#4f46e5', tags: ['취업', '포트폴리오'],
    previewBg: 'linear-gradient(160deg, #f0f0ff 0%, #e8e8f8 50%, #dcdcf0 100%)',
  },
  {
    id: 'proposal', num: 2,
    icon: '📋', label: '제안서',
    desc: '목적·일정·예산이 담긴 비즈니스 제안서',
    accent: '#7c3aed', tags: ['비즈니스', '영업'],
    previewBg: 'linear-gradient(160deg, #f5f0ff 0%, #ede8ff 100%)',
  },
  {
    id: 'report', num: 3,
    icon: '📊', label: '보고서',
    desc: '데이터·분석·결론이 포함된 공식 보고서',
    accent: '#0284c7', tags: ['기업', '분석'],
    previewBg: 'linear-gradient(160deg, #f0f7ff 0%, #e0efff 100%)',
  },
  {
    id: 'newsletter', num: 4,
    icon: '📧', label: '뉴스레터',
    desc: '구독자에게 보내는 이메일 HTML 뉴스레터',
    accent: '#059669', tags: ['마케팅', '이메일'],
    previewBg: 'linear-gradient(160deg, #f0fff8 0%, #e0fff0 100%)',
  },
  {
    id: 'landing', num: 5,
    icon: '🚀', label: '랜딩페이지',
    desc: '제품·서비스를 소개하는 원페이지 랜딩',
    accent: '#d97706', tags: ['마케팅', 'CTA'],
    previewBg: 'linear-gradient(160deg, #fffbf0 0%, #fff3d6 100%)',
  },
  {
    id: 'infographic', num: 6,
    icon: '📌', label: '인포그래픽',
    desc: '복잡한 정보를 시각적으로 정리한 인포그래픽',
    accent: '#dc2626', tags: ['디자인', '시각화'],
    previewBg: 'linear-gradient(160deg, #fff0f0 0%, #ffe0e0 100%)',
  },
  {
    id: 'portfolio/dark', num: 7,
    icon: '🎨', label: '포트폴리오', variant: 'Dark',
    desc: '작업물을 갤러리 형태로 보여주는 포트폴리오',
    accent: '#db2777', tags: ['디자인', '프리랜서'],
    img: 'dark-portfolio.png',
    previewBg: 'linear-gradient(160deg, #0f172a 0%, #1e1040 100%)',
  },
  {
    id: 'guide/attributes', num: 8,
    icon: '📐', label: '가이드', variant: 'Attributes',
    desc: 'loading · fetchpriority · autocomplete · inputmode — 4개 HTML 속성 레퍼런스. 코드 블록 + 인터랙티브 폼 + 우선순위 바 애니메이션',
    accent: '#82bfdb', tags: ['가이드', 'HTML', '레퍼런스'],
    badge: 'ATTR',
    img: 'attr-guide.png',
    previewBg: 'linear-gradient(160deg, #f5f4f0 0%, #e8e6e0 50%, #1c1b20 100%)',
  },
  {
    id: 'guide/standard', num: 9,
    icon: '📖', label: '가이드 문서', variant: 'Standard',
    desc: '챕터·사이드바 목차·STEP/FLOW/CALLOUT 블록이 포함된 튜토리얼',
    accent: '#b45309', tags: ['튜토리얼', '가이드', '교육'],
    previewBg: 'linear-gradient(160deg, #fffbeb 0%, #fef3c7 100%)',
  },
  {
    id: 'guide/contents-marker', num: 10,
    icon: '📑', label: '가이드 문서', variant: 'ContentsMarker',
    desc: '자동 목차 + 스크롤 위치 추적이 포함된 장문 가이드',
    accent: '#b45309', tags: ['가이드', '튜토리얼', '아티클'],
    badge: 'C·MARKER', warning: 'CHROME',
    img: 'contentsmaker-guide.png',
    previewBg: 'linear-gradient(160deg, #fffbeb 0%, #fde68a 100%)',
  },
  {
    id: 'landing/stacking-cards', num: 11,
    icon: '🚀', label: '랜딩페이지', variant: 'StackingCards',
    desc: '6장 카드가 순차 적층되는 풀스크린 랜딩페이지',
    accent: '#818cf8', tags: ['마케팅', 'CTA', '랜딩'],
    badge: 'S·CARDS',
    img: 'stack-landing.png',
    previewBg: 'linear-gradient(180deg, #0f172a 0%, #312e81 55%, #818cf8 100%)',
  },
  {
    id: 'landing/contents-marker', num: 12,
    icon: '🚀', label: '랜딩페이지', variant: 'ContentsMarker',
    desc: '기능·단계·후기·가격·FAQ 섹션을 자동 목차로 연결한 랜딩페이지',
    accent: '#4f46e5', tags: ['마케팅', 'CTA', '랜딩'],
    badge: 'C·MARKER', warning: 'CHROME',
    img: 'contentsmaker-landing.png',
    previewBg: 'linear-gradient(160deg, #eef2ff 0%, #e0e7ff 40%, #c7d2fe 100%)',
  },
  {
    id: 'landing/pottery', num: 13,
    icon: '🏺', label: '랜딩페이지', variant: 'Pottery',
    desc: '공방·크래프트·식음료 소상공인 전용 Neo-Brutalist 랜딩페이지',
    accent: '#e8613a', tags: ['공방', '크래프트', '소상공인'],
    badge: 'POTTERY',
    img: 'pottery-landing.png',
    previewBg: 'linear-gradient(160deg, #f5f0e8 0%, #e8c99a 50%, #e8613a 100%)',
  },
  {
    id: 'portfolio/pottery', num: 14,
    icon: '🎨', label: '포트폴리오', variant: 'Pottery',
    desc: '일러스트레이터·도예가·크래프터 전용 Neo-Brutalist 작품 포트폴리오',
    accent: '#7a5c44', tags: ['작가', '공예', '크리에이터'],
    badge: 'POTTERY',
    img: 'pottery-portfolio.png',
    previewBg: 'linear-gradient(160deg, #f5f0e8 0%, #d4a84b 50%, #7a5c44 100%)',
  },
  {
    id: 'neuromorphic/standard', num: 15,
    icon: '🧠', label: '개발자 프로필', variant: 'Standard',
    desc: '다크 시스템 인터페이스 미학의 개발자·AI 엔지니어 전용 프로필',
    accent: '#22d3ee', tags: ['개발자', 'AI', '기술'],
    badge: 'NEUROMORPHIC',
    img: 'NeuromorphicUI.png',
    previewBg: 'linear-gradient(160deg, #0f1117 0%, #1a1d27 50%, #21253a 100%)',
  },
  {
    id: 'portfolio/neumorphism', num: 16,
    icon: '🎨', label: '포트폴리오', variant: 'Neumorphism',
    desc: '소프트 그림자로 입체감을 주는 뉴모피즘 포트폴리오',
    accent: '#5c6bc0', tags: ['포트폴리오', '개인', '디자인'],
    badge: 'NEUMORPHISM',
    img: 'neumorphism-profile.png',
    previewBg: 'linear-gradient(160deg, #e4e9f0 0%, #d4d9e0 50%, #ccd1d8 100%)',
  },
  {
    id: 'product/contents-marker', num: 17,
    icon: '📦', label: '제품 소개', variant: 'ContentsMarker',
    desc: '수치 지표·기능·사양·활용 사례·가격을 자동 목차로 연결한 제품 소개',
    accent: '#0d9488', tags: ['제품', 'SaaS', '기술문서'],
    badge: 'C·MARKER', warning: 'CHROME',
    img: 'contentsmaker-product.png',
    previewBg: 'linear-gradient(160deg, #f0fdfa 0%, #ccfbf1 40%, #99f6e4 100%)',
  },
  {
    id: 'one-page/contents-marker', num: 18,
    icon: '🪪', label: '프로필', variant: 'ContentsMarker',
    desc: '소개·기술·경력·프로젝트·연락처를 자동 목차로 연결한 개인 프로필',
    accent: '#7c3aed', tags: ['개인', '포트폴리오', '이력서'],
    badge: 'C·MARKER', warning: 'CHROME',
    img: 'contentsmaker-portfolio.png',
    previewBg: 'linear-gradient(160deg, #f5f3ff 0%, #ede9fe 40%, #ddd6fe 100%)',
  },
  {
    id: 'one-page/minimalist', num: 19,
    icon: '🪟', label: '랜딩페이지', variant: 'Minimalist',
    desc: '이름·소개·링크를 담은 미니멀 랜딩페이지',
    accent: '#6366f1', tags: ['개인', '랜딩'], badge: 'MINIMALIST',
    img: 'Minimalist-onepage.png',
    previewBg: 'linear-gradient(160deg, #fafafa 0%, #f4f4f8 100%)',
  },
  {
    id: 'product/minimalist', num: 20,
    icon: '📦', label: '제품 소개', variant: 'Minimalist',
    desc: '헤드라인·특징·수치·가격표가 담긴 미니멀 제품 소개 페이지',
    accent: '#0ea5e9', tags: ['제품', 'SaaS'], badge: 'MINIMALIST',
    img: 'minimalist-product.png',
    previewBg: 'linear-gradient(160deg, #f0faff 0%, #e0f4ff 100%)',
  },
  {
    id: 'landing/web3', num: 21,
    icon: '🔗', label: '랜딩페이지', variant: 'Web3',
    desc: 'Web3·DeFi·크립토 앱 전용 다크 랜딩 — Acid Green + 네온 퍼플 팔레트',
    accent: '#caff00', tags: ['Web3', 'DeFi', '크립토'],
    badge: 'WEB3',
    img: 'web3-landing.png',
    previewBg: 'linear-gradient(160deg, #0a0a0f 0%, #1a1a28 50%, #7b4dff 100%)',
  },
  {
    id: 'letter/open', num: 22,
    icon: '📜', label: '공개서한', variant: 'Open Letter',
    desc: '공개서한·브랜드 선언문·창업자 편지 — 양피지 감성 공식 문서 레이아웃',
    accent: '#8b2c2c', tags: ['서한', '선언문', '공식문서'],
    badge: 'EXECUTIVE',
    img: 'executive-letter.png',
    previewBg: 'linear-gradient(160deg, #fcf7ec 0%, #f0e4c8 50%, #c49b48 100%)',
  },
  {
    id: 'letter/editorial', num: 23,
    icon: '📰', label: '에디토리얼', variant: 'Editorial',
    desc: '뉴스레터 칼럼·에세이·의견문 — 양피지 감성 Magazine 아티클 레이아웃',
    accent: '#c49b48', tags: ['뉴스레터', '에세이', '칼럼'],
    badge: 'EXECUTIVE',
    img: 'editorial-letter.png',
    previewBg: 'linear-gradient(160deg, #f5efe6 0%, #ede2cc 50%, #8b2c2c 100%)',
  },
  {
    id: 'landing/ethereal', num: 24,
    icon: '🌊', label: '랜딩페이지', variant: 'Ethereal',
    desc: '드래그·휠·키보드로 가로 스크롤하는 풀스크린 포트폴리오 랜딩. 배너·스포트라이트·갤러리 패널 구성',
    accent: '#726193', tags: ['랜딩', '포트폴리오', '수평스크롤'],
    badge: 'ETHEREAL',
    img: 'ethereal-landing.png',
    previewBg: 'linear-gradient(45deg, #726193 20%, #e37b7c 60%, #ffe4b4 100%)',
  },
  {
    id: 'landing/glass-kit', num: 25,
    icon: '🪟', label: '랜딩페이지', variant: 'Glass Dark',
    desc: '다크 배경 + 컬러 블롭 + backdrop-filter 글라스 카드. 15+ 컴포넌트 시연 + 12 CSS 애니메이션',
    accent: '#5ee7df', tags: ['랜딩', 'UI Kit', '글라스모피즘'],
    badge: 'GLASS',
    img: 'glass-dark.png',
    previewBg: 'linear-gradient(160deg, #07080f 0%, #1a0a2e 50%, #0d1b2a 100%)',
  },
  {
    id: 'portfolio/romantic-portfolio', num: 26,
    icon: '🎭', label: '포트폴리오', variant: 'Romantic',
    desc: '풀스크린 히어로 hover reveal + 감성 About + 갤러리 + 3D 글로브 + 무한 스크롤. 크리에이터·아티스트용',
    accent: '#c9a96e', tags: ['포트폴리오', '로맨틱', '크리에이터'],
    badge: 'ROMANTIC',
    img: 'romantic-portfolio.png',
    previewBg: 'linear-gradient(160deg, #0a0a0a 0%, #1a0a12 50%, #2a0a1a 100%)',
  },
  {
    id: 'landing/video-studio', num: 27,
    icon: '🎬', label: '랜딩페이지', variant: 'Video Studio',
    desc: 'CSS scroll-snap 풀스크린 섹션 스택. 비디오 배경(그라디언트 폴백) + GSAP + Lenis 스무스 스크롤',
    accent: '#ffffff', tags: ['랜딩', '영상', '스튜디오'],
    badge: 'VIDEO',
    img: 'video.png',
    previewBg: 'linear-gradient(160deg, #0a0a0a 0%, #0d1b2a 50%, #1a1a2e 100%)',
  },
  {
    id: 'landing/glassmorphism-light', num: 28,
    icon: '✨', label: '랜딩페이지', variant: 'Glass Light',
    desc: '라이트 글라스모피즘 랜딩 — 프로스티드 글라스 nav + hero + 피처 카드 + CTA. backdrop-filter 기반',
    accent: '#5ee7df', tags: ['랜딩', '라이트', '글라스모피즘'],
    badge: 'GLASS·L',
    img: 'glass-lite.png',
    previewBg: 'linear-gradient(160deg, #e8f0fa 0%, #d4e6f7 50%, #c5daf4 100%)',
  },
  {
    id: 'landing/romantic-landing', num: 29,
    icon: '💗', label: '랜딩페이지', variant: 'Romantic',
    desc: '다크 로맨틱 랜딩 — 풀스크린 하트 호버 reveal + About + 서비스 갤러리 + 무한 스크롤',
    accent: '#c9a96e', tags: ['랜딩', '로맨틱', '감성'],
    badge: 'ROMANTIC',
    img: 'romantic-landing.png',
    previewBg: 'linear-gradient(160deg, #1a0a0f 0%, #2d1420 50%, #1a0a0f 100%)',
  },
  {
    id: 'blank', num: 30,
    icon: '✏️', label: '빈 문서',
    desc: '템플릿 없이 주제 입력만으로 자유롭게 생성',
    accent: '#6b7280', tags: ['자유형식'],
    previewBg: 'linear-gradient(160deg, #f9fafb 0%, #f3f4f6 100%)',
  },
  {
    id: 'landing/sharp-minimal', num: 31,
    icon: '◼', label: '랜딩페이지', variant: 'Sharp Minimal',
    desc: 'Swiss Style 기반 예리한 미니멀 랜딩. 여백·타이포그래피·그리드만으로 완성되는 건축적 디자인. 이미지 불필요.',
    accent: '#111111', tags: ['랜딩', '미니멀', '타이포그래피'],
    badge: 'SHARP',
    previewBg: 'linear-gradient(160deg, #e9e9e9 0%, #cccccc 50%, #111111 100%)',
  },
];

const API_BASE = 'http://localhost:8001';
const IMG_BASE = `${API_BASE}/template-img`;

const CAT_TABS = [
  { key: '전체',    label: '전체' },
  { key: 'landing',     label: '랜딩' },
  { key: 'portfolio',   label: '포트폴리오' },
  { key: 'resume',      label: '이력서' },
  { key: 'guide',       label: '가이드' },
  { key: 'business',    label: '비즈니스' },
  { key: 'letter',      label: '레터' },
  { key: 'other',       label: '기타' },
];

function getCategory(id: string): string {
  const base = id.split('/')[0];
  if (['report', 'proposal', 'newsletter', 'infographic', 'product'].includes(base)) return 'business';
  if (['one-page', 'neuromorphic', 'blank'].includes(base)) return 'other';
  return base;
}

export default function HtmlNewPage() {
  const router = useRouter();
  const [topic, setTopic]       = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('전체');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const canStart    = topic.trim().length > 0 || selected !== null;
  const selectedTpl = TEMPLATES.find(t => t.id === selected);

  const [hearts, setHearts] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    fetch('http://localhost:8001/api/v1/template-hearts')
      .then(r => r.json())
      .then(setHearts)
      .catch(() => {});
  }, []);

  // 마운트 전: 서버 HTML과 완전히 일치시켜 hydration 방지
  if (!mounted) return null;

  const sortedTemplates = [...TEMPLATES].sort((a, b) => (hearts[b.id] ?? 0) - (hearts[a.id] ?? 0));
  const filteredTemplates = activeCategory === '전체'
    ? sortedTemplates
    : sortedTemplates.filter(t => getCategory(t.id) === activeCategory);

  async function handleAddHeart(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if ((hearts[id] ?? 0) >= 5) return;
    try {
      const res = await fetch(`http://localhost:8001/api/v1/template-hearts/${id}/add`, { method: 'POST' });
      const data = await res.json();
      setHearts(prev => ({ ...prev, [id]: data.count }));
    } catch {}
  }

  async function handleGenerate() {
    if (!canStart || loading) return;

    const templateId = selected ?? 'blank';
    const topicText  = topic.trim() || selectedTpl?.label || '(주제 없음)';

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/html-templates/${templateId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicText, use_ai: false }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `서버 오류 (${res.status})`);
      }

      const data = await res.json();
      const { createDoc } = await import('@/lib/htmlDocs');
      const tplName = selectedTpl ? `${selectedTpl.label}${selectedTpl.variant ? ` (${selectedTpl.variant})` : ''}` : templateId;
      const doc = await createDoc(templateId, tplName, topicText, data.html);
      router.push(`/html/editor?id=${doc.id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '생성 중 오류가 발생했습니다';
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f8f9fb',
      padding: '2.5rem 2rem',
      fontFamily: "'Pretendard', -apple-system, sans-serif",
      color: '#111',
    }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        {/* 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.45rem', color: '#111' }}>새 문서 만들기</h1>
          <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>
            주제를 입력하고 템플릿을 선택하면 AI가 구조화된 HTML을 생성합니다
          </p>
        </div>

        {/* 주제 입력 */}
        <div style={{ marginBottom: '2rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.4rem' }}>
            문서 주제
          </label>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canStart && !loading && handleGenerate()}
            placeholder="예: 2024년 4분기 마케팅 성과 보고서"
            disabled={loading}
            style={{
              width: '100%', padding: '0.875rem 1.1rem',
              borderRadius: '10px', border: '1.5px solid #e5e7eb',
              background: loading ? '#f9fafb' : '#fff', color: '#111',
              fontSize: '1rem', outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
            onFocus={e => { if (!loading) e.target.style.borderColor = '#4f46e5'; }}
            onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
          />
        </div>

        {/* 템플릿 선택 */}
        <div style={{ marginBottom: '2rem' }}>
          {/* 헤더 + 카운트 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>
              템플릿 선택 <span style={{ fontWeight: 400, color: '#9ca3af' }}>(선택사항)</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
              {filteredTemplates.length}개
            </span>
          </div>

          {/* 카테고리 필터 탭 */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {CAT_TABS.map(cat => {
              const isActive = activeCategory === cat.key;
              const count = cat.key === '전체'
                ? TEMPLATES.length
                : TEMPLATES.filter(t => getCategory(t.id) === cat.key).length;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  style={{
                    padding: '0.3rem 0.7rem',
                    borderRadius: '999px',
                    border: `1px solid ${isActive ? '#4f46e5' : '#e5e7eb'}`,
                    background: isActive ? '#4f46e5' : '#fff',
                    color: isActive ? '#fff' : '#6b7280',
                    fontSize: '0.75rem', fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}
                >
                  {cat.label}
                  <span style={{
                    fontSize: '0.62rem',
                    background: isActive ? 'rgba(255,255,255,0.25)' : '#f3f4f6',
                    color: isActive ? '#fff' : '#9ca3af',
                    padding: '0 0.3rem', borderRadius: '999px', lineHeight: '1.6',
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* 템플릿 카드 그리드 */}
          <div className="template-grid" style={{
            display: 'grid',
            gap: '0.75rem',
            opacity: loading ? 0.5 : 1,
            pointerEvents: loading ? 'none' : 'auto',
          }}>
            {filteredTemplates.map((t) => {
              const isSelected = selected === t.id;
              const isHovered = hoveredId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(isSelected ? null : t.id)}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    padding: 0,
                    borderRadius: '14px',
                    border: `2px solid ${isSelected ? t.accent : isHovered ? '#d1d5db' : '#e5e7eb'}`,
                    background: '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.18s cubic-bezier(0.25,0.46,0.45,0.94)',
                    overflow: 'hidden',
                    boxShadow: isSelected
                      ? `0 0 0 3px ${t.accent}28, 0 8px 24px ${t.accent}18`
                      : isHovered
                      ? '0 8px 24px rgba(0,0,0,0.1)'
                      : '0 1px 3px rgba(0,0,0,0.05)',
                    transform: isHovered && !isSelected ? 'translateY(-3px)' : 'none',
                  }}
                >
                  {/* 선택 시 상단 accent bar */}
                  {isSelected && (
                    <div style={{
                      height: '3px',
                      background: `linear-gradient(90deg, ${t.accent}, ${t.accent}99)`,
                    }} />
                  )}

                  {/* 프리뷰 영역 — 1:1 비율 */}
                  <div style={{
                    aspectRatio: '1 / 1',
                    backgroundImage: t.img ? `url('${IMG_BASE}/${t.img}'), ${t.previewBg}` : t.previewBg,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center top',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-end',
                    padding: '0.45rem',
                    gap: '0.3rem',
                  }}>
                    {/* 배지 컨테이너 */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      {t.warning && (
                        <span style={{
                          fontSize: '0.48rem', fontWeight: 700, letterSpacing: '0.12em',
                          color: '#fff', padding: '0.12rem 0.38rem',
                          borderRadius: '3px', background: '#dc2626',
                          lineHeight: 1.6, boxShadow: '0 1px 3px rgba(220,38,38,0.4)',
                        }}>{t.warning} ONLY</span>
                      )}
                      {(t.badge || t.variant) && (
                        <span style={{
                          fontSize: '0.48rem', fontWeight: 700, letterSpacing: '0.14em',
                          color: isSelected ? '#fff' : '#6b7280',
                          border: `1px solid ${isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.15)'}`,
                          padding: '0.1rem 0.38rem', borderRadius: '3px',
                          background: isSelected ? t.accent : 'rgba(255,255,255,0.8)',
                          backdropFilter: 'blur(4px)', lineHeight: 1.6,
                        }}>{t.badge ?? t.variant?.toUpperCase()}</span>
                      )}
                    </div>
                    {/* 순번 배지 */}
                    <span style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: '1.15rem', fontWeight: 800, color: '#fff',
                      background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                      padding: '0.25rem 0.62rem', borderRadius: '999px',
                      lineHeight: 1.4, letterSpacing: '0.02em',
                      pointerEvents: 'none', userSelect: 'none',
                      border: '1px solid rgba(255,255,255,0.22)',
                    }}>{t.num}</span>
                    {/* 선택 체크 */}
                    {isSelected && (
                      <span style={{
                        position: 'absolute', bottom: '0.45rem', left: '0.45rem',
                        width: '20px', height: '20px', borderRadius: '50%',
                        background: t.accent, border: '2px solid #fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', color: '#fff', fontWeight: 800,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                      }}>✓</span>
                    )}
                  </div>

                  {/* 콘텐츠 영역 */}
                  <div style={{ padding: '0.7rem 0.85rem 0.8rem' }}>
                    {/* 라벨 + 배리언트 */}
                    <div style={{ marginBottom: '0.3rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: isSelected ? t.accent : '#111', lineHeight: 1.2 }}>
                          {t.label}
                        </span>
                        {t.variant && (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 500,
                            color: isSelected ? t.accent : '#9ca3af',
                            background: isSelected ? `${t.accent}12` : '#f3f4f6',
                            padding: '0.05rem 0.4rem', borderRadius: '4px',
                            lineHeight: 1.6, flexShrink: 0,
                          }}>{t.variant}</span>
                        )}
                      </div>
                    </div>
                    {/* 설명 */}
                    <div style={{
                      fontSize: '0.68rem', color: '#6b7280', lineHeight: 1.5,
                      marginBottom: '0.45rem',
                      display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{t.desc}</div>
                    {/* 하트 + 추가 버튼 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '20px' }}>
                      <div style={{ display: 'flex', gap: '1px' }}>
                        {Array.from({ length: hearts[t.id] ?? 0 }).map((_, i) => (
                          <span key={i} style={{ fontSize: '0.78rem', color: '#facc15', lineHeight: 1 }}>♡</span>
                        ))}
                      </div>
                      {(hearts[t.id] ?? 0) < 5 && (
                        <button
                          onClick={e => handleAddHeart(e, t.id)}
                          style={{
                            width: '18px', height: '18px', borderRadius: '50%',
                            border: `1px solid ${isSelected ? t.accent + '60' : '#e5e7eb'}`,
                            background: isSelected ? `${t.accent}10` : '#f9fafb',
                            color: isSelected ? t.accent : '#9ca3af',
                            fontSize: '0.72rem', fontWeight: 700,
                            cursor: 'pointer', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', padding: 0, flexShrink: 0, lineHeight: 1,
                          }}
                        >+</button>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div style={{
            marginBottom: '1rem', padding: '0.875rem 1.1rem',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '10px', color: '#dc2626', fontSize: '0.875rem',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* 생성 버튼 */}
        <button
          onClick={handleGenerate}
          disabled={!canStart || loading}
          style={{
            width: '100%', padding: '1rem',
            background: loading ? '#6366f1' : canStart ? '#4f46e5' : '#e5e7eb',
            color: canStart ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: '12px',
            fontSize: '1rem', fontWeight: 700,
            cursor: (canStart && !loading) ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          }}
        >
          {loading ? (
            <>
              <span style={{
                width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff', borderRadius: '50%',
                display: 'inline-block', animation: 'spin 0.7s linear infinite',
              }} />
              템플릿을 초기화하고 있습니다...
            </>
          ) : selectedTpl
            ? `"${selectedTpl.label}" ${selectedTpl.variant ? `(${selectedTpl.variant}) ` : ''}템플릿으로 생성`
            : topic.trim()
            ? '주제만으로 생성'
            : '주제 또는 템플릿을 선택하세요'}
        </button>

        {loading && (
          <p style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.78rem', color: '#9ca3af' }}>
            템플릿 초안을 불러오는 중입니다...
          </p>
        )}
        {!loading && canStart && (
          <p style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.78rem', color: '#9ca3af' }}>
            템플릿 초안 생성 후 에디터로 이동합니다
          </p>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .template-grid { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 600px) {
          .template-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </main>
  );
}
