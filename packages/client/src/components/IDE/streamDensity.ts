/**
 * streamDensity.ts — §5.5 #17-12 표시 밀도 변환(순수 로직).
 *
 * 배경: 스트림이 thinking·도구·본문을 전부 같은 급 상자로 쌓아 "읽을 게 너무 많다"는 문제.
 * 2026 추세(점진적 공개 — 기본은 한 줄 요약, 펼치면 상세)에 맞춰 **표시 직전에** 아이템 배열을 접는다.
 *
 * 표시 계층 전용 — 파싱(streamItems)·스크롤·카드 합류는 건드리지 않는다. 순수 함수라 단위 테스트로 검증한다
 * (streamDensity.test.ts). 밀도는 클라 전용 UI 상태(`graphStore.ideStreamDensity`).
 */
import type { StreamDensity } from '@vibisual/shared';
import { sameStreamItem, isSystemSubtypeChip, type StreamGroup, type StreamItemFull, type StreamPlan } from './streamItems.js';
import { foldTaskChips } from './taskChips.js';

/**
 * 도구 실행 묶음 — 기본은 "명령 실행됨 ×N" 한 줄 + 최근 도구 한 줄, 펼치면 원래 항목들이 그대로 나온다.
 *
 * §5.5 #17-13 — 종전엔 **같은 도구 이름**끼리만 묶어서, 이름이 바뀌거나(`Bash`→`Read`) 사이에 빈 줄·
 * system 칩이 끼면 런이 끊겨 상자가 사다리처럼 쌓였다. 이제 이름을 가리지 않고 묶고, 사이 잡음은
 * 런 안으로 흡수한다(버리지 않는다 — 펼치면 그대로 보인다).
 *
 * §5.5 #17-16 — 묶음은 **첫 도구부터** 만들어지고(문턱 없음), **진행 중 도구도 이 안에** 들어간다.
 * 종전엔 홑 도구·활성 도구가 묶음 밖 독립 상자로 떴다가 조건이 맞는 순간 묶음으로 빨려 들어가
 * 리스트 높이가 매번 출렁였다(사용자: "사라졌다 나온다 / 스크롤이 들쭉날쭉"). 지금 뭘 하는지는
 * 렌더러가 접힌 상태에서도 그리는 **최근 도구 한 줄**이 담당한다.
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

/** 잘린 본문 — 보여줄 앞부분과 숨은 줄 수(버튼 라벨용). */
export interface ClampedText {
  text: string;
  hiddenLines: number;
}

/**
 * §5.5 #17-21 ② — 간결에서 AI 본문을 앞부분만 남긴다. 자를 필요가 없으면 `null`(그대로 그린다).
 *
 * 줄 수와 글자 수를 **둘 다** 본다: 마크다운 문단은 줄바꿈 없이 한 줄로 길게 오는 일이 잦아
 * 줄 수만 보면 클램프가 헛돌고, 글자 수만 보면 짧은 줄이 많은 목록이 안 잘린다.
 * 자르는 위치는 줄 경계 → 공백 경계 순으로 물러서 마크다운 문법을 최대한 덜 깬다
 * (닫히지 않은 코드펜스는 react-markdown 이 끝까지 코드로 관대하게 처리한다).
 */
export function clampStreamText(content: string, maxLines: number, maxChars: number): ClampedText | null {
  const lines = content.split('\n');
  let head = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : content;
  if (head.length > maxChars) {
    const space = head.lastIndexOf(' ', maxChars);
    // 공백이 너무 앞이면(한국어처럼 띄어쓰기가 드문 문장) 그냥 글자 수에서 자른다.
    head = head.slice(0, space > maxChars * 0.6 ? space : maxChars);
  }
  if (head.length >= content.length) return null;
  const rest = content.slice(head.length);
  const hiddenLines = Math.max(1, rest.split('\n').filter((l) => l.trim() !== '').length);
  return { text: head, hiddenLines };
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

/**
 * 묶을 수 있는 도구인가 — §5.5 #17-16 로 **진행 중인 도구도 묶는다**(옛 규칙: 활성 도구 제외).
 * "지금 뭘 하는지 가려지면 안 된다"는 원칙은 렌더러가 접힌 묶음에도 그리는 **최근 도구 한 줄**이 지킨다.
 * 활성 도구를 밖에 두면 그 도구가 끝나는 순간 독립 상자가 묶음으로 흡수되며 화면이 출렁였다.
 */
function groupable(item: StreamDisplayItem): item is StreamGroup {
  return item.kind === 'tool';
}

/**
 * 런을 끊지 않고 흡수할 "잡음" 항목인가 — system 칩(`[task_started]` 등)과 **빈 텍스트**.
 * 실제 대화(내용 있는 text·result·계획·카드)는 잡음이 아니므로 여기서 런이 끊긴다.
 */
function runFiller(item: StreamDisplayItem): boolean {
  if (item.kind === 'system') return true;
  return item.kind === 'text' && item.content.trim() === '';
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
 * §5.5 #17-26 ① — 간결에서 **턴마다 AI 본문의 처음 것과 마지막 것만** 남기고 사이를 뺀다.
 *
 * 턴 경계는 사용자 명령(`command`). 첫 본문 = "그 턴에 무엇을 하려는가"(의도 선언), 마지막 본문 =
 * "무엇으로 끝났는가"(결론·질문)이고, 사이의 본문은 도구를 감싼 진행 나레이션이라 도구를 숨긴 화면에서는
 * 맥락 없는 토막이 된다. 빈 본문은 후보로 세지 않는다(있어도 그냥 뺀다). 본문이 둘 이하인 턴은 그대로.
 */
function keepFirstAndLastText(items: StreamDisplayItem[]): StreamDisplayItem[] {
  // 남길 본문 id 집합을 먼저 고른다(턴 단위로 처음·마지막 하나씩).
  const keep = new Set<string>();
  let firstOfTurn: string | null = null;
  let lastOfTurn: string | null = null;
  const closeTurn = (): void => {
    if (firstOfTurn) keep.add(firstOfTurn);
    if (lastOfTurn) keep.add(lastOfTurn);
    firstOfTurn = null;
    lastOfTurn = null;
  };
  for (const it of items) {
    if (it.kind === 'command') { closeTurn(); continue; }
    if (it.kind !== 'text' || it.content.trim() === '') continue;
    if (!firstOfTurn) firstOfTurn = it.id;
    else lastOfTurn = it.id;
  }
  closeTurn();
  return items.filter((it) => it.kind !== 'text' || keep.has(it.id));
}

/**
 * 밀도에 맞춰 표시 아이템을 만든다.
 * - `raw`  : 아무것도 접지 않는다(원문 그대로).
 * - `standard` : SDK 상태 칩 숨김 + 옛 계획 접기 + 연속 동종 도구 묶기.
 * - `compact`  : 위 전부 + **도구 묶음을 배열에서 아예 뺀다**(§5.5 #17-21 ① / #17-24 ①)
 *                + **턴마다 AI 본문은 처음·마지막 하나씩만 남긴다**(§5.5 #17-26 ①).
 *
 * §5.5 #17-15 — 사고(thinking)는 밀도 축에서 빠졌다. 파싱 단계가 아이템 자체를 만들지 않으므로
 * 여기서 거를 것도 없다(진행 중 표시는 `thinking-live` 1줄이 전담).
 *
 * 반환 배열의 항목 참조는 변환이 필요 없는 한 입력 그대로다(불필요한 재렌더 방지).
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
  const visible = folded.filter((it) => !(it.kind === 'system' && isSystemSubtypeChip(it.content)));

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

  // §5.5 #17-21 ① / #17-24 ① — 간결은 **도구 묶음을 진행 중이든 완료든 화면에서 뺀다**
  //   (무엇을 했는지 볼 사람은 `표준` 으로 올린다). 높이 0 자리표시자로 남기지 않고 **배열에서 제거**해야
  //   가상 리스트 측정이 흐려지지 않는다.
  //   단, 런에 흡수됐던 **내용 있는 system 본문**(오류·권한 결정 메시지)은 묶음 밖으로 꺼내 남긴다 —
  //   그건 사용자가 읽어야 하는 내용이라 묶음과 함께 사라지면 안 된다.
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
    return keepFirstAndLastText(compacted);
  }
  return out;
}
