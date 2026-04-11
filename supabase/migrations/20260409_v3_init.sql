-- pgvector 확장
create extension if not exists vector;

-- ── v3_series ─────────────────────────────────────────────────────────────────
create table if not exists v3_series (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default '',
  topic         text not null,
  status        text not null default 'draft',
  world_data    jsonb not null default '{}',
  settings      jsonb not null default '{}',
  pipeline_step text not null default 'idle',
  error_detail  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── v3_chapters ───────────────────────────────────────────────────────────────
create table if not exists v3_chapters (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null references v3_series(id) on delete cascade,
  chapter     int not null,
  role        text not null default '',
  content     text,
  meta        jsonb default '{}',
  approved    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique(series_id, chapter)
);

-- ── v3_scenes ─────────────────────────────────────────────────────────────────
create table if not exists v3_scenes (
  id            uuid primary key default gen_random_uuid(),
  series_id     uuid not null references v3_series(id) on delete cascade,
  chapter       int not null,
  scene_index   int not null,
  scene_code    text,
  text          text,
  image_hint    text,
  is_hook       boolean default false,
  type          text default 'narration',
  sub_scenes    jsonb default '[]',
  keyframe_url  text,
  tts_url       text,
  srt_url       text,
  clip_url      text,
  status        text not null default 'pending',
  error_detail  text,
  created_at    timestamptz not null default now(),
  unique(series_id, chapter, scene_index)
);

-- ── v3_pipeline_runs ──────────────────────────────────────────────────────────
create table if not exists v3_pipeline_runs (
  id           uuid primary key default gen_random_uuid(),
  series_id    uuid not null references v3_series(id) on delete cascade,
  step         text not null,
  status       text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  attempt      int not null default 1,
  error_detail text,
  metadata     jsonb default '{}'
);

-- ── v3_youtube_uploads ────────────────────────────────────────────────────────
create table if not exists v3_youtube_uploads (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null references v3_series(id) on delete cascade,
  chapter     int,
  video_id    text,
  title       text,
  status      text not null,
  upload_url  text,
  youtube_url text,
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

-- ── v3_wiki_chunks (RAG) ──────────────────────────────────────────────────────
create table if not exists v3_wiki_chunks (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null references v3_series(id) on delete cascade,
  source_type text not null,
  source_ref  text,
  content     text not null,
  embedding   vector(768),
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists v3_wiki_chunks_embedding_idx
  on v3_wiki_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists v3_wiki_chunks_series_idx
  on v3_wiki_chunks(series_id, source_type);

-- ── v3_wiki_pages (4개 핵심 페이지) ──────────────────────────────────────────
create table if not exists v3_wiki_pages (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null references v3_series(id) on delete cascade,
  slug        text not null,
  content_md  text not null default '',
  updated_at  timestamptz not null default now(),
  unique(series_id, slug)
);

-- ── 인덱스 ────────────────────────────────────────────────────────────────────
create index if not exists v3_series_status_idx on v3_series(status);
create index if not exists v3_chapters_series_idx on v3_chapters(series_id, chapter);
create index if not exists v3_scenes_series_idx on v3_scenes(series_id, chapter, scene_index);
create index if not exists v3_pipeline_runs_series_idx on v3_pipeline_runs(series_id, started_at desc);

-- ── match_wiki_chunks RPC ─────────────────────────────────────────────────────
create or replace function match_wiki_chunks(
  p_series_id       uuid,
  p_query_embedding vector(768),
  p_match_count     int default 10,
  p_score_threshold float default 0.65
)
returns table (id uuid, content text, source_type text, source_ref text, similarity float)
language sql stable as $$
  select id, content, source_type, source_ref,
         1 - (embedding <=> p_query_embedding) as similarity
  from v3_wiki_chunks
  where series_id = p_series_id
    and 1 - (embedding <=> p_query_embedding) > p_score_threshold
  order by similarity desc
  limit p_match_count;
$$;

-- ── updated_at 자동 갱신 트리거 ──────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger v3_series_updated_at
  before update on v3_series
  for each row execute function update_updated_at();
