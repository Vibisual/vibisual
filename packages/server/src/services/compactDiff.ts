// SCENARIO.md §5.26 (D) — 압축 전후 대조 + (E) 복원 브리핑 조립.
//
// **판정에 모델을 쓰지 않는다.** 압축이 끝나면 트랜스크립트에 요약 항목이 붙는다. 마커가 적어 둔
// 바이트 오프셋 뒤에 새로 붙은 구간에서 요약 본문을 뽑고, 압축 직전의 `workingSet` 각 항목이
// **그 안에 나타나는지**만 본다. 그 이상은 우리가 알 수 없다.
//
// **그래서 결과의 이름이 `notCarried` 다 — "잃어버린 것"이 아니다.** 요약이 바꿔 말했을 수 있으므로
// 우리가 아는 것은 "요약 본문에 나타나지 않았다"까지이고, 화면도 그렇게 적는다.
// (§5.19 (H)·§2.1 이 세운 "모르는 것을 넘겨짚지 않는다"와 같은 규율.)

import type { CompactNotCarried, CompactWorkingSet } from '@vibisual/shared';
import { INSURANCE_BRIEF_MAX_CHARS, INSURANCE_WORKING_SET_MAX } from '@vibisual/shared';

/** 빈 `workingSet` — 그래프가 아무것도 모를 때의 정직한 값. */
export function emptyWorkingSet(): CompactWorkingSet {
  return {
    openFiles: [],
    recentEdits: [],
    runningTasks: [],
    queuedCommands: 0,
    goalSteps: [],
    teammates: [],
  };
}

/** 빈 대조 결과. */
export function emptyNotCarried(): CompactNotCarried {
  return { openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [] };
}

/** 대조 결과가 실제로 무언가를 말하는가(전부 비면 브리핑을 실을 이유가 없다). */
export function hasNotCarried(nc: CompactNotCarried): boolean {
  return nc.openFiles.length > 0
    || nc.recentEdits.length > 0
    || nc.runningTasks.length > 0
    || nc.goalSteps.length > 0
    || nc.teammates.length > 0
    || nc.goal !== undefined;
}

/**
 * 요약 본문을 찾기 좋은 모양으로 접는다.
 *
 * ⚠ **여기서만 `toLowerCase()` 를 쓴다.** 이것은 파일시스템 키가 아니라 **사람이 쓴 산문 안의
 * 텍스트 검색**이라, 대소문자를 접는 것이 맞다. 경로를 *키로* 쓸 때는 §멀티플랫폼 1축대로
 * `pathKey()` 를 써야 한다(Linux 는 `Feature-X ≠ feature-x`) — 두 규칙을 헷갈리면 한쪽이 깨진다.
 */
function foldForSearch(text: string): string {
  return text.replace(/\\/g, '/').toLowerCase();
}

/** 경로가 요약에 나타나는가 — 전체 경로 또는 마지막 두 조각(`dir/file.ts`) 또는 파일명. */
function pathMentioned(haystack: string, rawPath: string): boolean {
  const p = foldForSearch(rawPath);
  if (!p) return false;
  if (haystack.includes(p)) return true;
  const parts = p.split('/').filter(Boolean);
  const file = parts[parts.length - 1];
  if (!file) return false;
  const parent = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (parent && haystack.includes(`${parent}/${file}`)) return true;
  // 파일명 단독은 너무 짧으면 오탐한다(`a.ts`·`index.ts` 는 어디에나 있다).
  // 그러나 "안 실렸다"고 **잘못 말하는 쪽**이 더 나쁘므로, 짧아도 이름이 보이면 실린 것으로 친다.
  return haystack.includes(file);
}

/**
 * 문장형 항목(작업 제목·목표 단계)이 요약에 나타나는가.
 *
 * 앞머리 길이가 이 판정의 전부다. **요약은 인용하지 않고 바꿔 쓴다** — "컨텍스트 보험 5단계
 * 구현을 끝까지 밀어붙인다"가 요약에서는 "컨텍스트 보험 5단계 구현을 이어감"이 된다. 앞머리를
 * 길게 잡으면 이런 것이 전부 "안 실렸다"로 찍히고, 그 목록이 그대로 복원 브리핑에 실려
 * **잃지 않은 것을 잃었다고 모델에게 알린다.** 그래서 짧게 잡아 실린 쪽으로 기울인다
 * (§5.26 (D) — 우리가 아는 것은 "요약 본문에 나타나지 않았다"까지다).
 *
 * 하한(`PHRASE_HEAD_MIN`)이 있는 이유는 반대쪽이다 — 두세 글자는 어느 요약에나 있어서
 * 그것으로 "실렸다"고 하면 이 갈피가 영영 비게 된다.
 */
function phraseMentioned(haystack: string, rawPhrase: string): boolean {
  const p = foldForSearch(rawPhrase).trim();
  if (!p) return false;
  if (haystack.includes(p)) return true;
  const head = p.slice(0, PHRASE_HEAD_MAX).trim();
  return head.length >= PHRASE_HEAD_MIN && haystack.includes(head);
}

/** 앞머리 매칭에 쓰는 조각 길이 — 위 주석이 이 두 숫자의 근거다. */
const PHRASE_HEAD_MAX = 12;
const PHRASE_HEAD_MIN = 8;

export interface CompactDiffResult {
  notCarried: CompactNotCarried;
  /** 요약이 실제로 실은 항목 수. `notCarried` 와 합하면 `workingSet` 의 전체 항목 수다. */
  carriedCount: number;
}

/**
 * 압축 직전 `workingSet` 과 압축 요약 본문을 맞대 본다.
 *
 * `queuedCommands`(숫자)와 `lastTool`·`lastAssistantTail`(꼬리)은 대조하지 않는다 —
 * 숫자는 요약에 들어갈 성질이 아니고, 꼬리는 요약이 당연히 다시 쓰기 때문이다.
 */
export function diffAgainstSummary(
  workingSet: CompactWorkingSet,
  summaryText: string,
): CompactDiffResult {
  const hay = foldForSearch(summaryText ?? '');
  const nc = emptyNotCarried();
  let carried = 0;

  for (const p of workingSet.openFiles ?? []) {
    if (pathMentioned(hay, p)) carried += 1;
    else nc.openFiles.push(p);
  }
  for (const p of workingSet.recentEdits ?? []) {
    if (pathMentioned(hay, p)) carried += 1;
    else nc.recentEdits.push(p);
  }
  for (const t of workingSet.runningTasks ?? []) {
    if (phraseMentioned(hay, t)) carried += 1;
    else nc.runningTasks.push(t);
  }
  for (const s of workingSet.goalSteps ?? []) {
    if (phraseMentioned(hay, s)) carried += 1;
    else nc.goalSteps.push(s);
  }
  for (const m of workingSet.teammates ?? []) {
    if (phraseMentioned(hay, m)) carried += 1;
    else nc.teammates.push(m);
  }
  if (workingSet.goal) {
    if (phraseMentioned(hay, workingSet.goal)) carried += 1;
    else nc.goal = workingSet.goal;
  }

  return { notCarried: capNotCarried(nc), carriedCount: carried };
}

/** 배열 축마다 상한을 건다 — 원장이 두 번째 트랜스크립트가 되지 않게(§5.26 (B)). */
function capNotCarried(nc: CompactNotCarried): CompactNotCarried {
  const cap = INSURANCE_WORKING_SET_MAX;
  return {
    openFiles: nc.openFiles.slice(0, cap),
    recentEdits: nc.recentEdits.slice(0, cap),
    runningTasks: nc.runningTasks.slice(0, cap),
    goalSteps: nc.goalSteps.slice(0, cap),
    teammates: nc.teammates.slice(0, cap),
    ...(nc.goal !== undefined ? { goal: nc.goal } : {}),
  };
}

/**
 * §5.26 (D) — 압축 요약 구간에서 본문만 뽑는다.
 *
 * JSONL 한 줄씩 파싱해 **문자열로 보이는 것만** 모은다. 판본마다 요약이 앉는 자리가 달라
 * (`summary` · `message.content` · `content[].text` · `isCompactSummary`) 한 모양을 고집하면
 * 판올림 한 번에 조용히 빈 문자열이 된다 — 넓게 받아 합집합을 만든다(§3.6-1 과 같은 규율).
 */
export function extractSummaryText(chunk: string): string {
  const out: string[] = [];
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // 잘린 마지막 줄 — 다음 스윕이 온전한 줄로 다시 본다
    }
    collectText(obj, out, 0);
  }
  return out.join('\n');
}

/** 중첩 객체에서 텍스트를 긁는다. 깊이를 제한해 거대한 도구 응답까지 파고들지 않는다. */
function collectText(node: unknown, out: string[], depth: number): void {
  if (depth > 6 || node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (node.length > 0) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  for (const key of ['summary', 'text', 'content', 'message']) {
    if (key in rec) collectText(rec[key], out, depth + 1);
  }
}

/**
 * §5.26 (E) — 복원 브리핑 블록. **한 턴에만** 실린다.
 *
 * 짧게 유지하는 것이 규율이다 — 복원하려고 실은 글이 다음 압축을 앞당기면 앞뒤가 맞지 않는다.
 * 넘치면 최근 것부터 남기고 "그리고 N건 더"로 접으며, 전문은 팝업(§7.23)에 있다.
 */
export function buildRecoveryBrief(
  nc: CompactNotCarried,
  labels: RecoveryBriefLabels,
  maxChars: number = INSURANCE_BRIEF_MAX_CHARS,
): string {
  if (!hasNotCarried(nc)) return '';
  const lines: string[] = [labels.header];
  if (nc.goal) lines.push(`- ${labels.goal}: ${nc.goal}`);
  pushList(lines, labels.goalSteps, nc.goalSteps, labels.more);
  pushList(lines, labels.openFiles, nc.openFiles, labels.more);
  pushList(lines, labels.recentEdits, nc.recentEdits, labels.more);
  pushList(lines, labels.runningTasks, nc.runningTasks, labels.more);
  pushList(lines, labels.teammates, nc.teammates, labels.more);
  lines.push(labels.footer);

  let text = lines.join('\n');
  if (text.length <= maxChars) return text;
  // 넘치면 뒤에서부터 줄을 덜어낸다 — 머리말과 꼬리말은 남긴다(문장이 끊기면 뜻이 사라진다).
  const head = lines[0] ?? '';
  const foot = lines[lines.length - 1] ?? '';
  const body = lines.slice(1, -1);
  while (body.length > 0) {
    body.pop();
    text = [head, ...body, foot].join('\n');
    if (text.length <= maxChars) return text;
  }
  return [head, foot].join('\n').slice(0, maxChars);
}

export interface RecoveryBriefLabels {
  header: string;
  footer: string;
  goal: string;
  goalSteps: string;
  openFiles: string;
  recentEdits: string;
  runningTasks: string;
  teammates: string;
  /** `(N건 더)` 같은 꼬리를 만드는 함수. */
  more: (n: number) => string;
}

/** 한 줄에 몇 개까지 나열할지 — 목록이 길어지면 개수로 접는다. */
const BRIEF_ITEMS_PER_LINE = 6;

function pushList(lines: string[], label: string, items: readonly string[], more: (n: number) => string): void {
  if (items.length === 0) return;
  const shown = items.slice(0, BRIEF_ITEMS_PER_LINE);
  const rest = items.length - shown.length;
  lines.push(`- ${label}: ${shown.join(', ')}${rest > 0 ? ` ${more(rest)}` : ''}`);
}

/**
 * §5.26 (E) — 프롬프트에 실리는 실제 문구.
 *
 * 우리가 프롬프트에 조립하는 다른 블록들과 **같은 언어**를 쓴다(§4 규약의 블록들이 전부 한국어다).
 * 화면 라벨과 달리 이쪽은 로케일을 타지 않는다 — 모델에게 주는 글이라 12개 로케일로 갈라 두면
 * 어느 번역이 실렸는지에 따라 복원 품질이 달라진다.
 *
 * **말투가 곧 규율이다.** "잃어버렸다"가 아니라 "요약에 안 보인다"라고 적는다 — 우리가 아는 것은
 * 딱 거기까지이고(§5.26 (D)), 없는 확신을 주면 모델이 지어내기 시작한다.
 */
export const RECOVERY_BRIEF_LABELS_KO: RecoveryBriefLabels = {
  // 앞의 빈 줄 둘은 앞 블록과 떼기 위한 것 — 다른 주입 블록들과 같은 규약이다.
  header: `

# 방금 대화가 압축됐다 (자동 안내 · 이번 턴만)
아래는 압축 직전에 이 세션이 붙잡고 있었는데 **요약 본문에서는 보이지 않는** 것들이다.
요약이 다른 말로 옮겼을 수도 있으니 사라졌다고 단정하지 말고, 이어서 일할 때 참고만 해라.`,
  footer: '- 위 목록이 지금 하는 일과 무관하면 무시해라. 이 안내는 **다음 턴부터 실리지 않는다.**',
  goal: '목표',
  goalSteps: '남은 단계',
  openFiles: '보고 있던 파일',
  recentEdits: '고치던 파일',
  runningTasks: '돌던 작업',
  teammates: '팀원',
  more: (n) => `외 ${n}건`,
};

/** §5.26 (E) — 위 문구로 브리핑 한 벌. 실을 것이 없으면 빈 문자열이다. */
export function buildRecoveryBlock(nc: CompactNotCarried, maxChars?: number): string {
  return buildRecoveryBrief(nc, RECOVERY_BRIEF_LABELS_KO, maxChars);
}
