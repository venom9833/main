-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS 활성화 — 전체 public 테이블
-- 적용일: 2026-04-16
-- 배경: Supabase 보안 경고 (rls_disabled_in_public) 대응
--
-- 정책 없음 = anon 키 전면 차단
-- service_role 키는 RLS 우회 → FastAPI 백엔드 영향 없음
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE v3_series          ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_chapters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_scenes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_pipeline_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_youtube_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_wiki_chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3_wiki_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_emoline  ENABLE ROW LEVEL SECURITY;
