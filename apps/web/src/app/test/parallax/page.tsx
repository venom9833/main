"use client";

/**
 * 임시 패럴랙스 테스트 페이지 — /test/parallax?series_id=...
 *
 * 1. 시리즈의 패럴랙스 가능 씬 목록 조회
 * 2. 씬별 "패럴랙스 렌더" 버튼
 * 3. 완료 후 비디오 미리보기
 */

import { useEffect, useState } from "react";

const API = "http://localhost:8001";

interface Scene {
  id: string;
  scene_code: string;
  type: string;
  status: string;
  bg_url: string | null;
  char_url: string | null;
  tts_url: string | null;
  clip_url: string | null;
  animation_type: string | null;
}

interface RenderResult {
  ok: boolean;
  clip_url?: string;
  cutout_url?: string;
  duration_sec?: number;
  frames?: number;
  error?: string;
}

export default function ParallaxTestPage() {
  const [seriesId, setSeriesId] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, RenderResult>>({});
  const [error, setError] = useState("");

  // URL ?series_id= 읽기
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sid = p.get("series_id") || "";
    if (sid) {
      setSeriesId(sid);
      fetchScenes(sid);
    }
  }, []);

  async function fetchScenes(sid: string) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/api/v1/test/parallax/scenes/${sid}`);
      const d = await r.json();
      setScenes(d.scenes || []);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function renderScene(sceneId: string, skipRembg = false) {
    setRendering((p) => ({ ...p, [sceneId]: true }));
    try {
      const r = await fetch(
        `${API}/api/v1/test/parallax/render/${sceneId}?skip_rembg=${skipRembg}`,
        { method: "POST" }
      );
      const d: RenderResult = await r.json();
      setResults((p) => ({ ...p, [sceneId]: d }));
      if (d.ok) {
        // 씬 목록 갱신
        setScenes((prev) =>
          prev.map((s) =>
            s.id === sceneId
              ? { ...s, clip_url: d.clip_url ?? null, animation_type: "parallax" }
              : s
          )
        );
      }
    } catch (e: unknown) {
      setResults((p) => ({ ...p, [sceneId]: { ok: false, error: String(e) } }));
    } finally {
      setRendering((p) => ({ ...p, [sceneId]: false }));
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto", fontFamily: "monospace" }}>
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 8 }}>
        패럴랙스 렌더링 테스트
      </h1>
      <p style={{ color: "#888", marginBottom: 24, fontSize: 13 }}>
        임시 테스트 라우터 — 62번 §6 Plan A · Remotion 2-레이어
      </p>

      {/* Series ID 입력 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          placeholder="series_id 입력"
          style={{
            flex: 1, padding: "8px 12px", border: "1px solid #333",
            borderRadius: 6, background: "#111", color: "#fff", fontSize: 13,
          }}
        />
        <button
          onClick={() => fetchScenes(seriesId)}
          disabled={!seriesId || loading}
          style={{
            padding: "8px 16px", background: "#1d4ed8", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13,
          }}
        >
          {loading ? "조회 중..." : "씬 목록 조회"}
        </button>
      </div>

      {error && (
        <div style={{ color: "#f87171", marginBottom: 16, fontSize: 13 }}>오류: {error}</div>
      )}

      {/* 씬 목록 */}
      {scenes.length > 0 && (
        <div>
          <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}>
            패럴랙스 가능 씬 {scenes.length}개 (bg + char + tts 모두 보유)
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {scenes.map((scene) => {
              const res = results[scene.id];
              const isRendering = rendering[scene.id];
              const clipUrl = res?.clip_url || scene.clip_url;
              return (
                <div
                  key={scene.id}
                  style={{
                    border: "1px solid #222", borderRadius: 8, padding: 16,
                    background: "#0a0a0a",
                  }}
                >
                  {/* 헤더 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <span style={{ fontWeight: "bold", fontSize: 14 }}>
                        {scene.scene_code}
                      </span>
                      <span style={{ marginLeft: 8, color: "#888", fontSize: 12 }}>
                        {scene.type} · {scene.status}
                        {scene.animation_type && ` · ${scene.animation_type}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {/* rembg 포함 렌더 */}
                      <button
                        onClick={() => renderScene(scene.id, false)}
                        disabled={isRendering}
                        style={{
                          padding: "6px 14px", background: "#7c3aed", color: "#fff",
                          border: "none", borderRadius: 6, cursor: isRendering ? "not-allowed" : "pointer",
                          fontSize: 12, opacity: isRendering ? 0.6 : 1,
                        }}
                      >
                        {isRendering ? "렌더 중..." : "패럴랙스 렌더 (rembg)"}
                      </button>
                      {/* rembg 스킵 렌더 (이미 RGBA인 경우) */}
                      <button
                        onClick={() => renderScene(scene.id, true)}
                        disabled={isRendering}
                        style={{
                          padding: "6px 14px", background: "#374151", color: "#fff",
                          border: "none", borderRadius: 6, cursor: isRendering ? "not-allowed" : "pointer",
                          fontSize: 12, opacity: isRendering ? 0.6 : 1,
                        }}
                      >
                        rembg 스킵
                      </button>
                    </div>
                  </div>

                  {/* 에셋 URL 표시 */}
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
                    <div>BG: {scene.bg_url?.slice(0, 70)}...</div>
                    <div>CHAR: {scene.char_url?.slice(0, 70)}...</div>
                    <div>TTS: {scene.tts_url?.slice(0, 70)}...</div>
                  </div>

                  {/* 렌더 결과 */}
                  {res && !res.ok && (
                    <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>
                      오류: {res.error}
                    </div>
                  )}
                  {res?.ok && (
                    <div style={{ marginTop: 8, color: "#34d399", fontSize: 12 }}>
                      완료 — {res.duration_sec?.toFixed(1)}초 / {res.frames}프레임
                    </div>
                  )}

                  {/* 비디오 플레이어 */}
                  {clipUrl && (
                    <div style={{ marginTop: 12 }}>
                      <video
                        key={clipUrl}
                        controls
                        style={{ width: "100%", maxWidth: 640, borderRadius: 6, border: "1px solid #333" }}
                      >
                        <source src={clipUrl} type="video/mp4" />
                      </video>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                        {clipUrl.slice(0, 80)}...
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scenes.length === 0 && !loading && seriesId && (
        <div style={{ color: "#6b7280", fontSize: 13 }}>
          해당 시리즈에 bg + char + tts 모두 보유한 씬 없음
        </div>
      )}
    </div>
  );
}
