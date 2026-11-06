/**
 * §5.3 #10-6 (H) — 멤버 지시문(`rules`)을 프로젝트 스킬 한 장으로 내보낸다. 스킬은 필요할 때만 읽혀(점진 공개),
 * 멤버 하나를 없애고 그 일을 한 에이전트에 접는 길이 된다. 자리는 기존 스킬 공유가 쓰는 프로젝트 스킬 자리 그대로다.
 * 같은 이름이 있으면 덮지 않는다(사용자 산출물).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlatformName } from '@vibisual/shared';
import { assertWithinSkillRoot, skillRoots, validSkillName, type SkillProvider } from './skillSharingPaths.js';

/** 설명 줄 상한(글자) — 스킬 목록이 이 한 줄로 고른다. */
const SKILL_DESCRIPTION_MAX = 200;
const SKILL_NAME_MAX = 64;
const FALLBACK_NAME = 'orchestra-member';

/** 표시명 → 스킬 폴더 이름. 글자·숫자·`_`·`-` 만 남기고(다른 언어 글자 포함) 64자에서 자른다. 비면 대체 이름. */
export function orchestraSkillSlug(label: string): string {
  const slug = label
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-$/, '');
  return slug !== '' && validSkillName(slug) ? slug : FALLBACK_NAME;
}

/** SKILL.md 본문 — 이름·설명 머리(한 줄, JSON 따옴표라 YAML 특수문자에 안전) + 지시문 원문. */
export function buildMemberSkillMarkdown(name: string, label: string, rules: string): string {
  const firstLine = rules.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '') ?? '';
  const raw = `${label} — ${firstLine}`.replace(/\s+/g, ' ').trim();
  const description = raw.length > SKILL_DESCRIPTION_MAX ? `${raw.slice(0, SKILL_DESCRIPTION_MAX - 1)}…` : raw;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${rules.trim()}\n`;
}

export type MemberSkillExportResult =
  | { ok: true; name: string; path: string }
  | { ok: false; status: number; error: string };

/** 프로젝트 스킬 자리에 새로 쓴다. 이미 있으면 409(덮지 않는다), 지시문이 비었으면 400. */
export function exportMemberSkill(args: {
  projectCwd: string;
  provider: SkillProvider;
  label: string;
  rules: string | undefined;
  platform: PlatformName;
  home: string;
}): MemberSkillExportResult {
  const rules = args.rules?.trim() ?? '';
  if (rules === '') return { ok: false, status: 400, error: 'member-rules-empty' };
  const root = skillRoots({ home: args.home, claudeHome: args.home, codexHome: args.home, platform: args.platform }, args.provider, args.projectCwd)
    .find((r) => r.scope === 'project');
  if (!root) return { ok: false, status: 400, error: 'invalid-scope' };
  const name = orchestraSkillSlug(args.label);
  const dir = path.join(root.dir, name);
  const file = path.join(dir, 'SKILL.md');
  try {
    assertWithinSkillRoot(root.dir, dir, args.platform);
    if (fs.existsSync(dir)) return { ok: false, status: 409, error: 'skill-exists' };
    fs.mkdirSync(dir, { recursive: true });
    // `wx` — 그 사이 다른 쪽이 만들었으면 덮지 않고 실패한다.
    fs.writeFileSync(file, buildMemberSkillMarkdown(name, args.label, rules), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    if (code === 'EEXIST') return { ok: false, status: 409, error: 'skill-exists' };
    if (err instanceof Error && err.name === 'SkillSharingError') return { ok: false, status: 400, error: err.message };
    throw err;
  }
  return { ok: true, name, path: file };
}
