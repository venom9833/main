// ============================================================
// WARNING: V3 CORE -- 웹소설 파이프라인 핵심 파일
// 이 파일은 V3(LinkDropV3)에서만 수정합니다.
// V2 Claude 세션은 이 파일을 직접 수정하지 말 것.
// 로직 변경이 필요하면 반드시 V3 작업 세션에 요청할 것.
// ============================================================
// ── 파이프라인 단계 ──────────────────────────────────────────────────────────
export type PipelineStep =
  | 'idle'
  | 'awaiting_source_upload'
  | 'world'
  | 'awaiting_world_approval'
  | 'casting'
  | 'awaiting_casting_approval'
  | 'architect'
  | 'script'
  | 'awaiting_script_approval'
  | 'awaiting_keyframe_setup'
  | 'keyframe'
  | 'awaiting_tts'
  | 'tts'
  | 'render'
  | 'awaiting_upload_approval'
  | 'upload'
  | 'youtube_manage'
  | 'naver_upload'
  | 'chapter_done'
  | 'done'
  | 'failed';

export type SeriesStatus = 'draft' | 'world_ready' | 'scripting' | 'script_ready'
  | 'rendering' | 'render_ready' | 'uploading' | 'published' | 'failed';

// ── 세계관 설정 ───────────────────────────────────────────────────────────────
export interface SeriesSettings {
  genre?: string;
  style?: string;
  relationship?: string;
  conflictTypes?: string[];
  artStyle?: string;
  resolution?: '1920x1080' | '1080x1920';
  charA?: string;
  charB?: string;
  charAName?: string;
  charBName?: string;
  youtubeToken?: string;
  keyframeProvider?: string;
  ttsGender?: 'female' | 'male';
}

// ── 시리즈 ───────────────────────────────────────────────────────────────────
export interface Series {
  id: string;
  title: string;
  topic: string;
  status: SeriesStatus;
  worldData: Record<string, unknown>;
  settings: SeriesSettings;
  pipelineStep: PipelineStep;
  errorDetail?: string;
  createdAt: string;
  updatedAt: string;
}

// ── 챕터 ─────────────────────────────────────────────────────────────────────
export interface Chapter {
  id: string;
  seriesId: string;
  chapter: number;
  role: string; // 도입부 | 전개 | 클라이맥스 | 결말
  content?: string;
  meta?: ChapterMeta;
  approved: boolean;
  errorDetail?: string;
  createdAt: string;
}

export interface ChapterMeta {
  plantedForeshadows?: string[];
  openThreads?: string[];
  charStateDelta?: Record<string, string>;
}

// ── 씬 ───────────────────────────────────────────────────────────────────────
export type SceneStatus = 'pending' | 'tts_done' | 'keyframe_done' | 'render_done' | 'failed';

export interface Scene {
  id: string;
  seriesId: string;
  chapter: number;
  sceneIndex: number;
  sceneCode?: string;
  text?: string;
  imageHint?: string;
  isHook: boolean;
  type: 'narration' | 'dialogue' | 'mixed';
  subScenes: SubScene[];
  keyframeUrl?: string;
  ttsUrl?: string;
  srtUrl?: string;
  clipUrl?: string;
  status: SceneStatus;
  errorDetail?: string;
  durationSec?: number;
}

export interface SubScene {
  index: number;
  text: string;
  speaker?: string;
  emotion?: string;
}

// ── 파이프라인 실행 로그 ──────────────────────────────────────────────────────
export interface PipelineRun {
  id: string;
  seriesId: string;
  step: PipelineStep;
  status: 'running' | 'success' | 'failed' | 'retrying';
  startedAt: string;
  finishedAt?: string;
  attempt: number;
  errorDetail?: string;
}

// ── Wiki ─────────────────────────────────────────────────────────────────────
export type WikiSlug = 'world' | 'characters' | 'foreshadows' | 'timeline';

export interface WikiPage {
  id: string;
  seriesId: string;
  slug: WikiSlug;
  title?: string;
  contentMd: string;
  updatedAt: string;
}

export interface WikiChunk {
  id: string;
  content: string;
  sourceType: string;
  sourceRef?: string;
  similarity: number;
}

// ── IDB Draft 키 타입 ─────────────────────────────────────────────────────────
export type DraftKey =
  | `draft:world:${string}`
  | `draft:script:${string}:${number}`
  | `draft:settings:${string}`;
