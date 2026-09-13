/**
 * §5.10 — **되풀이를 알아본다.** 자동 목표의 본체.
 *
 * 사용자 지시: "사용자의 행동이나 에이전트의 행동들 중 자동으로 분석을 통해서 스킬을 만들어주는 것."
 *
 * 그래서 이 모듈이 답하는 물음은 하나다 — **"이 프로젝트에서 늘 같은 순서로 하는 일이 무엇인가."**
 * 답의 재료는 **이미 우리가 갖고 있다**: 셸 명령 이력(`bashHistory`)과 사용자가 무대에 꽂은
 * 단계(`SessionGoalStep.authoredBy==='user'`). 새 수집 경로를 내지 않는다(⑫(a) 와 같은 규율).
 *
 * **모델을 부르지 않는다.** 되풀이를 알아보는 데 추론이 필요 없고, 무엇보다 이 기능은 사용자가
 * 켜 두고 잊는 물건이라 **켜 두는 동안 토큰이 들면 안 된다**(§5.10 리플렉션이 매 턴 자식을 띄워
 * 아무도 켠 적 없는 기능이 토큰을 태우던 그 실패를 되밟지 않는다). 절차의 단계는 요약하지 않고
 * **실제로 돌던 원문** 그대로 싣는다 — 요약하는 순간 그 절차를 다시 돌릴 수 없게 된다.
 *
 * **순수 함수다.** `node:fs`·시간·플랫폼을 모르고, 서버가 화면 없이 시험할 수 있다.
 * 저장하지 않는다 — 후보는 이력에서 매번 다시 세는 **파생**이다(⑫(a) 팔레트와 같은 규칙).
 */
import {
  AUTO_GOAL_CANDIDATE_MAX,
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

/** 훑은 결과 — 후보와 "무엇을 몇 개나 봤나". */
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

/**
 * 명령을 **같은 것으로 볼지** 정하는 정규화.
 *
 * 연속 공백만 접고 그 밖은 건드리지 않는다 — `git status` 와 `git status -s` 를 같은 것으로
 * 뭉치면 굳어진 스킬에 적힌 줄과 실제로 돌던 명령이 달라지고, 그 스킬은 돌리면 틀린다
 * (⑫(a) `goalActions` 가 같은 자리에 세운 규칙).
 */
function normalize(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 순서를 **안정적인 id** 로 접는다(FNV-1a 32비트).
 *
 * 저장하지 않는 파생이라 id 는 매번 다시 계산된다 — 그러므로 같은 절차는 언제 세어도 같은 키여야
 * 한다. 그래야 사용자가 물린 기록(`dismissed`)과 이미 굳힌 스킬이 다음 분석에서도 그 후보를
 * 정확히 다시 가리킨다. 암호학적 성질은 필요 없고 **결정성**만 필요하다.
 */
export function autoGoalSequenceId(source: AutoGoalSource, steps: readonly string[]): string {
  let h = 0x811c9dc5;
  const text = `${source}\0${steps.join('\0')}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${source}:${h.toString(36)}`;
}

/**
 * 절차의 이름 — **첫 걸음에서 마지막 걸음까지**.
 *
 * 첫 단계만 쓰면 `git add …` 짜리 후보가 여럿 서서 서로 구분되지 않고, 단계를 다 이으면 한 줄에
 * 안 들어간다. 양 끝의 머리 낱말 둘씩이 절차의 정체를 가장 짧게 말한다.
 */
export function autoGoalTitle(steps: readonly string[]): string {
  const head = headWords(steps[0] ?? '');
  const tail = headWords(steps[steps.length - 1] ?? '');
  const text = steps.length > 1 && tail !== head ? `${head} → ${tail}` : head;
  return clamp(text, AUTO_GOAL_TITLE_MAX);
}

/** 한 줄에서 앞 두 낱말 — `pnpm build --filter x` → `pnpm build`. */
function headWords(line: string): string {
  const parts = normalize(line).split(' ').filter(Boolean);
  return parts.slice(0, 2).join(' ') || normalize(line);
}

/**
 * 명령 인자에서 **경로처럼 보이는 것**을 모은다 — 굳어진 스킬의 `files` 앵커가 된다.
 *
 * 판정은 이미 있는 셸 토크나이저 한 벌(`bashCommandPaths.ts`)을 그대로 쓴다. 두 벌이 되면
 * 한쪽만 고쳐져 어긋난다(§2.1 #3 이 읽기·쓰기 추출기에 세운 그 규율).
 */
function pathsIn(command: string): string[] {
  const out: string[] = [];
  for (const tok of tokenizeShellCommand(command)) {
    if (tok.startsWith('-') || !looksLikeShellPath(tok)) continue;
    out.push(tok);
  }
  return out;
}

/**
 * 한 줄기의 행동 나열에서 되풀이되는 묶음을 센다.
 *
 * `runs` 는 **그 묶음이 통째로 나타난 횟수**다. 겹쳐 세지 않는다 — `a b a b a b` 에서 `a b` 는
 * 3회이지 5회가 아니다(겹쳐 세면 두 번 한 일이 여섯 번 한 일로 보인다).
 */
function tallyRuns(
  runsOfLines: readonly (readonly { text: string; at: number; files: readonly string[] }[])[],
  source: AutoGoalSource,
  tally: Map<string, SeqTally>,
): void {
  for (const run of runsOfLines) {
    if (run.length < AUTO_GOAL_SEQUENCE_MIN) continue;
    for (let len = AUTO_GOAL_SEQUENCE_MIN; len <= AUTO_GOAL_SEQUENCE_MAX; len += 1) {
      if (run.length < len) break;
      // 겹치지 않게 훑는다 — 한 자리에서 잡히면 그 묶음 길이만큼 건너뛴다.
      for (let i = 0; i + len <= run.length; ) {
        const slice = run.slice(i, i + len);
        const steps = slice.map((x) => x.text);
        const id = autoGoalSequenceId(source, steps);
        const found = tally.get(id);
        const last = slice[slice.length - 1]?.at ?? 0;
        if (found) {
          found.runs += 1;
          if (last > found.lastSeenAt) found.lastSeenAt = last;
          for (const x of slice) for (const f of x.files) found.files.add(f);
        } else {
          const files = new Set<string>();
          for (const x of slice) for (const f of x.files) files.add(f);
          tally.set(id, { steps, runs: 1, lastSeenAt: last, source, files });
        }
        i += len;
      }
    }
  }
}

/**
 * 이력을 **시간 창으로 갈라** 이어진 일의 줄기들을 만든다.
 *
 * 없으면 어제 친 `git status` 와 오늘 친 `pnpm build` 가 한 절차가 된다 — 시간이 그 둘을 갈라
 * 주는 유일한 증거다. 같은 줄이 연달아 오면 한 번으로 접는다(재시도가 순서를 오염시킨다).
 */
function splitRuns(
  entries: readonly { text: string; at: number; files: readonly string[] }[],
  windowMs: number,
): { text: string; at: number; files: readonly string[] }[][] {
  const runs: { text: string; at: number; files: readonly string[] }[][] = [];
  let cur: { text: string; at: number; files: readonly string[] }[] = [];
  let prevAt = 0;
  for (const e of entries) {
    if (cur.length > 0 && e.at - prevAt > windowMs) {
      runs.push(cur);
      cur = [];
    }
    // 연달아 같은 줄은 접는다 — `pnpm build` 를 세 번 재시도한 것은 세 단계가 아니다.
    if (cur[cur.length - 1]?.text !== e.text) cur.push(e);
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
    // 꼬리만 본다 — 되풀이는 최근 습관이라 전량을 다시 세도 답이 같고, 느려지기만 한다(§9).
    const tail = entries.length > AUTO_GOAL_SCAN_TAIL ? entries.slice(entries.length - AUTO_GOAL_SCAN_TAIL) : entries;
    const lines = tail
      .map((e) => {
        const text = clamp(normalize(e.command ?? ''), AUTO_GOAL_STEP_MAX);
        return { text, at: typeof e.timestamp === 'number' ? e.timestamp : 0, files: pathsIn(e.command ?? '') };
      })
      .filter((x) => x.text !== '')
      .sort((a, b) => a.at - b.at);
    observed += lines.length;
    tallyRuns(splitRuns(lines, AUTO_GOAL_WINDOW_MS), 'command', tally);
  }

  // ⓑ 사용자가 무대에 꽂은 단계 — 사용자가 손으로 되풀이해 온 절차가 그대로 남아 있는 자리.
  for (const goal of Object.values(input.sessionGoals ?? {})) {
    const lines = (goal.steps ?? [])
      .filter((s) => s.authoredBy === 'user')
      .map((s) => ({
        text: clamp(normalize(s.text ?? ''), AUTO_GOAL_STEP_MAX),
        at: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
        files: [] as string[],
      }))
      .filter((x) => x.text !== '');
    observed += lines.length;
    // 한 목표 안의 단계는 이미 한 줄기다 — 시간으로 다시 가르지 않는다(꽂은 시각은 순서가 아니다).
    if (lines.length >= AUTO_GOAL_SEQUENCE_MIN) tallyRuns([lines], 'step', tally);
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
   * 부분 묶음은 버린다 — `a b c` 가 3회면 `a b` 도 3회다. 둘을 다 세우면 같은 일이 목록에
   * 두 번 서고, 스킬로 굳으면 **거의 같은 스킬이 두 장** 생겨 주입에서 서로를 밀어낸다.
   * 이미 선 긴 절차의 **부분 수열**이면서 되풀이 수가 그보다 많지 않은 것만 버린다(더 자주
   * 도는 짧은 묶음은 그 자체로 독립한 절차다).
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

/**
 * 후보 하나를 **`SKILL.md` 본문**으로 옮긴다 — 모델 없이, 관찰한 것만으로.
 *
 * 본문이 지켜야 하는 것은 하나다: **이 글만 읽고 그 절차를 다시 돌릴 수 있어야 한다.** 그래서
 * 단계는 원문 그대로 코드블록에 담고, 관찰 사실(몇 번 봤나·언제 마지막이었나)을 함께 적어
 * 읽는 사람이 이 스킬을 얼마나 믿을지 스스로 정하게 한다(§5.10 이 "근거 없는 단정"을 막으려고
 * 세운 것과 같은 태도).
 */
export function autoGoalSkillBody(candidate: AutoGoalCandidate, at: number): string {
  const lines: string[] = [];
  lines.push(`# ${candidate.title}`);
  lines.push('');
  lines.push(`이 절차는 이 프로젝트에서 **${candidate.runs}번 되풀이**된 것을 보고 자동으로 적었습니다.`);
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
  lines.push('사실과 다르면 이 파일을 직접 고치세요 — 다음 분석이 덮어쓰지 않습니다.');
  return lines.join('\n');
}

/** 스킬 카드의 한 줄 설명 — 언제 이 절차를 꺼내야 하는지를 말한다(집행이 이 줄만 보고 고른다). */
export function autoGoalSkillDescription(candidate: AutoGoalCandidate): string {
  const what = candidate.steps.map((s) => headWords(s)).join(' · ');
  return clamp(`${candidate.title} — 이 프로젝트에서 ${candidate.runs}번 되풀이된 절차(${what})`, 240);
}
