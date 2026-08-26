/**
 * §5.10 v2 (B) — **스킬 자산(절차적 기억).**
 *
 * 카드 6번째 종류가 **아니라 별도 자산**이다. 카드는 "무엇이 사실인가"(선언적)를 담고,
 * 스킬은 "이럴 땐 이렇게 한다"(절차)를 담는다. 실측에서 `lesson` 209장(64%)이 사실은
 * 절차인데 선언적 카드로 잠겨 있었고, 카드 327장 중 263장(80%)이 한 번도 안 읽혔다 —
 * **카드는 누가 읽어 주기를 기다리지만 스킬은 그 작업을 시작할 때 자동으로 걸린다.**
 * 이 파일이 그 차이를 만든다.
 *
 * 실물: `<root>/.vibisual/brain/skills/<id>/SKILL.md`(프로젝트 층)
 *       `<root>/.vibisual/brain/agents/<agentId>/skills/<id>/SKILL.md`(에이전트 층)
 * frontmatter 는 agentskills.io 호환(`name`·`description`)이라 `.claude/skills` 와 같은
 * 문법으로 읽힌다 — 새 규격을 만들지 않는다.
 *
 * **개정 모델**: 폴더가 스킬의 정체성이고 `SKILL.md` 가 현재 판이다. 개정하면 현재 판을
 * `.archive/<id>-v<N>/SKILL.md` 로 **먼저 복사한 뒤** 새 판을 쓴다 — 중간에 죽어도 옛 판이
 * 어느 한쪽에는 남는다(§5.10 v3.81 §C 쓰기 순서와 같은 취지).
 *
 * 모든 쓰기는 `atomicWriteFileSync`(§3.2.1 ①)를 지난다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BRAIN_SKILLS_DIRNAME,
  BRAIN_SKILL_BODY_MAX_CHARS,
  BRAIN_SKILL_BUDGET,
  BRAIN_SKILL_DESCRIPTION_MAX_CHARS,
  BRAIN_SKILL_FILENAME,
  BRAIN_SKILL_INJECTION_TOP_K,
  BRAIN_SKILL_PROMOTE_MIN_LESSONS,
  BRAIN_BIGRAM_MIN_SCORE,
  type BrainCard,
  type BrainCardScope,
  type BrainSkill,
  type BrainSkillStatus,
  type BrainVerifyState,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { atomicWriteFileSync } from './statePersistence.js';
import { charBigrams, coverage, tokenize } from './brainService.js';

const ARCHIVE_DIRNAME = '.archive';


/** 스킬 생성·개정 입력. `id` 를 주면 그 스킬의 개정, 없으면 새로 만든다. */
export interface BrainSkillInput {
  id?: string;
  name: string;
  description: string;
  body: string;
  scope: BrainCardScope;
  agentId?: string;
  topic?: string;
  files?: string[];
  sourceSessionId?: string;
  originCardIds?: string[];
  verifyState?: BrainVerifyState;
}

/** lesson 승급 후보 한 건 — "이 주제 카드 N장이 한 절차를 말하고 있다". */
export interface BrainSkillPromotionCandidate {
  topic: string;
  scope: BrainCardScope;
  agentId?: string;
  cards: BrainCard[];
}

// ─── frontmatter(YAML-lite) — 카드와 같은 규약 ───

function escapeScalar(v: string): string {
  return v.replace(/\r?\n/g, ' ').trim();
}

/** slug 정규화 — 폴더명이 되므로 경로 문자를 남기지 않는다. */
export function toSkillId(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return s.length > 0 ? s : `skill-${Date.now().toString(36)}`;
}

export function serializeSkill(skill: BrainSkill): string {
  const lines: string[] = ['---'];
  // agentskills.io 가 요구하는 두 필드를 맨 앞에 — 남의 도구가 앞부분만 읽어도 성립한다.
  lines.push(`name: ${escapeScalar(skill.name)}`);
  lines.push(`description: ${escapeScalar(skill.description)}`);
  lines.push(`id: ${skill.id}`);
  lines.push(`scope: ${skill.scope}`);
  if (skill.agentId) lines.push(`agentId: ${skill.agentId}`);
  if (skill.topic) lines.push(`topic: ${escapeScalar(skill.topic)}`);
  if (skill.files.length > 0) lines.push(`files: ${skill.files.join(',')}`);
  lines.push(`status: ${skill.status}`);
  lines.push(`version: ${skill.version}`);
  lines.push(`verifyState: ${skill.verifyState}`);
  if (skill.supersedes) lines.push(`supersedes: ${skill.supersedes}`);
  if (skill.supersededBy) lines.push(`supersededBy: ${skill.supersededBy}`);
  lines.push(`createdAt: ${skill.createdAt}`);
  lines.push(`updatedAt: ${skill.updatedAt}`);
  if (skill.lastReferencedAt != null) lines.push(`lastReferencedAt: ${skill.lastReferencedAt}`);
  lines.push(`refCount: ${skill.refCount}`);
  if (skill.helpfulCount != null && skill.helpfulCount > 0) lines.push(`helpfulCount: ${skill.helpfulCount}`);
  if (skill.sourceSessionId) lines.push(`sourceSessionId: ${skill.sourceSessionId}`);
  if (skill.originCardIds && skill.originCardIds.length > 0) {
    lines.push(`originCardIds: ${skill.originCardIds.join(',')}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(skill.body);
  return lines.join('\n');
}

const SKILL_STATUSES = new Set<BrainSkillStatus>(['draft', 'active', 'superseded', 'archived']);
const VERIFY_STATES = new Set<BrainVerifyState>(['candidate', 'verified', 'needs-check', 'contested', 'rejected']);

export function parseSkill(
  text: string,
  fallback: { id: string; scope: BrainCardScope; agentId?: string },
): BrainSkill | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const head = m[1] ?? '';
  const rest = m[2] ?? '';
  const fm = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(': ');
    if (i <= 0) continue;
    fm.set(line.slice(0, i).trim(), line.slice(i + 2).trim());
  }
  const name = fm.get('name');
  const description = fm.get('description');
  // agentskills.io 필수 두 필드가 없으면 스킬이 아니다 — 조용히 지우지 않고 호출부가 건너뛴다.
  if (!name || !description) return null;
  const num = (k: string, d: number): number => {
    const v = Number(fm.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const list = (k: string): string[] =>
    (fm.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const status = fm.get('status') as BrainSkillStatus | undefined;
  const verify = fm.get('verifyState') as BrainVerifyState | undefined;
  const agentId = fm.get('agentId') ?? fallback.agentId;
  const topic = fm.get('topic');
  const supersedes = fm.get('supersedes');
  const supersededBy = fm.get('supersededBy');
  const sourceSessionId = fm.get('sourceSessionId');
  const origins = list('originCardIds');
  const now = Date.now();
  return {
    id: fm.get('id') ?? fallback.id,
    name,
    description,
    body: rest.replace(/^\r?\n/, ''),
    scope: (fm.get('scope') as BrainCardScope | undefined) ?? fallback.scope,
    ...(agentId ? { agentId } : {}),
    ...(topic ? { topic } : {}),
    files: list('files'),
    status: status && SKILL_STATUSES.has(status) ? status : 'draft',
    version: num('version', 1),
    verifyState: verify && VERIFY_STATES.has(verify) ? verify : 'candidate',
    ...(supersedes ? { supersedes } : {}),
    ...(supersededBy ? { supersededBy } : {}),
    createdAt: num('createdAt', now),
    updatedAt: num('updatedAt', now),
    ...(fm.has('lastReferencedAt') ? { lastReferencedAt: num('lastReferencedAt', now) } : {}),
    refCount: num('refCount', 0),
    ...(fm.has('helpfulCount') ? { helpfulCount: num('helpfulCount', 0) } : {}),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...(origins.length > 0 ? { originCardIds: origins } : {}),
  };
}

// ─── 서비스 ───

export class BrainSkillService {
  private index = new Map<string, { skill: BrainSkill; file: string }>();
  private loaded = false;

  constructor(private readonly root: string) {}

  /** 층별 스킬 폴더. 에이전트 층은 카드와 같은 자리(`agents/<id>/`) 밑에 둔다. */
  skillsDir(scope: BrainCardScope, agentId?: string): string {
    const base = path.join(this.root, '.vibisual', 'brain');
    if (scope === 'agent' && agentId) return path.join(base, 'agents', agentId, BRAIN_SKILLS_DIRNAME);
    if (scope === 'user') return path.join(base, 'user', BRAIN_SKILLS_DIRNAME);
    return path.join(base, BRAIN_SKILLS_DIRNAME);
  }

  skillPath(skill: Pick<BrainSkill, 'id' | 'scope' | 'agentId'>): string {
    return path.join(this.skillsDir(skill.scope, skill.agentId), skill.id, BRAIN_SKILL_FILENAME);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const roots: { dir: string; scope: BrainCardScope; agentId?: string }[] = [
      { dir: this.skillsDir('project'), scope: 'project' },
      { dir: this.skillsDir('user'), scope: 'user' },
    ];
    // 에이전트 층 — agents/<id>/skills 를 훑는다.
    const agentsBase = path.join(this.root, '.vibisual', 'brain', 'agents');
    try {
      for (const ent of fs.readdirSync(agentsBase, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        roots.push({
          dir: path.join(agentsBase, ent.name, BRAIN_SKILLS_DIRNAME),
          scope: 'agent',
          agentId: ent.name,
        });
      }
    } catch {
      /* 에이전트 폴더가 없으면 프로젝트 층만 */
    }

    for (const r of roots) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(r.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name === ARCHIVE_DIRNAME) continue;
        const file = path.join(r.dir, ent.name, BRAIN_SKILL_FILENAME);
        let text: string;
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const skill = parseSkill(text, {
          id: ent.name,
          scope: r.scope,
          ...(r.agentId ? { agentId: r.agentId } : {}),
        });
        if (!skill) {
          // 카드와 같은 규율 — 사람이 고치다 깨뜨린 파일은 조용히 삭제하지 않고 건너뛴다.
          logger.warn(`[brain-skill] frontmatter 손상으로 건너뜀: ${file}`);
          continue;
        }
        this.index.set(skill.id, { skill, file });
      }
    }
  }

  private write(skill: BrainSkill): void {
    const file = this.skillPath(skill);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWriteFileSync(file, serializeSkill(skill));
      this.index.set(skill.id, { skill, file });
    } catch (e) {
      logger.warn('[brain-skill] write failed', e as Error);
    }
  }

  listSkills(filter?: {
    scope?: BrainCardScope;
    agentId?: string;
    includeArchived?: boolean;
  }): BrainSkill[] {
    this.ensureLoaded();
    const out: BrainSkill[] = [];
    for (const { skill } of this.index.values()) {
      if (!filter?.includeArchived && (skill.status === 'archived' || skill.status === 'superseded')) continue;
      if (filter?.scope && skill.scope !== filter.scope) continue;
      if (filter?.agentId && skill.scope === 'agent' && skill.agentId !== filter.agentId) continue;
      out.push(skill);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSkill(id: string): BrainSkill | undefined {
    this.ensureLoaded();
    return this.index.get(id)?.skill;
  }

  /**
   * 새 스킬을 만든다. 같은 id 가 이미 있으면 **개정**으로 넘긴다 —
   * 덮어쓰기로 옛 절차를 조용히 지우지 않기 위해서다.
   */
  createSkill(input: BrainSkillInput): BrainSkill {
    this.ensureLoaded();
    const id = input.id ? toSkillId(input.id) : toSkillId(input.name);
    const existing = this.index.get(id);
    if (existing) return this.reviseSkill(id, input) ?? existing.skill;
    const now = Date.now();
    const skill: BrainSkill = {
      id,
      name: input.name.trim(),
      description: input.description.trim().slice(0, BRAIN_SKILL_DESCRIPTION_MAX_CHARS),
      body: input.body.slice(0, BRAIN_SKILL_BODY_MAX_CHARS),
      scope: input.scope,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
      files: input.files ?? [],
      // 새 절차는 **초안으로 시작한다** — 한 번 써 보기 전에는 규칙이 아니다.
      status: 'draft',
      version: 1,
      verifyState: input.verifyState ?? 'candidate',
      createdAt: now,
      updatedAt: now,
      refCount: 0,
      ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
      ...(input.originCardIds && input.originCardIds.length > 0 ? { originCardIds: input.originCardIds } : {}),
    };
    this.write(skill);
    this.enforceBudget(skill.scope, skill.agentId);
    return skill;
  }

  /**
   * 개정 — **옛 판을 먼저 보존한 뒤** 새 판을 쓴다.
   * 중간에 죽어도 옛 절차가 어느 한쪽에는 남는다.
   */
  reviseSkill(id: string, patch: Partial<BrainSkillInput>): BrainSkill | null {
    this.ensureLoaded();
    const cur = this.index.get(id)?.skill;
    if (!cur) return null;
    const archived: BrainSkill = { ...cur, status: 'superseded' };
    const archiveFile = path.join(
      this.skillsDir(cur.scope, cur.agentId),
      ARCHIVE_DIRNAME,
      `${cur.id}-v${cur.version}`,
      BRAIN_SKILL_FILENAME,
    );
    try {
      fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
      atomicWriteFileSync(archiveFile, serializeSkill(archived));
    } catch (e) {
      // 보존이 안 되면 개정하지 않는다 — 절차를 잃느니 안 고치는 편이 낫다.
      logger.warn('[brain-skill] 개정 중단 — 옛 판 보존 실패', e as Error);
      return null;
    }
    const next: BrainSkill = {
      ...cur,
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.description
        ? { description: patch.description.trim().slice(0, BRAIN_SKILL_DESCRIPTION_MAX_CHARS) }
        : {}),
      ...(patch.body ? { body: patch.body.slice(0, BRAIN_SKILL_BODY_MAX_CHARS) } : {}),
      ...(patch.topic ? { topic: patch.topic } : {}),
      ...(patch.files ? { files: patch.files } : {}),
      ...(patch.verifyState ? { verifyState: patch.verifyState } : {}),
      version: cur.version + 1,
      supersedes: `${cur.id}-v${cur.version}`,
      updatedAt: Date.now(),
    };
    this.write(next);
    return next;
  }

  /**
   * §5.10 v2 (E) — 근거 검증 통과. **판올림을 올리지 않는다** — 절차 자체는 그대로이고
   * 검증 상태만 바뀐 것이라, 개정(`reviseSkill`)으로 처리하면 헛된 v2 가 생기고 옛 판이
   * 아카이브에 쌓인다.
   */
  markVerified(id: string): BrainSkill | null {
    this.ensureLoaded();
    const cur = this.index.get(id)?.skill;
    if (!cur) return null;
    const next: BrainSkill = {
      ...cur,
      verifyState: 'verified',
      // 검증을 통과한 절차는 더 이상 초안이 아니다.
      status: cur.status === 'draft' ? 'active' : cur.status,
      updatedAt: Date.now(),
    };
    this.write(next);
    return next;
  }

  /** 초안을 실제로 써도 되는 절차로 승격. 근거 검증(축 4)이나 사람이 올린다. */
  activateSkill(id: string): BrainSkill | null {
    this.ensureLoaded();
    const cur = this.index.get(id)?.skill;
    if (!cur) return null;
    const next: BrainSkill = { ...cur, status: 'active', updatedAt: Date.now() };
    this.write(next);
    return next;
  }

  archiveSkill(id: string): BrainSkill | null {
    this.ensureLoaded();
    const cur = this.index.get(id)?.skill;
    if (!cur) return null;
    const next: BrainSkill = { ...cur, status: 'archived', updatedAt: Date.now() };
    this.write(next);
    return next;
  }

  /**
   * **집행 선택** — 지금 작업과 맞는 절차를 고른다.
   *
   * 매칭은 `description` 이 담당한다("언제 이 절차를 쓰는가"를 적는 자리라 그렇다).
   * 한국어는 조사·어미가 붙어 어절 토큰이 어긋나므로 **문자 bigram 을 함께 본다** —
   * 카드 검색이 "수집기"로 "수집기는"을 못 찾던 것과 같은 문제다.
   */
  selectForTask(taskText: string, opts?: { agentId?: string; limit?: number }): BrainSkill[] {
    this.ensureLoaded();
    const text = (taskText ?? '').trim();
    if (!text) return [];
    const qT = tokenize(text);
    const qB = charBigrams(text);
    if (qT.size === 0 && qB.size === 0) return [];
    const scored: { skill: BrainSkill; score: number }[] = [];
    for (const { skill } of this.index.values()) {
      if (skill.status === 'archived' || skill.status === 'superseded') continue;
      if (skill.verifyState === 'rejected') continue;
      if (skill.scope === 'agent' && opts?.agentId && skill.agentId !== opts.agentId) continue;
      const hay = `${skill.name} ${skill.description}`;
      const tokenScore = coverage(qT, tokenize(hay));
      const bigramScore = coverage(qB, charBigrams(hay));
      // 어절이 맞으면 그것을 믿고, 안 맞을 때 bigram 이 한국어를 건진다(조사·어미 변형).
      // bigram 은 느슨하므로 살짝 깎아 어절 일치가 항상 우선하게 둔다.
      const score = Math.max(tokenScore, bigramScore * 0.9);
      if (score >= BRAIN_BIGRAM_MIN_SCORE) scored.push({ skill, score });
    }
    scored.sort((a, b) => b.score - a.score || (b.skill.helpfulCount ?? 0) - (a.skill.helpfulCount ?? 0));
    return scored.slice(0, opts?.limit ?? BRAIN_SKILL_INJECTION_TOP_K).map((s) => s.skill);
  }

  /** 주입된 스킬의 노출 카운트 갱신(카드 `touchReferences` 와 같은 의미). */
  touchReferences(ids: string[]): void {
    this.ensureLoaded();
    const now = Date.now();
    for (const id of ids) {
      const cur = this.index.get(id)?.skill;
      if (!cur) continue;
      this.write({ ...cur, refCount: cur.refCount + 1, lastReferencedAt: now });
    }
  }

  /** 도움됨 신고 — 스킬 집행 성과가 랭킹의 새 공급원이다(§5.10 v2 (J)). */
  markHelpful(id: string): BrainSkill | null {
    this.ensureLoaded();
    const cur = this.index.get(id)?.skill;
    if (!cur) return null;
    const next: BrainSkill = {
      ...cur,
      helpfulCount: (cur.helpfulCount ?? 0) + 1,
      updatedAt: Date.now(),
    };
    // 도움이 됐다고 신고된 초안은 그 자리에서 실제 절차로 올린다.
    if (next.status === 'draft') next.status = 'active';
    this.write(next);
    return next;
  }

  /**
   * lesson 승급 후보 — 같은 주제 `lesson` 이 문턱 이상 모이면 "스킬로 굳힐까요"로 올린다.
   * 209장을 버리는 게 아니라 **끌어올리는** 경로다(§5.10 v2 (B)).
   */
  promotionCandidates(cards: BrainCard[]): BrainSkillPromotionCandidate[] {
    this.ensureLoaded();
    const groups = new Map<string, BrainCard[]>();
    for (const c of cards) {
      if (c.type !== 'lesson') continue;
      if (c.status === 'archived') continue;
      const topic = c.topic ?? 'misc';
      const key = `${c.scope}::${c.agentId ?? ''}::${topic}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    const out: BrainSkillPromotionCandidate[] = [];
    for (const [key, list] of groups) {
      if (list.length < BRAIN_SKILL_PROMOTE_MIN_LESSONS) continue;
      const parts = key.split('::');
      const scope = (parts[0] ?? 'project') as BrainCardScope;
      const agentId = parts[1] ?? '';
      const topic = parts[2] ?? 'misc';
      // 이미 그 주제로 스킬이 있으면 다시 권하지 않는다.
      const already = [...this.index.values()].some(
        (e) => e.skill.topic === topic && e.skill.scope === scope && (e.skill.agentId ?? '') === agentId,
      );
      if (already) continue;
      out.push({
        topic,
        scope,
        ...(agentId ? { agentId } : {}),
        cards: list.sort((a, b) => b.updatedAt - a.updatedAt),
      });
    }
    return out.sort((a, b) => b.cards.length - a.cards.length);
  }

  /** 층별 상한. 넘치면 **도움된 적 없고 오래 안 쓰인 것부터** 보관으로 내린다(삭제 ❌). */
  private enforceBudget(scope: BrainCardScope, agentId?: string): number {
    const live = this.listSkills({ scope, ...(agentId ? { agentId } : {}) });
    if (live.length <= BRAIN_SKILL_BUDGET) return 0;
    const doomed = [...live]
      .sort((a, b) => {
        const ah = a.helpfulCount ?? 0;
        const bh = b.helpfulCount ?? 0;
        if (ah !== bh) return ah - bh;
        return (a.lastReferencedAt ?? a.updatedAt) - (b.lastReferencedAt ?? b.updatedAt);
      })
      .slice(0, live.length - BRAIN_SKILL_BUDGET);
    for (const s of doomed) this.archiveSkill(s.id);
    return doomed.length;
  }

  /** 테스트·재로딩용 — 다음 호출에서 디스크를 다시 읽는다. */
  reload(): void {
    this.index.clear();
    this.loaded = false;
  }
}

const services = new Map<string, BrainSkillService>();

export function getBrainSkillService(root: string): BrainSkillService {
  let svc = services.get(root);
  if (!svc) {
    svc = new BrainSkillService(root);
    services.set(root, svc);
  }
  return svc;
}

export function dropBrainSkillService(root: string): void {
  services.delete(root);
}
