'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { loadDoc, saveDoc, type HtmlDoc } from '@/lib/htmlDocs';

function EditorContent() {
  const params   = useSearchParams();
  const docId    = params.get('id') ?? '';

  const [doc, setDoc]               = useState<HtmlDoc | null>(null);
  const [html, setHtml]             = useState('');
  const [blobUrl, setBlobUrl]       = useState('');
  const [viewMode, setViewMode]     = useState<'code' | 'split' | 'preview'>('split');
  const [copied, setCopied]         = useState(false);
  const [ready, setReady]           = useState(false);
  const [saved, setSaved]           = useState(true);
  const [aiLoading, setAiLoading]   = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl]         = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const [showMediaPanel, setShowMediaPanel] = useState(false);
  const [currentSec, setCurrentSec] = useState(-1);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const iframeRef     = useRef<HTMLIFrameElement>(null);
  const lastSyncedSec = useRef(-1);

  useEffect(() => {
    if (!docId) { setReady(true); return; }
    loadDoc(docId).then(loaded => {
      if (loaded) { setDoc(loaded); setHtml(loaded.html); }
      setReady(true);
    });
  }, [docId]);

  // html → Blob URL (300ms 디바운스 — 타이핑 중 과도한 iframe remount 방지)
  useEffect(() => {
    if (!html) { setBlobUrl(''); return; }
    const t = setTimeout(() => {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    }, 300);
    return () => clearTimeout(t);
  }, [html]);

  // iframe 재마운트 시 섹션 싱크 상태 리셋
  useEffect(() => {
    lastSyncedSec.current = -1;
    setCurrentSec(-1);
  }, [blobUrl]);

  // 자동 저장 (1초 디바운스)
  useEffect(() => {
    if (!doc || !ready) return;
    setSaved(false);
    const t = setTimeout(() => {
      saveDoc({ ...doc, html }).then(() => setSaved(true)).catch(() => setSaved(false));
    }, 1000);
    return () => clearTimeout(t);
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps

  // 분할 모드: 마우스 위치 charOffset → <section> 인덱스 → iframe 스크롤
  const syncSection = useCallback((charOffset: number) => {
    const positions: number[] = [];
    const re = /<section[\s>]/gi;
    let m;
    while ((m = re.exec(html)) !== null) positions.push(m.index);
    if (!positions.length) return;

    let idx = 0;
    for (let i = positions.length - 1; i >= 0; i--) {
      if (positions[i] <= charOffset) { idx = i; break; }
    }
    if (lastSyncedSec.current === idx) return;
    lastSyncedSec.current = idx;
    setCurrentSec(idx);

    const iframeDoc = iframeRef.current?.contentWindow?.document;
    if (!iframeDoc) return;
    const secs = iframeDoc.querySelectorAll('section');
    secs[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }, [html]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta   = e.currentTarget;
    const rect = ta.getBoundingClientRect();
    const lineH = Math.round(0.78 * 16 * 1.7); // fontSize(px) × lineHeight ≈ 21px
    const relY  = e.clientY - rect.top + ta.scrollTop;
    const lineIdx = Math.floor(relY / lineH);
    const lines = html.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(lineIdx, lines.length - 1); i++) {
      offset += lines[i].length + 1;
    }
    syncSection(offset);
  }, [html, syncSection]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [html]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${doc?.topic || doc?.template || 'document'}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [html, doc]);

  const handleMediaUpload = useCallback(async (file: File) => {
    if (mediaUploading) return;
    setMediaUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('http://localhost:8001/api/v1/media/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('업로드 실패');
      const data = await res.json();
      setMediaUrl(data.url);
      setShowMediaPanel(true);
    } catch {
      alert('업로드 실패. API 서버가 실행 중인지 확인하세요.');
    } finally {
      setMediaUploading(false);
    }
  }, [mediaUploading]);

  const handleInjectVideo = useCallback((url: string) => {
    const isHls = url.includes('.m3u8');
    const videoStyle = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;';

    const videoTag = isHls
      ? `<video data-hls-src="${url}" autoplay muted loop playsinline style="${videoStyle}"></video>`
      : `<video autoplay muted loop playsinline style="${videoStyle}"><source src="${url}" type="video/mp4"></video>`;

    let next = html.replace(
      /<div class="video-bg"[^>]*>([\s\S]*?<div class="vignette[^>]*><\/div>)<\/div>/g,
      `<div class="video-bg">${videoTag}<div class="vignette"></div></div>`
    );

    if (next === html) {
      next = html.replace(
        /<div\s+class="section-bg section-bg--gradient"[^>]*>\s*<\/div>/g,
        `<div class="section-bg" aria-hidden="true">${videoTag}</div>`
      );
    }

    if (next === html) {
      alert('교체 가능한 그라디언트 섹션을 찾지 못했습니다.\n코드 탭에서 직접 <video> 태그를 삽입하세요.');
      return;
    }

    if (isHls) {
      if (!next.includes('hls.min.js') && !next.includes('hls.js@')) {
        next = next.replace(
          '</head>',
          '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>\n</head>'
        );
      }
      if (!next.includes('ld-hls-init')) {
        next = next.replace(
          '</body>',
          `<script id="ld-hls-init">(function(){function run(){document.querySelectorAll('video[data-hls-src]').forEach(function(v){var s=v.getAttribute('data-hls-src');if(!s)return;if(typeof Hls!=='undefined'&&Hls.isSupported()){var h=new Hls({enableWorker:false});h.loadSource(s);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){v.play().catch(function(){});});}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=s;v.play().catch(function(){});}});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run);}else{run();}})();</script>\n</body>`
        );
      }
    }

    setHtml(next);
    setShowMediaPanel(false);
  }, [html]);

  const handleRegen = useCallback(async () => {
    if (!doc || regenLoading) return;
    setRegenLoading(true);
    try {
      const res = await fetch(`http://localhost:8001/api/v1/html-templates/${doc.template}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: doc.topic, use_ai: false }),
      });
      if (!res.ok) throw new Error('재생성 실패');
      const data = await res.json();
      setHtml(data.html);
    } catch {
      setActionError('재생성 실패. API 서버를 확인하세요.');
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setRegenLoading(false);
    }
  }, [doc, regenLoading]);

  const handleAiFill = useCallback(async () => {
    if (!doc || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch(`http://localhost:8001/api/v1/html-templates/${doc.template}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: doc.topic, use_ai: true }),
      });
      if (!res.ok) throw new Error('생성 실패');
      const data = await res.json();
      setHtml(data.html);
    } catch {
      setActionError('AI 생성 실패. API 서버를 확인하세요.');
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setAiLoading(false);
    }
  }, [doc, aiLoading]);

  const btnBase: React.CSSProperties = {
    padding: '0.3rem 0.85rem', borderRadius: '7px', border: '1px solid #e5e7eb',
    background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
  };

  if (!ready) {
    return <div style={{ height: 'calc(100vh - 82px)', background: '#f8f9fb' }} />;
  }

  if (!doc) {
    return (
      <div style={{
        height: 'calc(100vh - 82px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f9fb', fontFamily: "'Pretendard', -apple-system, sans-serif",
      }}>
        <div style={{ textAlign: 'center', color: '#9ca3af' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#374151', marginBottom: '0.5rem' }}>문서를 찾을 수 없습니다</h2>
          <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>새 문서 페이지에서 생성하세요.</p>
          <a href="/html/new" style={{
            display: 'inline-block', padding: '0.6rem 1.5rem',
            background: '#4f46e5', color: '#fff', borderRadius: '8px',
            textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600,
          }}>새 문서 만들기 →</a>
        </div>
      </div>
    );
  }

  const renderIframe = () => blobUrl ? (
    <iframe
      ref={iframeRef}
      key={blobUrl}
      src={blobUrl}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock"
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      title="HTML 미리보기"
    />
  ) : (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
      문서를 불러오는 중…
    </div>
  );

  const renderTextarea = (withSync = false) => (
    <textarea
      value={html}
      onChange={e => setHtml(e.target.value)}
      onMouseMove={withSync ? handleMouseMove : undefined}
      spellCheck={false}
      style={{
        width: '100%', height: '100%', border: 'none', padding: '1.5rem',
        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: '0.78rem', resize: 'none', outline: 'none',
        background: '#1e293b', color: '#e2e8f0', lineHeight: 1.7,
        boxSizing: 'border-box',
      }}
    />
  );

  return (
    <div style={{
      height: 'calc(100vh - 82px)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: '#f8f9fb',
      fontFamily: "'Pretendard', -apple-system, sans-serif",
    }}>
      {/* 툴바 */}
      <div style={{
        height: '52px', flexShrink: 0,
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', padding: '0 1.25rem', gap: '0.75rem',
      }}>
        <a href="/html" style={{ fontSize: '0.78rem', color: '#9ca3af', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>← 문서보관함</a>
        <div style={{ width: '1px', height: '16px', background: '#e5e7eb', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {doc.topic || '(무제)'}
            <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.75rem', marginLeft: '0.4rem' }}>· {doc.templateLabel}</span>
          </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: saved ? '#9ca3af' : '#d97706', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {saved ? '저장됨' : '저장 중…'}
        </span>
        <div style={{ width: '1px', height: '16px', background: '#e5e7eb', flexShrink: 0 }} />
        {/* 뷰 모드 탭 */}
        <div style={{ display: 'flex', gap: '2px', background: '#f3f4f6', borderRadius: '8px', padding: '3px', flexShrink: 0 }}>
          {([
            { id: 'code'    as const, label: '코드' },
            { id: 'split'   as const, label: '⊟ 분할' },
            { id: 'preview' as const, label: '미리보기' },
          ]).map(({ id, label }) => (
            <button key={id} onClick={() => setViewMode(id)} style={{
              padding: '0.28rem 0.75rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: viewMode === id ? '#fff' : 'transparent',
              color: viewMode === id ? '#111' : '#9ca3af',
              fontSize: '0.75rem', fontWeight: 600,
              boxShadow: viewMode === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '16px', background: '#e5e7eb', flexShrink: 0 }} />
        <button onClick={handleCopy} style={{ ...btnBase, color: copied ? '#059669' : '#374151', borderColor: copied ? '#6ee7b7' : '#e5e7eb' }}>
          {copied ? '✓ 복사됨' : '복사'}
        </button>
        <button onClick={handleDownload} style={btnBase}>HTML 다운로드</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleMediaUpload(f); e.target.value = ''; }}
        />
        <button
          onClick={() => setShowMediaPanel(v => !v)}
          style={{ ...btnBase, color: '#0284c7', borderColor: showMediaPanel ? '#0284c7' : '#7dd3fc', background: showMediaPanel ? '#e0f2fe' : '#f0f9ff' }}
        >
          🎬 동영상
        </button>
        <button
          onClick={handleRegen}
          disabled={regenLoading || !doc}
          style={{ ...btnBase, color: regenLoading ? '#9ca3af' : '#059669', borderColor: regenLoading ? '#e5e7eb' : '#6ee7b7', background: regenLoading ? '#f9fafb' : '#f0fdf4' }}
        >
          {regenLoading ? '재생성 중…' : '재생성'}
        </button>
        <button
          onClick={handleAiFill}
          disabled={aiLoading || !doc}
          style={{ ...btnBase, color: aiLoading ? '#9ca3af' : '#7c3aed', borderColor: aiLoading ? '#e5e7eb' : '#7c3aed', background: aiLoading ? '#f9fafb' : '#faf5ff' }}
        >
          {aiLoading ? 'AI 생성 중…' : 'AI로 채우기'}
        </button>
        <a href={`/html/export?id=${docId}`} style={{ ...btnBase, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          내보내기
        </a>
      </div>

      {actionError && (
        <div style={{
          background: '#fef2f2', borderBottom: '1px solid #fecaca',
          padding: '0.4rem 1.25rem', fontSize: '0.78rem', color: '#dc2626',
          fontWeight: 500, flexShrink: 0,
        }}>
          ⚠️ {actionError}
        </div>
      )}

      {showMediaPanel && (
        <div style={{
          background: '#0f172a', borderBottom: '1px solid #1e3a5f',
          padding: '0.55rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontSize: '0.78rem', flexShrink: 0, flexWrap: 'wrap',
        }}>
          <span style={{ color: '#7dd3fc', fontWeight: 700, whiteSpace: 'nowrap' }}>🎬 동영상 배경</span>
          <div style={{ width: '1px', height: '16px', background: '#1e3a5f', flexShrink: 0 }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={mediaUploading}
            style={{ ...btnBase, color: mediaUploading ? '#475569' : '#94a3b8', borderColor: '#334155', background: '#1e293b', flexShrink: 0 }}
          >
            {mediaUploading ? '업로드 중…' : '📁 파일 선택'}
          </button>
          <span style={{ color: '#334155', fontSize: '0.72rem' }}>또는</span>
          <input
            type="text"
            placeholder="https://example.com/video.mp4"
            value={mediaUrl}
            onChange={e => setMediaUrl(e.target.value)}
            style={{
              flex: 1, minWidth: '260px',
              background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
              color: '#e2e8f0', padding: '0.28rem 0.6rem', fontSize: '0.75rem', outline: 'none',
            }}
          />
          <button
            onClick={() => { if (mediaUrl.trim()) handleInjectVideo(mediaUrl.trim()); else alert('URL을 입력하거나 파일을 업로드하세요.'); }}
            style={{ ...btnBase, color: '#34d399', borderColor: '#6ee7b7', background: '#064e3b', flexShrink: 0 }}
          >
            섹션 배경 교체
          </button>
          <button
            onClick={() => setShowMediaPanel(false)}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 콘텐츠 */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {viewMode === 'split' ? (
          <div style={{ display: 'flex', height: '100%' }}>
            {/* 좌: 코드 편집 + 섹션 인디케이터 */}
            <div style={{ flex: '0 0 50%', height: '100%', overflow: 'hidden', borderRight: '2px solid #0f172a', position: 'relative' }}>
              {renderTextarea(true)}
              {currentSec >= 0 && (
                <div style={{
                  position: 'absolute', bottom: '0.75rem', left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(99,102,241,0.9)', color: '#fff',
                  fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.7rem',
                  borderRadius: '999px', pointerEvents: 'none', whiteSpace: 'nowrap',
                  letterSpacing: '0.04em',
                }}>
                  § {currentSec + 1}
                </div>
              )}
            </div>
            {/* 우: 프리뷰 */}
            <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
              {renderIframe()}
            </div>
          </div>
        ) : viewMode === 'preview' ? (
          renderIframe()
        ) : (
          renderTextarea(false)
        )}
      </div>
    </div>
  );
}

export default function HtmlEditorPage() {
  return (
    <Suspense>
      <EditorContent />
    </Suspense>
  );
}
