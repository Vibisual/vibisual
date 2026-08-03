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
}

/** 렌더러가 실제로 그리는 아이템 = 파싱 아이템 + 묶음. */
export type StreamDisplayItem = StreamItemFull | StreamToolGroup;

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
 * 밀도에 맞춰 표시 아이템을 만든다.
 * - `raw`  : 아무것도 접지 않는다(원문 그대로).
 * - `standard`/`compact` : SDK 상태 칩 숨김 + 옛 계획 접기 + 연속 동종 도구 묶기.
 *
 * §5.5 #17-15 — 사고(thinking)는 밀도 축에서 빠졌다. 파싱 단계가 아이템 자체를 만들지 않으므로
 * 여기서 거를 것도 없다(진행 중 표시는 `thinking-live` 1줄이 전담).
 *
 * 반환 배열의 항목 참조는 변환이 필요 없는 한 입력 그대로다(불필요한 재렌더 방지).
 */
export function applyStreamDensity(items: StreamItemFull[], density: StreamDensity): StreamDisplayItem[] {
  if (density === 'raw') return items;

  // §5.5 #17-13 ⑤ — SDK 상태 칩(`[task_started]` 등)은 간결/표준에서 아예 그리지 않는다.
  //   내용 없는 레일 점이 한 줄씩 먹으며 화면을 갈랐다(사용자 스크린샷). 내용 있는 system 본문은 남긴다.
  const visible = items.filter((it) => !(it.kind === 'system' && isSystemSubtypeChip(it.content)));

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
      while (j < marked.length) {
        const next = marked[j]!;
        if (groupable(next)) { toolCount++; j++; lastToolEnd = j; continue; }
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
  return out;
}
