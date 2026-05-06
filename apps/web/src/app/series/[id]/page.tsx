// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getSeries, getSeriesStatus, approvePipelineStep,
  retryPipelineStep
} from '@/lib/seriesStore';
import { getPipelineLogs, setPipelineLogs } from '@/lib/useLogDB';
import PipelineStatus from '@/components/PipelineStatus';
import ApprovalPanel from '@/components/ApprovalPanel';
import WorldEditor from '@/components/WorldEditor';
import KeyframeSetupEditor from '@/components/KeyframeSetupEditor';
import CastingReviewPanel from '@/components/CastingReviewPanel';
import SourceUploadEditor from '@/components/SourceUploadEditor';
import ExtensionDrawer from '@/components/ExtensionDrawer';
import type { Series, PipelineStep, Chapter } from '@/types/series';

const API = 'http://localhost:8001/api/v1';
const TERMINAL_STEPS = new Set(['done', 'failed', 'chapter_done', 'awaiting_source_upload', 'awaiting_world_approval', 'awaiting_casting_approval', 'awaiting_script_approval', 'awaiting_keyframe_setup', 'awaiting_tts', 'awaiting_upload_approval']);

const BLOB_STYLE_LIGHT = `
  @keyframes blob-drift-s { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(60px,-40px) scale(1.08); } 66% { transform: translate(-40px,30px) scale(0.96); } 100% { transform: translate(0,0) scale(1); } }
  .ld-bg-l { position: fixed; inset: 0; background: #e8f0fa; z-index: 0; pointer-events: none; }
  .ld-blob-l { position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.3; pointer-events: none; z-index: 1; }
  .ld-blob-l1 { width: 700px; height: 700px; background: radial-gradient(circle, #5ee7df, #3b82f6); top: -200px; left: -150px; animation: blob-drift-s 22s ease-in-out infinite alternate; }
  .ld-blob-l2 { width: 600px; height: 600px; background: radial-gradient(circle, #b490f5, #ec4899); bottom: -200px; right: -100px; animation: blob-drift-s 17s ease-in-out infinite alternate; animation-delay: -8s; }
  .ld-blob-l3 { width: 400px; height: 400px; background: radial-gradient(circle, #ffd27f, #f7a8c4); top: 40%; left: 50%; animation: blob-drift-s 25s ease-in-out infinite alternate; animation-delay: -13s; }
`;

export default function SeriesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [series, setSeries] = useState<Series | null>(null);

  const [step, setStep] = useState<PipelineStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [expandedCh, setExpandedCh] = useState<number | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState<string | null>(null);
  const [scriptRegen, setScriptRegen] = useState(false);
  const [scriptRevise, setScriptRevise] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);
  const [scriptApproving, setScriptApproving] = useState<string | null>(null);
  const reviseAbortRef = useRef(false);
  const [lintLoading, setLintLoading] = useState(false);
  const [lintRevising, setLintRevising] = useState(false);
  const [lintReport, setLintReport] = useState('');
  const [lintReviseResult, setLintReviseResult] = useState<string | null>(null);
  // 키프레임 익스텐션 패널 열림 여부 (대본 승인 단계에서 사용)
  const [extensionOpen, setExtensionOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const st = await getSeriesStatus(id);
      setStep(st.pipeline_step);
      setError(st.error_detail ?? null);
      // 대본 완료 이후 단계에서 챕터 목록 갱신
      const scriptDoneSteps = ['awaiting_script_approval', 'awaiting_keyframe_setup', 'keyframe', 'awaiting_tts', 'tts', 'render', 'awaiting_upload_approval', 'chapter_done', 'done'];
      if (scriptDoneSteps.includes(st.pipeline_step)) {
        fetch(`${API}/series/${id}/chapters`).then(r => r.ok ? r.json() : []).then(setChapters).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('404')) setNotFound(true);
    }
  }, [id]);

  const loadSeries = useCallback(async () => {
    const s = await getSeries(id);
    setSeries(s);
    if (s) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFinalUrl((s as any).settings?.finalMp4Url ?? null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setYoutubeUrl((s as any).settings?.youtubeUrl ?? null);
    }
  }, [id]);

  const loadChapters = useCallback(async () => {
    try {
      const res = await fetch(`${API}/series/${id}/chapters`);
      if (res.ok) setChapters(await res.json());
    } catch { /* 무시 */ }
  }, [id]);

  useEffect(() => {
    loadSeries();
    refresh();
    loadChapters();
  }, [id, refresh, loadSeries, loadChapters]);


  useEffect(() => {
    if (TERMINAL_STEPS.has(step)) return;
    let closed = false;
    let retries = 0;
    let currentEs: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function connect() {
      if (closed) return;
      currentEs = new EventSource(`${API}/series/${id}/stream`);
      currentEs.onmessage = async (e) => {
        const event = JSON.parse(e.data);
        if (event.type === 'ping') return;
        retries = 0; // 수신 성공 → 재시도 카운트 리셋
        await loadSeries();
        refresh();
        if (event.type === 'done') { currentEs?.close(); }
      };
      currentEs.onerror = () => {
        currentEs?.close();
        if (closed) return;
        retries++;
        if (retries <= 3) {
          // 지수 백오프: 2s, 4s, 6s
          setTimeout(connect, retries * 2000);
        } else if (!pollTimer) {
          // SSE 3회 연속 실패 → 3초 폴링으로 전환
          pollTimer = setInterval(() => { if (!closed) refresh(); }, 3000);
        }
      };
    }

    connect();
    return () => {
      closed = true;
      currentEs?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id, step, refresh, loadSeries]);

  // awaiting_world_approval 고착 방지 — openingHook 미확보 시 2초 간격 재시도
  // series 상태가 바뀔 때마다 재평가 → openingHook 확보되면 자동 중단
  useEffect(() => {
    if (step !== 'awaiting_world_approval') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((series as any)?.world_data?.openingHook) return; // 이미 확보됨
    const timer = setInterval(() => loadSeries(), 2000);
    return () => clearInterval(timer);
  }, [step, series, loadSeries]);

  // 언마운트 시 handleScriptRevise 폴링 루프 중단
  useEffect(() => { return () => { reviseAbortRef.current = true; }; }, []);

  if (notFound) return (
    <div style={{ padding: '3rem 2rem', fontFamily: "var(--font-en), 'Pretendard', sans-serif", textAlign: 'center' }}>
      <p style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.5)', marginBottom: '1rem' }}>
        시리즈를 찾을 수 없습니다
      </p>
      <a href="/series" style={{ color: '#6366f1', fontSize: '0.9rem' }}>← 목록으로 돌아가기</a>
    </div>
  );

  if (!series) return (
    <div style={{ padding: '3rem 2rem', color: 'rgba(255,255,255,0.4)', fontFamily: "var(--font-en), 'Pretendard', sans-serif" }}>
      불러오는 중...
    </div>
  );

  const handleScriptRevise = async () => {
    if (!confirm('현재 대본의 스토리는 유지하면서 규칙 위반(대사 비중 30% 초과, 15자 미만 짧은 대사)만 교정합니다.\n교정 완료까지 30~90초 소요됩니다. 계속하시겠습니까?')) return;
    // ★ POST 전에 스냅샷 저장 — BackgroundTasks 시작 전 기준점
    const snap0 = await fetch(`${API}/series/${id}/chapters`).then(r => r.json()).catch(() => []);
    const contents0 = new Map<number, string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (snap0 as any[]).map((c) => [c.chapter as number, (c.content ?? '') as string])
    );
    reviseAbortRef.current = false;
    setScriptRevise(true);
    try {
      await fetch(`${API}/series/${id}/revise-script`, { method: 'POST' });
      // 최대 120초 폴링 (1.5초 간격) — POST 이후 내용 변경 감지
      for (let i = 0; i < 80; i++) {
        if (reviseAbortRef.current) break; // 언마운트 시 즉시 중단
        await new Promise(r => setTimeout(r, 1500));
        if (reviseAbortRef.current) break;
        const snap = await fetch(`${API}/series/${id}/chapters`).then(r => r.json()).catch(() => []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const changed = (snap as any[]).some((c) => (c.content ?? '') !== (contents0.get(c.chapter) ?? ''));
        if (changed) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setChapters(snap as any);
          setRevisionKey(k => k + 1); // ChapterScenes 강제 re-mount → 씬 재로드
          setExpandedCh(null);         // 열려있던 챕터 닫기 (stale 데이터 노출 방지)
          break;
        }
      }
    } finally {
      setScriptRevise(false);
    }
  };

  const handleScriptRegenerate = async () => {
    if (!confirm('기존 대본을 완전히 삭제하고 처음부터 새 대본을 생성합니다.\n스토리가 완전히 바뀝니다. 계속하시겠습니까?')) return;
    setScriptRegen(true);
    try {
      await fetch(`${API}/series/${id}/retry/script`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 600));  // DB 업데이트 대기
      refresh();
    } finally {
      setScriptRegen(false);
    }
  };

  const handleLintAndRevise = async () => {
    if (!confirm('위키 기준으로 대본을 검수한 뒤 수정 필요 항목을 자동 재작성합니다.\n계속하시겠습니까?')) return;
    setLintLoading(true);
    setLintReport('');
    setLintReviseResult(null);
    try {
      // 1단계: Lint 검수
      const lintRes = await fetch(`${API}/wiki/${id}/lint`, { method: 'POST' });
      const lintData = await lintRes.json();
      const report = lintData.report ?? '';
      setLintReport(report);

      // 2단계: 자동 수정
      setLintLoading(false);
      setLintRevising(true);
      const reviseRes = await fetch(`${API}/wiki/${id}/revise`, { method: 'POST' });
      const reviseData = await reviseRes.json();
      const count = reviseData.revised ?? 0;
      setLintReviseResult(count > 0 ? `챕터 ${reviseData.chapters?.join(', ')}화 재작성 완료.` : '수정 필요 항목이 없습니다.');
      if (count > 0) { setRevisionKey(k => k + 1); refresh(); }
    } finally {
      setLintLoading(false);
      setLintRevising(false);
    }
  };

  const handleApproveWithProvider = async (artStyle: string) => {
    if (scriptApproving) return;
    setScriptApproving('gemini');
    try {
      // 1. artStyle 저장
      await fetch(`${API}/series/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { keyframeProvider: 'gemini', artStyle } }),
      });
      // 2. 대본 승인 → awaiting_keyframe_setup 전이
      await approvePipelineStep(id, 'script');
      // 3. 키프레임 설정 즉시 승인 → keyframe 단계 진입 (Gemini 미호출 — 씬 JSON 그대로 사용)
      await approvePipelineStep(id, 'keyframe_setup');
      // 4. 키프레임 검토 페이지로 이동
      router.push(`/series/keyframe?series_id=${id}`);
    } catch {
      refresh();
    } finally {
      setScriptApproving(null);
    }
  };

  return (
  <>
  <style dangerouslySetInnerHTML={{ __html: BLOB_STYLE_LIGHT }} />
  <div className="ld-bg-l" />
  <div className="ld-blob-l ld-blob-l1" />
  <div className="ld-blob-l ld-blob-l2" />
  <div className="ld-blob-l ld-blob-l3" />
  <div style={{ position: 'relative', zIndex: 2, minHeight: 'calc(100vh - 56px)', padding: '2rem 1rem' }}>
  <main style={{ maxWidth: '960px', margin: '0 auto', fontFamily: "var(--font-en), 'Pretendard', sans-serif", padding: '2rem' }}>

      {/* 헤더 */}
      <div className="glass-dark" style={{ marginBottom: '2rem', padding: '1.5rem 2rem', borderRadius: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, flex: 1, color: 'rgba(255,255,255,0.95)' }}>
            {series.title || series.topic}
          </h1>
          <a href={`/series/${id}/wiki`} style={{
            padding: '0.4rem 1rem', borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.92)', textDecoration: 'none', fontSize: '0.85rem',
          }}>
            위키 →
          </a>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: '0.3rem', fontSize: '0.9rem' }}>
          {series.topic}
        </p>
      </div>

      {/* 제작 공정 스텝바 */}
      <div className="glass-dark" style={{ borderRadius: '16px', padding: '1rem 1.25rem', marginBottom: '0.5rem' }}>
        <PipelineStatus currentStep={step} error={error} />
      </div>

      {/* ── 단계별 콘텐츠 패널 ── */}

      {/* 소스 업로드 — 파일 업로드 + AI 분류 제안 */}
      {step === 'awaiting_source_upload' && (
        <SourceUploadEditor
          seriesId={id}
          onConfirm={() => { refresh(); loadSeries(); }}
        />
      )}

      {/* 세계관 확인 & 편집 — openingHook이 있을 때만 마운트 (race condition 방지) */}
      {step === 'awaiting_world_approval' && series && !!(series as any).world_data?.openingHook && (
        <WorldEditor
          key={`world-${id}`}
          seriesId={id}
          worldData={(series as any).world_data || {}}
          onConfirm={() => { refresh(); loadSeries(); }}
        />
      )}
      {step === 'awaiting_world_approval' && series && !(series as any).world_data?.openingHook && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: "var(--font-en), 'Pretendard', sans-serif" }}>
          세계관 생성 중...
        </div>
      )}

      {/* 캐스팅 확인 */}
      {step === 'awaiting_casting_approval' && series && (
        <CastingReviewPanel
          seriesId={id}
          worldData={(series as any).world_data || {}}
          onConfirm={() => { refresh(); loadSeries(); }}
        />
      )}

      {/* 키프레임 방식 선택 */}
      {step === 'awaiting_keyframe_setup' && series && (
        <KeyframeSetupEditor
          seriesId={id}
          currentProvider={(series as any).settings?.keyframeProvider}
          onConfirm={() => { refresh(); loadSeries(); }}
        />
      )}

      {/* 실행 중 — 스피너 */}
      {!TERMINAL_STEPS.has(step) && step !== 'idle' && step !== 'failed' && (
        <StepRunningPanel step={step} />
      )}

      {/* 대본 승인 */}
      {step === 'awaiting_script_approval' && (
        <div className="glass-dark" style={{
          marginTop: '2rem',
          padding: '2rem',
          borderRadius: '16px',
          fontFamily: "var(--font-en), 'Pretendard', sans-serif",
          color: 'rgba(255,255,255,0.92)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}>
          {/* 헤더 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'rgba(255,255,255,0.92)' }}>대본 확인</h2>
              <span className="glass-badge glass-badge--violet">
                {chapters.length}화
              </span>
              <span style={{ flex: 1 }} />
              <button
                onClick={handleLintAndRevise}
                disabled={lintLoading || lintRevising || scriptRevise || scriptRegen}
                className="glass-btn glass-btn--ghost glass-btn--sm"
                style={{ borderRadius: '8px' }}
              >
                {lintLoading ? '검수 중…' : lintRevising ? '교정 중…' : '대본 교정'}
              </button>
              {/* 키프레임 익스텐션 버튼 — 컷별 이미지 생성 보조 도구 */}
              <button
                onClick={() => setExtensionOpen(true)}
                disabled={lintLoading || lintRevising || scriptRevise || scriptRegen}
                className="glass-btn glass-btn--ghost glass-btn--sm"
                style={{ borderRadius: '8px', borderColor: 'rgba(139,92,246,0.4)', color: '#a78bfa' }}
              >
                키프레임 익스텐션
              </button>
              <button
                onClick={handleScriptRegenerate}
                disabled={scriptRegen || scriptRevise}
                className="glass-btn glass-btn--danger glass-btn--sm"
                style={{ borderRadius: '8px' }}
              >
                {scriptRegen ? '재생성 중…' : '대본 재생성'}
              </button>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              생성된 대본을 검토하고 승인하면 영상 제작이 시작됩니다.
            </p>

          </div>

          <ChapterList key={revisionKey} seriesId={id} chapters={chapters} expandedCh={expandedCh} setExpandedCh={setExpandedCh} />

          {chapters.length > 0 && (
            <ScriptDownloadPanel series={series} chapters={chapters} busy={scriptRevise || scriptRegen} />
          )}

          <ScriptApprovalButtons
            approving={scriptApproving}
            disabled={scriptRevise || scriptRegen}
            onApprove={handleApproveWithProvider}
          />

          {/* Lint 결과 패널 */}
          {(lintReport || lintReviseResult) && (
            <div style={{ borderRadius: '16px', border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
                <span style={{ fontWeight: 700, color: '#a78bfa', fontSize: '0.9rem' }}>🔍 Lint 보고서</span>
                <button
                  onClick={() => { setLintReport(''); setLintReviseResult(null); }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.1rem' }}
                >✕</button>
              </div>
              {lintReviseResult && (
                <div style={{ padding: '0.7rem 1.25rem', background: 'rgba(16,185,129,0.1)', borderBottom: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7', fontWeight: 600, fontSize: '0.85rem' }}>
                  ✅ {lintReviseResult}
                </div>
              )}
              <pre style={{ padding: '1.25rem', whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.8)', fontSize: '0.83rem', lineHeight: 1.7, margin: 0, maxHeight: '500px', overflowY: 'auto' }}>
                {lintReport}
              </pre>
            </div>
          )}

          {/* 키프레임 익스텐션 패널 — 컷별 이미지 생성 보조 도구 */}
          <ExtensionDrawer
            open={extensionOpen}
            onClose={() => setExtensionOpen(false)}
            seriesId={id}
            chapters={chapters.map(c => ({ id: c.id, chapter: c.chapter, role: c.role }))}
          />
        </div>
      )}

      {/* TTS 시작 승인 — 키프레임 검토 완료 후 TTS 생성 시작 */}
      {step === 'awaiting_tts' && (
        <div className="glass-dark" style={{
          marginTop: '2rem',
          padding: '2rem',
          borderRadius: '16px',
          color: 'rgba(255,255,255,0.92)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>🎙 음성(TTS) 생성 시작</h2>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.55)', fontSize: '0.9rem' }}>
            키프레임 검토가 완료됐습니다. 아래 버튼을 누르면 모든 컷의 음성을 자동 생성합니다.
          </p>
          <button
            onClick={async () => {
              await approvePipelineStep(id, 'tts');
              refresh();
            }}
            className="glass-btn glass-btn--accent glass-btn--lg"
            style={{ alignSelf: 'flex-start' }}
          >
            TTS 생성 시작
          </button>
        </div>
      )}

      {/* 업로드 승인 */}
      {step === 'awaiting_upload_approval' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!series?.settings?.youtubeToken && <YouTubeConnectBanner />}
          {finalUrl && <VideoPreview url={finalUrl} />}
          <ApprovalPanel
            seriesId={id} step={step}
            onApprove={async () => {
              await approvePipelineStep(id, 'upload');
              refresh();
            }}
          />
        </div>
      )}

      {/* 챕터 완료 — 다음 챕터 대기 */}
      {step === 'chapter_done' && series && (
        <ChapterDonePanel
          seriesId={id}
          completedChapter={(series as any).current_chapter - 1}
          onNext={() => { refresh(); loadSeries(); }}
        />
      )}

      {/* 전체 완료 */}
      {step === 'done' && youtubeUrl && <DonePanel url={youtubeUrl} />}

      {/* 오류 */}
      {step === 'failed' && error && (
        <ErrorPanel error={error} onRetry={() => {
          const match = error?.match(/step[=:\s]+([a-z_]+)/i)
            ?? error?.match(/\b(world|casting|script|keyframe|tts|render|upload)\b/i);
          const retryStep = match ? match[1].toLowerCase() : 'world';
          retryPipelineStep(id, retryStep).then(refresh);
        }} />
      )}

      {/* 실행 로그 */}
      <SeriesLogs seriesId={id} seriesTitle={series.title || series.topic} />
    </main>
    </div>
  </>
  );
}

// ── 하위 컴포넌트 ──────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  awaiting_source_upload: '소스 업로드', world: '세계관 생성', casting: '캐스팅',
  script: '대본 생성', keyframe: '키프레임 생성', awaiting_tts: 'TTS 시작 대기',
  tts: '음성(TTS) 생성', render: '영상 렌더링', upload: 'YouTube 업로드',
};

function StepRunningPanel({ step }: { step: string }) {
  return (
    <div className="glass-dark" style={{
      padding: '2rem', borderRadius: '16px',
      display: 'flex', alignItems: 'center', gap: '1.25rem',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        border: '3px solid #6366f1', borderTopColor: 'transparent',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0,
      }} />
      <div>
        <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: 'rgba(255,255,255,0.92)' }}>
          {STEP_LABELS[step] ?? step} 진행 중…
        </p>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>
          완료되면 자동으로 다음 단계로 이동합니다
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── 컷 예상 TTS 시간 추정 ── */
function estimateDuration(text: string): number {
  const clean = text
    .replace(/\[IMAGE[^\]]*\]/gi, '')   // [IMAGE ...] 지시문
    .replace(/\[BGM[^\]]*\]/gi, '')     // [BGM ...]
    .replace(/\[SFX[^\]]*\]/gi, '')     // [SFX ...]
    .replace(/\([^)]*\)/g, '')          // (속삭이며), (사이) 등 연기 지문
    .replace(/\/\/\//g, '')             // /// 구분자
    .replace(/\s+/g, ' ')
    .trim();
  // 한국어 TTS 기본 속도: 약 5자/초 (edge-tts ko-KR 기준)
  return Math.max(1.0, clean.length / 5);
}

/* ── 나레이션/대사 파서 ── */
type TextSegment = { kind: 'narration' | 'dialogue'; content: string };

function parseTextSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // 쌍따옴표 " " 또는 "  " 패턴으로 대사 추출
  const regex = /"([^"]*?)"|"([^"]*?)"/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      const narr = text.slice(lastIndex, m.index).trim();
      if (narr) segments.push({ kind: 'narration', content: narr });
    }
    segments.push({ kind: 'dialogue', content: m[0] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim();
    if (tail) segments.push({ kind: 'narration', content: tail });
  }
  return segments.length > 0 ? segments : [{ kind: 'narration', content: text }];
}

type SceneCut = {
  scene_index: number;
  cut_index: number;
  is_hook: boolean;
  scene_code: string;
  text: string;
  render_type: string;
  type: 'narration' | 'dialogue' | 'mixed';
  speaker: string | null;
};

type SceneGroup = {
  sceneIndex: number;
  isHook: boolean;
  sceneCode: string;  // 첫 번째 컷의 scene_code
  cuts: SceneCut[];
};

function groupCutsByScene(cuts: SceneCut[]): SceneGroup[] {
  const map = new Map<number, SceneGroup>();
  for (const cut of cuts) {
    if (!map.has(cut.scene_index)) {
      map.set(cut.scene_index, {
        sceneIndex: cut.scene_index,
        isHook: cut.is_hook,
        sceneCode: cut.scene_code,
        cuts: [],
      });
    }
    map.get(cut.scene_index)!.cuts.push(cut);
  }
  return Array.from(map.values()).sort((a, b) => a.sceneIndex - b.sceneIndex);
}

function ChapterScenes({ seriesId, chapter }: { seriesId: string; chapter: number }) {
  const [scenes, setScenes] = useState<SceneGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [patchingCodes, setPatchingCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/series/${seriesId}/chapters/${chapter}/scenes`)
      .then(r => r.ok ? r.json() : [])
      .then((cuts: SceneCut[]) => { setScenes(groupCutsByScene(cuts)); setLoading(false); })
      .catch(() => setLoading(false));
  }, [seriesId, chapter]);

  const toggleCutType = async (cut: SceneCut) => {
    if (cut.type === 'mixed' || patchingCodes.has(cut.scene_code)) return;
    const newType = cut.type === 'dialogue' ? 'narration' : 'dialogue';
    // 낙관적 업데이트
    setScenes(prev => prev.map(sc => ({
      ...sc,
      cuts: sc.cuts.map(c => c.scene_code === cut.scene_code ? { ...c, type: newType as SceneCut['type'] } : c),
    })));
    setPatchingCodes(s => new Set(s).add(cut.scene_code));
    try {
      const res = await fetch(`${API}/series/${seriesId}/scenes/${cut.scene_code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // 롤백
      setScenes(prev => prev.map(sc => ({
        ...sc,
        cuts: sc.cuts.map(c => c.scene_code === cut.scene_code ? { ...c, type: cut.type } : c),
      })));
    } finally {
      setPatchingCodes(s => { const ns = new Set(s); ns.delete(cut.scene_code); return ns; });
    }
  };

  if (loading) return (
    <div style={{ padding: '1.5rem', color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>씬 로딩 중…</div>
  );
  if (!scenes.length) return (
    <div style={{ padding: '1.5rem', color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>씬 데이터 없음</div>
  );

  const totalCuts = scenes.reduce((s, sc) => s + sc.cuts.length, 0);
  const totalSec  = scenes.reduce((s, sc) => s + sc.cuts.reduce((ss, c) => ss + estimateDuration(c.text), 0), 0);
  const totalMin  = Math.floor(totalSec / 60);
  const remSec    = Math.round(totalSec % 60);

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      {/* 챕터 합계 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '0.55rem 1.4rem',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
          총 <b style={{ color: 'rgba(255,255,255,0.7)' }}>{totalCuts}컷</b>
        </span>
        <span style={{ fontSize: '0.65rem', fontFamily: "var(--font-en), 'Pretendard', sans-serif", color: 'rgba(255,255,255,0.4)' }}>
          예상 <b style={{ color: 'rgba(255,255,255,0.7)' }}>
            {totalMin > 0 ? `${totalMin}분 ${remSec}초` : `${remSec}초`}
          </b>
        </span>
      </div>
      {scenes.map(scene => {
        const isHookCopy = scene.sceneIndex === 0;
        const sceneBg = isHookCopy ? 'rgba(239,68,68,0.04)' : 'transparent';

        const sceneSec = scene.cuts.reduce((sum, c) => sum + estimateDuration(c.text), 0);

        return (
          <div key={scene.sceneIndex} style={{ background: sceneBg }}>

            {/* ── 씬 구분선 헤더 ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.7rem 1.4rem 0.4rem',
              borderTop: scene.sceneIndex === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
            }}>
              <span style={{
                fontSize: '0.62rem', fontWeight: 700, fontFamily: "var(--font-en), 'Pretendard', sans-serif",
                color: isHookCopy ? '#f87171' : scene.isHook ? '#fbbf24' : 'rgba(255,255,255,0.3)',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                {isHookCopy ? '▶ HOOK 도입부 (복사본)' : scene.isHook ? `SCENE ${scene.sceneIndex}  HOOK 원본` : `SCENE ${scene.sceneIndex}`}
              </span>
              <span style={{ flex: 1, height: '1px', background: isHookCopy ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)' }}>
                {scene.cuts.length}컷
              </span>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', fontFamily: "var(--font-en), 'Pretendard', sans-serif" }}>
                ~{sceneSec.toFixed(0)}s
              </span>
            </div>

            {/* ── 컷별 표시 ── */}
            {scene.cuts.map(cut => {
              const isDialogue = cut.type === 'dialogue';
              const isMixed    = cut.type === 'mixed';
              const segments   = isMixed ? parseTextSegments(cut.text) : null;
              const cutSec     = estimateDuration(cut.text);
              return (
                <div key={cut.cut_index} style={{
                  padding: '0.6rem 1.4rem 0.9rem 1.8rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  background: isDialogue ? 'rgba(99,102,241,0.04)' : 'transparent',
                }}>
                  {/* 컷 마스터코드 뱃지 */}
                  <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.18rem 0.65rem',
                      borderRadius: '999px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      fontFamily: "var(--font-en), 'Pretendard', sans-serif",
                      letterSpacing: '0.05em',
                      color: '#ffffff',
                      background: cut.is_hook ? '#FF0000' : 'rgba(99,102,241,0.7)',
                    }}>
                      {cut.scene_code.split('_').slice(2).join('_') || cut.scene_code}
                    </span>
                    <span
                      onClick={() => { if (!isMixed) toggleCutType(cut); }}
                      title={isMixed ? undefined : '클릭 → 나레이션 ↔ 대사 전환'}
                      style={{
                        fontSize: '0.62rem', fontWeight: 600,
                        color: isDialogue ? '#34d399' : isMixed ? '#fbbf24' : 'rgba(255,255,255,0.3)',
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        cursor: isMixed ? 'default' : 'pointer',
                        opacity: patchingCodes.has(cut.scene_code) ? 0.4 : 1,
                        borderBottom: isMixed ? 'none' : '1px dashed currentColor',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {isDialogue ? '대사' : isMixed ? '혼합' : 'narr'}
                    </span>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.18rem 0.55rem',
                      borderRadius: '999px',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      fontFamily: "var(--font-en), 'Pretendard', sans-serif",
                      letterSpacing: '0.03em',
                      background: cutSec < 3
                        ? 'rgba(239,68,68,0.18)'
                        : cutSec > 30
                          ? 'rgba(251,191,36,0.15)'
                          : 'rgba(255,255,255,0.06)',
                      color: cutSec < 3 ? '#f87171' : cutSec > 30 ? '#fbbf24' : 'rgba(255,255,255,0.45)',
                      border: `1px solid ${cutSec < 3 ? 'rgba(239,68,68,0.3)' : cutSec > 30 ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.1)'}`,
                    }}>
                      {cutSec.toFixed(1)}s
                    </span>
                  </div>

                  {/* ── 순수 대사 컷 ── */}
                  {isDialogue && (
                    <>
                      {cut.speaker && (
                        <div style={{
                          marginBottom: '0.3rem',
                          fontSize: '0.75rem', fontWeight: 700,
                          color: '#34d399',
                          letterSpacing: '0.04em',
                        }}>
                          {cut.speaker}
                        </div>
                      )}
                      <p style={{
                        fontSize: '0.88rem', lineHeight: 1.9,
                        color: 'rgba(255,255,255,0.92)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        margin: 0,
                        paddingLeft: '0.8rem',
                        borderLeft: '2px solid rgba(52,211,153,0.5)',
                      }}>
                        {cut.text}
                      </p>
                    </>
                  )}

                  {/* ── 순수 나레이션 컷 ── */}
                  {!isDialogue && !isMixed && (
                    <p style={{
                      fontSize: '0.88rem', lineHeight: 1.9,
                      color: 'rgba(255,255,255,0.55)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      margin: 0, fontStyle: 'italic',
                    }}>
                      {cut.text}
                    </p>
                  )}

                  {/* ── 혼합 컷: 나레이션 / 대사 분리 표시 ── */}
                  {isMixed && segments && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {segments.map((seg, si) => (
                        seg.kind === 'dialogue' ? (
                          <div key={si} style={{
                            paddingLeft: '0.8rem',
                            borderLeft: '2px solid rgba(52,211,153,0.5)',
                            background: 'rgba(52,211,153,0.04)',
                            borderRadius: '0 6px 6px 0',
                            padding: '0.3rem 0.7rem',
                          }}>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 700,
                              color: '#34d399', letterSpacing: '0.06em',
                              display: 'block', marginBottom: '0.15rem',
                            }}>
                              대사
                            </span>
                            <span style={{
                              fontSize: '0.88rem', lineHeight: 1.85,
                              color: 'rgba(255,255,255,0.92)',
                              wordBreak: 'break-word',
                            }}>
                              {seg.content}
                            </span>
                          </div>
                        ) : (
                          <div key={si} style={{ paddingLeft: '0.2rem' }}>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 700,
                              color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em',
                              display: 'block', marginBottom: '0.15rem', textTransform: 'uppercase',
                            }}>
                              narr
                            </span>
                            <span style={{
                              fontSize: '0.88rem', lineHeight: 1.85,
                              color: 'rgba(255,255,255,0.55)',
                              fontStyle: 'italic', wordBreak: 'break-word',
                            }}>
                              {seg.content}
                            </span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        );
      })}
    </div>
  );
}

type HarvestCandidate = { sentence: string; reason: string };

// ── 챕터 대본 탭: 순수 대본 | 씬/컷 구조 ────────────────────────────────────
function ChapterScriptTabs({ seriesId, chapter }: { seriesId: string; chapter: number }) {
  const [tab, setTab] = useState<'raw' | 'structured'>('structured');
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  const [candidates, setCandidates] = useState<HarvestCandidate[] | null>(null);
  const [addedIdx, setAddedIdx] = useState<Set<number>>(new Set());

  function loadRaw() {
    if (rawText !== null) return;
    setRawLoading(true);
    fetch(`${API}/series/${seriesId}/chapters/${chapter}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setRawText(d?.content ?? ''); setRawLoading(false); })
      .catch(() => { setRawText(''); setRawLoading(false); });
  }

  function handleCopy() {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleHarvest() {
    setHarvesting(true);
    setCandidates(null);
    setAddedIdx(new Set());
    try {
      const res = await fetch(`${API}/series/${seriesId}/chapters/${chapter}/harvest`, { method: 'POST' });
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    } catch { setCandidates([]); }
    finally { setHarvesting(false); }
  }

  async function handleAddExample(idx: number, c: HarvestCandidate) {
    await fetch(`${API}/writing-guide/add-example`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence: c.sentence, reason: c.reason }),
    });
    setAddedIdx(prev => new Set([...prev, idx]));
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.35rem 1rem',
    fontSize: '0.75rem', fontWeight: 600,
    border: 'none', cursor: 'pointer',
    borderRadius: '6px',
    background: active ? 'rgba(99,102,241,0.25)' : 'transparent',
    color: active ? '#6366f1' : 'rgba(255,255,255,0.4)',
    transition: 'all 0.15s',
  });

  return (
    <div>
      {/* 탭 헤더 */}
      <div style={{
        display: 'flex', gap: '0.25rem', alignItems: 'center',
        padding: '0.5rem 1.2rem',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.15)',
      }}>
        <button style={tabStyle(tab === 'structured')} onClick={() => setTab('structured')}>
          씬/컷 구조
        </button>
        <button style={tabStyle(tab === 'raw')} onClick={() => { setTab('raw'); loadRaw(); }}>
          순수 대본
        </button>
      </div>

      {/* 씬/컷 구조 탭 */}
      {tab === 'structured' && <ChapterScenes seriesId={seriesId} chapter={chapter} />}

      {/* 순수 대본 탭 */}
      {tab === 'raw' && (
        <div style={{ padding: '1.2rem 1.8rem' }}>
          {/* 액션 버튼 */}
          {rawText && !rawLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <button
                onClick={handleHarvest}
                disabled={harvesting}
                style={{
                  padding: '0.35rem 0.85rem', borderRadius: '8px',
                  border: '1px solid rgba(251,191,36,0.3)',
                  background: harvesting ? 'rgba(251,191,36,0.05)' : 'rgba(251,191,36,0.08)',
                  color: harvesting ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.8)',
                  fontSize: '0.75rem', fontWeight: 600, cursor: harvesting ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {harvesting ? '분석 중…' : '명문 수집'}
              </button>
              <button
                onClick={handleCopy}
                style={{
                  padding: '0.35rem 0.85rem', borderRadius: '8px',
                  border: copied ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.12)',
                  background: copied ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                  color: copied ? '#10b981' : 'rgba(255,255,255,0.5)',
                  fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {copied ? '✓ 복사됨' : '복사'}
              </button>
            </div>
          )}

          {/* 명문 후보 패널 */}
          {candidates !== null && (
            <div style={{
              marginBottom: '1.2rem', borderRadius: '12px',
              border: '1px solid rgba(251,191,36,0.2)',
              background: 'rgba(251,191,36,0.04)',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '0.65rem 1rem',
                borderBottom: '1px solid rgba(251,191,36,0.15)',
                fontSize: '0.72rem', fontWeight: 700,
                color: 'rgba(251,191,36,0.7)', letterSpacing: '0.05em',
              }}>
                명문 후보 — guide에 추가할 문장을 선택하세요
              </div>
              {candidates.length === 0 ? (
                <p style={{ padding: '1rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.35)' }}>
                  추출된 후보가 없습니다.
                </p>
              ) : (
                candidates.map((c, i) => {
                  const added = addedIdx.has(i);
                  return (
                    <div key={i} style={{
                      padding: '0.85rem 1rem',
                      borderBottom: i < candidates.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      opacity: added ? 0.45 : 1,
                      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    }}>
                      <div style={{ flex: 1 }}>
                        <p style={{
                          fontSize: '0.88rem', lineHeight: 1.7,
                          color: 'rgba(255,255,255,0.88)', margin: '0 0 0.3rem',
                          fontStyle: 'italic',
                        }}>
                          "{c.sentence}"
                        </p>
                        <p style={{ fontSize: '0.72rem', color: 'rgba(251,191,36,0.55)', margin: 0 }}>
                          {c.reason}
                        </p>
                      </div>
                      <button
                        onClick={() => !added && handleAddExample(i, c)}
                        style={{
                          flexShrink: 0,
                          padding: '0.3rem 0.75rem', borderRadius: '7px',
                          border: added ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(251,191,36,0.3)',
                          background: added ? 'rgba(16,185,129,0.1)' : 'rgba(251,191,36,0.1)',
                          color: added ? '#34d399' : 'rgba(251,191,36,0.9)',
                          fontSize: '0.72rem', fontWeight: 600,
                          cursor: added ? 'default' : 'pointer',
                        }}
                      >
                        {added ? '✓ 추가됨' : '추가'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
          {rawLoading ? (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>불러오는 중…</p>
          ) : rawText ? (
            <p style={{
              whiteSpace: 'pre-wrap', lineHeight: 2.0,
              fontSize: '0.88rem', color: 'rgba(255,255,255,0.8)',
              fontFamily: "var(--font-en), 'Pretendard', sans-serif",
              margin: 0,
            }}>
              {rawText}
            </p>
          ) : (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>대본 없음</p>
          )}
        </div>
      )}
    </div>
  );
}


function ChapterList({ seriesId, chapters, expandedCh, setExpandedCh }: {
  seriesId: string;
  chapters: Array<{ chapter: number; role: string; approved?: boolean }>;
  expandedCh: number | null;
  setExpandedCh: (n: number | null) => void;
}) {
  if (!chapters.length) return null;

  const ROLE_COLOR: Record<string, string> = {
    '도입부': '#6366f1', '전개': '#3b82f6', '클라이맥스': '#f59e0b', '결말': '#10b981',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {chapters.map(ch => {
        const isOpen = expandedCh === ch.chapter;
        const roleColor = ROLE_COLOR[ch.role] ?? '#6366f1';
        return (
          <div key={ch.chapter} className="glass-dark" style={{
            borderRadius: '12px',
            border: `1px solid ${ch.approved ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.18)'}`,
            overflow: 'hidden',
          }}>
            {/* 헤더 */}
            <div
              onClick={() => setExpandedCh(isOpen ? null : ch.chapter)}
              style={{ padding: '0.85rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
            >
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '0.18rem 0.55rem',
                borderRadius: '999px', background: `${roleColor}22`, color: roleColor, flexShrink: 0,
              }}>
                {ch.role}
              </span>
              <span style={{ fontWeight: 600, fontSize: '0.92rem', flex: 1, color: 'rgba(255,255,255,0.92)' }}>
                {ch.chapter}화
              </span>
              {ch.approved && (
                <span className="glass-badge glass-badge--success" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  승인
                </span>
              )}
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', flexShrink: 0 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>
            {/* 대본 탭 — 순수 대본 | 씬/컷 구조 */}
            {isOpen && <ChapterScriptTabs seriesId={seriesId} chapter={ch.chapter} />}
          </div>
        );
      })}
    </div>
  );
}

function YouTubeConnectBanner() {
  return (
    <div style={{ padding: '1.25rem', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
      <p style={{ color: '#fca5a5', fontWeight: 600, marginBottom: '0.75rem' }}>
        YouTube 업로드를 위해 Google 계정 연결이 필요합니다.
      </p>
      <button
        onClick={() => window.open('http://localhost:8001/api/v1/youtube/auth', '_blank', 'width=600,height=700')}
        style={{ padding: '0.55rem 1.4rem', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
        YouTube 연결하기
      </button>
    </div>
  );
}

function VideoPreview({ url }: { url: string }) {
  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>최종 영상 확인</h2>
      <video src={url} controls style={{ width: '100%', borderRadius: '14px', background: '#000', maxHeight: '520px' }} />
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
        영상 확인 후 아래 승인 버튼을 눌러 업로드를 시작하세요.
      </p>
    </div>
  );
}

function DonePanel({ url }: { url: string }) {
  return (
    <div className="glass-dark" style={{ padding: '2.5rem', textAlign: 'center', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '16px', marginTop: '1rem' }}>
      <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎉</p>
      <p style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '1.25rem' }}>YouTube 업로드 완료</p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        onClick={(e) => { e.preventDefault(); window.open(url, '_blank', 'noopener,noreferrer'); }}
        style={{ display: 'inline-block', padding: '0.75rem 2.25rem', background: '#ff0000', color: '#fff', borderRadius: '10px', fontWeight: 700, textDecoration: 'none', fontSize: '1rem' }}>
        YouTube에서 보기 →
      </a>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', marginTop: '1rem' }}>{url}</p>
    </div>
  );
}

function ScriptDownloadPanel({ series, chapters, busy = false }: {
  series: Series | null;
  chapters: Array<{ chapter: number; role: string; approved?: boolean }>;
  busy?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);

  async function downloadJson() {
    setDownloading(true);
    try {
      const seriesId = (series as any)?.id;

      // 각 챕터의 씬/컷 데이터를 v3_scenes에서 가져옴 (HOOK 복사본·마스터코드 포함)
      const chaptersWithScenes = await Promise.all(
        chapters.map(async ch => {
          const res = await fetch(`${API}/series/${seriesId}/chapters/${ch.chapter}/scenes`);
          const cuts = res.ok ? await res.json() : [];
          return { chapter: ch.chapter, role: ch.role, approved: ch.approved, cuts };
        })
      );

      const data = {
        series_id: seriesId,
        series_code: (series as any)?.series_code,
        title: (series as any)?.title,
        topic: (series as any)?.topic,
        exported_at: new Date().toISOString(),
        chapters: chaptersWithScenes,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(series as any)?.series_code ?? seriesId ?? 'script'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="glass-dark" style={{
      padding: '1rem 1.25rem',
      borderRadius: '12px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.15rem' }}>JSON 다운로드</p>
        <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
          {chapters.length}화 · 전체 씬/컷 포함 (마스터코드 포함)
        </p>
      </div>
      <button
        onClick={downloadJson}
        disabled={downloading || busy}
        className="glass-btn glass-btn--ghost glass-btn--sm"
        style={{ borderRadius: '8px' }}
      >
        {busy ? '교정/재생성 중…' : downloading ? '준비 중…' : `↓ ${(series as any)?.series_code ?? 'script'}.json`}
      </button>
    </div>
  );
}

function ChapterDonePanel({ seriesId, completedChapter, onNext }: {
  seriesId: string;
  completedChapter: number;
  onNext: () => void;
}) {
  const [action, setAction] = useState<'idle' | 'next' | 'terminate'>('idle');
  const [confirmTerminate, setConfirmTerminate] = useState(false);

  async function handleNext() {
    setAction('next');
    try {
      await fetch(`${API}/series/${seriesId}/next-chapter`, { method: 'POST' });
      onNext();
    } finally {
      setAction('idle');
    }
  }

  async function handleTerminate() {
    setAction('terminate');
    try {
      await fetch(`${API}/series/${seriesId}/terminate`, { method: 'POST' });
      onNext();
    } finally {
      setAction('idle');
      setConfirmTerminate(false);
    }
  }

  return (
    <div className="glass-dark" style={{
      padding: '2rem', borderRadius: '16px', marginTop: '1rem',
      border: '1px solid rgba(16,185,129,0.3)',
    }}>
      {/* 완료 헤더 */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <p style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>✅</p>
        <p style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.35rem' }}>
          {completedChapter}화 업로드 완료
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
          독자 반응을 확인하고 계속 여부를 결정하세요
        </p>
      </div>

      {/* 발행 채널 링크 (추후 실제 URL로 교체) */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.75rem', justifyContent: 'center' }}>
        <a href="#" style={{
          padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
          background: 'rgba(3,199,90,0.15)', color: '#03c75a',
          border: '1px solid rgba(3,199,90,0.3)', textDecoration: 'none',
        }}>
          네이버 웹소설 →
        </a>
        <a href="#" style={{
          padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
          background: 'rgba(255,0,0,0.1)', color: '#ff4444',
          border: '1px solid rgba(255,0,0,0.25)', textDecoration: 'none',
        }}>
          YouTube →
        </a>
      </div>

      {/* 행동 버튼 */}
      {!confirmTerminate ? (
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button
            onClick={() => setConfirmTerminate(true)}
            disabled={action !== 'idle'}
            className="glass-btn glass-btn--danger"
            style={{ borderRadius: '10px' }}
          >
            시리즈 종결
          </button>
          <button
            onClick={handleNext}
            disabled={action !== 'idle'}
            className="glass-btn glass-btn--accent"
            style={{ borderRadius: '10px' }}
          >
            {action === 'next' ? '시작 중…' : `${completedChapter + 1}화 시작`}
          </button>
        </div>
      ) : (
        <div style={{
          padding: '1rem', borderRadius: '12px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
            {completedChapter}화로 시리즈를 종결합니다. 계속할 수 없습니다.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
            <button
              onClick={() => setConfirmTerminate(false)}
              style={{
                padding: '0.5rem 1.2rem', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent', color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              취소
            </button>
            <button
              onClick={handleTerminate}
              disabled={action !== 'idle'}
              style={{
                padding: '0.5rem 1.2rem', borderRadius: '8px', border: 'none',
                background: '#ef4444', color: '#fff',
                fontWeight: 700, cursor: action !== 'idle' ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {action === 'terminate' ? '처리 중…' : '종결 확정'}
            </button>
          </div>
        </div>
      )}

      {/* 누적 화수 표시 */}
      <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
        현재 {completedChapter}화 완료 · 무제한 연재 가능
      </p>
    </div>
  );
}

const ART_STYLES_ACTIVE = [
  { key: 'polystyle', label: '폴리 스타일' },
] as const;

const ART_STYLES_COMING = [
  { key: 'masako',   label: '마사코 스타일' },
  { key: 'noir_oil', label: '누아르 유화'   },
] as const;

type ArtStyleType = typeof ART_STYLES_ACTIVE[number]['key'];

function ScriptApprovalButtons({
  approving, disabled = false, onApprove,
}: {
  approving: string | null;
  disabled?: boolean;
  onApprove: (artStyle: string) => void;
}) {
  const [artStyle, setArtStyle] = useState<ArtStyleType>('polystyle');
  const isBusy = !!approving || disabled;
  return (
    <div className="glass-dark" style={{
      padding: '1.5rem 2rem',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: '16px',
    }}>
      <p style={{
        fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)',
        textAlign: 'center', marginBottom: '1rem',
      }}>
        대본을 승인하고 화풍을 선택하세요
      </p>

      {/* 화풍 선택 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.25rem' }}>
        {/* 활성 스타일 */}
        {ART_STYLES_ACTIVE.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => !isBusy && setArtStyle(key)}
            disabled={isBusy}
            style={{
              padding: '0.4rem 1.2rem', borderRadius: '20px',
              border: artStyle === key ? '1.5px solid rgba(245,158,11,0.8)' : '1px solid rgba(255,255,255,0.15)',
              background: artStyle === key ? 'rgba(245,158,11,0.18)' : 'transparent',
              color: artStyle === key ? '#f59e0b' : 'rgba(255,255,255,0.45)',
              fontSize: '0.82rem', fontWeight: artStyle === key ? 700 : 400,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}

        {/* 준비 중 스타일 */}
        {ART_STYLES_COMING.map(({ label }) => (
          <span
            key={label}
            title="준비 중"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.4rem 1.2rem', borderRadius: '20px',
              border: '1px dashed rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.2)',
              fontSize: '0.82rem', cursor: 'not-allowed',
            }}
          >
            {label}
            <span style={{
              fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
              padding: '0.1rem 0.4rem', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.25)',
            }}>
              준비 중
            </span>
          </span>
        ))}
      </div>

      {/* 승인 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => !isBusy && onApprove(artStyle)}
          disabled={isBusy}
          className="glass-btn glass-btn--amber glass-btn--lg"
          style={{ borderRadius: '12px' }}
        >
          {approving ? '처리 중…' : '대본 승인 → 키프레임 제작'}
        </button>
      </div>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="glass-dark" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.35)', marginTop: '1rem' }}>
      <p style={{ color: '#f87171', fontWeight: 600, marginBottom: '0.5rem' }}>오류 발생</p>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.88rem' }}>{error}</p>
      <button onClick={onRetry} className="glass-btn glass-btn--danger glass-btn--sm" style={{ marginTop: '1rem', borderRadius: '8px' }}>
        재시도
      </button>
    </div>
  );
}

type PipelineLog = {
  id: string;
  status: string;
  step: string;
  attempt: number;
  started_at: string;
  finished_at?: string;
  error_detail?: string;
  metadata?: Record<string, unknown>;
};

function MetaSummary({ step, meta }: { step: string; meta?: Record<string, unknown> }) {
  if (!meta || Object.keys(meta).length === 0) return null;
  const items: string[] = [];

  if (step === 'world') {
    if (meta.title) items.push(`제목: ${meta.title}`);
  }
  if (step === 'casting') {
    if (meta.trope) items.push(`트롭: ${meta.trope}`);
    if (Array.isArray(meta.cast)) items.push((meta.cast as string[]).join(' · '));
  }
  if (step === 'architect') {
    if (meta.chapters) items.push(`${meta.chapters}챕터 구조 설계`);
  }
  if (step === 'script') {
    if (meta.chapter) items.push(`${meta.chapter}화`);
    if (meta.role) items.push(`역할: ${meta.role}`);
    if (meta.scenes) items.push(`씬 ${meta.scenes}개`);
  }
  if (step === 'keyframe') {
    if (meta.scenes) items.push(`키프레임 ${meta.scenes}개`);
    if (meta.note) items.push(String(meta.note));
  }
  if (step === 'tts') {
    if (meta.scenes) items.push(`음성 ${meta.scenes}개`);
    if (meta.note) items.push(String(meta.note));
  }
  if (step === 'render') {
    if (meta.clips) items.push(`클립 ${meta.clips}개`);
    if (meta.final_url) items.push('최종 영상 생성 완료');
    if (meta.note) items.push(String(meta.note));
  }
  if (step === 'upload') {
    if (meta.youtube_url) items.push(`YouTube 업로드 완료`);
    if (meta.video_id) items.push(`ID: ${meta.video_id}`);
  }
  if (step === 'youtube_manage') {
    if (meta.video_id) items.push(`메타데이터 업데이트: ${meta.video_id}`);
    if (meta.note) items.push(String(meta.note));
  }
  if (step === 'naver_upload') {
    if (meta.chapter) items.push(`${meta.chapter}화 업로드`);
    if (meta.naver_url) items.push('네이버 업로드 완료');
    if (meta.skipped || meta.note) items.push(String(meta.note || '건너뜀'));
  }

  if (items.length === 0) return null;
  return (
    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.2rem', lineHeight: 1.5 }}>
      {items.join('  /  ')}
    </div>
  );
}

const LOG_STEP_LABELS: Record<string, string> = {
  awaiting_source_upload: '소스 업로드 대기',
  world: '세계관 생성',
  casting: '캐스팅',
  script: '대본 생성',
  awaiting_script_approval: '대본 승인 대기',
  keyframe: '키프레임 생성',
  awaiting_tts: 'TTS 시작 대기',
  tts: 'TTS 음성 생성',
  render: '영상 렌더링',
  awaiting_upload_approval: '업로드 승인 대기',
  upload: 'YouTube 업로드',
  chapter_done: '챕터 완료',
  done: '완료',
  failed: '실패',
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  success: { bg: 'rgba(16,185,129,0.15)', color: '#10b981', label: '성공' },
  failed:  { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444', label: '실패' },
  running: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: '실행 중' },
  retrying:{ bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', label: '재시도' },
};

function formatDuration(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

function SeriesLogs({ seriesId, seriesTitle }: { seriesId: string; seriesTitle: string }) {
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // IDB 캐시에서 즉시 복원 (API 응답 전 빈 상태 방지)
  useEffect(() => {
    getPipelineLogs<PipelineLog>(seriesId).then(cached => {
      if (cached.length > 0) setLogs(cached);
    });
  }, [seriesId]);

  const load = useCallback(() => {
    fetch(`${API}/series/${seriesId}/logs`)
      .then(r => r.ok ? r.json() : null)
      .then((data: PipelineLog[] | null) => {
        if (!data) return;
        setLogs(data);
        setPipelineLogs<PipelineLog>(seriesId, data, seriesTitle);
      })
      .catch(() => {});
  }, [seriesId, seriesTitle]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div style={{ marginTop: '3rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>
          실행 로그
        </h2>
        <button
          onClick={load}
          style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.4)', padding: '0.25rem 0.75rem',
            borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
          }}
        >
          새로고침
        </button>
      </div>

      {logs.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem' }}>로그 없음</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {logs.map((log, idx) => {
            const badge = STATUS_BADGE[log.status] ?? { bg: 'rgba(255,255,255,0.05)', color: '#fff', label: log.status };
            const isExpanded = expandedId === log.id;
            const isLatest = idx === 0;

            return (
              <div
                key={log.id}
                className="glass-dark"
                style={{
                  borderRadius: '10px',
                  border: `1px solid ${isLatest ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'}`,
                  overflow: 'hidden',
                }}
              >
                {/* 로그 행 */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  style={{
                    padding: '0.6rem 0.85rem',
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    cursor: log.error_detail ? 'pointer' : 'default',
                    fontSize: '0.82rem',
                  }}
                >
                  {/* 상태 뱃지 */}
                  <span className={`glass-badge glass-badge--${log.status === 'success' ? 'success' : log.status === 'failed' ? 'error' : log.status === 'running' ? 'running' : 'amber'}`} style={{ flexShrink: 0, minWidth: 52, justifyContent: 'center', textTransform: 'none', letterSpacing: 0 }}>
                    {badge.label}
                  </span>

                  {/* 단계명 */}
                  <span style={{
                    color: isLatest ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
                    fontWeight: isLatest ? 600 : 400, flex: 1,
                  }}>
                    {LOG_STEP_LABELS[log.step] ?? log.step}
                    <MetaSummary step={log.step} meta={log.metadata} />
                  </span>

                  {/* 소요 시간 */}
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', flexShrink: 0 }}>
                    {formatDuration(log.started_at, log.finished_at)}
                  </span>

                  {/* 시작 시각 */}
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', flexShrink: 0, minWidth: 55, textAlign: 'right' }}>
                    {new Date(log.started_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>

                  {/* 시도 횟수 */}
                  {log.attempt > 1 && (
                    <span style={{ color: '#b45309', fontSize: '0.7rem', flexShrink: 0 }}>
                      ×{log.attempt}
                    </span>
                  )}

                  {/* 오류 펼치기 아이콘 */}
                  {log.error_detail && (
                    <span style={{ color: '#dc2626', fontSize: '0.7rem', flexShrink: 0 }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </div>

                {/* 오류 상세 (펼칠 때) */}
                {isExpanded && log.error_detail && (
                  <div style={{
                    padding: '0.65rem 0.85rem',
                    borderTop: '1px solid rgba(239,68,68,0.15)',
                    background: 'rgba(239,68,68,0.06)',
                  }}>
                    <pre style={{
                      margin: 0, fontSize: '0.74rem', color: '#991b1b',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      lineHeight: 1.6, fontFamily: "var(--font-en), 'Pretendard', sans-serif",
                    }}>
                      {log.error_detail}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
