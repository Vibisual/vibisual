/**
 * §5.10 — **자동 목표.** 되풀이한 일을 스킬로 굳혀 둔다.
 *
 * 사용자 지시(전면 개편): "기억·메모리·브레인 이런 거 다 버리고 자동 목표라는 이름으로 —
 * 사용자의 행동이나 에이전트의 행동 중 자동으로 분석을 통해서 스킬을 만들어 주는 것. 기본 off."
 *
 * **무엇이 달라졌나** — §5.10 의 기억 카드는 *누가 읽어 주기를 기다리는 자산*이었고, 실측에서
 * 327장 중 263장(80%)이 한 번도 안 읽혔다. 스킬은 그 반대다: 그 작업을 시작할 때 **저절로 걸린다.**
 * 그래서 이 기능은 "무엇을 기억할까"를 묻지 않고 **"무엇을 되풀이하는가"** 만 본다.
 *
 * **모델을 부르지 않는다.** 되풀이를 알아보는 데 추론이 필요 없고, 이 기능은 켜 두고 잊는 물건이라
 * 켜 둔 동안 토큰이 들면 안 된다(리플렉션이 매 턴 자식을 띄워 아무도 켠 적 없는 기능이 토큰을
 * 태우던 그 실패를 되밟지 않는다). 분석은 전부 shared 순수 함수(`mineAutoGoalCandidates`)다.
 *
 * **꺼져 있으면 아무것도 하지 않는다.** 3층(프로젝트·에이전트·세션) 어디에도 켬이 없으면 훑지도,
 * 짓지도, 프롬프트에 싣지도 않는다 — 이 기능이 없던 때와 완전히 같아야 한다.
 *
 * **저장하는 것과 안 하는 것** — 설정(3층 켬/끔 + 물린 후보)은 `ProjectCheckpoint.autoGoalSettings`
 * 한 칸(§3.2 단일 창구). 후보는 이력에서 매번 다시 세는 파생이라 저장하지 않고, 스킬은 디스크의
 * `SKILL.md` 가 원본이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTO_GOAL_CANDIDATE_MAX,
  AUTO_GOAL_MIN_RUNS,
  AUTO_GOAL_SKILL_BUDGET,
  autoGoalSkillBody,
  autoGoalSkillDescription,
  autoGoalActiveAnywhere,
  mineAutoGoalCandidates,
  resolveAutoGoalEnabled,
  type AutoGoalCandidate,
  type AutoGoalSettings,
  type AutoGoalSkillSummary,
  type AutoGoalSource,
  type AutoGoalState,
  type AutoGoalSummary,
  type BashEntry,
  type SessionGoal,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { atomicWriteFileSync } from './statePersistence.js';

/**
 * 스킬이 사는 자리 — **`.vibisual/skills/`**.
 *
 * 종전 자리는 `.vibisual/brain/skills/` 였다. 이름에서 브레인을 걷어낸 이상 새 스킬은 여기로
 * 쓰지만, **옛 자리를 지우지 않고 읽기로 흡수한다**(아래 `LEGACY_SKILL_DIR`) — 통폐합은
 * 합치는 일이지 버리는 일이 아니고, 이미 쌓인 것이 경로를 잃으면 사용자에겐 그냥 소실이다.
 */
const SKILL_DIR = path.join('.vibisual', 'skills');
/** 브레인 시절의 스킬 자리. **읽기 전용** — 여기에 새로 쓰지 않는다. */
const LEGACY_SKILL_DIR = path.join('.vibisual', 'brain', 'skills');
const SKILL_FILENAME = 'SKILL.md';

/**
 * 이 스킬을 누가 적었는가. `auto-goal` 만 우리가 덮어쓸 수 있다 —
 * **사람이 손본 파일은 다음 분석이 건드리지 않는다**(고쳐 뒀는데 되돌아오면 아무도 안 고친다).
 */
const AUTO_SOURCE = 'auto-goal';

/**
 * 다시 훑기까지의 최소 간격.
 *
 * 뷰를 열 때마다 이력 전량을 다시 세면 창을 껐다 켜는 것만으로 디스크·CPU 가 돈다. 되풀이는
 * 분 단위로 바뀌는 것이 아니라 이 정도면 화면이 늘 최신이면서 비용이 없다.
 */
const ANALYZE_COOLDOWN_MS = 30_000;

/** 이 프로젝트의 마지막 분석 결과 — 쿨다운 안에서는 이것을 그대로 돌려준다. */
interface AnalyzeCache {
  at: number;
  candidates: AutoGoalCandidate[];
  observed: number;
  /** 설정 지문 — 물린 후보가 바뀌면 캐시를 버린다(안 그러면 방금 물린 것이 그대로 서 있다). */
  fingerprint: string;
}

/** 분석에 넣는 재료 — 호출부가 그래프에서 떠 준다(이 서비스는 그래프를 모른다). */
export interface AutoGoalAnalyzeInput {
  bashHistory?: Record<string, BashEntry[]>;
  sessionGoals?: Record<string, SessionGoal>;
}

const caches = new Map<string, AnalyzeCache>();

function fingerprintOf(settings: AutoGoalSettings | undefined): string {
  return (settings?.dismissed ?? []).join(',');
}

// ─── SKILL.md — agentskills.io 호환 frontmatter(`.claude/skills` 와 같은 문법) ───

function escapeScalar(v: string): string {
  return v.replace(/\r?\n/g, ' ').trim();
}

/** 폴더명이 되므로 경로 문자를 남기지 않는다. */
export function toAutoGoalSkillId(candidate: AutoGoalCandidate): string {
  const slug = candidate.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  // 뒤에 후보 해시를 붙인다 — 제목이 같은 서로 다른 절차가 한 폴더를 다투면 한쪽이 조용히 사라진다.
  const tail = candidate.id.split(':')[1] ?? 'x';
  return `${slug || 'auto'}-${tail}`;
}

export function serializeAutoGoalSkill(skill: AutoGoalSkillSummary, body: string): string {
  const lines: string[] = ['---'];
  // 남의 도구가 앞부분만 읽어도 성립하도록 두 필수 필드를 맨 앞에.
  lines.push(`name: ${escapeScalar(skill.name)}`);
  lines.push(`description: ${escapeScalar(skill.description)}`);
  lines.push(`id: ${skill.id}`);
  lines.push(`source: ${AUTO_SOURCE}`);
  if (skill.candidateId) lines.push(`candidateId: ${skill.candidateId}`);
  if (skill.origin) lines.push(`origin: ${skill.origin}`);
  /*
   * 파일 앵커 — 본문에도 같은 목록이 적히지만 본문은 사람이 고치는 자리다. 세는 근거는 여기여야
   * "이 절차를 원본으로 되짚을 수 있나"가 사람의 편집에 흔들리지 않는다. 쉼표로 이어 한 줄에 두는
   * 것은 frontmatter 파서를 `key: value` 한 줄짜리로 유지하기 위해서다(남의 도구도 그대로 읽는다).
   */
  if (skill.files && skill.files.length > 0) lines.push(`files: ${escapeScalar(skill.files.join(', '))}`);
  lines.push(`runs: ${skill.runs}`);
  lines.push(`steps: ${skill.steps}`);
  lines.push(`createdAt: ${skill.createdAt}`);
  lines.push(`updatedAt: ${skill.updatedAt}`);
  lines.push('---');
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}

/** 파일 하나를 요약으로 접는다. 두 필수 필드가 없으면 스킬이 아니다(조용히 건너뛴다). */
export function parseAutoGoalSkill(text: string, fallbackId: string): AutoGoalSkillSummary | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = new Map<string, string>();
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(': ');
    if (i <= 0) continue;
    fm.set(line.slice(0, i).trim(), line.slice(i + 2).trim());
  }
  const name = fm.get('name');
  const description = fm.get('description');
  if (!name || !description) return null;
  const num = (k: string, d: number): number => {
    const v = Number(fm.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const now = Date.now();
  const candidateId = fm.get('candidateId');
  const files = (fm.get('files') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const originRaw = fm.get('origin');
  const origin: AutoGoalSource | undefined = originRaw === 'command' || originRaw === 'step' ? originRaw : undefined;
  return {
    id: fm.get('id') ?? fallbackId,
    name,
    description,
    steps: num('steps', 0),
    runs: num('runs', 0),
    createdAt: num('createdAt', now),
    updatedAt: num('updatedAt', now),
    ...(candidateId ? { candidateId } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(origin ? { origin } : {}),
  };
}

/** 이 파일을 우리가 적었나 — 사람이 손으로 넣은 스킬은 덮지 않는다. */
function isAutoAuthored(text: string): boolean {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  return new RegExp(`^source:\\s*${AUTO_SOURCE}\\s*$`, 'm').test(head);
}

function skillDirs(root: string): { dir: string; writable: boolean }[] {
  return [
    { dir: path.join(root, SKILL_DIR), writable: true },
    { dir: path.join(root, LEGACY_SKILL_DIR), writable: false },
  ];
}

/**
 * 디스크의 스킬 전부 — 새 자리와 옛 브레인 자리를 **함께** 읽는다(통폐합).
 *
 * 같은 id 가 양쪽에 있으면 새 자리가 이긴다. 옛 자리는 읽기 전용이라 다음 개정은 새 자리에 쓰이고,
 * 그렇게 자연스럽게 옮겨 앉는다 — 한 번에 옮기는 마이그레이션을 돌리지 않는 이유는 그 작업이
 * 실패하면 사용자 디스크에서 스킬이 사라지기 때문이다.
 */
export function listAutoGoalSkills(root: string): AutoGoalSkillSummary[] {
  const byId = new Map<string, AutoGoalSkillSummary>();
  // 옛 자리를 먼저 읽고 새 자리로 덮는다 — 뒤에 읽은 쪽이 이긴다.
  for (const { dir } of [...skillDirs(root)].reverse()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 아직 한 장도 없다 — 정상이다.
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const file = path.join(dir, e.name, SKILL_FILENAME);
      try {
        const parsed = parseAutoGoalSkill(fs.readFileSync(file, 'utf8'), e.name);
        if (parsed) byId.set(parsed.id, parsed);
      } catch {
        // 읽을 수 없는 한 장이 목록 전체를 죽이지 않는다.
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 그 후보로 이미 지어진 스킬이 있나 — 같은 절차를 두 번 굳히지 않는다. */
function skillForCandidate(skills: readonly AutoGoalSkillSummary[], candidateId: string): AutoGoalSkillSummary | undefined {
  return skills.find((s) => s.candidateId === candidateId);
}

/**
 * 후보 하나를 **스킬로 굳힌다.**
 *
 * 이미 있으면 관찰 횟수만 올려 다시 쓴다(개정) — 단 **사람이 손본 파일은 건드리지 않는다.**
 * 쓰기는 전부 `atomicWriteFileSync`(§3.2.1 ①)를 지난다.
 */
export function writeAutoGoalSkill(
  root: string,
  candidate: AutoGoalCandidate,
  existing?: AutoGoalSkillSummary,
): AutoGoalSkillSummary | null {
  const id = existing?.id ?? toAutoGoalSkillId(candidate);
  const dir = path.join(root, SKILL_DIR, id);
  const file = path.join(dir, SKILL_FILENAME);
  const now = Date.now();

  try {
    if (fs.existsSync(file)) {
      const prev = fs.readFileSync(file, 'utf8');
      // 사람이 고쳐 둔 스킬을 다음 분석이 되돌리면 아무도 고치지 않게 된다.
      if (!isAutoAuthored(prev)) return existing ?? parseAutoGoalSkill(prev, id);
      const parsedPrev = parseAutoGoalSkill(prev, id);
      // 관찰이 늘지 않았으면 다시 쓰지 않는다 — 같은 내용으로 mtime 만 흔들면 동기화가 소음이 된다.
      if (parsedPrev && parsedPrev.runs >= candidate.runs) return parsedPrev;
    }
    const summary: AutoGoalSkillSummary = {
      id,
      name: candidate.title,
      description: autoGoalSkillDescription(candidate),
      steps: candidate.steps.length,
      runs: candidate.runs,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      candidateId: candidate.id,
      origin: candidate.source,
      ...(candidate.files && candidate.files.length > 0 ? { files: candidate.files } : {}),
    };
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(file, serializeAutoGoalSkill(summary, autoGoalSkillBody(candidate, now)));
    return summary;
  } catch (err) {
    // 스킬 한 장을 못 썼다고 에이전트 작업이 멈추면 안 된다 — 다음 분석이 다시 시도한다.
    logger.warn('[auto-goal] skill write failed', { id, err: String(err) });
    return null;
  }
}

/** 스킬 한 장을 지운다(사용자가 화면에서 누를 때만 — 자동 삭제 ❌). */
export function deleteAutoGoalSkill(root: string, id: string): boolean {
  for (const { dir } of skillDirs(root)) {
    const target = path.join(dir, id);
    try {
      if (!fs.existsSync(path.join(target, SKILL_FILENAME))) continue;
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch (err) {
      logger.warn('[auto-goal] skill delete failed', { id, err: String(err) });
    }
  }
  return false;
}

/** 스킬 본문 원문 — 화면이 "무엇이 적혔나"를 펼쳐 보일 때. */
export function readAutoGoalSkillBody(root: string, id: string): string | null {
  for (const { dir } of skillDirs(root)) {
    const file = path.join(dir, id, SKILL_FILENAME);
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      return /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(text)?.[1] ?? text;
    } catch {
      // 못 읽으면 다음 자리를 본다.
    }
  }
  return null;
}

/**
 * **이 프로젝트의 자동 목표 현황** — 뷰가 읽는 전부이고, 스킬을 굳히는 것도 여기서 한다.
 *
 * 꺼져 있으면 **훑지 않는다**: 후보는 빈 목록이고 `observed` 는 0 이다. 이미 지어진 스킬 목록만
 * 돌려주는데, 그것은 디스크를 읽는 일이라 토큰이 0 이고 "껐더니 그동안 만든 것까지 사라졌다"를
 * 막는다(§5.10 "끄기는 동작 정지이지 삭제가 아니다" 승계).
 */
export function getAutoGoalState(
  root: string,
  settings: AutoGoalSettings | undefined,
  ids: { agentId?: string | null; subAgentId?: string | null },
  input: AutoGoalAnalyzeInput,
): AutoGoalState {
  const enabled = resolveAutoGoalEnabled(settings, ids);
  const skills = listAutoGoalSkills(root);

  if (!enabled) {
    return { enabled: false, candidates: [], skills, minRuns: AUTO_GOAL_MIN_RUNS, observed: 0, analyzedAt: 0 };
  }

  const now = Date.now();
  const fingerprint = fingerprintOf(settings);
  const cached = caches.get(root);
  let candidates: AutoGoalCandidate[];
  let observed: number;
  let analyzedAt: number;

  if (cached && cached.fingerprint === fingerprint && now - cached.at < ANALYZE_COOLDOWN_MS) {
    candidates = cached.candidates;
    observed = cached.observed;
    analyzedAt = cached.at;
  } else {
    const mined = mineAutoGoalCandidates({
      ...(input.bashHistory ? { bashHistory: input.bashHistory } : {}),
      ...(input.sessionGoals ? { sessionGoals: input.sessionGoals } : {}),
      ...(settings?.dismissed ? { dismissed: settings.dismissed } : {}),
      max: AUTO_GOAL_CANDIDATE_MAX,
    });
    candidates = mined.candidates;
    observed = mined.observed;
    analyzedAt = now;
    caches.set(root, { at: now, candidates, observed, fingerprint });
  }

  /*
   * 문턱을 넘은 후보를 **그 자리에서 굳힌다.**
   *
   * 사용자 지시가 "계속 자동으로 만들어 주는 것"이라 승인 버튼을 두지 않는다. 대신 총량에 상한을
   * 걸어(`AUTO_GOAL_SKILL_BUDGET`) 디스크와 주입 양쪽이 무한히 늘지 않게 한다 — 넘으면 더 짓지
   * 않을 뿐 이미 있는 것을 지우지는 않는다(자동 삭제 ❌).
   */
  const known = [...skills];
  const linked: AutoGoalCandidate[] = [];
  for (const c of candidates) {
    const existing = skillForCandidate(known, c.id);
    if (!existing && known.length >= AUTO_GOAL_SKILL_BUDGET) {
      linked.push(c);
      continue;
    }
    const written = writeAutoGoalSkill(root, c, existing);
    if (written) {
      const at = known.findIndex((s) => s.id === written.id);
      if (at >= 0) known[at] = written;
      else known.push(written);
      linked.push({ ...c, skillId: written.id });
    } else {
      linked.push(c);
    }
  }

  return {
    enabled: true,
    candidates: linked,
    skills: known.sort((a, b) => b.updatedAt - a.updatedAt),
    minRuns: AUTO_GOAL_MIN_RUNS,
    observed,
    analyzedAt,
  };
}

/**
 * 이 세션의 프롬프트에 실을 **스킬 목록 한 조각**.
 *
 * 카드를 밀어넣던 §5.10 의 브리핑과 다르다 — 본문을 싣지 않고 **이름과 한 줄 설명만** 싣는다.
 * 그래야 스무 장이 있어도 프롬프트가 얇고, 에이전트는 필요할 때 그 파일을 열어 읽는다
 * (§5.10 v3.74 가 "밀어넣기 ❌ 색인 ⭕"로 옮겨간 그 결론을 스킬에 그대로 적용한 것).
 *
 * 꺼져 있으면 `undefined` 를 돌려 **한 글자도 싣지 않는다.**
 */
export function buildAutoGoalPromptBlock(
  root: string,
  settings: AutoGoalSettings | undefined,
  ids: { agentId?: string | null; subAgentId?: string | null },
): string | undefined {
  if (!resolveAutoGoalEnabled(settings, ids)) return undefined;
  const skills = listAutoGoalSkills(root);
  if (skills.length === 0) return undefined;
  const lines: string[] = [];
  lines.push('# 이 프로젝트에서 되풀이해 온 절차 (절차 감지)');
  lines.push('');
  lines.push('아래는 **이 프로젝트에서 실제로 여러 번 되풀이된 일**을 관찰해 적어 둔 절차다.');
  lines.push('지금 하려는 일이 그중 하나면 그 파일을 열어 그대로 따르라 — 매번 다시 알아낼 필요가 없다.');
  lines.push('');
  for (const s of skills) {
    lines.push(`- **${s.name}** — ${s.description}`);
    lines.push(`  \`${path.posix.join('.vibisual', 'skills', s.id, SKILL_FILENAME)}\``);
  }
  return lines.join('\n');
}

/** 프로젝트를 닫을 때 분석 캐시를 버린다(§3.5 프로젝트 격리 — 남의 이력이 섞이면 안 된다). */
export function dropAutoGoalCache(root: string): void {
  caches.delete(root);
}

/**
 * §5.10 — 스냅샷에 싣는 **경량 요약**. 폐기된 브레인 요약이 앉아 있던 자리를 잇는다.
 *
 * 전문(`getAutoGoalState`)과 갈라 둔 이유는 하나다 — 전문은 후보·스킬 **목록**을 들고 있어
 * 매 브로드캐스트에 태우면 전선이 목록 길이만큼 무거워진다. 여기서는 숫자 몇 개만 센다.
 *
 * **어느 층도 켜지 않은 프로젝트에서는 `undefined`** 다. 없음이 곧 "이 축은 이 프로젝트에 없다"이고,
 * 그래야 기본 off 가 화면·전선·프롬프트 세 군데에서 같은 뜻이 된다. 프로젝트 층만 보고 판단하지
 * 않는다 — 아래 층이 위를 덮으므로 "프로젝트 끔 + 이 에이전트만 켬"이 정상 상태이고, 그 자리를
 * 숨기면 켜 둔 에이전트가 화면에서 통째로 사라진다.
 *
 * 분석은 전문과 **같은 캐시**를 타므로(30초) 스냅샷이 자주 지어져도 채굴이 다시 돌지 않는다.
 */
export function getAutoGoalSummary(
  root: string,
  settings: AutoGoalSettings | undefined,
  input: AutoGoalAnalyzeInput,
): AutoGoalSummary | undefined {
  if (!autoGoalActiveAnywhere(settings)) return undefined;

  /*
   * 프로젝트 층 기준으로 한 번 센다. 층마다 다시 채굴하면 에이전트 수만큼 분석이 돌아버린다 —
   * 후보·스킬은 프로젝트 단위의 사실이고, 층이 가르는 것은 "그 사실을 이 자리에 싣느냐"뿐이다.
   */
  const projectEnabled = resolveAutoGoalEnabled(settings);
  const state = getAutoGoalState(root, settings, {}, input);
  const skills = state.skills;

  // 굳은 것은 후보 목록에도 남아 있다(진행 막대가 100% 로 서야 하므로) — 두 번 세지 않는다.
  const brewing = state.candidates.filter((c) => !c.skillId);

  /*
   * 원천·앵커는 **디스크의 스킬**에서 센다(분석 창의 후보 ❌).
   *
   * 후보는 30초 창 안에서 관찰된 것만 들어 있어, 잠깐 손을 멈추면 0 으로 떨어진다. 그러면 카드가
   * "이 프로젝트는 절차가 없다"고 말하는데 저장고에는 스무 장이 있다 — 같은 화면에서 두 숫자가
   * 어긋난다. frontmatter 에 `origin`·`files` 를 적어 둔 것이 바로 이 안정성을 위해서다.
   * 아직 굳지 않은 후보는 그 위에 더한다(후보에도 원천·파일이 있다).
   */
  const grown = [
    ...skills.map((s) => ({ origin: s.origin, files: s.files })),
    ...brewing.map((c) => ({ origin: c.source as AutoGoalSource | undefined, files: c.files })),
  ];
  const anchoredCount = grown.filter((g) => (g.files?.length ?? 0) > 0).length;
  const fromCommand = grown.filter((g) => g.origin === 'command').length;
  const fromStep = grown.filter((g) => g.origin === 'step').length;

  // 되풀이 횟수 — 굳은 것은 굳을 때의 관찰 수를, 아직인 것은 지금까지의 관찰 수를 쓴다.
  const runs = [...skills.map((s) => s.runs), ...brewing.map((c) => c.runs)];
  const topRuns = runs.reduce((max, n) => (n > max ? n : max), 0);
  const totalRuns = runs.reduce((sum, n) => sum + n, 0);

  const recent = skills.reduce<AutoGoalSkillSummary | null>(
    (best, s) => (best === null || s.updatedAt > best.updatedAt ? s : best),
    null,
  );

  /*
   * 에이전트 층은 **적힌 자리만** 싣는다. 없는 키는 프로젝트 층을 물려받으므로 받는 쪽이 그렇게 읽으면
   * 되고, 전량을 싣기 시작하면 이 맵이 에이전트 수만큼 자라 매 브로드캐스트에 얹힌다.
   */
  const agentEnabled: Record<string, boolean> = {};
  for (const [agentId, own] of Object.entries(settings?.enabledAgents ?? {})) {
    if (typeof own === 'boolean' && own !== projectEnabled) agentEnabled[agentId] = own;
  }

  return {
    enabled: projectEnabled,
    ...(Object.keys(agentEnabled).length > 0 ? { agentEnabled } : {}),
    skillCount: skills.length,
    candidateCount: brewing.length,
    dismissedCount: settings?.dismissed?.length ?? 0,
    anchoredCount,
    fromCommand,
    fromStep,
    observed: state.observed,
    minRuns: state.minRuns,
    topRuns,
    totalRuns,
    ...(recent ? { recentSkillName: recent.name } : {}),
  };
}
