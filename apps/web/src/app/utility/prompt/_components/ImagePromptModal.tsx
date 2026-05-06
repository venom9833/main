'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { compilePrompt, extractDefaults } from './compilePrompt';
import type { ImgPromptItem, CatLabelMap } from './ImagePromptCard';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

type DetailData = {
  content: string;
  args: { name: string; default: string }[];
  image_url: string;
  notice?: string;
};

interface Props {
  item: ImgPromptItem;
  categoryLabels: CatLabelMap;
  onClose: () => void;
}

export default function ImagePromptModal({ item, categoryLabels, onClose }: Props) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 모바일 감지
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setValues({});
    setCopied(false);

    fetch(`${API_BASE}/api/v1/img-prompts/${item.master_no}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: DetailData) => {
        setDetail(data);
        setValues(extractDefaults(data.args));
        setDetailLoading(false);
      })
      .catch((e) => {
        setDetailError(`상세 정보를 불러올 수 없습니다 (${e.message})`);
        setDetailLoading(false);
      });
  }, [item.master_no]);

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const compiled = detail ? compilePrompt(detail.content, values) : '';

  function handleCopy() {
    if (!compiled) return;
    navigator.clipboard.writeText(compiled).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleChatGPT() {
    if (!compiled) return;
    window.open(
      'https://chat.openai.com/?q=' + encodeURIComponent(compiled),
      '_blank',
      'noopener,noreferrer'
    );
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/img-prompts/${item.master_no}/download`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.master_no}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('원본 다운로드 실패:', e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: isMobile ? '8px' : '20px',
        paddingTop: isMobile ? '60px' : '100px',
        overflowY: 'auto',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 900,
        maxHeight: isMobile ? 'calc(100vh - 68px)' : 'calc(100vh - 120px)',
        background: '#f8faff',
        borderRadius: isMobile ? 14 : 18,
        boxShadow: '0 32px 80px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            width: 42, height: 42, borderRadius: '50%',
            border: '2px solid rgba(220,38,38,0.35)',
            background: 'rgba(220,38,38,0.10)',
            cursor: 'pointer', fontSize: '1.1rem', color: 'rgba(220,38,38,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700,
          }}
          aria-label="모달 닫기"
        >
          ✕
        </button>

        {/* ── 썸네일 + 메타 영역 ── */}
        {isMobile ? (
          /* 모바일: 상/중/하 완전 세로 3단 */
          <div style={{
            display: 'flex', flexDirection: 'column',
            background: 'rgba(15,23,42,0.04)',
            borderBottom: '1px solid rgba(15,23,42,0.10)',
            flexShrink: 0,
          }}>
            {/* 상: 썸네일 */}
            {item.thumb_url ? (
              <img
                src={item.thumb_url}
                alt={item.title}
                style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: 140,
                background: 'rgba(94,231,223,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '3rem',
              }}>
                🖼️
              </div>
            )}

            {/* 중: #ID + ★추천 + 카테고리 */}
            <div style={{
              padding: '10px 14px 0',
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, color: '#0891b2',
                background: 'rgba(8,145,178,0.12)', padding: '3px 8px', borderRadius: 5,
                border: '1px solid rgba(8,145,178,0.25)', letterSpacing: '0.04em',
              }}>
                #{item.master_no}
              </span>
              {item.featured && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700,
                  background: 'rgba(248,184,77,0.18)', color: '#92400e',
                  padding: '3px 8px', borderRadius: 5,
                  border: '1px solid rgba(248,184,77,0.40)',
                }}>
                  ★ 추천
                </span>
              )}
              {item.categories.map((catId) => {
                const meta = categoryLabels[catId];
                return (
                  <span key={catId} style={{
                    fontSize: '0.65rem', color: 'rgba(15,23,42,0.6)',
                    background: 'rgba(15,23,42,0.07)', padding: '3px 8px', borderRadius: 5,
                    border: '1px solid rgba(15,23,42,0.12)',
                  }}>
                    {meta?.emoji && `${meta.emoji} `}{meta?.label ?? catId}
                  </span>
                );
              })}
            </div>

            {/* 하(메타): 타이틀 */}
            <div style={{ padding: '6px 14px 12px' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>
                {item.title}
              </div>
            </div>
          </div>
        ) : (
          /* 데스크탑: 기존 좌측 패널 */
          <div style={{
            width: 300, flexShrink: 0,
            background: 'rgba(15,23,42,0.04)',
            borderRight: '1px solid rgba(15,23,42,0.10)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            <div style={{ paddingTop: 20 }}>
              {item.thumb_url ? (
                <img
                  src={item.thumb_url}
                  alt={item.title}
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                />
              ) : (
                <div style={{
                  width: '100%', aspectRatio: '16/9',
                  background: 'rgba(94,231,223,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '3rem',
                }}>
                  🖼️
                </div>
              )}
            </div>

            <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 700, color: '#0891b2',
                  background: 'rgba(8,145,178,0.12)', padding: '3px 8px', borderRadius: 5,
                  border: '1px solid rgba(8,145,178,0.25)', letterSpacing: '0.04em',
                }}>
                  #{item.master_no}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {item.featured && (
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700,
                    background: 'rgba(248,184,77,0.18)', color: '#92400e',
                    padding: '2px 7px', borderRadius: 5,
                    border: '1px solid rgba(248,184,77,0.40)',
                  }}>
                    ★ 추천
                  </span>
                )}
                {item.categories.map((catId) => {
                  const meta = categoryLabels[catId];
                  return (
                    <span key={catId} style={{
                      fontSize: '0.65rem', color: 'rgba(15,23,42,0.6)',
                      background: 'rgba(15,23,42,0.07)', padding: '2px 7px', borderRadius: 5,
                      border: '1px solid rgba(15,23,42,0.12)',
                    }}>
                      {meta?.emoji && `${meta.emoji} `}{meta?.label ?? catId}
                    </span>
                  );
                })}
              </div>

              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.45 }}>
                {item.title}
              </div>

              {item.description && (
                <div style={{
                  fontSize: '0.75rem', color: 'rgba(15,23,42,0.55)', lineHeight: 1.6,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                  title={item.description}
                >
                  {item.description}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 우측/하단: Args 폼 + 미리보기 + 버튼 ── */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          padding: isMobile ? '16px 16px 20px' : '24px 24px 28px',
        }}>
          {detailLoading && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(15,23,42,0.4)', fontSize: '0.88rem',
            }}>
              불러오는 중…
            </div>
          )}

          {detailError && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.20)',
              fontSize: '0.80rem', color: 'rgba(185,28,28,0.85)', marginBottom: 16,
            }}>
              {detailError}
            </div>
          )}

          {detail && !detailLoading && (
            <>
              {detail.notice && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', marginBottom: 14, borderRadius: 10,
                  background: 'rgba(234,179,8,0.08)',
                  border: '1px solid rgba(234,179,8,0.35)',
                }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>📎</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'rgba(133,77,14,0.9)', lineHeight: 1.5 }}>
                    {detail.notice}
                  </span>
                </div>
              )}
              {detail.args.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 20,
                      background: 'rgba(8,145,178,0.10)',
                      border: '1px solid rgba(8,145,178,0.30)',
                      fontSize: '0.72rem', fontWeight: 700,
                      color: '#0891b2', letterSpacing: '0.04em',
                    }}>
                      ✏️ 변수 입력
                    </span>
                    <span style={{
                      fontSize: '0.72rem', color: 'rgba(15,23,42,0.45)',
                    }}>
                      값 수정 시 프롬프트에 즉시 반영됩니다
                    </span>
                  </div>
                  <table style={{
                    width: '100%', borderCollapse: 'collapse',
                    border: '1px solid rgba(15,23,42,0.13)',
                    borderRadius: 10, overflow: 'hidden',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}>
                    <tbody>
                      {detail.args.map((arg, idx) => (
                        <tr key={arg.name} style={{
                          borderBottom: idx < detail.args.length - 1
                            ? '1px solid rgba(15,23,42,0.10)' : 'none',
                        }}>
                          <td style={{
                            padding: '8px 10px',
                            width: '1%', minWidth: 0,
                            background: 'rgba(15,23,42,0.035)',
                            fontWeight: 600, color: 'rgba(15,23,42,0.65)',
                            verticalAlign: 'middle',
                            whiteSpace: 'nowrap',
                            borderRight: '1px solid rgba(15,23,42,0.10)',
                          }}>
                            {arg.name}
                          </td>
                          <td style={{ padding: '5px 8px', verticalAlign: 'middle' }}>
                            {item.master_no === 'IP0762' && arg.name === '문구모음' ? (
                              <textarea
                                rows={2}
                                defaultValue={arg.default}
                                placeholder={arg.default}
                                onChange={(e) =>
                                  setValues((prev) => ({ ...prev, [arg.name]: e.target.value }))
                                }
                                style={{
                                  width: '100%', padding: '6px 10px',
                                  borderRadius: 6, fontSize: 'inherit',
                                  border: '1px solid rgba(15,23,42,0.22)',
                                  background: '#fff',
                                  color: '#0f172a', outline: 'none',
                                  boxSizing: 'border-box' as const,
                                  resize: 'vertical',
                                  lineHeight: 1.6,
                                  transition: 'border-color 0.15s, box-shadow 0.15s',
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = 'rgba(8,145,178,0.6)';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(8,145,178,0.12)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(15,23,42,0.22)';
                                  e.target.style.boxShadow = 'none';
                                }}
                              />
                            ) : (
                              <input
                                type="text"
                                defaultValue={arg.default}
                                placeholder={arg.default}
                                onChange={(e) =>
                                  setValues((prev) => ({ ...prev, [arg.name]: e.target.value }))
                                }
                                style={{
                                  width: '100%', padding: '6px 10px',
                                  borderRadius: 6, fontSize: 'inherit',
                                  border: '1px solid rgba(15,23,42,0.22)',
                                  background: '#fff',
                                  color: '#0f172a', outline: 'none',
                                  boxSizing: 'border-box' as const,
                                  transition: 'border-color 0.15s, box-shadow 0.15s',
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = 'rgba(8,145,178,0.6)';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(8,145,178,0.12)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(15,23,42,0.22)';
                                  e.target.style.boxShadow = 'none';
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: 600, color: 'rgba(15,23,42,0.4)',
                  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
                }}>
                  프롬프트 미리보기
                </div>
                <pre style={{
                  margin: 0, padding: '12px 14px',
                  background: 'rgba(15,23,42,0.04)',
                  border: '1px solid rgba(15,23,42,0.10)',
                  borderRadius: 10,
                  fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
                  fontSize: isMobile ? '0.78rem' : '0.8rem', lineHeight: 1.75,
                  color: 'rgba(15,23,42,0.80)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word' as const,
                  maxHeight: isMobile ? 150 : 200, overflowY: 'auto',
                }}>
                  {compiled}
                </pre>
              </div>

              {/* 버튼: 모바일에서 전체 너비 */}
              <div style={{
                display: 'flex', gap: 8,
                flexDirection: isMobile ? 'column' : 'row',
                flexWrap: isMobile ? 'nowrap' : 'wrap',
              }}>
                <button
                  onClick={handleCopy}
                  style={{
                    padding: isMobile ? '12px 18px' : '8px 18px',
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: '0.88rem', fontWeight: 500, transition: 'all 0.15s',
                    border: copied ? '1px solid rgba(8,145,178,0.45)' : '1px solid rgba(15,23,42,0.18)',
                    background: copied ? 'rgba(8,145,178,0.1)' : 'rgba(15,23,42,0.06)',
                    color: copied ? '#0891b2' : 'rgba(15,23,42,0.70)',
                  }}
                >
                  {copied ? '✓ 복사됨' : '복사'}
                </button>

                <button
                  onClick={handleChatGPT}
                  style={{
                    padding: isMobile ? '12px 18px' : '8px 18px',
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: '0.88rem', fontWeight: 500, transition: 'all 0.15s',
                    border: '1px solid rgba(22,163,74,0.35)',
                    background: 'rgba(22,163,74,0.08)',
                    color: 'rgba(20,130,60,0.85)',
                  }}
                >
                  ChatGPT 바로 실행
                </button>


                <button
                  onClick={handleDownload}
                  disabled={downloading || !detail.image_url}
                  style={{
                    padding: isMobile ? '12px 18px' : '8px 18px',
                    borderRadius: 8,
                    cursor: (downloading || !detail.image_url) ? 'default' : 'pointer',
                    fontSize: '0.88rem', fontWeight: 500, transition: 'all 0.15s',
                    border: '1px solid rgba(79,70,229,0.35)',
                    background: (downloading || !detail.image_url)
                      ? 'rgba(79,70,229,0.03)' : 'rgba(79,70,229,0.08)',
                    color: (downloading || !detail.image_url)
                      ? 'rgba(79,70,229,0.35)' : 'rgba(55,48,163,0.85)',
                    opacity: downloading ? 0.7 : 1,
                  }}
                >
                  {downloading ? '다운로드 중…' : '원본 다운로드'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
