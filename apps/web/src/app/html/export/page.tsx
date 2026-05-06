'use client';
import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadDoc, type HtmlDoc } from '@/lib/htmlDocs';

function ExportContent() {
  const params = useSearchParams();
  const docId  = params.get('id') ?? '';
  const [doc, setDoc]     = useState<HtmlDoc | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!docId) { setReady(true); return; }
    loadDoc(docId).then(loaded => {
      setDoc(loaded);
      setReady(true);
    });
  }, [docId]);

  const handleHtml = useCallback(() => {
    if (!doc) return;
    const blob = new Blob([doc.html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${doc.topic || doc.template}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  const handlePdf = useCallback(() => {
    if (!doc) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(doc.html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }, [doc]);

  const btnStyle = (accent: string, disabled: boolean): React.CSSProperties => ({
    padding: '1.1rem 1.25rem',
    borderRadius: '12px',
    border: `1.5px solid ${disabled ? '#e5e7eb' : accent}`,
    background: disabled ? '#f9fafb' : '#fff',
    color: disabled ? '#9ca3af' : '#111',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', gap: '1rem',
    textAlign: 'left' as const, transition: 'all 0.15s',
    width: '100%', boxSizing: 'border-box' as const,
    boxShadow: disabled ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
  });

  return (
    <main style={{ minHeight: '100vh', background: '#f8f9fb', padding: '2rem', fontFamily: "'Pretendard', -apple-system, sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#111' }}>
      <div style={{ maxWidth: '480px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📤</div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.4rem' }}>내보내기</h2>
          {ready && doc && (
            <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              <strong>{doc.topic || '(무제)'}</strong> · {doc.templateLabel}
            </p>
          )}
          {ready && !doc && (
            <p style={{ fontSize: '0.85rem', color: '#ef4444' }}>문서를 찾을 수 없습니다. <a href="/html" style={{ color: '#4f46e5' }}>문서보관함</a>으로 이동하세요.</p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* HTML */}
          <button onClick={handleHtml} disabled={!doc} style={btnStyle('#4f46e5', !doc)}>
            <span style={{ fontSize: '1.8rem' }}>🌐</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>HTML 파일</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.15rem' }}>.html 단일 파일로 다운로드</div>
            </div>
            {doc && <span style={{ fontSize: '0.75rem', color: '#059669', background: '#ecfdf5', padding: '0.2rem 0.6rem', borderRadius: '999px', flexShrink: 0 }}>사용 가능</span>}
          </button>

          {/* PDF */}
          <button onClick={handlePdf} disabled={!doc} style={btnStyle('#7c3aed', !doc)}>
            <span style={{ fontSize: '1.8rem' }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>PDF</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.15rem' }}>브라우저 인쇄 창 → PDF로 저장</div>
            </div>
            {doc && <span style={{ fontSize: '0.75rem', color: '#059669', background: '#ecfdf5', padding: '0.2rem 0.6rem', borderRadius: '999px', flexShrink: 0 }}>사용 가능</span>}
          </button>

          {/* ZIP - 준비 중 */}
          <button disabled style={btnStyle('#0284c7', true)}>
            <span style={{ fontSize: '1.8rem', opacity: 0.4 }}>📦</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>ZIP</div>
              <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.15rem' }}>CSS·이미지 포함 전체 압축</div>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', background: '#f3f4f6', padding: '0.2rem 0.6rem', borderRadius: '999px', flexShrink: 0 }}>준비 중</span>
          </button>
        </div>

        {docId && (
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <a href={`/html/editor?id=${docId}`} style={{ fontSize: '0.82rem', color: '#4f46e5', textDecoration: 'none' }}>← 에디터로 돌아가기</a>
          </div>
        )}
      </div>
    </main>
  );
}

export default function HtmlExportPage() {
  return (
    <Suspense>
      <ExportContent />
    </Suspense>
  );
}
