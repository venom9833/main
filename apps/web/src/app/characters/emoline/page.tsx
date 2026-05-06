// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeProps,
  type EdgeProps,
  type Node,
  type Edge,
  BackgroundVariant,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const API = 'http://localhost:8001/api/v1';

/* ── 타입 ── */
interface CharEntry {
  id: string;
  name: string;
  gender: string;
  age: number;
  age_group: string;
  occupation: string;
  family_group: string;
  relation: string;
  role: string;
  situations?: string[];
}

interface NodeData {
  id: string;
  name: string;
  age: number;
  gender: string;
  occupation: string;
  relation: string;
  role: string;
  familyColor: string;
  familyLabel: string;
  situations: string[];
  [key: string]: unknown;
}

/* ── 감정 타입 ── */
const EMOTION_TYPES = [
  { label: '로맨스',      color: '#db2777' },
  { label: '짝사랑',      color: '#9333ea' },
  { label: '착각',        color: '#7c3aed' },
  { label: '불륜',        color: '#dc2626' },
  { label: '금지된 감정', color: '#ea580c' },
  { label: '그리움·미련', color: '#0d9488' },
  { label: '위로·의지',   color: '#0369a1' },
  { label: '집착',        color: '#4f46e5' },
  { label: '경쟁·질투',   color: '#b45309' },
  { label: '가족',        color: '#059669' },
  { label: '적대',        color: '#6b7280' },
];

/* ── 가정 메타 ── */
const FAMILY_META: Record<string, { label: string; color: string }> = {
  family_park: { label: '박씨 가정', color: '#7c3aed' },
  family_kim:  { label: '김씨 가정', color: '#3b82f6' },
  family_choi: { label: '최씨 가정', color: '#10b981' },
  supporting:  { label: '주변 인물', color: '#a78bfa' },
};

const GROUP_ORDER = ['family_park', 'family_kim', 'family_choi', 'supporting'];

/* ── 자동 레이아웃 ── */
const COL_GAP  = 400;
const ROW_GAP  = 280;
const START_X  = 100;
const START_Y  = 80;
const SUP_COLS = 2;

function buildInitialNodes(chars: CharEntry[]): Node<NodeData>[] {
  const nodes: Node<NodeData>[] = [];
  const grouped: Record<string, CharEntry[]> = {};
  GROUP_ORDER.forEach(g => { grouped[g] = []; });
  chars.forEach(c => {
    const g = GROUP_ORDER.includes(c.family_group) ? c.family_group : 'supporting';
    grouped[g].push(c);
  });
  GROUP_ORDER.forEach(g => {
    grouped[g].sort((a, b) => {
      if (a.gender !== b.gender) return a.gender === 'male' ? -1 : 1;
      return a.age - b.age;
    });
  });

  let colIndex = 0;
  GROUP_ORDER.forEach(groupKey => {
    const members = grouped[groupKey];
    if (members.length === 0) return;
    const meta = FAMILY_META[groupKey];

    if (groupKey === 'supporting' && members.length > 5) {
      const half = Math.ceil(members.length / SUP_COLS);
      members.forEach((char, i) => {
        const col = colIndex + Math.floor(i / half);
        const row = i % half;
        nodes.push(makeNode(char, meta, START_X + col * COL_GAP, START_Y + row * ROW_GAP));
      });
      colIndex += SUP_COLS;
    } else {
      members.forEach((char, i) => {
        nodes.push(makeNode(char, meta, START_X + colIndex * COL_GAP, START_Y + i * ROW_GAP));
      });
      colIndex += 1;
    }
  });
  return nodes;
}

function makeNode(
  char: CharEntry,
  meta: { label: string; color: string },
  x: number,
  y: number,
): Node<NodeData> {
  return {
    id: char.id,
    type: 'characterNode',
    position: { x, y },
    data: {
      id: char.id,
      name: char.name,
      age: char.age,
      gender: char.gender,
      occupation: char.occupation,
      relation: char.relation,
      role: char.role,
      familyColor: meta.color,
      familyLabel: meta.label,
      situations: char.situations ?? [],
    },
  };
}

/* ── 캐릭터 노드 (Dark Liquid Glass) ── */
function CharacterNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isMale = d.gender === 'male';

  return (
    <div style={{
      background: isMale ? '#222222' : '#111111',
      backdropFilter: 'blur(16px)',
      border: `2px solid ${selected ? d.familyColor : 'rgba(255,255,255,0.1)'}`,
      borderRadius: 14,
      padding: '14px 16px',
      color: 'rgba(255,255,255,0.9)',
      width: 360,
      boxShadow: selected
        ? `0 8px 32px ${d.familyColor}40`
        : '0 4px 24px rgba(0,0,0,0.5)',
      transition: 'border-color 0.15s, box-shadow 0.15s',
    }}>
      <Handle type="target" position={Position.Left} style={{
        width: 12, height: 12,
        background: 'rgba(255,255,255,0.2)',
        border: '2px solid rgba(255,255,255,0.5)',
        left: -7,
      }} />

      {/* 가정 배지 */}
      <div style={{ marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', fontSize: 9, fontWeight: 700,
          background: d.familyColor, color: 'white',
          borderRadius: 6, padding: '2px 8px', letterSpacing: '0.05em',
        }}>{d.familyLabel}</span>
      </div>

      {/* 이름 + 나이 + 성별 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{d.name}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{d.age}세</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: isMale ? '#60a5fa' : '#f472b6' }}>
          {isMale ? '♂' : '♀'}
        </span>
      </div>

      {/* 관계 배지 */}
      <div style={{ marginBottom: 6 }}>
        <span style={{
          fontSize: 9, fontWeight: 600,
          color: isMale ? '#60a5fa' : '#f472b6',
          background: isMale ? 'rgba(96,165,250,0.1)' : 'rgba(244,114,182,0.1)',
          border: `1px solid ${isMale ? 'rgba(96,165,250,0.25)' : 'rgba(244,114,182,0.25)'}`,
          borderRadius: 4, padding: '1px 6px',
        }}>{d.relation}</span>
      </div>

      {/* 직업 */}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>{d.occupation}</div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginBottom: 8 }} />

      {/* 상황 목록 (읽기 전용) */}
      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
          📋 상황 {d.situations.length}개
        </div>
        {d.situations.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {d.situations.slice(0, 4).map((s, i) => (
              <li key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 2 }}>
                · {s}
              </li>
            ))}
            {d.situations.length > 4 && (
              <li style={{ fontSize: 9, color: 'rgba(167,139,250,0.5)', marginTop: 2 }}>
                +{d.situations.length - 4}개 더 — 클릭하면 전체 보기
              </li>
            )}
          </ul>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{
        width: 12, height: 12,
        background: d.familyColor,
        border: '2px solid white',
        right: -7,
      }} />
    </div>
  );
}

/* ── 감정 엣지 ── */
function EmotionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const { setEdges } = useReactFlow();
  const edgeData = data as { label: string; color: string } | undefined;
  const color = edgeData?.color ?? '#6b7280';
  const label = edgeData?.label ?? '';
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: color, strokeWidth: 2.5 }} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(10,10,25,0.92)',
            backdropFilter: 'blur(8px)',
            border: `1.5px solid ${color}`,
            borderRadius: 20, padding: '3px 10px 3px 8px',
            fontSize: 11, fontWeight: 600, color,
            boxShadow: `0 2px 12px ${color}33`,
            cursor: 'pointer',
          }}>
            <span>{label}</span>
            <button
              onClick={() => setEdges(eds => eds.filter(e => e.id !== id))}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', color: 'rgba(255,255,255,0.4)',
                fontSize: 13, padding: 0, lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { characterNode: CharacterNode };
const edgeTypes = { emotionEdge: EmotionEdge };

/* ── 감정선 선택 팝업 ── */
function EdgeTypePopup({ sourceLabel, targetLabel, onSelect, onCancel }: {
  sourceLabel: string; targetLabel: string;
  onSelect: (label: string, color: string) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(15,15,30,0.95)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16, padding: 24, zIndex: 1000,
        minWidth: 320, maxWidth: 400,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
          감정선 타입 선택
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
          {sourceLabel} → {targetLabel}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {EMOTION_TYPES.map(em => (
            <button
              key={em.label}
              onClick={() => onSelect(em.label, em.color)}
              style={{
                background: 'transparent',
                border: `1px solid ${em.color}`,
                borderRadius: 8, color: em.color,
                fontSize: 12, fontWeight: 600,
                padding: '5px 12px', cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = em.color;
                (e.currentTarget as HTMLButtonElement).style.color = '#fff';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = em.color;
              }}
            >{em.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, color: 'rgba(255,255,255,0.5)',
            fontSize: 12, padding: '5px 16px', cursor: 'pointer',
          }}>취소</button>
        </div>
      </div>
    </>
  );
}

/* ── 검증 모달 ── */
interface VerifyPreviewData {
  prompt: string;
  edge_count: number;
  edges: {
    sourceName: string; targetName: string;
    emotion: string; color: string;
    sourceSituations: string[]; targetSituations: string[];
  }[];
}

function VerifyModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<VerifyPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/emoline/preview`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(10,10,25,0.97)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16, padding: 28, zIndex: 1200,
        width: 600, maxHeight: '82vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>
            감정선 → Gemini 전달 검증
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}>×</button>
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '32px 0' }}>
            백엔드에서 실제 주입 내용 로딩 중...
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: '#ef4444', padding: '16px 0' }}>
            오류: {error}
          </div>
        )}

        {data && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 12 }}>
              감정선 {data.edge_count}개 — Supabase 저장 기준 실제 전달 내용
            </div>

            {data.edges.length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '24px 0' }}>
                감정선이 없습니다 — 캐릭터를 드래그해 연결하세요
              </div>
            )}

            {data.edges.map((e, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${e.color}44`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
                  <span style={{ color: e.color }}>●</span>{' '}
                  {e.sourceName} → {e.targetName}:{' '}
                  <span style={{ color: e.color }}>{e.emotion}</span>
                </div>
                {[
                  { name: e.sourceName, sits: e.sourceSituations },
                  { name: e.targetName, sits: e.targetSituations },
                ].filter(s => s.sits.length > 0).map(s => (
                  <div key={s.name} style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, marginBottom: 2 }}>
                      [{s.name} 현재 상황 — {s.sits.length}개]
                    </div>
                    {s.sits.map((sit, j) => (
                      <div key={j} style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, paddingLeft: 8 }}>
                        {j + 1}. {sit}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {data.prompt && (
              <>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  실제 Gemini 프롬프트 삽입 블록
                </div>
                <pre style={{
                  background: '#0a0a1a',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, padding: '12px 14px',
                  fontSize: 10, lineHeight: 1.7, color: '#e2e8f0',
                  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {data.prompt}
                </pre>
              </>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{
            background: '#7c3aed', color: 'white', border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700,
            padding: '7px 20px', cursor: 'pointer',
          }}>닫기</button>
        </div>
      </div>
    </>
  );
}

/* ── 캐릭터 상세 사이드 패널 ── */
function CharacterDetailPanel({ char, onClose, onSituationAdded }: {
  char: CharEntry;
  onClose: () => void;
  onSituationAdded: (charId: string, situations: string[]) => void;
}) {
  const isMale = char.gender === 'male';
  const accentColor = isMale ? '#60a5fa' : '#f472b6';
  const [addMode, setAddMode] = useState(false);
  const [newSit, setNewSit] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);

  const handleDelete = async (index: number) => {
    setDeletingIndex(index);
    setConfirmIndex(null);
    try {
      const res = await fetch(`${API}/characters/${char.id}/situations/${index}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        onSituationAdded(char.id, data.situations);
      }
    } finally {
      setDeletingIndex(null);
    }
  };

  const handleAdd = async () => {
    const text = newSit.trim();
    if (!text) return;
    setAdding(true);
    try {
      const res = await fetch(`${API}/characters/${char.id}/situations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation: text }),
      });
      if (res.ok) {
        const data = await res.json();
        onSituationAdded(char.id, data.situations);
        setNewSit('');
        setAddMode(false);
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 82, right: 0, bottom: 0,
      width: 380,
      background: 'rgba(10,10,25,0.97)',
      backdropFilter: 'blur(24px)',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      zIndex: 50,
      overflowY: 'auto',
      padding: '20px 20px 32px',
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{char.name}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{char.age}세</span>
          <span style={{ fontSize: 14, color: accentColor, fontWeight: 700 }}>{isMale ? '♂' : '♀'}</span>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, color: 'rgba(255,255,255,0.5)',
          fontSize: 16, width: 28, height: 28, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      {/* 기본 정보 */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, padding: '12px 14px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{char.occupation}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: accentColor,
            background: isMale ? 'rgba(96,165,250,0.1)' : 'rgba(244,114,182,0.1)',
            border: `1px solid ${isMale ? 'rgba(96,165,250,0.25)' : 'rgba(244,114,182,0.25)'}`,
            borderRadius: 4, padding: '1px 7px',
          }}>{char.relation}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{char.role}</span>
        </div>
      </div>

      {/* 전체 상황 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
            📋 현재 상황 — {char.situations?.length ?? 0}개 전체
          </div>
          {!addMode && (
            <button onClick={() => setAddMode(true)} style={{
              background: 'rgba(167,139,250,0.12)',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: 6, color: '#a78bfa',
              fontSize: 10, fontWeight: 700,
              padding: '3px 10px', cursor: 'pointer',
            }}>+ 상황 추가</button>
          )}
        </div>

        {/* 추가 입력 폼 */}
        {addMode && (
          <div style={{
            background: 'rgba(124,58,237,0.08)',
            border: '1px solid rgba(124,58,237,0.3)',
            borderRadius: 10, padding: '12px',
            marginBottom: 10,
          }}>
            <textarea
              autoFocus
              value={newSit}
              onChange={e => setNewSit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); }
                if (e.key === 'Escape') { setAddMode(false); setNewSit(''); }
              }}
              placeholder="새 상황을 입력하세요&#10;Enter로 추가, Shift+Enter로 줄바꿈"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(124,58,237,0.4)',
                borderRadius: 7, padding: '8px 10px',
                color: '#f1f5f9', fontSize: 11, lineHeight: 1.6,
                resize: 'vertical', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setAddMode(false); setNewSit(''); }} style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, color: 'rgba(255,255,255,0.4)',
                fontSize: 11, padding: '4px 12px', cursor: 'pointer',
              }}>취소</button>
              <button onClick={handleAdd} disabled={adding || !newSit.trim()} style={{
                background: newSit.trim() ? '#7c3aed' : 'rgba(124,58,237,0.3)',
                border: 'none', borderRadius: 6, color: 'white',
                fontSize: 11, fontWeight: 700,
                padding: '4px 16px', cursor: newSit.trim() ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}>{adding ? '추가 중…' : '추가'}</button>
            </div>
          </div>
        )}

        {(char.situations ?? []).length === 0 && !addMode && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '8px 0' }}>상황 없음</div>
        )}
        {(char.situations ?? []).map((s, i) => {
          const isSecret = s.startsWith('★ 투입된 비밀:');
          const leftColor = confirmIndex === i ? '#dc2626' : isSecret ? '#ef4444' : i === 0 ? accentColor : 'rgba(255,255,255,0.1)';
          const bgColor = confirmIndex === i ? 'rgba(220,38,38,0.08)' : isSecret ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)';
          const borderColor = confirmIndex === i ? 'rgba(220,38,38,0.35)' : isSecret ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)';
          const textColor = isSecret ? '#fca5a5' : i === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)';
          return (
          <div key={i}>
            <div style={{
              background: bgColor,
              border: `1px solid ${borderColor}`,
              borderLeft: `3px solid ${leftColor}`,
              borderRadius: '0 8px 8px 0',
              padding: '8px 10px 8px 12px',
              marginBottom: confirmIndex === i ? 2 : 6,
              fontSize: 11,
              color: textColor,
              lineHeight: 1.65,
              display: 'flex', alignItems: 'flex-start', gap: 6,
              transition: 'all 0.15s',
            }}>
              <span style={{ color: isSecret ? '#ef4444' : accentColor, fontWeight: 700, fontSize: 10, flexShrink: 0, paddingTop: 1 }}>{i + 1}</span>
              <span style={{ flex: 1 }}>
                {isSecret ? (
                  <>
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>★ 투입된 비밀: </span>
                    {s.replace('★ 투입된 비밀:', '').trim()}
                  </>
                ) : s}
              </span>
              <button
                onClick={() => setConfirmIndex(confirmIndex === i ? null : i)}
                disabled={deletingIndex === i}
                style={{
                  background: 'none', border: 'none',
                  color: confirmIndex === i ? '#dc2626' : 'rgba(255,255,255,0.2)',
                  fontSize: 13, cursor: 'pointer', padding: '0 2px',
                  flexShrink: 0, lineHeight: 1,
                  transition: 'color 0.15s',
                }}
              >{deletingIndex === i ? '…' : '×'}</button>
            </div>

            {/* 삭제 확인 */}
            {confirmIndex === i && (
              <div style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: '0 0 8px 8px',
                padding: '8px 12px',
                marginBottom: 6,
                fontSize: 10,
              }}>
                {i === 0 && !isSecret && (
                  <div style={{ color: '#fca5a5', marginBottom: 6, lineHeight: 1.5 }}>
                    ⚠️ 1번 상황은 대본 생성 프롬프트에 직접 주입됩니다. 삭제하면 다음 상황이 1번이 됩니다.
                  </div>
                )}
                {isSecret && (
                  <div style={{ color: '#fca5a5', marginBottom: 6, lineHeight: 1.5 }}>
                    ★ 투입된 비밀을 삭제합니다. 이후 대본 생성 시 비밀이 반영되지 않습니다.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => setConfirmIndex(null)} style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 5, color: 'rgba(255,255,255,0.4)',
                    fontSize: 10, padding: '3px 10px', cursor: 'pointer',
                  }}>취소</button>
                  <button onClick={() => handleDelete(i)} style={{
                    background: '#dc2626', border: 'none',
                    borderRadius: 5, color: 'white',
                    fontSize: 10, fontWeight: 700,
                    padding: '3px 12px', cursor: 'pointer',
                  }}>삭제</button>
                </div>
              </div>
            )}
          </div>
        );
        })}
      </div>
    </div>
  );
}

/* ── 메인 플로우 ── */
function CharactersEmolineFlow() {
  const [chars, setChars]           = useState<CharEntry[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pendingConn, setPendingConn] = useState<{ connection: Connection; sourceLabel: string; targetLabel: string } | null>(null);
  const [showVerify, setShowVerify]  = useState(false);
  const [saveStatus, setSaveStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loaded, setLoaded]          = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedChar = selectedCharId ? (chars.find(c => c.id === selectedCharId) ?? null) : null;

  const handleSituationAdded = useCallback((charId: string, situations: string[]) => {
    setChars(prev => prev.map(c => c.id === charId ? { ...c, situations } : c));
    setNodes(prev => prev.map(n =>
      n.id === charId
        ? { ...n, data: { ...(n.data as NodeData), situations } }
        : n
    ));
  }, [setNodes]);

  const charNameMap: Record<string, string> = chars.reduce<Record<string, string>>((acc, c) => {
    acc[c.id] = c.name;
    return acc;
  }, {});
  const situationsMap: Record<string, string[]> = chars.reduce<Record<string, string[]>>((acc, c) => {
    acc[c.id] = c.situations ?? [];
    return acc;
  }, {});

  /* 캐릭터 + 저장된 감정선 + 노드 위치 로드 (초기 + 새로고침 공용) */
  const loadData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    Promise.all([
      fetch(`${API}/characters`).then(r => r.ok ? r.json() : []),
      fetch(`${API}/emoline`).then(r => r.ok ? r.json() : { edges: [], node_positions: [] }),
    ]).then(([charData, emolineData]) => {
      const charList = charData as CharEntry[];
      setChars(charList);
      const savedPositions: { id: string; x: number; y: number }[] = emolineData.node_positions ?? [];
      const posMap = Object.fromEntries(savedPositions.map(p => [p.id, { x: p.x, y: p.y }]));
      const initialNodes = buildInitialNodes(charList).map(n => ({
        ...n,
        position: posMap[n.id] ?? n.position,
      }));
      setNodes(initialNodes);
      const savedEdges: Edge[] = (emolineData.edges ?? []);
      setEdges(savedEdges);
      setLoaded(true);
      if (isRefresh) {
        setSelectedCharId(null);
        setTimeout(() => setRefreshing(false), 400);
      }
    });
  }, [setNodes, setEdges]);

  useEffect(() => { loadData(); }, []);

  /* 자동 저장 (디바운스 800ms) — edges 변경 시만 */
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus('saving');
      const nodePositions = nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }));
      fetch(`${API}/emoline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edges, node_positions: nodePositions }),
      })
        .then(r => r.ok ? setSaveStatus('saved') : setSaveStatus('error'))
        .catch(() => setSaveStatus('error'))
        .finally(() => setTimeout(() => setSaveStatus('idle'), 2000));
    }, 800);
  }, [edges, loaded]);

  const onConnect = useCallback((connection: Connection) => {
    const srcName = charNameMap[connection.source ?? ''] ?? '';
    const tgtName = charNameMap[connection.target ?? ''] ?? '';
    setPendingConn({ connection, sourceLabel: srcName, targetLabel: tgtName });
  }, [charNameMap]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedCharId(prev => prev === node.id ? null : node.id);
  }, []);

  const handleSelectEmotion = useCallback((label: string, color: string) => {
    if (!pendingConn) return;
    setEdges(eds => addEdge({
      ...pendingConn.connection,
      id: `${pendingConn.connection.source}-${pendingConn.connection.target}-${Date.now()}`,
      type: 'emotionEdge', data: { label, color }, animated: false,
    }, eds));
    setPendingConn(null);
  }, [pendingConn, setEdges]);

  const handleSaveNow = () => {
    setSaveStatus('saving');
    const nodePositions = nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }));
    fetch(`${API}/emoline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edges, node_positions: nodePositions }),
    })
      .then(r => r.ok ? setSaveStatus('saved') : setSaveStatus('error'))
      .catch(() => setSaveStatus('error'))
      .finally(() => setTimeout(() => setSaveStatus('idle'), 2000));
  };

  const saveLabel = saveStatus === 'saving' ? '저장 중…'
    : saveStatus === 'saved'  ? '✓ 저장됨'
    : saveStatus === 'error'  ? '저장 실패'
    : '저장';

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 82px)', marginTop: 82, overflow: 'hidden' }}>
      {selectedChar && (
        <CharacterDetailPanel
          char={selectedChar}
          onClose={() => setSelectedCharId(null)}
          onSituationAdded={handleSituationAdded}
        />
      )}
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={{ padding: 0.1 }}
        style={{ background: 'linear-gradient(135deg, #07071a 0%, #0d0d23 50%, #070718 100%)' }}
        connectionLineStyle={{ stroke: '#7c3aed', strokeWidth: 2.5 }}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(167,139,250,0.15)" />
        <Controls
          position="top-right"
          style={{
            marginTop: 12,
            marginRight: selectedChar ? 392 : 12,
            transition: 'margin-right 0.2s',
          }}
        />

        {/* 상단 툴바 */}
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 8, zIndex: 10, alignItems: 'center',
        }}>
          <span style={{
            fontSize: 11, color: 'rgba(255,255,255,0.4)',
            background: 'rgba(15,15,30,0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '4px 14px', borderRadius: 20,
          }}>
            {chars.length}명 · 노드를 드래그해 연결
          </span>

          <span style={{
            fontSize: 11, color: 'rgba(255,255,255,0.5)',
            background: 'rgba(15,15,30,0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '4px 14px', borderRadius: 20,
          }}>
            감정선 {edges.length}개
          </span>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="캐릭터 상황·비밀 투입 내용을 최신으로 갱신"
            style={{
              background: 'rgba(15,15,30,0.85)',
              backdropFilter: 'blur(12px)',
              color: refreshing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 20, fontSize: 14,
              padding: '4px 12px', cursor: refreshing ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              transition: 'color 0.2s',
            }}
          >
            <span style={{
              display: 'inline-block',
              animation: refreshing ? 'spin 0.6s linear infinite' : 'none',
            }}>↻</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {refreshing ? '갱신 중…' : '갱신'}
            </span>
          </button>
          <style>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

            .react-flow__controls {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .react-flow__controls-button {
              background: rgba(15,15,30,0.85) !important;
              border: 1px solid rgba(255,255,255,0.12) !important;
              border-radius: 8px !important;
              width: 28px !important;
              height: 28px !important;
              color: rgba(255,255,255,0.6) !important;
              fill: rgba(255,255,255,0.6) !important;
              backdrop-filter: blur(12px);
              transition: background 0.15s, border-color 0.15s;
            }
            .react-flow__controls-button:hover {
              background: rgba(124,58,237,0.4) !important;
              border-color: rgba(124,58,237,0.6) !important;
              fill: rgba(255,255,255,0.95) !important;
            }
            .react-flow__controls-button svg {
              fill: inherit;
              max-width: 12px;
              max-height: 12px;
            }
          `}</style>

          <button
            onClick={() => setShowVerify(true)}
            style={{
              background: 'rgba(15,15,30,0.85)',
              backdropFilter: 'blur(12px)',
              color: '#a78bfa',
              border: '1.5px solid #7c3aed',
              borderRadius: 20, fontSize: 12, fontWeight: 700,
              padding: '6px 18px', cursor: 'pointer',
            }}
          >🔍 전달 검증</button>

          <button
            onClick={handleSaveNow}
            disabled={saveStatus === 'saving'}
            style={{
              background: saveStatus === 'saved' ? 'rgba(16,185,129,0.8)' : 'rgba(124,58,237,0.85)',
              backdropFilter: 'blur(12px)',
              color: 'white', border: 'none',
              borderRadius: 20, fontSize: 12, fontWeight: 700,
              padding: '6px 20px', cursor: saveStatus === 'saving' ? 'default' : 'pointer',
              transition: 'background 0.2s',
            }}
          >{saveLabel}</button>
        </div>

        {/* 감정 타입 범례 — 상단 좌측 */}
        <div style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(10,10,25,0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: '10px 14px', zIndex: 10,
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 6, letterSpacing: '0.08em' }}>감정 타입</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' }}>
            {EMOTION_TYPES.map(em => (
              <div key={em.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: em.color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: em.color, fontWeight: 500 }}>{em.label}</span>
              </div>
            ))}
          </div>
        </div>

        {showVerify && (
          <VerifyModal
            onClose={() => setShowVerify(false)}
          />
        )}

        {pendingConn && (
          <EdgeTypePopup
            sourceLabel={pendingConn.sourceLabel}
            targetLabel={pendingConn.targetLabel}
            onSelect={handleSelectEmotion}
            onCancel={() => setPendingConn(null)}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export default function CharactersEmolinePage() {
  return (
    <ReactFlowProvider>
      <CharactersEmolineFlow />
    </ReactFlowProvider>
  );
}
