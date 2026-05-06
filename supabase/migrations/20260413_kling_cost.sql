-- kling_clip_url: Kling AI image-to-video 결과 MP4 (Ken Burns clip_url과 별도)
-- cost_usd: 씬별 API 비용 (이미지 생성 + Kling 등 누적)
ALTER TABLE v3_scenes
  ADD COLUMN IF NOT EXISTS kling_clip_url TEXT,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 4) DEFAULT 0;

-- 시리즈별 총비용 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_v3_scenes_cost ON v3_scenes (series_id, cost_usd);
