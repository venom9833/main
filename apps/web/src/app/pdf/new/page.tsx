'use client';
import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import './pdf-styles.css';

const API = 'http://localhost:8001/api/v1';
const ACCEPT = '.txt,.srt,.vtt,.pdf,.md';

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface SourceFile {
  file: File;
  // pending: 방금 추가됨(useEffect 추출 대기) / extracting: 서버 요청 중
  // done: 추출 완료 / error: 추출 실패
  status: 'pending' | 'ready' | 'extracting' | 'done' | 'error';
  text: string;
  chars: number;
  error?: string;
}

interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  chapter_suggestion: number;
}

// ── 마크다운 렌더러 ────────────────────────────────────────────────────────────

function parseBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p
  );
}

function RenderMd({ md }: { md: string }) {
  return (
    <>
      {md.split(/\n\n+/).map((block, i) => {
        const t = block.trim();
        if (!t) return null;
        if (t.startsWith('## ')) return <h2 key={i} className="pdf-h2">{t.slice(3)}</h2>;
        if (t.startsWith('# '))  return <h1 key={i} className="pdf-h1">{t.slice(2)}</h1>;
        if (t.startsWith('### ')) return <h3 key={i} className="pdf-h3">{t.slice(4)}</h3>;
        if (t.match(/^[-*] /)) {
          const items = t.split('\n').filter(l => l.match(/^[-*] /));
          return (
            <ul key={i} className="pdf-ul">
              {items.map((item, j) => <li key={j}>{parseBold(item.slice(2))}</li>)}
            </ul>
          );
        }
        return <p key={i} className="pdf-p">{parseBold(t)}</p>;
      })}
    </>
  );
}

function A4Page({ content, pageNum, total }: { content: string; pageNum: number; total: number }) {
  return (
    <div className="pdf-page">
      <RenderMd md={content} />
      <div className="pdf-footer">
        <span className="pdf-footer-num">{pageNum} / {total}</span>
      </div>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

function PdfNewPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docId = searchParams.get('id');

  const [sources, setSources] = useState<SourceFile[]>([]);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [chapterCount, setChapterCount] = useState(0);
  const [usePaidAi, setUsePaidAi] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'nlm' | 'revising' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [reviseInstruction, setReviseInstruction] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API}/pdf-docs/templates`)
      .then(r => r.json())
      .then((list: Template[]) => {
        setTemplates(list);
        if (list.length > 0 && !templateId) setTemplateId(list[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!docId) return;
    fetch(`${API}/pdf-docs/${docId}`)
      .then(r => r.json())
      .then(doc => {
        setTitle(doc.title || '');
        setContent(doc.content || '');
        splitPages(doc.content || '');
        setPhase('done');
      })
      .catch(() => {});
  }, [docId]);

  function splitPages(md: string) {
    setPages(md.split(/\n---\n|\n---$|^---\n/).map(p => p.trim()).filter(Boolean));
  }

  // extractFile: useCallback으로 메모이제이션하여 불필요한 재생성 방지
  // idx 기반으로 sources 배열의 특정 항목 상태를 갱신
  const extractFile = useCallback(async (file: File, idx: number) => {
    // 해당 인덱스 항목을 "추출 중" 상태로 변경
    setSources(prev => prev.map((s, i) => i === idx ? { ...s, status: 'extracting' } : s));
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/pdf-docs/upload-source`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || '추출 실패');
      // 추출 성공 — 텍스트와 글자 수 저장
      setSources(prev => prev.map((s, i) =>
        i === idx ? { ...s, status: 'done', text: data.text, chars: data.chars } : s
      ));
    } catch (e: unknown) {
      // 추출 실패 — 에러 메시지 저장
      setSources(prev => prev.map((s, i) =>
        i === idx ? { ...s, status: 'error', error: e instanceof Error ? e.message : '오류' } : s
      ));
    }
  }, []); // API 주소는 모듈 상수라 deps 불필요

  // addFiles: 파일 추가만 담당 — 추출은 useEffect가 처리
  // setTimeout 패턴 제거: setSources 콜백 안에서 비동기 함수를 호출하면
  // 인덱스 계산 시점과 실제 상태 업데이트 시점이 달라 경쟁 조건이 생김
  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    // 새 파일을 'pending' 상태로 추가 — useEffect가 추출을 시작
    const newFiles: SourceFile[] = Array.from(fileList).map(f => ({
      file: f, status: 'pending', text: '', chars: 0,
    }));
    setSources(prev => {
      const next = [...prev, ...newFiles];
      // 첫 번째 파일 이름으로 제목 자동 완성 (제목이 비어있을 때만)
      if (!title.trim() && next.length > 0) {
        setTitle(next[0].file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim());
      }
      return next;
    });
  }, [title]); // title은 자동 완성 조건에 사용

  // useEffect: status === 'pending' 항목을 감지해 순서대로 extractFile 호출
  // setSources 완료 후 React가 sources를 업데이트한 뒤 이 effect가 실행되므로
  // 인덱스가 항상 정확하게 보장됨 (경쟁 조건 없음)
  useEffect(() => {
    sources.forEach((s, idx) => {
      if (s.status === 'pending') {
        extractFile(s.file, idx);
      }
    });
  }, [sources, extractFile]);

  // onDrop: addFiles를 deps에 포함해 stale closure 방지
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  function removeSource(idx: number) {
    setSources(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleGenerate() {
    const ready = sources.filter(s => s.status === 'done' && s.text.trim());
    if (ready.length === 0) { setError('소스 파일을 먼저 업로드해 주세요'); return; }
    if (!title.trim()) { setError('제목을 입력해 주세요'); return; }
    setError(null);
    setPhase('generating');
    try {
      const res = await fetch(`${API}/pdf-docs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          sources: ready.map(s => ({ filename: s.file.name, text: s.text })),
          doc_type: templates.find(t => t.id === templateId)?.name || '문서형',
          chapter_count: chapterCount,
          use_paid_ai: usePaidAi,
          template_id: templateId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || '생성 실패');
      setContent(data.content);
      splitPages(data.content);
      setPhase('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '생성 오류');
      setPhase('idle');
    }
  }

  async function handleGenerateNlm() {
    const ready = sources.filter(s => s.status === 'done' && s.text.trim());
    if (ready.length === 0) { setError('소스 파일을 먼저 업로드해 주세요'); return; }
    if (!title.trim()) { setError('제목을 입력해 주세요'); return; }
    setError(null);
    setPhase('nlm');
    try {
      const res = await fetch(`${API}/pdf-docs/generate-with-nlm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          sources: ready.map(s => ({ filename: s.file.name, text: s.text })),
          doc_type: templates.find(t => t.id === templateId)?.name || '문서형',
          chapter_count: chapterCount,
          use_paid_ai: usePaidAi,
          template_id: templateId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || 'NLM 생성 실패');
      setContent(data.content);
      splitPages(data.content);
      setPhase('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'NLM 생성 오류');
      setPhase('idle');
    }
  }

  async function handleSave() {
    if (!content.trim()) return;
    const id = docId || crypto.randomUUID();
    await fetch(`${API}/pdf-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, doc_type: templates.find(t => t.id === templateId)?.name || '문서형', content, status: 'done' }),
    });
    router.push('/pdf');
  }

  async function handleRevise() {
    if (!content.trim() || !reviseInstruction.trim()) return;
    setError(null);
    setPhase('revising');
    try {
      const res = await fetch(`${API}/pdf-docs/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          instruction: reviseInstruction,
          doc_type: templates.find(t => t.id === templateId)?.name || '문서형',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || '수정 실패');
      setContent(data.content);
      splitPages(data.content);
      setReviseInstruction('');
      setPhase('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '수정 오류');
      setPhase('done');
    }
  }

  function handleDownloadMd() {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allDone = sources.length > 0 && sources.every(s => s.status === 'done' || s.status === 'error');
  const readyCount = sources.filter(s => s.status === 'done').length;
  const busy = phase === 'generating' || phase === 'nlm' || phase === 'revising';
  const nlmBusy = phase === 'nlm';
  const revising = phase === 'revising';
  // pending(추출 대기) 또는 extracting(서버 요청 중) 상태가 있으면 아직 추출 진행 중
  const extracting = sources.some(s => s.status === 'extracting' || s.status === 'pending');
  const totalChars = sources.filter(s => s.status === 'done').reduce((sum, s) => sum + s.chars, 0);
  const overLimit = totalChars > 12000;

  return (
    <>
      <div style={{ display: 'flex', height: 'calc(100vh - 92px)', overflow: 'hidden' }}>

        {/* ── 컨트롤 패널 ── */}
        <div className="pdf-controls" style={{
          width: 320, flexShrink: 0,
          background: 'rgba(7,8,15,0.75)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          overflowY: 'auto',
          padding: '1.4rem 1.1rem',
          display: 'flex', flexDirection: 'column', gap: '0.9rem',
        }}>
          <p style={{ fontSize: '0.68rem', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', margin: 0 }}>
            PDF 문서 만들기
          </p>

          {/* ── 드래그앤드롭 업로드 존 ── */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !busy && inputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? '#5ee7df' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '12px',
              padding: '1rem 0.8rem',
              textAlign: 'center',
              cursor: busy ? 'default' : 'pointer',
              background: dragging ? 'rgba(94,231,223,0.05)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.18s',
            }}
          >
            <p style={{ fontSize: '1.4rem', margin: '0 0 0.25rem' }}>📂</p>
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
              소스 파일 드래그 또는 클릭
            </p>
            <p style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.22)', margin: '0.25rem 0 0' }}>
              TXT · SRT · VTT · PDF · MD · 다중 선택 가능
            </p>
            <input ref={inputRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
              onChange={e => addFiles(e.target.files)} />
          </div>

          {/* ── 소스 파일 목록 ── */}
          {sources.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <p style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', margin: 0 }}>
                소스 {sources.length}개 · 준비 {readyCount}개
              </p>
              {sources.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.45rem 0.7rem',
                  borderRadius: '8px',
                  background: s.status === 'error'
                    ? 'rgba(239,68,68,0.07)'
                    : s.status === 'done'
                    ? 'rgba(94,231,223,0.06)'
                    : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${
                    s.status === 'error' ? 'rgba(239,68,68,0.2)'
                    : s.status === 'done' ? 'rgba(94,231,223,0.18)'
                    : 'rgba(255,255,255,0.08)'}`,
                }}>
                  <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>
                    {/* pending/extracting 모두 대기 아이콘 표시 */}
                    {(s.status === 'extracting' || s.status === 'pending') ? '⏳'
                      : s.status === 'done' ? '✅'
                      : s.status === 'error' ? '❌'
                      : '📄'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: '0.78rem', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: s.status === 'error' ? '#f87171' : 'rgba(255,255,255,0.82)',
                    }}>
                      {s.file.name}
                    </p>
                    <p style={{ margin: '0.05rem 0 0', fontSize: '0.64rem', color: 'rgba(255,255,255,0.28)' }}>
                      {s.status === 'done'
                        ? `${s.chars.toLocaleString()}자 추출`
                        : s.status === 'error'
                        ? s.error
                        : (s.status === 'extracting' || s.status === 'pending')
                        ? '추출 중…'
                        : `${(s.file.size / 1024).toFixed(0)} KB`}
                    </p>
                  </div>
                  {!busy && (
                    <button onClick={() => removeSource(i)} style={{
                      background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.22)', cursor: 'pointer',
                      fontSize: '0.78rem', padding: '0.1rem 0.2rem', flexShrink: 0,
                    }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── 12,000자 초과 경고 ── */}
          {overLimit && (
            <div style={{
              padding: '0.45rem 0.75rem', borderRadius: '8px',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              color: '#fbbf24', fontSize: '0.73rem', lineHeight: 1.5,
            }}>
              소스 합계 {totalChars.toLocaleString()}자 — 12,000자 초과분은 AI 처리에서 제외됩니다
            </div>
          )}

          {/* ── 제목 ── */}
          <div>
            <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.25rem' }}>
              문서 제목
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="제목 입력"
              disabled={busy}
              style={{
                width: '100%', padding: '0.55rem 0.8rem',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.88rem', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* ── 템플릿 선택 ── */}
          {templates.length > 0 && (
            <div>
              <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.4rem' }}>
                문서 템플릿
              </label>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {templates.map(t => {
                  const active = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => !busy && setTemplateId(t.id)}
                      disabled={busy}
                      title={t.description}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '999px',
                        border: `1px solid ${active ? 'rgba(94,231,223,0.45)' : 'rgba(255,255,255,0.09)'}`,
                        background: active ? 'rgba(94,231,223,0.09)' : 'rgba(255,255,255,0.025)',
                        color: active ? '#5ee7df' : 'rgba(255,255,255,0.52)',
                        fontSize: '0.76rem',
                        fontWeight: active ? 700 : 400,
                        cursor: busy ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              {templateId && (
                <p style={{ fontSize: '0.64rem', color: 'rgba(255,255,255,0.22)', margin: '0.35rem 0 0', lineHeight: 1.4 }}>
                  {templates.find(t => t.id === templateId)?.description}
                </p>
              )}
            </div>
          )}

          {/* ── 챕터 수 ── */}
          <div>
            <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.25rem' }}>
              챕터 수 <span style={{ color: 'rgba(255,255,255,0.2)' }}>(0 = 자동)</span>
            </label>
            <input
              type="number" min={0} max={20}
              value={chapterCount}
              onChange={e => setChapterCount(Number(e.target.value))}
              disabled={busy}
              style={{
                width: '100%', padding: '0.55rem 0.8rem',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.88rem', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* ── AI 도움 토글 ── */}
          <div
            onClick={() => !busy && setUsePaidAi(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.6rem 0.85rem',
              borderRadius: '10px',
              border: `1px solid ${usePaidAi ? 'rgba(180,144,245,0.4)' : 'rgba(255,255,255,0.1)'}`,
              background: usePaidAi ? 'rgba(180,144,245,0.08)' : 'rgba(255,255,255,0.03)',
              cursor: busy ? 'default' : 'pointer',
              transition: 'all 0.18s',
              userSelect: 'none',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: '0.83rem', fontWeight: 600, color: usePaidAi ? '#b490f5' : 'rgba(255,255,255,0.6)' }}>
                AI 도움
              </p>
              <p style={{ margin: '0.08rem 0 0', fontSize: '0.64rem', color: 'rgba(255,255,255,0.26)', lineHeight: 1.4 }}>
                {usePaidAi ? 'Gemini Pro — 고품질 재구성' : 'Cerebras 무료 — 기본 원칙 적용'}
              </p>
            </div>
            <div style={{
              width: 36, height: 20, borderRadius: 999,
              background: usePaidAi ? '#b490f5' : 'rgba(255,255,255,0.15)',
              position: 'relative', flexShrink: 0, transition: 'background 0.2s',
            }}>
              <div style={{
                position: 'absolute',
                top: 3, left: usePaidAi ? 18 : 3,
                width: 14, height: 14,
                borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </div>
          </div>

          {/* ── 에러 ── */}
          {error && (
            <div style={{
              padding: '0.5rem 0.75rem', borderRadius: '8px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)',
              color: '#f87171', fontSize: '0.78rem',
            }}>
              {error}
            </div>
          )}

          {/* ── 생성 버튼 ── */}
          <button
            onClick={handleGenerate}
            disabled={busy || extracting || readyCount === 0}
            style={{
              width: '100%', padding: '0.78rem',
              background: busy || extracting || readyCount === 0
                ? 'rgba(94,231,223,0.15)'
                : 'linear-gradient(135deg, #5ee7df 0%, #3b82f6 100%)',
              color: busy || extracting || readyCount === 0
                ? 'rgba(255,255,255,0.35)' : '#0b0e1a',
              border: 'none', borderRadius: '10px',
              fontSize: '0.93rem', fontWeight: 700,
              cursor: busy || extracting || readyCount === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {phase === 'generating' ? 'AI 문서 생성 중…'
              : extracting ? `소스 읽는 중… (${readyCount}/${sources.length})`
              : readyCount > 0 ? `소스 ${readyCount}개로 문서 생성`
              : '문서 생성'}
          </button>

          {/* ── NLM 생성 버튼 ── */}
          <button
            onClick={handleGenerateNlm}
            disabled={busy || extracting || readyCount === 0}
            style={{
              width: '100%', padding: '0.65rem',
              background: nlmBusy
                ? 'rgba(94,231,223,0.08)'
                : busy || extracting || readyCount === 0
                ? 'rgba(94,231,223,0.04)'
                : 'rgba(94,231,223,0.1)',
              color: busy || extracting || readyCount === 0
                ? 'rgba(94,231,223,0.25)' : '#5ee7df',
              border: `1px solid ${busy || extracting || readyCount === 0 ? 'rgba(94,231,223,0.1)' : 'rgba(94,231,223,0.3)'}`,
              borderRadius: '10px',
              fontSize: '0.84rem', fontWeight: 600,
              cursor: busy || extracting || readyCount === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {nlmBusy ? 'NotebookLM 분석 중… (~30초)' : '🔬 소스 주입 → 문서 생성'}
          </button>
          <p style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.18)', margin: '-0.4rem 0 0', textAlign: 'center' }}>
            소스 → NotebookLM 종합 → 문서 생성
          </p>

          {/* ── 저장 / 다운로드 / 인쇄 ── */}
          {phase === 'done' && content && (
            <>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={handleSave} style={{
                  flex: 1, padding: '0.55rem',
                  background: 'rgba(180,144,245,0.12)', color: '#b490f5',
                  border: '1px solid rgba(180,144,245,0.3)',
                  borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                }}>저장</button>
                <button onClick={handleDownloadMd} style={{
                  flex: 1, padding: '0.55rem',
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                }}>MD 다운</button>
              </div>
              <button onClick={() => window.print()} style={{
                width: '100%', padding: '0.6rem',
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              }}>
                🖨️ 인쇄 / PDF 저장
              </button>

              {/* ── AI 수정 ── */}
              <div style={{
                marginTop: '0.2rem',
                padding: '0.75rem',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>
                  AI 수정
                </p>
                <textarea
                  value={reviseInstruction}
                  onChange={e => setReviseInstruction(e.target.value)}
                  placeholder="수정 지시 입력 (예: 3챕터를 더 구체적으로 보강해 줘)"
                  disabled={revising}
                  rows={3}
                  style={{
                    width: '100%', padding: '0.55rem 0.7rem',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: '0.78rem', outline: 'none', resize: 'vertical',
                    boxSizing: 'border-box', lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={handleRevise}
                  disabled={revising || !reviseInstruction.trim()}
                  style={{
                    marginTop: '0.4rem',
                    width: '100%', padding: '0.55rem',
                    background: revising || !reviseInstruction.trim()
                      ? 'rgba(94,231,223,0.06)'
                      : 'rgba(94,231,223,0.12)',
                    color: revising || !reviseInstruction.trim()
                      ? 'rgba(94,231,223,0.3)' : '#5ee7df',
                    border: `1px solid ${revising || !reviseInstruction.trim() ? 'rgba(94,231,223,0.1)' : 'rgba(94,231,223,0.3)'}`,
                    borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
                    cursor: revising || !reviseInstruction.trim() ? 'not-allowed' : 'pointer',
                    transition: 'all 0.18s',
                  }}
                >
                  {revising ? 'AI 수정 중…' : '✦ AI 수정 적용'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── A4 미리보기 ── */}
        <div className="pdf-workspace" style={{
          flex: 1,
          background: '#c8c8c8',
          overflowY: 'auto',
          padding: '2rem',
        }}>
          {pages.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', flexDirection: 'column', gap: '0.75rem',
              color: 'rgba(0,0,0,0.3)',
            }}>
              <p style={{ fontSize: '2.5rem', margin: 0 }}>📄</p>
              <p style={{ fontSize: '0.9rem', margin: 0 }}>
                소스 파일을 업로드하고 문서 생성을 누르면 A4 미리보기가 표시됩니다
              </p>
            </div>
          ) : (
            pages.map((pageContent, i) => (
              <A4Page key={i} content={pageContent} pageNum={i + 1} total={pages.length} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

export default function PdfNewPage() {
  return (
    <Suspense fallback={null}>
      <PdfNewPageInner />
    </Suspense>
  );
}
