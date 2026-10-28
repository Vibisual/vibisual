/**
 * §5.10 — 되풀이를 알아본다(자동 목표의 본체): 이 프로젝트에서 늘 같은 순서로 하는 일을 찾아 스킬로 만든다. 재료는 `bashHistory` 와 사용자가 꽂은 단계뿐(새 수집 ❌).
 * 모델을 부르지 않는다 — 켜 두고 잊는 기능이라 토큰이 들면 안 된다. 단계는 실제 원문 그대로 싣는다(요약하면 다시 돌릴 수 없다). 후보는 저장하지 않는 파생이다.
 */
import {
  AUTO_GOAL_CANDIDATE_MAX,
  AUTO_GOAL_COMMAND_MAX,
  AUTO_GOAL_MIN_RUNS,
  AUTO_GOAL_SCAN_TAIL,
  AUTO_GOAL_SEQUENCE_MAX,
  AUTO_GOAL_SEQUENCE_MIN,
  AUTO_GOAL_STEP_MAX,
  AUTO_GOAL_TITLE_MAX,
  AUTO_GOAL_WINDOW_MS,
} from './constants.js';
import { looksLikeShellPath, tokenizeShellCommand } from './bashCommandPaths.js';
import type { AutoGoalCandidate, AutoGoalSource, BashEntry, SessionGoal } from './types.js';

/** 훑는 재료 — 전부 **이미 있는** 것이다(새 수집 ❌). */
export interface AutoGoalMiningInput {
  /** agentId → 셸 명령 이력. 되풀이되는 **순서**를 여기서 찾는다. */
  bashHistory?: Record<string, BashEntry[]>;
  /** 세션 목표들 — 사용자가 꽂은 단계(`authoredBy==='user'`)의 연속 묶음을 센다. */
  sessionGoals?: Record<string, SessionGoal>;
  /** 사용자가 물린 후보 id — 목록에서 뺀다(제안만 멈추고 관찰은 계속한다). */
  dismissed?: readonly string[];
  /** 스킬이 되는 문턱. 시험이 값을 바꿔 끼울 수 있게 인자로 받는다. */
  minRuns?: number;
  /** 화면·굳히기 대상 상한. */
  max?: number;
}

/** 훑은 결과 — 후보와 "성공·완료 근거를 몇 개나 봤나". */
export interface AutoGoalMiningResult {
  candidates: AutoGoalCandidate[];
  /** 훑은 행동 수(명령 + 사용자 단계). 0 이면 "아직 볼 것이 없다"이지 고장이 아니다. */
  observed: number;
}

/** 한 묶음을 세는 동안의 누적. */
interface SeqTally {
  steps: string[];
  runs: number;
  lastSeenAt: number;
  source: AutoGoalSource;
  files: Set<string>;
}

interface ObservedLine {
  text: string;
  at: number;
  files: readonly string[];
}

/** 표시용 제목에만 쓴다. 실행 원문의 공백·개행은 명령의 의미이므로 접지 않는다. */
function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 순서를 FNV-1a 32비트 id 로 접는다 — 매번 다시 세는 파생이라 같은 절차는 늘 같은 키여야 물린 기록·굳힌 스킬이 다시 가리킨다(결정성만 필요). */
export function autoGoalSequenceId(source: AutoGoalSource, steps: readonly string[]): string {
  let h = 0x811c9dc5;
  const text = `${source}\0${steps.join('\0')}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${source}:${h.toString(36)}`;
}

/** 절차의 이름 — 첫 걸음과 마지막 걸음의 머리 낱말 둘씩. 첫 단계만이면 `git add …` 후보들이 구분되지 않고, 다 이으면 한 줄에 안 든다. */
export function autoGoalTitle(steps: readonly string[]): string {
  const head = headWords(steps[0] ?? '');
  const tail = headWords(steps[steps.length - 1] ?? '');
  const text = steps.length > 1 && tail !== head ? `${head} → ${tail}` : head;
  return clamp(text, AUTO_GOAL_TITLE_MAX);
}

/** 한 줄에서 앞 두 낱말 — `pnpm build --filter x` → `pnpm build`. */
function headWords(line: string): string {
  const parts = normalizeTitle(line).split(' ').filter(Boolean);
  return parts.slice(0, 2).join(' ') || normalizeTitle(line);
}

/** 상한을 넘으면 원문을 잘라 실행 가능한 것처럼 만들지 않고 관찰 경계를 끊는다. */
function fitsObservation(text: string, max: number): boolean {
  return text.trim() !== '' && text.length <= max;
}

/** 인자에서 경로처럼 보이는 것을 모은다(스킬 `files` 앵커). 셸 토크나이저 한 벌(`bashCommandPaths.ts`)을 쓴다 — 두 벌이면 어긋난다(§2.1 #3). */
function pathsIn(command: string): string[] {
  const out: string[] = [];
  for (const tok of tokenizeShellCommand(command)) {
    if (tok.startsWith('-') || !looksLikeShellPath(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** 되풀이 묶음을 센다. `runs` 는 묶음이 통째로 나타난 횟수 — 겹쳐 세지 않는다(`a b a b a b` 의 `a b` 는 3회, 5회 ❌). */
function tallyRuns(
  runsOfLines: readonly (readonly ObservedLine[])[],
  source: AutoGoalSource,
  tally: Map<string, SeqTally>,
): void {
  for (const run of runsOfLines) {
    if (run.length < AUTO_GOAL_SEQUENCE_MIN) continue;
    const lastEnds = new Map<string, number>();
    for (let len = AUTO_GOAL_SEQUENCE_MIN; len <= AUTO_GOAL_SEQUENCE_MAX; len += 1) {
      if (run.length < len) break;
      // 모든 시작점을 보되 같은 후보가 앞에서 차지한 구간과 겹치면 그 관찰만 건너뛴다.
      for (let i = 0; i + len <= run.length; i += 1) {
        const slice = run.slice(i, i + len);
        const steps = slice.map((x) => x.text);
        const id = autoGoalSequenceId(source, steps);
        if (i < (lastEnds.get(id) ?? 0)) continue;
        lastEnds.set(id, i + len);
        const found = tally.get(id);
        const last = Math.max(...slice.map((x) => x.at));
        if (found) {
          found.runs += 1;
          if (last > found.lastSeenAt) found.lastSeenAt = last;
          for (const x of slice) for (const f of x.files) found.files.add(f);
        } else {
          const files = new Set<string>();
          for (const x of slice) for (const f of x.files) files.add(f);
          tally.set(id, { steps, runs: 1, lastSeenAt: last, source, files });
        }
      }
    }
  }
}

/**
 * 이력을 실패·미완료 경계와 시간 창으로 갈라 줄기를 만든다 — 없으면 어제의 `git status` 와 오늘의 `pnpm build` 가 한 절차가 된다.
 * 같은 줄이 연달아 오면 하나로 접는다(재시도가 순서를 오염시킨다).
 */
function splitRuns(
  entries: readonly (ObservedLine | null)[],
  windowMs?: number,
): ObservedLine[][] {
  const runs: ObservedLine[][] = [];
  let cur: ObservedLine[] = [];
  let prevAt = 0;
  for (const e of entries) {
    if (e === null || (windowMs !== undefined && cur.length > 0 && e.at - prevAt > windowMs)) {
      if (cur.length > 0) runs.push(cur);
      cur = [];
    }
    if (e === null) continue;
    // 명령의 연속 재시도만 접는다. 사용자 단계는 시간·중복으로 순서를 바꾸지 않는다.
    if (windowMs !== undefined && cur[cur.length - 1]?.text === e.text) {
      cur[cur.length - 1] = e;
    } else {
      cur.push(e);
    }
    prevAt = e.at;
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/**
 * **되풀이하는 절차를 찾는다.**
 *
 * 정렬 — 되풀이가 많은 것 먼저, 같으면 **긴 절차 먼저**(긴 것이 더 많은 일을 대신한다),
 * 그다음 최근 것, 그래도 같으면 id 순(같은 입력이면 항상 같은 답이 나와야 한다).
 */
export function mineAutoGoalCandidates(input: AutoGoalMiningInput): AutoGoalMiningResult {
  const minRuns = input.minRuns ?? AUTO_GOAL_MIN_RUNS;
  const max = input.max ?? AUTO_GOAL_CANDIDATE_MAX;
  const dismissed = new Set(input.dismissed ?? []);
  const tally = new Map<string, SeqTally>();
  let observed = 0;

  // ⓐ 에이전트가 친 셸 명령 — "늘 이 순서로 한다"가 가장 또렷하게 남는 자리.
  for (const entries of Object.values(input.bashHistory ?? {})) {
    // 런타임 이력은 최신순이다. 시각으로 먼저 정렬해야 꼬리가 실제 최신 관찰을 뜻한다.
    const tail = [...entries].sort((a, b) => a.timestamp - b.timestamp).slice(-AUTO_GOAL_SCAN_TAIL);
    const lines = tail.map((e): ObservedLine | null => {
      const text = e.command ?? '';
      // 실패·진행 중·옛 상태 미상은 경계다. 걸러 붙이면 A 실패 B 가 A B 절차로 바뀐다.
      if (e.status !== 'success' || e.commandTruncated || !fitsObservation(text, AUTO_GOAL_COMMAND_MAX)) return null;
      return { text, at: e.timestamp, files: pathsIn(text) };
    });
    observed += lines.filter((line) => line !== null).length;
    tallyRuns(splitRuns(lines, AUTO_GOAL_WINDOW_MS), 'command', tally);
  }

  // ⓑ 사용자가 무대에 꽂은 단계 — 사용자가 손으로 되풀이해 온 절차가 그대로 남아 있는 자리.
  for (const goal of Object.values(input.sessionGoals ?? {})) {
    const lines = (goal.steps ?? []).map((s): ObservedLine | null => {
      const text = s.text ?? '';
      if (s.authoredBy !== 'user' || s.status !== 'done' || !fitsObservation(text, AUTO_GOAL_STEP_MAX)) return null;
      return { text, at: s.updatedAt, files: [] };
    });
    observed += lines.filter((line) => line !== null).length;
    // 한 목표 안의 단계는 이미 한 줄기다 — 시간으로 다시 가르지 않는다(꽂은 시각은 순서가 아니다).
    tallyRuns(splitRuns(lines), 'step', tally);
  }

  const rows = [...tally.entries()]
    .filter(([id, t]) => t.runs >= minRuns && !dismissed.has(id))
    .sort((a, b) => {
      if (a[1].runs !== b[1].runs) return b[1].runs - a[1].runs;
      if (a[1].steps.length !== b[1].steps.length) return b[1].steps.length - a[1].steps.length;
      if (a[1].lastSeenAt !== b[1].lastSeenAt) return b[1].lastSeenAt - a[1].lastSeenAt;
      return a[0].localeCompare(b[0]);
    });

  /*
   * 부분 묶음은 버린다 — `a b c` 가 3회면 `a b` 도 3회라, 둘 다 세우면 거의 같은 스킬 두 장이 주입에서 서로를 밀어낸다.
   * 긴 절차의 부분 수열이면서 되풀이 수가 더 많지 않은 것만 버린다(더 자주 도는 짧은 묶음은 독립한 절차다).
   */
  const kept: AutoGoalCandidate[] = [];
  for (const [id, t] of rows) {
    const covered = kept.some((k) => k.runs >= t.runs && isSubsequenceRun(t.steps, k.steps));
    if (covered) continue;
    kept.push({
      id,
      title: autoGoalTitle(t.steps),
      steps: t.steps,
      runs: t.runs,
      lastSeenAt: t.lastSeenAt,
      source: t.source,
      ...(t.files.size > 0 ? { files: [...t.files].slice(0, AUTO_GOAL_SEQUENCE_MAX) } : {}),
    });
    if (kept.length >= max) break;
  }

  return { candidates: kept, observed };
}

/** `inner` 가 `outer` 안에 **연속으로** 들어 있는가 — 순서가 곧 절차라 흩어진 포함은 세지 않는다. */
export function isSubsequenceRun(inner: readonly string[], outer: readonly string[]): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i += 1) {
    let hit = true;
    for (let j = 0; j < inner.length; j += 1) {
      if (outer[i + j] !== inner[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/** 후보를 `SKILL.md` 본문으로(모델 없이). 이 글만으로 절차를 다시 돌릴 수 있어야 한다 — 단계는 원문 코드블록, 관찰 사실(횟수·마지막)을 함께 적는다. */
export function autoGoalSkillBody(candidate: AutoGoalCandidate, at: number): string {
  const lines: string[] = [];
  lines.push(`# ${candidate.title}`);
  lines.push('');
  lines.push(`이 절차는 이 프로젝트에서 **${candidate.runs}번 되풀이**된 성공·완료 근거를 보고 자동으로 적었습니다.`);
  lines.push('처음에는 검토 대기 후보로 저장됩니다. 반복 관찰만으로 실행이 승인되지는 않습니다.');
  lines.push('사용 전에 현재 검토 상태와 적용 조건·파일 근거를 확인하세요. 지금 사용자의 지시가 우선합니다.');
  lines.push('');
  lines.push('## 단계');
  lines.push('');
  if (candidate.source === 'command') {
    lines.push('```bash');
    for (const s of candidate.steps) lines.push(s);
    lines.push('```');
  } else {
    for (let i = 0; i < candidate.steps.length; i += 1) lines.push(`${i + 1}. ${candidate.steps[i]}`);
  }
  if (candidate.files && candidate.files.length > 0) {
    lines.push('');
    lines.push('## 이 절차가 만지는 것');
    lines.push('');
    for (const f of candidate.files) lines.push(`- \`${f}\``);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    `관찰 ${candidate.runs}회 · 마지막 ${new Date(candidate.lastSeenAt || at).toISOString().slice(0, 10)} · 절차 감지가 적음`,
  );
  lines.push('');
  lines.push('사실과 다르면 이 파일을 직접 고치세요 — 다음 관찰이 수정한 본문을 덮어쓰지 않으며, 바뀐 본문은 재검토합니다.');
  return lines.join('\n');
}

/** 스킬 카드의 한 줄 설명 — 언제 이 절차를 꺼내야 하는지를 말한다(집행이 이 줄만 보고 고른다). */
export function autoGoalSkillDescription(candidate: AutoGoalCandidate): string {
  const what = candidate.steps.map((s) => headWords(s)).join(' · ');
  return clamp(`${candidate.title} — 이 프로젝트에서 ${candidate.runs}번 되풀이된 절차(${what})`, 240);
}
