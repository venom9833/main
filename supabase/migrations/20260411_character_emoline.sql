-- ── character_emoline ─────────────────────────────────────────────────────────
-- 전역 캐릭터 감정선 영구 저장 테이블
-- 시리즈 무관, 사용자가 수정하지 않는 한 유지
-- edges: ReactFlow 엣지 배열 (source/target/type/data{label,color})

create table if not exists character_emoline (
  id          integer primary key default 1,   -- 단일 전역 행
  edges       jsonb   not null default '[]',
  updated_at  timestamptz not null default now()
);

-- 초기 행 보장 (없으면 삽입)
insert into character_emoline (id, edges)
values (1, '[]')
on conflict (id) do nothing;

-- updated_at 자동 갱신 트리거
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger character_emoline_updated_at
  before update on character_emoline
  for each row execute function set_updated_at();
