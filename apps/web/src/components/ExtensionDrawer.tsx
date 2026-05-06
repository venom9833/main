// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
// ExtensionDrawer.tsx — 키프레임 익스텐션 사이드 패널 (그리드 프롬프트 방식)
//
// 기존 방식(컷 1개 → 이미지 1장)에서 → 그리드 방식으로 전환.
//   - 2×2 모드: 4컷을 하나의 4-panel 그리드 프롬프트로 합쳐 이미지 1장 생성
//   - 3×3 모드: 9컷을 하나의 9-panel 그리드 프롬프트로 합쳐 이미지 1장 생성
//
// 사용자 번거로움: 70컷 기준 70번 복사 → 18번(2×2) or 8번(3×3)으로 대폭 감소

import { useEffect, useRef, useState } from 'react';

// API 서버 주소 (page.tsx와 동일)
const API = 'http://localhost:8001/api/v1';

// 화풍 상수 — page.tsx의 ART_STYLES_ACTIVE / ART_STYLES_COMING과 동일하게 유지
const ART_STYLES_ACTIVE = [
  { key: 'polystyle', label: '폴리 스타일' },
] as const;

const ART_STYLES_COMING = [
  { key: 'masako',   label: '마사코 스타일' },
  { key: 'noir_oil', label: '누아르 유화'   },
] as const;

// SceneCut — page.tsx의 타입과 동일 (export되지 않으므로 재정의)
type SceneCut = {
  scene_index: number;
  cut_index: number;
  is_hook: boolean;
  scene_code: string; // 예: "20260413_095022_ch01s02nc04"
  text: string;
  render_type: string;
  type: 'narration' | 'dialogue' | 'mixed';
  speaker: string | null;
};

// 그리드 모드 타입 — 2×2 (4컷) 또는 3×3 (9컷)
type GridSize = '2x2' | '3x3';

// ExtensionDrawer가 받는 Props
interface ExtensionDrawerProps {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  // chapters는 id, chapter(번호), role(역할 설명)만 필요
  chapters: Array<{ id: string; chapter: number; role: string }>;
}

// ───────────────────────────────────────────────
// 이미지 생성 사이트 목록
// ───────────────────────────────────────────────
const IMAGE_SITES = [
  { label: 'Gemini',    url: 'https://gemini.google.com/app' },
  { label: 'ChatGPT',  url: 'https://chatgpt.com' },
  { label: 'Ideogram', url: 'https://ideogram.ai' },
] as const;

// ───────────────────────────────────────────────
// 그리드 프롬프트 생성 함수
//
// cuts: 그룹 내 컷 목록 (최대 4개 또는 9개)
// artStyle: 화풍 키 ('polystyle' 등)
// purpose: 용도 ('webnovel')
// gridSize: 그리드 크기 ('2x2' | '3x3')
// ───────────────────────────────────────────────
function buildGridPrompt(
  cuts: SceneCut[],
  artStyle: string,
  purpose: string,
  gridSize: GridSize
): string {
  // 화풍별 앞부분 설명 (영어 키워드)
  const stylePrefix =
    artStyle === 'polystyle'
      ? 'flat illustration, bold outlines, vibrant colors, Korean webtoon style, high quality'
      : 'illustration';

  // 용도별 구도 설명
  const purposeSuffix =
    purpose === 'webnovel'
      ? 'cinematic 16:9 widescreen composition'
      : 'vertical composition';

  // 그리드 크기별 설정
  const panelCount = gridSize === '2x2' ? 4 : 9;
  const gridLabel = gridSize === '2x2' ? '2x2 four-panel grid layout' : '3x3 nine-panel grid layout';

  // 패널 위치 레이블 (사람이 읽기 쉽게 영문으로 표기)
  const panelPositions2x2 = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const panelPositions3x3 = [
    'row1-col1', 'row1-col2', 'row1-col3',
    'row2-col1', 'row2-col2', 'row2-col3',
    'row3-col1', 'row3-col2', 'row3-col3',
  ];
  const positions = gridSize === '2x2' ? panelPositions2x2 : panelPositions3x3;

  // 실제 포함할 컷 수 제한 (panelCount 초과 방지)
  const activeCuts = cuts.slice(0, panelCount);

  // 각 패널 설명 줄 생성
  // 대사 컷은 [립씽크 MP4 필요] 주석 추가
  const panelLines = activeCuts.map((cut, i) => {
    // 텍스트 앞 100자만 사용 (프롬프트 과다 방지)
    const desc = cut.text.slice(0, 100).trim();
    // scene_code에서 날짜·시간 제거, 핵심 코드만 추출 (예: "ch01s02nc04")
    const code = cut.scene_code.split('_').slice(2).join('_');
    // 대사 컷이면 배경 이미지 생성용임을 명시
    const dialogueNote = cut.type === 'dialogue' ? ' [BG only - lipsync MP4 needed]' : '';
    return `[Panel ${i + 1}, ${positions[i]}] (${code})${dialogueNote}: ${desc}`;
  }).join('\n');

  // 그룹 코드 범위 표시 (예: "nc01~nc04")
  const groupCode =
    activeCuts.length > 0
      ? `${activeCuts[0].scene_code.split('_').slice(2).join('_')}~${activeCuts[activeCuts.length - 1].scene_code.split('_').slice(2).join('_')}`
      : '';

  return `${stylePrefix}, ${gridLabel}, each panel clearly separated by thin lines, consistent art style and character designs across all panels, ${purposeSuffix}

${panelLines}

Do NOT mix elements between panels. Each panel tells its own moment.
[group: ${groupCode}]`;
}

// ───────────────────────────────────────────────
// 컷 그룹화 함수
// cuts: 전체 컷 목록 (HOOK 제외한 정규 컷)
// gridSize: 그리드 크기
// 반환: 배치 크기 단위로 나뉜 컷 배열들의 배열
// ───────────────────────────────────────────────
function groupCutsForGrid(cuts: SceneCut[], gridSize: GridSize): SceneCut[][] {
  const batchSize = gridSize === '2x2' ? 4 : 9;
  const groups: SceneCut[][] = [];
  for (let i = 0; i < cuts.length; i += batchSize) {
    groups.push(cuts.slice(i, i + batchSize));
  }
  return groups;
}

// ───────────────────────────────────────────────
// HOOK 단독 카드 컴포넌트
// HOOK 컷은 개수가 적으므로 그리드 없이 개별 카드로 표시
// (단, HOOK이 4개 이상이면 gridSize 그리드 적용 — 구현 단순화를 위해 4개 미만은 개별 처리)
// ───────────────────────────────────────────────
function HookCard({
  cut,
  artStyle,
  purpose,
  seriesId,
  uploadedCodes,
  onUploaded,
}: {
  cut: SceneCut;
  artStyle: string;
  purpose: string;
  seriesId: string;
  uploadedCodes: Set<string>;
  onUploaded: (code: string) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // HOOK 컷은 단일 프롬프트 (기존 buildGridPrompt에 컷 1개를 넣으면 그리드 구조 없이 단일 패널로 동작)
  // 가독성을 위해 간단한 단일 프롬프트 생성
  const stylePrefix =
    artStyle === 'polystyle'
      ? 'flat illustration, bold outlines, vibrant colors, Korean webtoon style, high quality'
      : 'illustration';
  const purposeSuffix =
    purpose === 'webnovel'
      ? 'cinematic 16:9 widescreen composition'
      : 'vertical composition';
  const desc = cut.text.slice(0, 120);
  const code = cut.scene_code.split('_').slice(2).join('_');
  const prompt = `${stylePrefix}, ${desc}, ${purposeSuffix}\n[scene_code: ${code}] [HOOK]`;

  const isDialogue = cut.type === 'dialogue';
  const isUploaded = uploadedCodes.has(cut.scene_code);
  const typeBadgeLabel = cut.type === 'narration' ? 'narr' : cut.type === 'dialogue' ? '대사' : '혼합';

  // 프롬프트 클립보드 복사
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopying(true);
      setTimeout(() => setCopying(false), 1500);
    } catch {
      // 복사 실패 시 조용히 무시
    }
  }

  // 이미지 생성 사이트를 새 탭으로 열기 (프롬프트 먼저 복사)
  async function handleOpenSite(url: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      alert('프롬프트가 복사됐습니다. 사이트에서 붙여넣기 하세요.');
    } catch {
      // 복사 실패해도 사이트는 열어줌
    }
    // iframe 절대 금지 — window.open 팝업 사용 (프로젝트 규칙)
    window.open(url, '_blank', 'noopener,noreferrer');
    setSiteMenuOpen(false);
  }

  // 파일 업로드 처리
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target', 'bg'); // 배경 이미지 타겟
      const res = await fetch(
        `${API}/series/${seriesId}/scenes/${cut.scene_code}/upload`,
        { method: 'POST', body: fd }
      );
      if (!res.ok) throw new Error('업로드 실패');
      const data = await res.json();
      if (data.bg_url) setThumbUrl(data.bg_url);
      onUploaded(cut.scene_code);
    } catch (err) {
      alert(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div
      style={{
        borderRadius: '8px',
        padding: '0.8rem',
        background: isUploaded
          ? 'rgba(16,185,129,0.06)'
          : 'rgba(239,68,68,0.04)', // HOOK은 빨간 tint
        marginBottom: '0.5rem',
        border: isUploaded
          ? '1px solid rgba(16,185,129,0.25)'
          : '1px solid rgba(239,68,68,0.15)',
        borderLeft: '3px solid #ef4444', // HOOK 빨간 left border
        fontFamily: "var(--font-en), 'Pretendard', sans-serif",
      }}
    >
      {/* 상단 배지 행 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.03em',
          padding: '0.15rem 0.5rem', borderRadius: '6px',
          background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
        }}>
          {code}
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600,
          padding: '0.12rem 0.45rem', borderRadius: '6px',
          background: 'rgba(239,68,68,0.18)', color: '#f87171',
        }}>
          HOOK
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600,
          padding: '0.12rem 0.45rem', borderRadius: '6px',
          background: cut.type === 'dialogue'
            ? 'rgba(139,92,246,0.18)'
            : 'rgba(255,255,255,0.08)',
          color: cut.type === 'dialogue' ? '#a78bfa' : 'rgba(255,255,255,0.5)',
        }}>
          {typeBadgeLabel}
        </span>
        {cut.speaker && (
          <span style={{
            fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '6px',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
          }}>
            {cut.speaker}
          </span>
        )}
        {isUploaded && (
          <span style={{
            marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700,
            color: '#6ee7b7', background: 'rgba(16,185,129,0.12)',
            padding: '0.12rem 0.5rem', borderRadius: '6px',
          }}>
            ✓ 완료
          </span>
        )}
      </div>

      {/* 텍스트 미리보기 */}
      <p style={{
        fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)',
        marginBottom: '0.5rem',
        display: '-webkit-box', WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
        lineHeight: 1.5,
      }}>
        {cut.text}
      </p>

      {/* 프롬프트 표시 or 대사 컷 안내 */}
      {isDialogue ? (
        <div style={{
          padding: '0.5rem 0.75rem', borderRadius: '6px',
          background: 'rgba(139,92,246,0.08)',
          border: '1px dashed rgba(139,92,246,0.3)',
          fontSize: '0.75rem', color: 'rgba(167,139,250,0.7)',
          marginBottom: '0.5rem',
        }}>
          대사 컷 — 립씽크 MP4 필요 (키프레임 페이지에서 처리)
        </div>
      ) : (
        <textarea
          readOnly
          value={prompt}
          style={{
            width: '100%', height: '72px',
            borderRadius: '6px', padding: '0.5rem 0.7rem',
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '0.78rem', lineHeight: 1.6,
            resize: 'none', fontFamily: 'monospace',
            boxSizing: 'border-box', marginBottom: '0.5rem',
            outline: 'none',
          }}
        />
      )}

      {/* 업로드 완료 시 썸네일 */}
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt="업로드된 이미지"
          style={{
            width: '100%', maxHeight: '100px',
            objectFit: 'cover', borderRadius: '6px',
            marginBottom: '0.5rem',
            border: '1px solid rgba(16,185,129,0.3)',
          }}
        />
      )}

      {/* 버튼 행 */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={handleCopy}
          style={{
            padding: '0.28rem 0.65rem', fontSize: '0.73rem',
            borderRadius: '6px', cursor: 'pointer',
            background: copying ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
            border: copying ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.1)',
            color: copying ? '#6ee7b7' : 'rgba(255,255,255,0.6)',
            transition: 'all 0.15s',
          }}
        >
          {copying ? '복사됨 ✓' : '📋 복사'}
        </button>

        {/* 이미지 생성 사이트 드롭다운 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setSiteMenuOpen(prev => !prev)}
            disabled={isDialogue}
            style={{
              padding: '0.28rem 0.65rem', fontSize: '0.73rem',
              borderRadius: '6px',
              cursor: isDialogue ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: isDialogue ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.6)',
            }}
          >
            🖼️ 이미지 생성 사이트
          </button>
          {siteMenuOpen && !isDialogue && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 20,
              marginTop: '0.3rem',
              background: '#1a1d27',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              minWidth: '150px', overflow: 'hidden',
            }}>
              {IMAGE_SITES.map(site => (
                <button
                  key={site.label}
                  onClick={() => handleOpenSite(site.url)}
                  style={{
                    display: 'block', width: '100%',
                    padding: '0.45rem 0.9rem', textAlign: 'left',
                    background: 'none', border: 'none',
                    color: 'rgba(255,255,255,0.75)',
                    fontSize: '0.78rem', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                >
                  {site.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 업로드 버튼 */}
        <button
          onClick={() => !isDialogue && !uploading && fileInputRef.current?.click()}
          disabled={isDialogue || uploading}
          style={{
            padding: '0.28rem 0.65rem', fontSize: '0.73rem',
            borderRadius: '6px',
            cursor: isDialogue || uploading ? 'not-allowed' : 'pointer',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: isDialogue || uploading ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.6)',
          }}
        >
          {uploading ? '업로드 중…' : '⬆ 업로드'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* 수동 완료 표시 */}
        {!isUploaded && (
          <button
            onClick={() => onUploaded(cut.scene_code)}
            style={{
              padding: '0.28rem 0.65rem', fontSize: '0.73rem',
              borderRadius: '6px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            ✓ 완료표시
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 그리드 그룹 카드 컴포넌트
//
// 기존 CutCard 대체 — 4컷(2×2) 또는 9컷(3×3)을
// 하나의 그리드 프롬프트로 합쳐 이미지 1장 생성 지원.
// 그리드 이미지 1장을 그룹 내 모든 narration 컷에 동일 업로드.
// ───────────────────────────────────────────────
function GridGroupCard({
  cuts,         // 이 그룹에 속하는 컷들 (최대 4개 or 9개)
  artStyle,
  purpose,
  gridSize,
  seriesId,
  groupIndex,   // 몇 번째 그룹인지 (1부터 시작, 표시용)
  uploadedGroups,   // 완료 처리된 그룹 인덱스 집합
  onGroupUploaded,  // 그룹 내 scene_code 목록과 함께 완료 콜백
}: {
  cuts: SceneCut[];
  artStyle: string;
  purpose: string;
  gridSize: GridSize;
  seriesId: string;
  groupIndex: number;
  uploadedGroups: Set<number>;
  onGroupUploaded: (groupIndex: number, codes: string[]) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  // 업로드 진행 상황 (예: "3/4 업로드 중...")
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  // 업로드 완료 후 그리드 썸네일 URL
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGroupDone = uploadedGroups.has(groupIndex);

  // 그리드 프롬프트 생성 (buildGridPrompt 함수 사용)
  const prompt = buildGridPrompt(cuts, artStyle, purpose, gridSize);

  // 그룹 코드 범위 표시 (예: "nc01 ~ nc04")
  const firstCode = cuts.length > 0 ? cuts[0].scene_code.split('_').slice(2).join('_') : '';
  const lastCode = cuts.length > 0 ? cuts[cuts.length - 1].scene_code.split('_').slice(2).join('_') : '';
  const groupLabel = `그룹 ${groupIndex} — ${firstCode} ~ ${lastCode} (${cuts.length}컷)`;

  // 대사가 아닌 컷 수 (업로드 대상)
  const narrationCuts = cuts.filter(c => c.type !== 'dialogue');
  const dialogueCuts = cuts.filter(c => c.type === 'dialogue');

  // 컷 유형 배지 색상 헬퍼
  function cutTypeBadgeStyle(type: 'narration' | 'dialogue' | 'mixed') {
    if (type === 'dialogue') return { bg: 'rgba(139,92,246,0.18)', color: '#a78bfa' };
    if (type === 'mixed')    return { bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' };
    return { bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' };
  }

  // 프롬프트 복사
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopying(true);
      setTimeout(() => setCopying(false), 1500);
    } catch {
      // 복사 실패 시 조용히 무시
    }
  }

  // 이미지 생성 사이트 열기 (프롬프트 먼저 복사)
  async function handleOpenSite(url: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      alert('그리드 프롬프트가 복사됐습니다. 사이트에서 붙여넣기 하세요.');
    } catch {
      // 복사 실패해도 사이트는 열어줌
    }
    // iframe 절대 금지 — window.open 팝업 사용 (프로젝트 규칙)
    window.open(url, '_blank', 'noopener,noreferrer');
    setSiteMenuOpen(false);
  }

  // 그리드 이미지 파일 선택 후 업로드
  // 그룹 내 모든 narration 컷에 동일 이미지를 target='bg'로 순차 업로드
  // (Promise.all 대신 for loop — API 과부하 방지)
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 업로드 대상: narration 컷만 (dialogue 컷은 bg 업로드 스킵)
    const targets = narrationCuts;
    if (targets.length === 0) {
      alert('업로드할 narration 컷이 없습니다.');
      return;
    }

    const uploadedCodes: string[] = [];
    let lastBgUrl: string | null = null;

    for (let i = 0; i < targets.length; i++) {
      const cut = targets[i];
      // 진행 상황 표시
      setUploadProgress(`${i + 1}/${targets.length} 업로드 중...`);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('target', 'bg'); // 배경 이미지 타겟 (LD-003: image_hint 기반 배경)
        const res = await fetch(
          `${API}/series/${seriesId}/scenes/${cut.scene_code}/upload`,
          { method: 'POST', body: fd }
        );
        if (!res.ok) throw new Error(`${cut.scene_code} 업로드 실패`);
        const data = await res.json();
        if (data.bg_url) lastBgUrl = data.bg_url;
        uploadedCodes.push(cut.scene_code);
      } catch (err) {
        alert(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.');
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    // 모든 업로드 완료
    setUploadProgress(null);
    if (lastBgUrl) setThumbUrl(lastBgUrl);

    // dialogue 컷 scene_code도 완료 목록에 추가 (수동 완료 처리)
    const allCodes = [
      ...uploadedCodes,
      ...dialogueCuts.map(c => c.scene_code),
    ];
    onGroupUploaded(groupIndex, allCodes);

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div
      style={{
        borderRadius: '10px',
        padding: '1rem',
        background: isGroupDone
          ? 'rgba(16,185,129,0.05)'
          : 'rgba(255,255,255,0.03)',
        border: isGroupDone
          ? '1px solid rgba(16,185,129,0.2)'
          : '1px solid rgba(255,255,255,0.07)',
        fontFamily: "var(--font-en), 'Pretendard', sans-serif",
      }}
    >
      {/* ── 카드 헤더: 그룹 레이블 + 완료 배지 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginBottom: '0.75rem',
      }}>
        <span style={{
          fontSize: '0.78rem', fontWeight: 700,
          color: isGroupDone ? '#6ee7b7' : 'rgba(255,255,255,0.7)',
        }}>
          {groupLabel}
        </span>
        {isGroupDone && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700,
            color: '#6ee7b7', background: 'rgba(16,185,129,0.12)',
            padding: '0.1rem 0.5rem', borderRadius: '6px', marginLeft: 'auto',
          }}>
            ✓ 완료
          </span>
        )}
      </div>

      {/* ── 컷 미리보기 목록 (각 컷 한 줄) ── */}
      <div style={{ marginBottom: '0.75rem' }}>
        {cuts.map((cut, i) => {
          const code = cut.scene_code.split('_').slice(2).join('_');
          const typeBadge = cut.type === 'narration' ? 'narr' : cut.type === 'dialogue' ? '대사' : '혼합';
          const { bg: badgeBg, color: badgeColor } = cutTypeBadgeStyle(cut.type);
          const isDialogue = cut.type === 'dialogue';
          return (
            <div
              key={cut.scene_code}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.25rem 0.4rem',
                borderRadius: '5px',
                // 짝수 행에 미세 배경 구분
                background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                marginBottom: '0.1rem',
              }}
            >
              {/* 패널 번호 */}
              <span style={{
                fontSize: '0.65rem', fontWeight: 700,
                color: 'rgba(245,158,11,0.6)',
                minWidth: '1.2rem',
              }}>
                P{i + 1}
              </span>
              {/* scene_code 배지 */}
              <span style={{
                fontSize: '0.68rem', fontWeight: 700,
                padding: '0.08rem 0.4rem', borderRadius: '5px',
                background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                whiteSpace: 'nowrap',
              }}>
                {code}
              </span>
              {/* 컷 유형 배지 */}
              <span style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '0.08rem 0.4rem', borderRadius: '5px',
                background: badgeBg, color: badgeColor,
                whiteSpace: 'nowrap',
              }}>
                {typeBadge}
              </span>
              {/* 대사 컷 립씽크 주석 */}
              {isDialogue && (
                <span style={{
                  fontSize: '0.63rem', color: 'rgba(167,139,250,0.6)',
                  whiteSpace: 'nowrap',
                }}>
                  [립씽크 MP4 필요]
                </span>
              )}
              {/* 텍스트 미리보기 (말줄임) */}
              <span style={{
                fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {cut.text.slice(0, 50)}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── 그리드 프롬프트 영역 ── */}
      <div style={{ marginBottom: '0.75rem' }}>
        <p style={{
          fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
          marginBottom: '0.35rem',
        }}>
          그리드 프롬프트
        </p>
        <textarea
          readOnly
          value={prompt}
          rows={7}
          style={{
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '0.78rem',
            lineHeight: 1.6,
            resize: 'none',
            width: '100%',
            padding: '0.6rem 0.8rem',
            boxSizing: 'border-box',
            fontFamily: 'monospace',
            outline: 'none',
          }}
        />
      </div>

      {/* ── 버튼 행: 복사 + 이미지 사이트 ── */}
      <div style={{
        display: 'flex', gap: '0.4rem', flexWrap: 'wrap',
        alignItems: 'center', marginBottom: '0.75rem',
      }}>
        {/* 프롬프트 복사 버튼 */}
        <button
          onClick={handleCopy}
          style={{
            padding: '0.32rem 0.8rem', fontSize: '0.76rem',
            borderRadius: '6px', cursor: 'pointer',
            background: copying ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
            border: copying ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.1)',
            color: copying ? '#6ee7b7' : 'rgba(255,255,255,0.6)',
            transition: 'all 0.15s',
          }}
        >
          {copying ? '복사됨 ✓' : '📋 프롬프트 복사'}
        </button>

        {/* 이미지 생성 사이트 드롭다운 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setSiteMenuOpen(prev => !prev)}
            style={{
              padding: '0.32rem 0.8rem', fontSize: '0.76rem',
              borderRadius: '6px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            🖼️ 이미지 생성 사이트
          </button>
          {siteMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 20,
              marginTop: '0.3rem',
              background: '#1a1d27',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              minWidth: '150px', overflow: 'hidden',
            }}>
              {IMAGE_SITES.map(site => (
                <button
                  key={site.label}
                  onClick={() => handleOpenSite(site.url)}
                  style={{
                    display: 'block', width: '100%',
                    padding: '0.45rem 0.9rem', textAlign: 'left',
                    background: 'none', border: 'none',
                    color: 'rgba(255,255,255,0.75)',
                    fontSize: '0.78rem', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                >
                  {site.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 구분선 ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        marginBottom: '0.75rem',
      }} />

      {/* ── 그리드 이미지 업로드 영역 ── */}
      <div>
        <p style={{
          fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
          marginBottom: '0.4rem',
        }}>
          생성 후 그리드 이미지 업로드
        </p>

        {/* 안내 텍스트 */}
        <p style={{
          fontSize: '0.72rem',
          color: 'rgba(255,255,255,0.3)',
          marginBottom: '0.5rem',
          lineHeight: 1.5,
        }}>
          이 그리드 이미지는 {narrationCuts.length}개 narration 컷에 동일 적용됩니다.
          {dialogueCuts.length > 0 && ` (대사 컷 ${dialogueCuts.length}개는 건너뜀)`}
        </p>

        {/* 진행 상황 표시 */}
        {uploadProgress && (
          <div style={{
            padding: '0.45rem 0.75rem',
            borderRadius: '6px',
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.2)',
            fontSize: '0.75rem', color: '#f59e0b',
            marginBottom: '0.5rem',
          }}>
            {uploadProgress}
          </div>
        )}

        {/* 업로드 완료 썸네일 */}
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt="업로드된 그리드 이미지"
            style={{
              width: '100%', maxHeight: '140px',
              objectFit: 'cover', borderRadius: '6px',
              marginBottom: '0.5rem',
              border: '1px solid rgba(16,185,129,0.3)',
            }}
          />
        )}

        {/* 버튼 행 */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 파일 선택 버튼 */}
          <button
            onClick={() => !uploadProgress && fileInputRef.current?.click()}
            disabled={!!uploadProgress}
            style={{
              padding: '0.35rem 0.9rem', fontSize: '0.76rem',
              borderRadius: '6px',
              cursor: uploadProgress ? 'not-allowed' : 'pointer',
              background: uploadProgress ? 'rgba(255,255,255,0.03)' : 'rgba(16,185,129,0.1)',
              border: uploadProgress
                ? '1px solid rgba(255,255,255,0.08)'
                : '1px solid rgba(16,185,129,0.3)',
              color: uploadProgress ? 'rgba(255,255,255,0.25)' : '#6ee7b7',
              transition: 'all 0.15s',
            }}
          >
            {uploadProgress ? uploadProgress : '⬆ 파일 선택 후 업로드'}
          </button>

          {/* 숨겨진 파일 input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* 수동 완료 표시 (이미 완료면 숨김) */}
          {!isGroupDone && (
            <button
              onClick={() => {
                const allCodes = cuts.map(c => c.scene_code);
                onGroupUploaded(groupIndex, allCodes);
              }}
              style={{
                padding: '0.35rem 0.8rem', fontSize: '0.73rem',
                borderRadius: '6px', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
                border: '1px dashed rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.3)',
              }}
            >
              ✓ 그룹 완료표시
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 메인 ExtensionDrawer 컴포넌트
// ───────────────────────────────────────────────
export default function ExtensionDrawer({
  open,
  onClose,
  seriesId,
  chapters,
}: ExtensionDrawerProps) {
  // 선택된 화풍 (기본값: polystyle)
  const [artStyle, setArtStyle] = useState<'polystyle'>('polystyle');
  // 선택된 용도 (기본값: webnovel = 16:9)
  const [purpose, setPurpose] = useState<'webnovel'>('webnovel');
  // 그리드 모드 — 2×2(4컷) 또는 3×3(9컷), 기본값 2×2
  const [gridMode, setGridMode] = useState<GridSize>('2x2');
  // 챕터별 컷 목록 (key = chapter 번호)
  const [scenesByChapter, setScenesByChapter] = useState<Record<number, SceneCut[]>>({});
  // 현재 로딩 중인 챕터 번호 집합
  const [loadingChapters, setLoadingChapters] = useState<Set<number>>(new Set());
  // 완료 처리된 그룹 인덱스 집합 (key = `${chapterNum}_${groupIndex}`)
  const [uploadedGroups, setUploadedGroups] = useState<Set<string>>(new Set());
  // 완료 처리된 scene_code 집합 (진행률 계산용)
  const [uploadedCodes, setUploadedCodes] = useState<Set<string>>(new Set());

  // ── 데이터 패치 ──
  // open이 true가 될 때 모든 챕터의 씬 데이터를 동시에 fetch
  useEffect(() => {
    if (!open) return;

    // 아직 로딩하지 않은 챕터만 fetch
    const toFetch = chapters.filter(ch => !(ch.chapter in scenesByChapter));
    if (toFetch.length === 0) return;

    // 로딩 시작 표시
    setLoadingChapters(prev => {
      const next = new Set(prev);
      toFetch.forEach(ch => next.add(ch.chapter));
      return next;
    });

    // 각 챕터를 동시에 fetch
    toFetch.forEach(async ch => {
      try {
        const res = await fetch(
          `${API}/series/${seriesId}/chapters/${ch.chapter}/scenes`
        );
        const cuts: SceneCut[] = res.ok ? await res.json() : [];
        setScenesByChapter(prev => ({ ...prev, [ch.chapter]: cuts }));
      } catch {
        setScenesByChapter(prev => ({ ...prev, [ch.chapter]: [] }));
      } finally {
        setLoadingChapters(prev => {
          const next = new Set(prev);
          next.delete(ch.chapter);
          return next;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seriesId, chapters.length]);

  // 그룹 완료 콜백 — scene_code 목록과 함께 완료 등록
  function handleGroupUploaded(chapterNum: number, groupIndex: number, codes: string[]) {
    const key = `${chapterNum}_${groupIndex}`;
    setUploadedGroups(prev => new Set(prev).add(key));
    setUploadedCodes(prev => {
      const next = new Set(prev);
      codes.forEach(code => next.add(code));
      return next;
    });
  }

  // HOOK 단독 컷 완료 콜백
  function handleHookUploaded(code: string) {
    setUploadedCodes(prev => new Set(prev).add(code));
  }

  // 오버레이 클릭 시 확인 후 닫기
  function handleOverlayClick() {
    if (window.confirm('익스텐션 패널을 닫겠습니까?')) {
      onClose();
    }
  }

  // 전체 컷 수 합산 (진행률 표시용)
  const totalCuts = Object.values(scenesByChapter).reduce(
    (sum, cuts) => sum + cuts.length, 0
  );
  const uploadedCount = uploadedCodes.size;

  // 전체 그룹 수 합산 (그룹 진행률 표시용)
  // HOOK은 별도로 계산하지 않고 정규 그룹만 포함
  const totalRegularGroups = Object.entries(scenesByChapter).reduce(
    (sum, [, cuts]) => {
      const regularCuts = cuts.filter(c => !c.is_hook);
      return sum + groupCutsForGrid(regularCuts, gridMode).length;
    }, 0
  );
  const completedGroupCount = uploadedGroups.size;

  // 패널이 닫혀있으면 아무것도 렌더하지 않음
  if (!open) return null;

  return (
    <>
      {/* 배경 오버레이 — 클릭 시 닫기 확인 */}
      <div
        onClick={handleOverlayClick}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1000,
        }}
      />

      {/* 사이드 패널 본체 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '62vw',
          zIndex: 1001,
          background: '#0f1117',
          borderLeft: '1px solid rgba(245,158,11,0.2)',
          overflowY: 'auto',
          fontFamily: "var(--font-en), 'Pretendard', sans-serif",
          display: 'flex',
          flexDirection: 'column',
        }}
        // 패널 내부 클릭이 오버레이 닫기 이벤트로 전파되지 않도록 차단
        onClick={e => e.stopPropagation()}
      >

        {/* ── 헤더 (sticky) ── */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(15,17,23,0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(245,158,11,0.15)',
          padding: '1rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          {/* 닫기 버튼 */}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '1.1rem', cursor: 'pointer',
              padding: '0.2rem 0.4rem', borderRadius: '6px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)'; }}
            aria-label="패널 닫기"
          >
            ✕
          </button>

          {/* 타이틀 */}
          <span style={{
            color: '#f59e0b',
            fontWeight: 800,
            fontSize: '1rem',
            letterSpacing: '0.01em',
          }}>
            키프레임 익스텐션
          </span>

          {/* 그리드 모드 표시 배지 */}
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            padding: '0.15rem 0.55rem', borderRadius: '8px',
            background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
            letterSpacing: '0.04em',
          }}>
            {gridMode === '2x2' ? '2×2 그리드' : '3×3 그리드'}
          </span>

          {/* 진행률 배지 */}
          {totalCuts > 0 && (
            <span style={{
              marginLeft: 'auto',
              fontSize: '0.75rem', fontWeight: 600,
              color: uploadedCount === totalCuts ? '#6ee7b7' : 'rgba(255,255,255,0.4)',
              background: uploadedCount === totalCuts
                ? 'rgba(16,185,129,0.12)'
                : 'rgba(255,255,255,0.05)',
              padding: '0.2rem 0.6rem', borderRadius: '8px',
            }}>
              {uploadedCount}/{totalCuts}컷 완료
            </span>
          )}
        </div>

        {/* ── 옵션 섹션 (화풍 + 용도 + 그리드 모드) ── */}
        <div style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>

          {/* 화풍 선택 */}
          <div style={{ marginBottom: '0.75rem' }}>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
              marginBottom: '0.45rem',
            }}>
              화풍
            </p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {/* 활성 화풍 */}
              {ART_STYLES_ACTIVE.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setArtStyle(key)}
                  style={{
                    padding: '0.35rem 1rem', borderRadius: '20px',
                    border: artStyle === key
                      ? '1.5px solid rgba(245,158,11,0.8)'
                      : '1px solid rgba(255,255,255,0.12)',
                    background: artStyle === key
                      ? 'rgba(245,158,11,0.15)'
                      : 'transparent',
                    color: artStyle === key ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                    fontSize: '0.8rem', fontWeight: artStyle === key ? 700 : 400,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
              {/* 준비 중 화풍 */}
              {ART_STYLES_COMING.map(({ label }) => (
                <span
                  key={label}
                  title="준비 중"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.35rem 1rem', borderRadius: '20px',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem',
                    cursor: 'not-allowed',
                  }}
                >
                  {label}
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '0.08rem 0.35rem', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.2)',
                  }}>
                    준비 중
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* 용도 선택 */}
          <div style={{ marginBottom: '0.75rem' }}>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
              marginBottom: '0.45rem',
            }}>
              용도
            </p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setPurpose('webnovel')}
                style={{
                  padding: '0.35rem 1rem', borderRadius: '20px',
                  border: purpose === 'webnovel'
                    ? '1.5px solid rgba(245,158,11,0.8)'
                    : '1px solid rgba(255,255,255,0.12)',
                  background: purpose === 'webnovel'
                    ? 'rgba(245,158,11,0.15)'
                    : 'transparent',
                  color: purpose === 'webnovel' ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                  fontSize: '0.8rem', fontWeight: purpose === 'webnovel' ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                웹소설 (16:9)
              </button>
              {['쇼츠 (9:16)', '카드뉴스 (1:1)'].map(label => (
                <span
                  key={label}
                  title="준비 중"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.35rem 1rem', borderRadius: '20px',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem',
                    cursor: 'not-allowed',
                  }}
                >
                  {label}
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '0.08rem 0.35rem', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.2)',
                  }}>
                    준비 중
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* 그리드 모드 선택 — 핵심 신규 기능 */}
          <div>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
              marginBottom: '0.45rem',
            }}>
              그리드 모드
            </p>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {/* 2×2 모드 버튼 */}
              <button
                onClick={() => setGridMode('2x2')}
                style={{
                  padding: '0.35rem 1.1rem', borderRadius: '20px',
                  border: gridMode === '2x2'
                    ? '1.5px solid rgba(139,92,246,0.8)'
                    : '1px solid rgba(255,255,255,0.12)',
                  background: gridMode === '2x2'
                    ? 'rgba(139,92,246,0.15)'
                    : 'transparent',
                  color: gridMode === '2x2' ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                  fontSize: '0.8rem', fontWeight: gridMode === '2x2' ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                2×2 (4컷)
              </button>
              {/* 3×3 모드 버튼 */}
              <button
                onClick={() => setGridMode('3x3')}
                style={{
                  padding: '0.35rem 1.1rem', borderRadius: '20px',
                  border: gridMode === '3x3'
                    ? '1.5px solid rgba(139,92,246,0.8)'
                    : '1px solid rgba(255,255,255,0.12)',
                  background: gridMode === '3x3'
                    ? 'rgba(139,92,246,0.15)'
                    : 'transparent',
                  color: gridMode === '3x3' ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                  fontSize: '0.8rem', fontWeight: gridMode === '3x3' ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                3×3 (9컷)
              </button>
              {/* 절감 효과 안내 텍스트 */}
              <span style={{
                fontSize: '0.7rem', color: 'rgba(16,185,129,0.7)',
                marginLeft: '0.5rem',
              }}>
                {gridMode === '2x2' ? '70컷 → 약 18번 업로드' : '70컷 → 약 8번 업로드'}
              </span>
            </div>
          </div>
        </div>

        {/* ── 챕터별 컷 섹션 ── */}
        <div style={{ flex: 1, padding: '1rem 1.5rem', paddingBottom: '5rem' }}>
          {chapters.map(ch => {
            const cuts = scenesByChapter[ch.chapter] ?? [];
            const isLoading = loadingChapters.has(ch.chapter);
            const dataReady = ch.chapter in scenesByChapter;

            // HOOK 컷(is_hook=true)과 정규 컷 분리 — LD-015 준수
            const hookCuts = cuts.filter(c => c.is_hook);
            const regularCuts = cuts.filter(c => !c.is_hook);

            // 정규 컷을 gridMode에 따라 그룹화
            const regularGroups = groupCutsForGrid(regularCuts, gridMode);

            return (
              <div key={ch.chapter} style={{ marginBottom: '2rem' }}>
                {/* 챕터 제목 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  marginBottom: '0.75rem',
                  paddingBottom: '0.5rem',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'rgba(255,255,255,0.85)' }}>
                    {ch.chapter}화
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                    — {ch.role}
                  </span>
                  {dataReady && !isLoading && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
                      {cuts.length}컷 / {regularGroups.length}그룹
                    </span>
                  )}
                </div>

                {/* 로딩 중 */}
                {isLoading && (
                  <div style={{
                    padding: '1rem', color: 'rgba(255,255,255,0.3)',
                    fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  }}>
                    <span style={{
                      display: 'inline-block',
                      width: '14px', height: '14px',
                      border: '2px solid rgba(245,158,11,0.3)',
                      borderTopColor: '#f59e0b',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    씬 데이터 로딩 중…
                  </div>
                )}

                {/* 데이터 없음 */}
                {dataReady && !isLoading && cuts.length === 0 && (
                  <div style={{
                    padding: '0.75rem 1rem',
                    fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)',
                  }}>
                    씬 데이터 없음
                  </div>
                )}

                {/* HOOK 컷 — 단독 분리 섹션 (LD-015 준수) */}
                {hookCuts.length > 0 && (
                  <div style={{
                    marginBottom: '1.25rem',
                    paddingBottom: '1rem',
                    borderBottom: '2px dashed rgba(245,158,11,0.35)', // amber 점선 구분선
                  }}>
                    {/* HOOK 섹션 레이블 */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                      marginBottom: '0.6rem',
                    }}>
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
                        padding: '0.1rem 0.5rem', borderRadius: '5px',
                        background: 'rgba(239,68,68,0.18)', color: '#f87171',
                      }}>
                        HOOK
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
                        단독 컷 (그리드 없이 개별 처리)
                      </span>
                    </div>

                    {/* HOOK 컷 개별 카드 렌더 */}
                    {hookCuts.map(cut => (
                      <HookCard
                        key={cut.scene_code}
                        cut={cut}
                        artStyle={artStyle}
                        purpose={purpose}
                        seriesId={seriesId}
                        uploadedCodes={uploadedCodes}
                        onUploaded={handleHookUploaded}
                      />
                    ))}
                  </div>
                )}

                {/* 정규 컷 — GridGroupCard 배열 */}
                {regularGroups.map((group, groupIdx) => {
                  // 그룹 인덱스는 1부터 시작 (사용자 표시용)
                  const displayGroupIndex = groupIdx + 1;
                  const groupKey = `${ch.chapter}_${displayGroupIndex}`;
                  const isGroupDone = uploadedGroups.has(groupKey);

                  return (
                    <div
                      key={groupIdx}
                      style={{
                        marginBottom: '0.75rem',
                        paddingBottom: '0.75rem',
                        // 마지막 그룹 제외하고 amber 점선 그룹 구분선
                        borderBottom: groupIdx < regularGroups.length - 1
                          ? '1px dashed rgba(245,158,11,0.25)'
                          : 'none',
                      }}
                    >
                      <GridGroupCard
                        cuts={group}
                        artStyle={artStyle}
                        purpose={purpose}
                        gridSize={gridMode}
                        seriesId={seriesId}
                        groupIndex={displayGroupIndex}
                        uploadedGroups={new Set(
                          // 이 챕터의 그룹 완료 여부를 groupIndex 기준으로 전달
                          isGroupDone ? [displayGroupIndex] : []
                        )}
                        onGroupUploaded={(gIdx, codes) =>
                          handleGroupUploaded(ch.chapter, gIdx, codes)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── 하단 고정 바 (진행률 + 닫기) ── */}
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: 'rgba(15,17,23,0.97)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '0.85rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          {/* 그룹 진행 현황 */}
          <span style={{
            fontSize: '0.8rem', fontWeight: 600,
            color: completedGroupCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.35)',
          }}>
            완료 그룹: {completedGroupCount}/{totalRegularGroups}
          </span>

          {/* 구분자 */}
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.8rem' }}>|</span>

          {/* 컷 진행 현황 */}
          <span style={{
            fontSize: '0.8rem', fontWeight: 600,
            color: uploadedCount > 0 ? '#10b981' : 'rgba(255,255,255,0.35)',
          }}>
            완료 컷: {uploadedCount}/{totalCuts}
          </span>

          <span style={{ flex: 1 }} />

          {/* 닫기 버튼 */}
          <button
            onClick={onClose}
            style={{
              padding: '0.45rem 1.1rem', fontSize: '0.8rem',
              borderRadius: '8px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            패널 닫기 — 대본 승인 버튼은 별도로 클릭하세요
          </button>
        </div>

      </div>

      {/* 스피너 애니메이션 키프레임 (글로벌 정의가 없는 경우 대비) */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
