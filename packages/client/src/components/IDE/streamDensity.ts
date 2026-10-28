/**
 * §5.5 #17-12 표시 밀도 변환(순수) — **표시 직전에** 아이템 배열을 접는다(기본은 한 줄 요약, 펼치면 상세).
 * 표시 계층 전용 — 파싱(streamItems)·스크롤·카드 합류는 건드리지 않는다. 밀도는 클라 UI 상태(`graphStore.ideStreamDensity`).
 */
import type { StreamDensity } from '@vibisual/shared';
import { sameStreamItem, isSystemSubtypeChip, type StreamGroup, type StreamItemFull, type StreamPlan } from './streamItems.js';
import { foldTaskChips } from './taskChips.js';
import { mergeAdjacentThinkTraces, type ThinkTraceView } from './turnSteps.js';

/**
 * 도구 실행 묶음 — 기본은 "명령 실행됨 ×N" + 최근 도구 한 줄, 펼치면 원래 항목 그대로.
 * §5.5 #17-13 — 이름을 가리지 않고 묶고 사이 잡음(빈 줄·system 칩)은 런 안으로 흡수한다(이름별로 끊으면 상자가 사다리로 쌓인다).
 * §5.5 #17-16 — 첫 도구부터(문턱 없음), 진행 중 도구도 안에 묶는다 — 밖에 두면 흡수될 때 리스트 높이가 출렁인다.
 */
export interface StreamToolGroup {
  kind: 'toolgroup';
  id: string;
  /** 묶인 도구 호출 수(라벨의 ×N). */
  toolCount: number;
  /** 등장한 도구 이름(중복 제거, 등장 순서). 헤더 칩으로 몇 개만 보여준다. */
  toolNames: string[];
  /** 펼치면 그대로 렌더할 원래 항목들(도구 + 사이 잡음, 원 순서). */
  children: StreamItemFull[];
  /** 런의 마지막 도구가 진행 중인가 — 접혀 있어도 그 한 줄은 스피너와 함께 항상 보인다. */
  active: boolean;
  timestamp: number;
  /**
   * §4 (스트림 3종 ①) — 이 묶음이 **중첩 서브에이전트(Task)** 가 부른 도구들이면 그 Task 호출의 id.
   * 런은 주인이 같은 도구끼리만 묶이므로 묶음 하나의 주인은 항상 하나다.
   */
  nestedUnderToolUseId?: string;
}

/** 렌더러가 실제로 그리는 아이템 = 파싱 아이템 + 묶음. */
export type StreamDisplayItem = StreamItemFull | StreamToolGroup;

/**
 * §5.5 #17-45 — 이 본문이 **연속 발화 런**에서 선 자리.
 * `solo` 앞뒤가 끊긴 홑 문단 · `head` 런의 첫 문단 · `mid` 가운데 · `tail` 런의 마지막 문단.
 */
export type SpeechRunPos = 'solo' | 'head' | 'mid' | 'tail';

/** 런 판정에 필요한 최소 형태 — Sub 탭(`StreamDisplayItem`)·메인 탭(`TerminalEntry`) 공용. */
export interface SpeechRole {
  id: string;
  /** AI 본문인가 — 아니면 여기서 런이 끊긴다(내 말풍선·카드·오류·계획·그림·도구 묶음·라이브 1줄). */
  text: boolean;
  /** 이 말의 주인 — Sub 탭은 중첩 서브에이전트(`nestedUnderToolUseId`), 메인 탭은 세션(`sessionLabel`). 주인이 다르면 런을 끊는다. */
  owner?: string | undefined;
}

/** 밀도가 `compact` 가 아닐 때 넘기는 빈 맵 — 참조가 고정돼야 `useMemo`·`memo` 가 헛돌지 않는다. */
export const NO_SPEECH_RUNS: ReadonlyMap<string, SpeechRunPos> = new Map<string, SpeechRunPos>();

/**
 * §5.5 #17-45 — 연달아 온 AI 본문을 한 발화로 묶어 문단마다 자리를 매긴다(말머리는 런의 첫 문단에만).
 * 가상 리스트라 CSS 형제 선택자(`+`)로는 못 가린다(화면 밖 앞 항목은 DOM 에 없다) — 항목 배열로 판정한다.
 */
export function speechRunPositions(seq: readonly SpeechRole[]): Map<string, SpeechRunPos> {
  const out = new Map<string, SpeechRunPos>();
  let i = 0;
  while (i < seq.length) {
    const cur = seq[i]!;
    if (!cur.text) { i++; continue; }
    let j = i + 1;
    while (j < seq.length && seq[j]!.text && seq[j]!.owner === cur.owner) j++;
    for (let k = i; k < j; k++) {
      out.set(seq[k]!.id, j - i === 1 ? 'solo' : k === i ? 'head' : k === j - 1 ? 'tail' : 'mid');
    }
    i = j;
  }
  return out;
}

/** Virtuoso key·앞쪽 절단 shift 카운트용 안정 id. */
export function displayItemId(item: StreamDisplayItem): string {
  return item.id;
}

/** identity 안정화 비교(묶음까지 포함) — 렌더 결과에 영향 주는 필드가 모두 같으면 이전 참조를 재사용한다. */
export function sameDisplayItem(a: StreamDisplayItem, b: StreamDisplayItem): boolean {
  if (a.kind === 'toolgroup' || b.kind === 'toolgroup') {
    if (a.kind !== 'toolgroup' || b.kind !== 'toolgroup') return false;
    if (a.toolCount !== b.toolCount || a.active !== b.active || a.children.length !== b.children.length) return false;
    for (let k = 0; k < b.children.length; k++) {
      if (!sameStreamItem(a.children[k]!, b.children[k]!)) return false;
    }
    return true;
  }
  return sameStreamItem(a, b);
}

/** 묶을 수 있는 도구인가 — §5.5 #17-16 진행 중 도구도 묶는다(밖에 두면 끝나는 순간 묶음으로 흡수되며 화면이 출렁인다). */
function groupable(item: StreamDisplayItem): item is StreamGroup {
  return item.kind === 'tool';
}

/**
 * 런을 끊지 않고 흡수할 "잡음" 항목인가 — system 칩(`[task_started]` 등)과 **빈 텍스트**.
 * 실제 대화(내용 있는 text·result·계획·카드)는 잡음이 아니므로 여기서 런이 끊긴다.
 */
function runFiller(item: StreamDisplayItem): boolean {
  if (item.kind === 'system') return !item.transportRecovery;
  return item.kind === 'text' && item.content.trim() === '';
}

/** §5.5 #17-39 ⑩ — 합치기가 읽는 자국 모양(자국이 아니면 `null` = 구간이 끊긴다). */
function readStepTrace(item: StreamDisplayItem): ThinkTraceView | null {
  if (item.kind !== 'step') return null;
  return { ms: item.endedAt - item.timestamp, chars: item.chars, owner: item.nestedUnderToolUseId };
}

/** 합친 시간·분량을 든 새 자국 — id·자리(`timestamp`)는 첫 자국 그대로, `endedAt` 은 시작 + 사고 시간의 합. */
function writeStepTrace(first: StreamDisplayItem, ms: number, chars: number): StreamDisplayItem {
  return first.kind === 'step' ? { ...first, endedAt: first.timestamp + ms, chars } : first;
}

/**
 * 같은 턴의 옛 계획을 접는다(마지막 계획만 펼쳐 보인다).
 * 턴 경계 = 사용자 명령(`command`) 아이템 — 그 뒤로는 새 턴이라 계획도 새로 센다.
 */
function markSupersededPlans(items: StreamItemFull[]): StreamItemFull[] {
  // 뒤에서부터 훑으며 "이 턴에서 이미 더 새로운 계획을 봤는가"를 들고 간다.
  let seenNewerPlan = false;
  const out = items.slice();
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]!;
    if (it.kind === 'command') { seenNewerPlan = false; continue; }
    if (it.kind !== 'plan') continue;
    const plan = it as StreamPlan;
    if (seenNewerPlan) {
      if (!plan.superseded) out[k] = { ...plan, superseded: true };
    } else {
      seenNewerPlan = true;
      if (plan.superseded) out[k] = { ...plan, superseded: false };
    }
  }
  return out;
}

/**
 * 밀도에 맞춰 표시 아이템을 만든다. `raw` 그대로 · `standard` SDK 상태 칩 숨김 + 옛 계획 접기 + 연속 도구 묶기.
 * `compact` 위 전부 + 도구 묶음을 배열에서 뺀다(§5.5 #17-21 ①) — AI 본문은 하나도 거르지 않고(#17-43) 이어 붙은 사고 자국은 주인별 한 줄(#17-39 ⑩).
 * 변환이 없는 항목은 입력 참조 그대로다(재렌더 방지).
 */
export function applyStreamDensity(items: StreamItemFull[], density: StreamDensity): StreamDisplayItem[] {
  // §5.5 #17-13 ⑤-3 — 작업 칩(시작·끝)은 밀도를 가르기 **전에** 한 줄로 접는다. 밀도 안쪽에 두면
  //   같은 스트림이 탭·밀도마다 다르게 접힌다(간결/표준에서는 어차피 ⑤ 가 걷어내므로 결과는 같다).
  const folded = foldTaskChips(
    items,
    (it) => (it.kind === 'system' ? it.content : null),
    (it, content) => (it.kind === 'system' ? { ...it, content } : it),
  );
  if (density === 'raw') return folded;

  // §5.5 #17-13 ⑤ — SDK 상태 칩(`[task_started]` 등)은 간결/표준에서 아예 그리지 않는다.
  //   내용 없는 레일 점이 한 줄씩 먹으며 화면을 갈랐다(사용자 스크린샷). 내용 있는 system 본문은 남긴다.
  const visible = folded.filter((it) => !(it.kind === 'system' && !it.transportRecovery && isSystemSubtypeChip(it.content)));

  const marked = markSupersededPlans(visible);
  const out: StreamDisplayItem[] = [];
  let i = 0;
  while (i < marked.length) {
    const item = marked[i]!;
    if (groupable(item)) {
      // 도구 이름을 가리지 않고, 사이에 낀 잡음(빈 줄·system 칩)도 넘어가며 런을 끝까지 잇는다.
      let j = i + 1;
      let lastToolEnd = i + 1; // 꼬리 잡음은 런에 넣지 않는다(다음 대화의 머리이므로).
      let toolCount = 1;
      // §4 (스트림 3종 ①) — 런의 **주인**. 중첩 서브에이전트가 부른 도구와 부모가 부른 도구를 한 묶음에
      //   넣으면 "누가 한 일인지"가 묶음 헤더 하나로 뭉개진다 — 주인이 다르면 거기서 런을 끊는다.
      const runNest = item.nestedUnderToolUseId;
      while (j < marked.length) {
        const next = marked[j]!;
        if (groupable(next)) {
          if (next.nestedUnderToolUseId !== runNest) break;
          toolCount++; j++; lastToolEnd = j; continue;
        }
        if (runFiller(next)) { j++; continue; }
        break;
      }
      // §5.5 #17-16 — 문턱 없음: 도구 1개짜리 런도 묶음으로 감싼다. 그래야 두 번째 도구가 와도
      //   "홑 상자가 사라지고 묶음이 생기는" 교체가 일어나지 않고, 같은 묶음의 ×N 만 올라간다.
      const children = marked.slice(i, lastToolEnd);
      const toolNames: string[] = [];
      let active = false;
      for (const c of children) {
        if (c.kind !== 'tool') continue;
        if (!toolNames.includes(c.toolName)) toolNames.push(c.toolName);
        active = c.isActive; // 활성은 런의 마지막 도구에만 붙는다(뒤 도구가 오면 자동으로 덮인다).
      }
      out.push({
        kind: 'toolgroup',
        // 묶음 id = 첫 도구 id 고정. 스트리밍 중 묶음이 자라도 id 가 그대로라 사용자가 펼쳐 둔 상태가 유지된다
        //   (개수를 id 에 넣으면 도구가 하나 늘 때마다 remount 돼 펼침이 풀린다).
        id: `toolgroup-${item.id}`,
        ...(runNest ? { nestedUnderToolUseId: runNest } : {}),
        toolCount,
        toolNames,
        children,
        active,
        timestamp: item.timestamp,
      });
      i = lastToolEnd;
      continue;
    }
    out.push(item);
    i++;
  }

  // §5.5 #17-21 ① / #17-24 ① — 간결은 도구 묶음을 진행 중이든 완료든 **배열에서 제거**한다(높이 0 자리표시자면 가상 리스트 측정이 흐려진다).
  // 단, 런에 흡수된 내용 있는 system 본문(오류·권한 결정)은 묶음 밖으로 꺼내 남긴다.
  if (density === 'compact') {
    const compacted: StreamDisplayItem[] = [];
    for (const it of out) {
      if (it.kind !== 'toolgroup') { compacted.push(it); continue; }
      for (const child of it.children) {
        if (child.kind === 'system' && !isSystemSubtypeChip(child.content)) compacted.push(child);
      }
      // §5.5 #17-24 ① — 진행 중 묶음도 남기지 않는다. 도구가 시작할 때 생겼다가 끝나는 순간 빠지는
      //   그 한 줄이 간결 화면이 끊임없이 깜빡이던 원인이었다. "지금 뭘 하는지"는 작동하는 내내 떠 있는
      //   라이브 1줄(`thinking-live`)이 대신 알린다 — 실행 내용을 문자 그대로 볼 사람은 `표준` 으로 올린다.
    }
    // §5.5 #17-43 — 본문은 **하나도 거르지 않는다**(처음·마지막만 남기면 사이의 경고·결정이 잘리고, 어휘로 고르면 로케일마다 헛돈다).
    // §5.5 #17-39 ⑩ — 묶음이 빠져 이어 붙은 사고 자국은 주인별 한 줄로 합친다.
    return mergeAdjacentThinkTraces(compacted, readStepTrace, writeStepTrace);
  }
  return out;
}
