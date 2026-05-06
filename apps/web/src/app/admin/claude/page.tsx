'use client';

import { useEffect, useState, useCallback } from 'react';
import Galaxy from './Galaxy';

const API = 'http://localhost:8001/api/admin';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Overview {
  projectCount: number;
  sessionCount: number;
  commandCount: number;
  todayProjectCount: number;
  skillsCount: number;
  agentsCount: number;
  hooksCount: number;
  pluginsCount: number;
  connectorsCount: number;
  lastUpdate: number;
}

interface Skill { id: string; name: string; description: string; }
interface Agent { id: string; name: string; description: string; model: string; tools: string[]; }
interface Session { pid: number; sessionId: string; project: string; workspace: string; startedAt: string; }
interface ProjectSummary { displayName: string; cwd: string; device: string; sessionCount: number; lastActivity: number; firstRequest: string; lastResult: string; }
interface Task { id: string; kind: string; teamName: string; totalCount: number; completedCount: number; lockActive: boolean; }
interface Connector { id: string; name: string; type: string; command: string; }
interface Hook { event: string; type?: string; command?: string; matcher?: string; }
interface Permission { allow: string[]; deny: string[]; }
interface Archive { id: string; filename: string; project: string; size: number; updatedAt: number; preview: string; }
interface Profile { name: string; description: string; score: number; settings: { permissions: { allow: string[]; deny: string[] } }; }
interface GuideData { profiles: Profile[]; current: { allow: string[]; deny: string[] }; }

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function relTime(ms: number): string {
  if (!ms) return '-';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// ── 카드 컴포넌트 ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(28,28,30,0.75)', border: '1px solid #2a2a2e', borderRadius: 10,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 700, color: color || '#f4f4f5', lineHeight: 1.1 }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: '#666' }}>{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 13, fontWeight: 700, color: '#a1a1aa', margin: '20px 0 8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {children}
    </h2>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: color + '22', color, fontWeight: 600 }}>
      {text}
    </span>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [connectors, setConnectors] = useState<{ platform: Connector[]; local: Connector[] }>({ platform: [], local: [] });
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [permissions, setPermissions] = useState<Permission>({ allow: [], deny: [] });
  const [archives, setArchives] = useState<Archive[]>([]);
  const [expandedArchive, setExpandedArchive] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'skills' | 'agents' | 'connectors' | 'hooks' | 'projects' | 'archives' | 'guide'>('overview');
  const [lastRefresh, setLastRefresh] = useState(0);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [ov, sk, ag, sys, summ, sched, conn, hk, arch, gd] = await Promise.all([
      fetchJSON<Overview>('/briefing/overview'),
      fetchJSON<Skill[]>('/skills'),
      fetchJSON<{ agents: Agent[] }>('/agents'),
      fetchJSON<{ sessions: Session[]; permissions: Permission; hooks: Hook[] }>('/system/status'),
      fetchJSON<{ summaries: ProjectSummary[] }>('/briefing/projects-summary'),
      fetchJSON<{ tasks: Task[] }>('/briefing/schedule'),
      fetchJSON<{ platform: Connector[]; local: Connector[] }>('/connectors'),
      fetchJSON<{ hooks: Hook[]; permissions: Permission }>('/hooks'),
      fetchJSON<Archive[]>('/archives'),
      fetchJSON<GuideData>('/guide/recommended-settings'),
    ]);
    if (ov) setOverview(ov);
    if (sk) setSkills(sk);
    if (ag) setAgents(ag.agents || []);
    if (sys) { setSessions(sys.sessions || []); setPermissions(sys.permissions || { allow: [], deny: [] }); }
    if (summ) setSummaries(summ.summaries || []);
    if (sched) setTasks(sched.tasks || []);
    if (conn) setConnectors(conn);
    if (hk) { setHooks(hk.hooks || []); if (!sys) setPermissions(hk.permissions || { allow: [], deny: [] }); }
    if (arch) setArchives(arch);
    if (gd) setGuide(gd);
    setLastRefresh(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    const id = setInterval(loadAll, 30000);
    return () => clearInterval(id);
  }, [loadAll]);

  const tabs = [
    { key: 'overview', label: '브리핑' },
    { key: 'skills', label: `스킬 (${skills.length})` },
    { key: 'agents', label: `에이전트 (${agents.length})` },
    { key: 'connectors', label: `MCP (${(connectors.platform.length + connectors.local.length)})` },
    { key: 'hooks', label: `훅 (${hooks.length})` },
    { key: 'projects', label: `프로젝트 (${overview?.projectCount ?? summaries.length})` },
    { key: 'archives', label: `아카이브 (${archives.length})` },
    { key: 'guide', label: '가이드' },
  ] as const;

  return (
    <div style={{ minHeight: '100vh', background: '#09090b', color: '#f4f4f5', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '0', position: 'relative' }}>

      {/* Galaxy 배경 */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <Galaxy hueShift={220} density={1.2} glowIntensity={0.4} transparent={false} />
      </div>

      {/* 컨텐츠 레이어 */}
      <div style={{ position: 'relative', zIndex: 1 }}>

      {/* 헤더 */}
      <div style={{ background: 'rgba(9,9,11,0.75)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #27272a', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em' }}>⚙️ Claude 워크스페이스</span>
            {loading && <span style={{ fontSize: 11, color: '#a78bfa', animation: 'pulse 1.5s infinite' }}>로딩 중…</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastRefresh > 0 && <span style={{ fontSize: 11, color: '#52525b' }}>갱신 {relTime(lastRefresh)}</span>}
            <button
              onClick={loadAll}
              style={{ fontSize: 11, padding: '5px 12px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 6, color: '#a1a1aa', cursor: 'pointer' }}
            >새로고침</button>
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ background: 'rgba(9,9,11,0.6)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #27272a' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', gap: 0 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '10px 16px', fontSize: 12, fontWeight: 600,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: activeTab === t.key ? '#a78bfa' : '#71717a',
                borderBottom: activeTab === t.key ? '2px solid #a78bfa' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>

        {/* ── 브리핑 탭 ── */}
        {activeTab === 'overview' && (
          <>
            {/* 스탯 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 4 }}>
              <StatCard label="프로젝트" value={overview?.projectCount ?? '-'} color="#a78bfa" />
              <StatCard label="활성 세션" value={overview?.sessionCount ?? '-'} color="#60a5fa" />
              <StatCard label="오늘 명령" value={overview?.commandCount ?? '-'} color="#4ade80" />
              <StatCard label="스킬" value={overview?.skillsCount ?? '-'} color="#f59e0b" />
              <StatCard label="에이전트" value={overview?.agentsCount ?? '-'} color="#fb923c" />
              <StatCard label="MCP" value={overview?.connectorsCount ?? '-'} color="#34d399" />
              <StatCard label="훅" value={overview?.hooksCount ?? '-'} color="#f472b6" />
              <StatCard label="플러그인" value={overview?.pluginsCount ?? '-'} color="#818cf8" />
            </div>

            {/* 세션 + 권한 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
              {/* 활성 세션 */}
              <div>
                <SectionTitle>활성 세션</SectionTitle>
                {sessions.length === 0
                  ? <p style={{ fontSize: 12, color: '#52525b' }}>활성 세션 없음</p>
                  : sessions.map(s => (
                    <div key={s.sessionId} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7' }}>{s.project || 'Claude Code'}</div>
                      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2, wordBreak: 'break-all' }}>{s.workspace || '-'}</div>
                      {s.pid && <div style={{ fontSize: 10, color: '#52525b', marginTop: 2 }}>PID {s.pid}</div>}
                    </div>
                  ))}
              </div>

              {/* 권한 */}
              <div>
                <SectionTitle>권한 설정</SectionTitle>
                <div style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>✓ 허용 ({permissions.allow.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {permissions.allow.length === 0
                        ? <span style={{ fontSize: 11, color: '#52525b' }}>없음</span>
                        : permissions.allow.map(a => <Badge key={a} text={a} color="#4ade80" />)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, marginBottom: 4 }}>✗ 거부 ({permissions.deny.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {permissions.deny.length === 0
                        ? <span style={{ fontSize: 11, color: '#52525b' }}>없음</span>
                        : permissions.deny.map(d => <Badge key={d} text={d} color="#f87171" />)}
                    </div>
                  </div>
                </div>

                {/* 진행 중 태스크 */}
                {tasks.length > 0 && (
                  <>
                    <SectionTitle>진행 중 태스크</SectionTitle>
                    {tasks.slice(0, 5).map(t => (
                      <div key={t.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7' }}>{t.teamName || t.id.slice(0, 8)}</span>
                          {t.lockActive && <Badge text="실행 중" color="#4ade80" />}
                        </div>
                        <div style={{ background: '#27272a', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 4, background: '#a78bfa',
                            width: `${t.totalCount > 0 ? Math.round(t.completedCount / t.totalCount * 100) : 0}%`,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: '#71717a', marginTop: 4 }}>
                          {t.completedCount}/{t.totalCount} 완료
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* 최근 프로젝트 활동 */}
            <SectionTitle>최근 프로젝트 활동</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {summaries.slice(0, 12).map(s => (
                <div key={s.cwd} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e4e4e7' }}>{s.displayName}</span>
                    <span style={{ fontSize: 10, color: '#52525b' }}>{relTime(s.lastActivity)}</span>
                  </div>
                  {s.lastResult && <p style={{ fontSize: 11, color: '#71717a', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.lastResult}</p>}
                  <div style={{ fontSize: 10, color: '#52525b', marginTop: 4 }}>{s.sessionCount}회 명령</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 스킬 탭 ── */}
        {activeTab === 'skills' && (
          <>
            <SectionTitle>스킬 ({skills.length})</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {skills.map(s => (
                <div key={s.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: '#71717a' }}>{s.description || '설명 없음'}</div>
                  <div style={{ fontSize: 10, color: '#52525b', marginTop: 6, fontFamily: 'monospace' }}>{s.id}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 에이전트 탭 ── */}
        {activeTab === 'agents' && (
          <>
            <SectionTitle>에이전트 ({agents.length})</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {agents.map(a => (
                <div key={a.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fb923c', marginBottom: 4 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>{a.description || '설명 없음'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <Badge text={a.model || 'inherit'} color="#60a5fa" />
                    {a.tools.slice(0, 5).map(t => <Badge key={t} text={t} color="#71717a" />)}
                    {a.tools.length > 5 && <Badge text={`+${a.tools.length - 5}`} color="#52525b" />}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── MCP 탭 ── */}
        {activeTab === 'connectors' && (
          <>
            {connectors.platform.length > 0 && (
              <>
                <SectionTitle>플랫폼 MCP ({connectors.platform.length})</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginBottom: 8 }}>
                  {connectors.platform.map(c => (
                    <div key={c.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>{c.name}</div>
                      <Badge text={c.type} color="#34d399" />
                    </div>
                  ))}
                </div>
              </>
            )}
            <SectionTitle>로컬 MCP ({connectors.local.length})</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {connectors.local.map(c => (
                <div key={c.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#71717a', fontFamily: 'monospace', wordBreak: 'break-all' }}>{c.command}</div>
                  <div style={{ marginTop: 6 }}><Badge text={c.type} color="#34d399" /></div>
                </div>
              ))}
              {connectors.local.length === 0 && <p style={{ fontSize: 12, color: '#52525b' }}>로컬 MCP 없음</p>}
            </div>
          </>
        )}

        {/* ── 훅 탭 ── */}
        {activeTab === 'hooks' && (
          <>
            <SectionTitle>훅 ({hooks.length})</SectionTitle>
            {hooks.length === 0
              ? <p style={{ fontSize: 12, color: '#52525b' }}>등록된 훅 없음</p>
              : hooks.map((h, i) => (
                <div key={i} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 14px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Badge text={h.event} color="#f472b6" />
                    {h.type && <Badge text={h.type} color="#a78bfa" />}
                    {h.matcher && <Badge text={h.matcher} color="#60a5fa" />}
                  </div>
                  {h.command && <div style={{ fontSize: 11, color: '#71717a', fontFamily: 'monospace', wordBreak: 'break-all' }}>{h.command}</div>}
                </div>
              ))}
          </>
        )}

        {/* ── 아카이브 탭 ── */}
        {activeTab === 'archives' && (
          <>
            <SectionTitle>아카이브 ({archives.length})</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {archives.map(a => {
                const isOpen = expandedArchive === a.id;
                return (
                  <div key={a.id} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, overflow: 'hidden' }}>
                    <div
                      onClick={() => setExpandedArchive(isOpen ? null : a.id)}
                      style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>{a.id}</span>
                        <Badge text={a.project} color="#60a5fa" />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 10, color: '#52525b' }}>{Math.round(a.size / 1024 * 10) / 10} KB</span>
                        <span style={{ fontSize: 12, color: '#52525b' }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: '1px solid #27272a', padding: '12px 14px' }}>
                        <pre style={{ fontSize: 11, color: '#a1a1aa', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: 1.6 }}>
                          {a.preview}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── 가이드 탭 ── */}
        {activeTab === 'guide' && (
          <>
            <SectionTitle>하네스 점수 — 추천 설정 프로필</SectionTitle>
            <p style={{ fontSize: 12, color: '#71717a', marginBottom: 16 }}>
              현재 settings.json 권한이 각 프로필과 얼마나 일치하는지 비교합니다.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
              {(guide?.profiles || []).map(prof => {
                const pct = prof.score;
                const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#f59e0b' : '#f87171';
                return (
                  <div key={prof.name} style={{ background: '#1c1c1e', border: `1px solid ${color}44`, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e4e4e7' }}>{prof.name}</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color }}>{pct}<span style={{ fontSize: 12, color: '#71717a' }}>점</span></span>
                    </div>
                    {/* 점수 바 */}
                    <div style={{ background: '#27272a', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct}%`, transition: 'width 0.4s' }} />
                    </div>
                    <p style={{ fontSize: 11, color: '#71717a', margin: '0 0 10px' }}>{prof.description}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {prof.settings.permissions.allow.slice(0, 6).map(t => <Badge key={t} text={`✓ ${t}`} color="#4ade80" />)}
                      {prof.settings.permissions.deny.slice(0, 4).map(t => <Badge key={t} text={`✗ ${t}`} color="#f87171" />)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 현재 권한 요약 */}
            {guide?.current && (
              <>
                <SectionTitle>현재 적용 권한</SectionTitle>
                <div style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, marginBottom: 6 }}>허용 ({guide.current.allow.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {guide.current.allow.length === 0
                        ? <span style={{ fontSize: 11, color: '#52525b' }}>없음</span>
                        : guide.current.allow.map((a, i) => <Badge key={i} text={a.length > 40 ? a.slice(0, 40) + '…' : a} color="#4ade80" />)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, marginBottom: 6 }}>거부 ({guide.current.deny.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {guide.current.deny.length === 0
                        ? <span style={{ fontSize: 11, color: '#52525b' }}>없음</span>
                        : guide.current.deny.map((d, i) => <Badge key={i} text={d.length > 40 ? d.slice(0, 40) + '…' : d} color="#f87171" />)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── 프로젝트 탭 ── */}
        {activeTab === 'projects' && (
          <>
            <SectionTitle>최근 프로젝트 ({summaries.length})</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {summaries.map(s => (
                <div key={s.cwd} style={{ background: '#1c1c1e', border: '1px solid #27272a', borderRadius: 8, padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e4e7', marginBottom: 4 }}>{s.displayName}</div>
                    <div style={{ fontSize: 11, color: '#52525b', fontFamily: 'monospace', marginBottom: 6, wordBreak: 'break-all' }}>{s.cwd}</div>
                    {s.lastResult && <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>{s.lastResult}</p>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: '#52525b' }}>{relTime(s.lastActivity)}</div>
                    <div style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>{s.sessionCount}회</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      </div>{/* /컨텐츠 레이어 */}
    </div>
  );
}
