-- v3_scenes: 씬>컷 계층 구조 추가
-- scene_index = 서사 씬 번호, cut_index = 씬 내 렌더링 컷 번호

-- 컷 번호 컬럼 추가 (기존 행 = 컷 1로 간주)
alter table v3_scenes
  add column if not exists cut_index int not null default 1,
  add column if not exists duration_seconds float default 4.5,
  add column if not exists image_prompt text;

-- 기존 unique(series_id, chapter, scene_index) 제약 제거
alter table v3_scenes
  drop constraint if exists v3_scenes_series_id_chapter_scene_index_key;

-- 새 unique: (series_id, chapter, scene_index, cut_index)
alter table v3_scenes
  add constraint v3_scenes_unique_cut
  unique(series_id, chapter, scene_index, cut_index);

-- 인덱스 업데이트
drop index if exists v3_scenes_series_idx;
create index if not exists v3_scenes_series_idx
  on v3_scenes(series_id, chapter, scene_index, cut_index);
