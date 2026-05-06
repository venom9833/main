import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import SkillsClient, { type SkillMeta } from './SkillsClient';
import translations from './translations';

/* ── 경로: apps/web → ../../.claude/skills ── */
const SKILLS_DIR = path.resolve(process.cwd(), '../../.claude/skills');

/* ── frontmatter 파서 (YAML subset: scalar + block scalar >) ── */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = '';
  let isBlock = false;
  const blockLines: string[] = [];

  const flushBlock = () => {
    if (isBlock && currentKey) result[currentKey] = blockLines.join(' ').trim();
    isBlock = false;
    blockLines.length = 0;
  };

  for (const line of lines) {
    const keyMatch = line.match(/^([\w][\w-]*)\s*:\s*(.*)/);
    if (keyMatch) {
      flushBlock();
      const [, key, val] = keyMatch;
      currentKey = key;
      if (val.trim() === '>') {
        isBlock = true;
      } else {
        result[key] = val.trim();
      }
    } else if (isBlock) {
      if (line.match(/^\s+\S/)) blockLines.push(line.trim());
    }
  }
  flushBlock();
  return result;
}

/* ── 자동 카테고리 분류 ── */
const CAT_RULES: [string, RegExp][] = [
  ['AI/Gemini',  /gemini|vertex|google.gen/i],
  ['문서조회',   /context7|find.docs|find_docs/i],
  ['Next.js',    /next.js|nextjs|next.best|next.cache|next.compile|next.upgrade/i],
  ['React',      /react|composition.pattern|view.transition/i],
  ['UI/UX',      /design|ux.design|ui.ux|typography|web.design|impact.design|innovative.ux|controlled.ux|bencium.*ux/i],
  ['배포',       /vercel|deploy/i],
  ['아키텍처',   /architect|vanity.engineer|renaissance/i],
  ['문서조회',   /find.docs/i],
  ['생산성',     /adaptive.commun|aeo|negentropy|organic|relationship/i],
  ['핵심',       /investigate|^ship$|^qa$|^review$|checkpoint|save.session|verify|^init$/i],
];

function categorize(slug: string, desc: string): string {
  const text = slug + ' ' + desc;
  for (const [cat, re] of CAT_RULES) {
    if (re.test(text)) return cat;
  }
  return '기타';
}

/* ── 트리거 문장 추출 (description에서 패턴 매칭) ── */
function extractTriggers(slug: string, desc: string, whenToUse?: string): string[] {
  const src = whenToUse ?? desc;
  const sentences = src
    .split(/[.!?]|(?:Triggers on:|Use when:|Activate when:|when the user)/i)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 10 && s.length < 120);
  return sentences.slice(0, 4);
}

/* ── 뱃지 생성 ── */
function makeBadge(slug: string): string {
  return slug
    .replace(/^bencium-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Ux/, 'UX')
    .replace(/Api/, 'API')
    .replace(/Mcp/, 'MCP')
    .replace(/Aeo/, 'AEO');
}

/* ── 자동 플래그 ── */
const AUTO_SLUGS = new Set([
  'typography', 'adaptive-communication', 'vanity-engineering-review',
  'human-architect-mindset', 'find-docs', 'gemini-api-dev', 'context7-mcp',
]);

/* ── 스킬 로딩 ── */
async function loadSkills(): Promise<SkillMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.md')) continue; // 루트 레벨 .md 파일 무시

    const skillPath = path.join(SKILLS_DIR, entry);
    try {
      const s = await stat(skillPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = path.join(skillPath, 'SKILL.md');
    let content: string;
    try {
      content = await readFile(skillMdPath, 'utf-8');
    } catch {
      continue; // SKILL.md 없으면 스킵
    }

    const fm = parseFrontmatter(content);
    const slug = entry;
    const name = fm.name ?? slug;
    const enDescription = fm.description ?? fm.desc ?? '';
    const whenToUse = fm.when_to_use ?? '';

    /* 한국어 번역 우선, 없으면 영문 원문 사용 */
    const ko = translations[slug];
    const description = ko?.description ?? enDescription;
    const triggers = ko?.triggers ?? extractTriggers(slug, enDescription, whenToUse || undefined);

    const cat = categorize(slug, enDescription);
    const badge = makeBadge(slug);
    const auto = AUTO_SLUGS.has(slug) ||
      /auto.apply|auto-apply|always apply|all conversations|proactively/i.test(enDescription + whenToUse);

    skills.push({ slug, name, description, cat, badge, auto, triggers });
  }

  /* 카테고리 우선순위 정렬 */
  const CAT_ORDER = ['핵심', 'AI/Gemini', '문서조회', '아키텍처', 'UI/UX', 'React', 'Next.js', '배포', '생산성', '기타'];
  skills.sort((a, b) => {
    const ai = CAT_ORDER.indexOf(a.cat);
    const bi = CAT_ORDER.indexOf(b.cat);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.slug.localeCompare(b.slug);
  });

  return skills;
}

export default async function SkillsPage() {
  const skills = await loadSkills();
  return <SkillsClient skills={skills} />;
}
