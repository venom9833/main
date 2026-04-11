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

interface Props {
  seriesId: string;
  onConfirm: () => void;
}

export default function SourceUploadEditor({ seriesId, onConfirm }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
    } catch (e: unknown) {
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
      const res = await fetch(`${API}/series/${seriesId}/approve/source_upload`, { method: 'POST' });
      if (!res.ok) throw new Error('승인 실패');
      onConfirm();
    } catch {
      setConfirming(false);
    }
  }, [seriesId, onConfirm]);

  // 파일 업로드 완료 시 자동으로 세계관 생성 시작
  useEffect(() => {
    if (files.length === 0 || confirming) return;
    if (files.some(f => f.status === 'error')) return;
    if (files.every(f => f.status === 'done')) {
      handleConfirm();
    }
  }, [files, confirming, handleConfirm]);

  const allDone = files.length === 0 || files.every(f => f.status !== 'uploading');
  const hasFailed = files.some(f => f.status === 'error');

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
          disabled={!allDone || confirming || hasFailed}
          style={{
            padding: '0.65rem 1.75rem',
            borderRadius: '10px',
            border: 'none',
            background: (!allDone || confirming || hasFailed) ? 'rgba(99,102,241,0.35)' : '#6366f1',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: (!allDone || confirming || hasFailed) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {confirming ? '처리 중…' : files.length > 0 ? `소스 ${files.filter(f=>f.status==='done').length}건으로 세계관 생성` : '세계관 생성 시작'}
        </button>
      </div>
    </div>
  );
}
