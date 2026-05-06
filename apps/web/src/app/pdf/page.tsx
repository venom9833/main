'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = 'http://localhost:8001/api/v1';

interface DocMeta {
  id: string;
  title: string;
  doc_type: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function PdfListPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/pdf-docs`)
      .then(r => r.json())
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('이 문서를 삭제하시겠습니까?')) return;
    await fetch(`${API}/pdf-docs/${id}`, { method: 'DELETE' });
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  return (
    <main style={{
      minHeight: 'calc(100vh - 92px)',
      padding: '2.5rem 2rem',
      maxWidth: 900,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'rgba(255,255,255,0.92)', margin: 0 }}>
            PDF 문서보관함
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.38)', marginTop: '0.3rem' }}>
            소스 기반 문서 목록
          </p>
        </div>
        <button
          onClick={() => router.push('/pdf/new')}
          style={{
            padding: '0.6rem 1.4rem',
            background: 'linear-gradient(135deg, #5ee7df, #3b82f6)',
            color: '#0b0e1a',
            border: 'none',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          + 새 문서
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: '4rem' }}>불러오는 중…</p>
      ) : docs.length === 0 ? (
        <div style={{
          textAlign: 'center', marginTop: '5rem',
          color: 'rgba(255,255,255,0.3)',
        }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📄</p>
          <p style={{ fontSize: '0.9rem' }}>저장된 문서가 없습니다</p>
          <button
            onClick={() => router.push('/pdf/new')}
            style={{
              marginTop: '1rem',
              padding: '0.55rem 1.2rem',
              background: 'rgba(94,231,223,0.1)',
              color: '#5ee7df',
              border: '1px solid rgba(94,231,223,0.25)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            첫 문서 만들기
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {docs.map(doc => (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.9rem 1.1rem',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onClick={() => router.push(`/pdf/new?id=${doc.id}`)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            >
              <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  margin: 0, fontSize: '0.93rem', fontWeight: 600,
                  color: 'rgba(255,255,255,0.88)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {doc.title || '제목 없음'}
                </p>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
                  {doc.doc_type} · {fmtDate(doc.updatedAt)}
                </p>
              </div>
              <span style={{
                fontSize: '0.7rem', padding: '0.15rem 0.55rem',
                borderRadius: '999px',
                background: doc.status === 'done' ? 'rgba(94,231,223,0.1)' : 'rgba(255,255,255,0.07)',
                color: doc.status === 'done' ? '#5ee7df' : 'rgba(255,255,255,0.4)',
                border: `1px solid ${doc.status === 'done' ? 'rgba(94,231,223,0.25)' : 'rgba(255,255,255,0.12)'}`,
                flexShrink: 0,
              }}>
                {doc.status === 'done' ? '완료' : '초안'}
              </span>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(doc.id); }}
                style={{
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.2)', cursor: 'pointer',
                  fontSize: '0.85rem', padding: '0.2rem 0.4rem',
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
