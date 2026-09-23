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
  AUTO_GOAL_REVIEW_QUEUE_MAX,
  AUTO_GOAL_ACTIVE_QUEUE_MAX,
  AUTO_GOAL_STALE_REVIEW_MS,
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
  type AutoGoalMetrics,
  type BashEntry,
  type SessionGoal,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { atomicWriteFileSync } from './statePersistence.js';
import {
  AUTO_GOAL_SKILL_DIRS, autoGoalSkillRelativePath, safeAutoGoalPath,
  parseAutoGoalDocument, readAutoGoalDocument, readAutoGoalDocumentAt,
  summarizeAutoGoalDocument, patchAutoGoalDocument, dropAutoGoalAssessments,
} from './autoGoalLifecycle.js';

/** Authorship is provenance, never permission to overwrite edited instructions. */
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
  lines.push('status: candidate');
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
  const doc = parseAutoGoalDocument(text, fallbackId);
  return doc ? summarizeAutoGoalDocument(null, doc) : null;
}

/**
 * 디스크의 스킬 전부 — 새 자리와 옛 브레인 자리를 **함께** 읽는다(통폐합).
 *
 * 같은 id 가 양쪽에 있으면 새 자리가 이긴다. 검토·상태·근거는 실제 원본 위치에 기록한다.
 * 각 파일의 현재 근거를 확인하므로 옛 verified 표식은 활성 판정을 대신하지 않는다.
 */
export function listAutoGoalSkills(root: string): AutoGoalSkillSummary[] {
  const byId = new Map<string, AutoGoalSkillSummary>();
  // 옛 자리를 먼저 읽고 새 자리로 덮는다 — 뒤에 읽은 쪽이 이긴다.
  for (const relative of [...AUTO_GOAL_SKILL_DIRS].reverse()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(safeAutoGoalPath(root, relative), { withFileTypes: true });
    } catch {
      continue; // 아직 한 장도 없다 — 정상이다.
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      try {
        const doc = readAutoGoalDocumentAt(root, autoGoalSkillRelativePath(e.name, relative), e.name);
        const parsed = doc ? summarizeAutoGoalDocument(root, doc) : null;
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
 * 이미 있으면 관찰 횟수만 올린다 — 본문과 검토 상태는 자동으로 개정하지 않는다.
 * 쓰기는 전부 `atomicWriteFileSync`(§3.2.1 ①)를 지난다.
 */
export function writeAutoGoalSkill(
  root: string,
  candidate: AutoGoalCandidate,
  existing?: AutoGoalSkillSummary,
): AutoGoalSkillSummary | null {
  const id = existing?.id ?? toAutoGoalSkillId(candidate);
  const now = Date.now();

  try {
    const previous = readAutoGoalDocument(root, id);
    if (previous) {
      const parsedPrev = summarizeAutoGoalDocument(root, previous);
      // Observation never regenerates instructions, reviewed evidence, or a retired procedure.
      if (parsedPrev.status === 'retired' || parsedPrev.status === 'superseded' || parsedPrev.runs >= candidate.runs) return parsedPrev;
      const current = readAutoGoalDocument(root, id) ?? previous;
      return summarizeAutoGoalDocument(root, patchAutoGoalDocument(root, current, { runs: String(candidate.runs) }));
    }
    // An unreadable/partially edited existing original is not permission to regenerate it.
    if (AUTO_GOAL_SKILL_DIRS.some((location) => fs.existsSync(safeAutoGoalPath(root, autoGoalSkillRelativePath(id, location), true)))) return null;
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
    const relative = autoGoalSkillRelativePath(id);
    const file = safeAutoGoalPath(root, relative, true);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    safeAutoGoalPath(root, relative, true);
    atomicWriteFileSync(file, serializeAutoGoalSkill(summary, autoGoalSkillBody(candidate, now)));
    const saved = readAutoGoalDocument(root, id);
    return saved ? summarizeAutoGoalDocument(root, saved) : null;
  } catch (err) {
    // 스킬 한 장을 못 썼다고 에이전트 작업이 멈추면 안 된다 — 다음 분석이 다시 시도한다.
    logger.warn('[auto-goal] skill write failed', { id, err: String(err) });
    return null;
  }
}

/** 스킬 한 장을 지운다(사용자가 화면에서 누를 때만 — 자동 삭제 ❌). */
export function deleteAutoGoalSkill(root: string, id: string): boolean {
  // Resolve every target before deleting anything; deleting the modern copy must not revive a legacy copy.
  const targets = AUTO_GOAL_SKILL_DIRS.map((dir) => safeAutoGoalPath(root, autoGoalSkillRelativePath(id, dir), true))
    .filter((file) => fs.existsSync(file)).map((file) => path.dirname(file));
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  return targets.length > 0;
}

/** 스킬 본문 원문 — 화면이 "무엇이 적혔나"를 펼쳐 보일 때. */
export function readAutoGoalSkillBody(root: string, id: string): string | null {
  return readAutoGoalDocument(root, id)?.body ?? null;
}

export function autoGoalMetrics(skills: readonly AutoGoalSkillSummary[]): AutoGoalMetrics {
  return {
    activeCount: skills.filter((s) => s.status === 'active').length,
    reviewCount: skills.filter((s) => s.status === 'candidate' || s.status === 'needs-review').length,
    retiredCount: skills.filter((s) => s.status === 'retired' || s.status === 'superseded').length,
    reuseCount: skills.reduce((n, s) => n + (s.reuseCount ?? 0), 0),
    skipCount: skills.reduce((n, s) => n + (s.skipCount ?? 0), 0),
    failureCount: skills.reduce((n, s) => n + (s.failureCount ?? 0), 0),
    revisionCount: skills.reduce((n, s) => n + (s.revisionCount ?? 0), 0),
  };
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
    return { enabled: false, candidates: [], skills, metrics: autoGoalMetrics(skills), minRuns: AUTO_GOAL_MIN_RUNS, observed: 0, analyzedAt: 0 };
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
   * 문턱을 넘은 관찰은 검토할 후보 파일이 된다. 활성화는 근거를 갖춘 검토 API만 한다.
   *
   * 총량에 상한을 걸어(`AUTO_GOAL_SKILL_BUDGET`) 디스크와 주입 양쪽이 무한히 늘지 않게 한다 — 넘으면 더 짓지
   * 않을 뿐 이미 있는 것을 지우지는 않는다(자동 삭제 ❌).
   */
  const known = [...skills];
  const linked: AutoGoalCandidate[] = [];
  for (const c of candidates) {
    if (c.runs < AUTO_GOAL_MIN_RUNS) { linked.push(c); continue; }
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
    metrics: autoGoalMetrics(known),
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
  task?: string,
): string | undefined {
  if (!resolveAutoGoalEnabled(settings, ids)) return undefined;
  const now = Date.now();
  const scored = listAutoGoalSkills(root)
    .map((skill) => ({ skill, score: task === undefined ? 1 : autoGoalRelevanceScore(skill, task) }))
    .filter((entry) => entry.score > 0);
  /*
   * §5.10 (R)ⓑ — **관련도 순위**로 고른다.
   *
   * 앞에서 세 개를 자르던 때는 지금 만지는 파일의 절차가 실리지 않는 턴이 대부분이었고,
   * 그래서 규약이 검토를 지시해도 실릴 자리가 없어 아무 일도 일어나지 않았다. 폭을 넓히는 대신
   * 순위를 매기므로 무관한 절차가 더 실리지는 않는다 — 점수 0 은 위에서 이미 걸러졌다.
   * 동점이면 `listAutoGoalSkills` 의 순서(최근 수정 순)가 그대로 남는다(정렬이 안정적이다).
   */
  const rank = (a: { score: number }, b: { score: number }): number => b.score - a.score;
  const pick = (want: (s: AutoGoalSkillSummary) => boolean, max: number): AutoGoalSkillSummary[] =>
    scored.filter((e) => want(e.skill)).sort(rank).slice(0, max).map((e) => e.skill);
  const active = pick((s) => s.status === 'active', AUTO_GOAL_ACTIVE_QUEUE_MAX);
  const review = pick((s) => s.status === 'candidate' || s.status === 'needs-review', AUTO_GOAL_REVIEW_QUEUE_MAX);
  if (active.length === 0 && review.length === 0) return undefined;
  const lines: string[] = [];
  lines.push('# 이 프로젝트에서 되풀이해 온 절차 (절차 감지)');
  lines.push('');
  lines.push('현재 사용자 지시가 우선이다. 관련 절차만 읽고 적용 조건을 확인하라. 반복 관찰은 검토 통과나 완료 증거가 아니다.');
  lines.push('실행 전 사전 판정을 받고, 서버가 같은 작업·판본·입력과 완료 출력을 확인해 skip을 반환한 경우에만 완료 결과를 재사용할 수 있다.');
  lines.push('이 턴에 이미 읽은 근거로 판정할 수 있는 절차가 있으면 판정 1건을 남긴다 — 사용자 요청을 기다리지 않는다.');
  lines.push('');
  for (const [label, skills] of [['검토 통과 — 적용 조건 확인 후 사용', active], ['검토 대기 — 실행 지침이 아님', review]] as const) {
    if (skills.length === 0) continue;
    lines.push(`## ${label}`);
    for (const s of skills) {
      lines.push(`- **${s.name}** — ${escapeScalar(s.description).slice(0, 240)}`);
      lines.push(`  id=${s.id} revision=${s.revision} · \`${s.path}\``);
      if (s.applicability) lines.push(`  적용 조건: ${escapeScalar(s.applicability).slice(0, 400)}`);
      if (s.status !== 'active' && s.reason) lines.push(`  검토 사유: ${escapeScalar(s.reason).slice(0, 240)}`);
      const hint = autoGoalRetireHint(root, s, now, active);
      if (hint) lines.push(`  걷을 후보: ${hint}`);
    }
  }
  return lines.join('\n');
}

/**
 * §5.10 (R)ⓒ — 이 절차를 지금 걷어야 하는지에 대한 **한 줄 사유**. 없으면 `undefined`.
 *
 * 서버가 걷지 않는다 — 판단은 근거를 쥔 에이전트가 하고, 여기서는 그 자리에 표시만 한다.
 * 상태를 바꾸는 것은 언제나 `/api/auto-goal/review` 한 창구다(§5.10 (Q)).
 */
function autoGoalRetireHint(
  root: string,
  skill: AutoGoalSkillSummary,
  now: number,
  actives: AutoGoalSkillSummary[],
): string | undefined {
  const evidence = skill.files ?? [];
  if (evidence.length > 0 && evidence.every((relative) => !autoGoalEvidenceExists(root, relative))) {
    return '근거 파일이 프로젝트에 하나도 남아 있지 않다 — 가리키던 코드가 사라졌으면 retire 하라.';
  }
  if (skill.status === 'active' && skill.reviewedAt && now - skill.reviewedAt > AUTO_GOAL_STALE_REVIEW_MS
      && skill.reuseCount === 0 && skill.skipCount === 0) {
    return '승인 뒤 한 번도 쓰이지 않았다 — 지금도 필요한지 보고 아니면 retire 하라.';
  }
  if (skill.status !== 'active') {
    const twin = actives.find((a) => a.id !== skill.id && autoGoalRelevanceScore(a, `${skill.name} ${skill.description}`) >= 9);
    if (twin) return `같은 일을 하는 검토 통과 절차가 있다(id=${twin.id}) — 중복이면 supersede 하라.`;
  }
  return undefined;
}

/** 근거 파일이 아직 프로젝트 안에 있는지. 경로는 항상 `safeAutoGoalPath` 를 거친다(§5.10 (E) 경계). */
function autoGoalEvidenceExists(root: string, relative: string): boolean {
  try { return fs.statSync(safeAutoGoalPath(root, relative, true)).isFile(); } catch { return false; }
}

/** Conservative lexical routing keeps unrelated old project work out of the agent's task. */
export function autoGoalSkillRelevant(skill: AutoGoalSkillSummary, task: string): boolean {
  return autoGoalRelevanceScore(skill, task) > 0;
}

/**
 * 이 절차가 지금 작업과 얼마나 가까운가 — 0 이면 무관(싣지 않는다).
 *
 * `autoGoalSkillRelevant` 가 쓰던 판정을 그대로 두되 **점수**로 돌려준다. 통과/탈락만 알면
 * 주입 자리가 모자랄 때 무엇을 버릴지 고를 수 없고, 그때 버려지는 것이 하필 지금 만지는 파일의
 * 절차였다(§5.10 (R)ⓑ). 가중치는 겹친 낱말 3, 한글 두 글자 짝 1, 근거 파일 이름이 걸리면 5 —
 * 파일 이름이 문장에 나오는 것이 가장 강한 신호라서 가장 높다.
 */
export function autoGoalRelevanceScore(skill: AutoGoalSkillSummary, task: string): number {
  const ignored = new Set(['this', 'that', 'with', 'from', 'what', 'when', 'please', 'project', 'agent', 'procedure',
    '확인', '작업', '절차', '검토', '기능', '사용', '진행', '자동', '현재', '추가', '수정', '방법', '있는', '하기', '위해']);
  const words = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .filter((word) => word.length >= 2 && !ignored.has(word));
  const taskWords = new Set(words(task));
  const terms = words(`${skill.name} ${skill.description} ${skill.applicability ?? ''}`);
  let score = 0;
  const counted = new Set<string>();
  for (const word of terms) {
    if (counted.has(word) || !taskWords.has(word)) continue;
    if (!/[가-힣]/u.test(word) && word.length < 3) continue;
    counted.add(word);
    score += 3;
  }
  const koreanPairs = (items: Iterable<string>): Set<string> => {
    const pairs = new Set<string>();
    for (const word of items) if (/^[가-힣]+$/u.test(word) && word.length >= 3) {
      for (let i = 0; i + 1 < word.length; i += 1) if (!ignored.has(word.slice(i, i + 2))) pairs.add(word.slice(i, i + 2));
    }
    return pairs;
  };
  const a = koreanPairs(taskWords);
  let matches = 0;
  for (const pair of koreanPairs(terms)) if (a.has(pair)) matches += 1;
  if (matches >= 2) score += matches;
  /*
   * 근거 파일은 **낱말로** 견준다 — 경로 문자열을 접어 비교하면 Linux 에서 `Feature-X ≠ feature-x`
   * 를 놓친다(멀티플랫폼 ①). 확장자를 뗀 파일 이름을 위 토크나이저에 그대로 태우면 경로 동일성
   * 판정이 아니라 자연어 낱말 비교가 되어 세 운영체제에서 같은 답이 나온다.
   */
  for (const file of skill.files ?? []) {
    const base = (file.replace(/\\/g, '/').split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    if (words(base).some((token) => taskWords.has(token))) score += 5;
  }
  return score;
}

/** 프로젝트를 닫을 때 분석 캐시를 버린다(§3.5 프로젝트 격리 — 남의 이력이 섞이면 안 된다). */
export function dropAutoGoalCache(root: string): void {
  caches.delete(root);
  try { dropAutoGoalAssessments(root); } catch { /* A closed project may already be unavailable. */ }
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
  const state = getAutoGoalState(root, { ...settings, enabledProject: true }, {}, input);
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
    ...autoGoalMetrics(skills),
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
