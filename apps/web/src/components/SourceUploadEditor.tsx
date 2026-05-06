// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

const API = 'http://localhost:8001/api/v1';
const ACCEPT = '.txt,.srt,.vtt,.pdf';

interface UploadedFile {
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

interface Classification {
  type: string;
  confidence: number;
  signals: Record<string, unknown>;
  reason?: string;
  method?: string;
}

interface Props {
  seriesId: string;
  onConfirm: () => void;
}

export default function SourceUploadEditor({ seriesId, onConfirm }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [sourceMode, setSourceMode] = useState<'extract' | 'design' | null>(null);
  const [classifying, setClassifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    const entry: UploadedFile = { name: file.name, size: file.size, status: 'uploading' };
    setFiles(prev => [...prev, entry]);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch(`${API}/wiki/${seriesId}/sources/upload-file`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const err = await res.text();
        setFiles(prev => prev.map(f =>
          f.name === file.name ? { ...f, status: 'error', error: err.slice(0, 80) } : f
        ));
      } else {
        setFiles(prev => prev.map(f =>
          f.name === file.name ? { ...f, status: 'done' } : f
        ));
      }
    } catch {
      setFiles(prev => prev.map(f =>
        f.name === file.name ? { ...f, status: 'error', error: '네트워크 오류' } : f
      ));
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList).forEach(uploadFile);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [seriesId]);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      // sourceMode가 결정된 경우 world_data에 저장
      if (sourceMode) {
        await fetch(`${API}/series/${seriesId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            world_data: { sourceMode },
            settings: { autoApproveWorld: sourceMode === 'extract' },
          }),
        });
      }
      const res = await fetch(`${API}/series/${seriesId}/approve/source_upload`, { method: 'POST' });
      if (!res.ok) throw new Error('승인 실패');
      onConfirm();
    } catch {
      setConfirming(false);
    }
  }, [seriesId, onConfirm, sourceMode]);

  // 파일 업로드 완료 시 분류 결과 fetch — 최대 5회 폴링 (서버 처리 대기)
  useEffect(() => {
    if (files.length === 0 || confirming) return;
    if (files.some(f => f.status === 'error')) return;
    if (!files.every(f => f.status === 'done')) return;
    if (classification) return;

    let attempts = 0;
    const maxAttempts = 5;

    const poll = () => {
      setClassifying(true);
      fetch(`${API}/series/${seriesId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const cls = data?.world_data?.source_summary?.classification;
          if (cls) {
            setClassification(cls);
            setSourceMode(cls.type === 'novel' || cls.type === 'script' ? 'extract' : 'design');
            setClassifying(false);
          } else {
            attempts += 1;
            if (attempts < maxAttempts) {
              setTimeout(poll, 1500); // 1.5초 후 재시도
            } else {
              setClassifying(false); // 5회 실패 시 포기 → 버튼 유지 비활성
            }
          }
        })
        .catch(() => { setClassifying(false); });
    };

    poll();
  }, [files, confirming, classification, seriesId]);

  const allDone = files.length === 0 || files.every(f => f.status !== 'uploading');
  const hasFailed = files.some(f => f.status === 'error');

  const isNovelType = classification?.type === 'novel' || classification?.type === 'script';
  const badgeLabel =
    classification?.type === 'novel' ? '완성형 소설/시나리오'
    : classification?.type === 'script' ? '시나리오'
    : classification?.type === 'news' ? '뉴스/기사'
    : classification?.type === 'keyword' ? '키워드/소재'
    : '분류 중';

  const mainButtonLabel =
    confirming ? '처리 중…'
    : sourceMode === 'extract' ? '소스 그대로 캐스팅으로'
    : sourceMode === 'design' ? '세계관 생성 시작'
    : files.length > 0 ? `소스 ${files.filter(f => f.status === 'done').length}건으로 세계관 생성`
    : '세계관 생성 시작';

  return (
    <div style={{
      marginTop: '1.5rem',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      {/* 헤더 */}
      <div style={{
        padding: '1.25rem 1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          소스 파일 업로드
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)' }}>
          참고할 파일을 업로드하세요. 세계관 생성 시 내용이 팩트·각색 소재로 활용됩니다.
        </p>
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { ext: '.txt', desc: '소설·시나리오·메모' },
            { ext: '.srt/.vtt', desc: 'YouTube 자막' },
            { ext: '.pdf', desc: '기사·보고서' },
          ].map(t => (
            <span key={t.ext} style={{
              fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '999px',
              background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
            }}>
              {t.ext} — {t.desc}
            </span>
          ))}
        </div>
      </div>

      {/* 드래그앤드롭 존 */}
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? '#6366f1' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: '12px',
            padding: '2rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgba(99,102,241,0.06)' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
            파일을 여기로 드래그하거나 클릭해서 선택
          </p>
          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.75rem', marginTop: '0.3rem' }}>
            .txt · .srt · .pdf 지원
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {/* 업로드된 파일 목록 */}
        {files.length > 0 && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.6rem 0.9rem', borderRadius: '9px',
                background: f.status === 'error'
                  ? 'rgba(239,68,68,0.08)'
                  : f.status === 'done'
                  ? 'rgba(16,185,129,0.07)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${
                  f.status === 'error' ? 'rgba(239,68,68,0.25)'
                  : f.status === 'done' ? 'rgba(16,185,129,0.2)'
                  : 'rgba(255,255,255,0.06)'}`,
              }}>
                <span style={{ fontSize: '1rem' }}>
                  {f.status === 'uploading' ? '⏳' : f.status === 'done' ? '✅' : '❌'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </p>
                  {f.error && (
                    <p style={{ fontSize: '0.72rem', color: '#f87171', marginTop: '0.15rem' }}>{f.error}</p>
                  )}
                </div>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 분류 결과 */}
      {classifying && (
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)' }}>
            소스 분석 중…
          </p>
        </div>
      )}

      {classification && !classifying && (
        <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {/* 분류 결과 배지 */}
          <div style={{ marginBottom: '1rem' }}>
            <span style={{
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em',
              padding: '0.25rem 0.7rem', borderRadius: '999px',
              background: isNovelType ? 'rgba(99,102,241,0.18)' : 'rgba(16,185,129,0.15)',
              color: isNovelType ? '#a5b4fc' : '#6ee7b7',
              border: `1px solid ${isNovelType ? 'rgba(99,102,241,0.35)' : 'rgba(16,185,129,0.3)'}`,
            }}>
              {badgeLabel}
            </span>
            {/* 근거 수치 */}
            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginLeft: '0.6rem' }}>
              {[
                classification.signals?.char_count && `${classification.signals.char_count}자`,
                classification.signals?.korean_names_count && `인물 ${classification.signals.korean_names_count}명`,
                classification.signals?.dialogue_count && `대화 ${classification.signals.dialogue_count}회`,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>

          {/* 모드 고정 안내 (분류 결과 기반 — 사용자 override 불가) */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.85rem 1rem', borderRadius: '10px',
            background: isNovelType ? 'rgba(99,102,241,0.08)' : 'rgba(16,185,129,0.07)',
            border: `1px solid ${isNovelType ? 'rgba(99,102,241,0.3)' : 'rgba(16,185,129,0.2)'}`,
          }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: '0.05rem' }}>
              {isNovelType ? '🔒' : '✨'}
            </span>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: isNovelType ? '#a5b4fc' : '#6ee7b7' }}>
                {isNovelType ? '소스 원문 추출 모드 (자동 고정)' : '키워드 참고 생성 모드 (자동 고정)'}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.3rem', lineHeight: 1.6 }}>
                {isNovelType
                  ? '완성형 소설·시나리오가 감지되었습니다. 시대·인물 이름·갈등 구조를 변형 없이 그대로 추출합니다.'
                  : '키워드·단편 소재가 감지되었습니다. AI가 현대 한국 드라마로 새 세계관을 생성합니다.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 하단 버튼 */}
      <div style={{
        padding: '1rem 1.5rem',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={handleConfirm}
          disabled={!allDone || confirming}
          style={{
            padding: '0.35rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.4)',
            fontSize: '0.82rem',
            cursor: (!allDone || confirming) ? 'not-allowed' : 'pointer',
          }}
        >
          소스 없이 바로 진행
        </button>
        <button
          onClick={handleConfirm}
          disabled={!allDone || confirming || hasFailed || classifying || (files.length > 0 && !classification)}
          style={{
            padding: '0.65rem 1.75rem',
            borderRadius: '10px',
            border: 'none',
            background: (!allDone || confirming || hasFailed || classifying || (files.length > 0 && !classification)) ? 'rgba(99,102,241,0.35)' : '#6366f1',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: (!allDone || confirming || hasFailed || classifying || (files.length > 0 && !classification)) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {mainButtonLabel}
        </button>
      </div>
    </div>
  );
}
