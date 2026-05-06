-- v3_scenes: 씬별 생성 자산 URL 컬럼 추가
-- bg_url: 배경 이미지 (narration bg 또는 dialogue composite)
-- char_url: 캐릭터 누끼 이미지 (narration + 1인 parallax용)
-- lipsync_url: 립싱크 영상 URL (dialogue 전용)

ALTER TABLE v3_scenes
  ADD COLUMN IF NOT EXISTS bg_url      TEXT,
  ADD COLUMN IF NOT EXISTS char_url    TEXT,
  ADD COLUMN IF NOT EXISTS lipsync_url TEXT;
