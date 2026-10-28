/**
 * §5.5 #17-39 단계 자국 — 사고·작성·도구가 얼마나 걸렸고 얼마나 나왔는지를 숫자로만 남긴다(원문은 저장 ❌, 길이만 센다 — #17-15).
 * 표시 문자열은 만들지 않는다 — 로케일 조립은 렌더가 한다.
 */
import type { SubAgentStreamEvent } from '@vibisual/shared';

// ─── 자국을 남길 문턱 (하드코딩 금지 — 값은 전부 여기) ───

/** 사고 자국을 남길 최소 분량(글자). 이보다 짧아도 아래 시간 문턱을 넘으면 남긴다. */
export const THINK_TRACE_MIN_CHARS = 80;
/** 사고 자국을 남길 최소 시간(ms). 순간 사고에 한 줄을 내주면 그 줄이 곧 소음이 된다. */
export const THINK_TRACE_MIN_MS = 1_000;
/** 본문 말풍선에 작성 자국을 붙일 최소 분량(글자). 짧은 대답 밑에 숫자를 달지 않는다. */
export const WRITE_TRACE_MIN_CHARS = 300;
/** 자국 안에 걸린 시간을 함께 적을 최소 시간(ms). 그 아래는 `1초 미만` 으로 뭉친다. */
export const TRACE_SHOW_MS = 1_000;

// ─── 시간 표기 ───

/**
 * 경과(ms)를 **로케일이 조립할 부품**으로 나눈다. 문자열을 여기서 만들지 않는 이유는 12개 로케일마다
 * 단위·어순이 달라서다 — 렌더가 `kind` 에 맞는 키를 골라 숫자만 끼운다.
 */
export type StepDuration =
  | { kind: 'under' }
  | { kind: 'sec'; sec: number }
  | { kind: 'minSec'; min: number; sec: number }
  | { kind: 'hourMin'; hour: number; min: number };

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/** 경과를 사람이 읽는 단위로 자른다. 음수·NaN 은 `under`(1초 미만)로 접는다. */
export function describeStepDuration(ms: number): StepDuration {
  if (!Number.isFinite(ms) || ms < TRACE_SHOW_MS) return { kind: 'under' };
  if (ms < MIN) return { kind: 'sec', sec: Math.floor(ms / SEC) };
  if (ms < HOUR) return { kind: 'minSec', min: Math.floor(ms / MIN), sec: Math.floor((ms % MIN) / SEC) };
  return { kind: 'hourMin', hour: Math.floor(ms / HOUR), min: Math.floor((ms % HOUR) / MIN) };
}

// ─── 사고 런 ───

/**
 * 연속된 `thinking` 이벤트 한 덩어리. **원문은 담지 않는다** — 길이(`chars`)만 센다.
 * 파서가 런을 봉인하는 순간 이 모양이 확정되고, 그 뒤로는 자라지 않는다.
 */
export interface ThinkRun {
  /** 런의 첫 이벤트 id — 자국 항목의 안정 id 를 여기서 만든다(가상 리스트 key). */
  firstId: string;
  startedAt: number;
  endedAt: number;
  chars: number;
  /**
   * §4 (스트림 3종 ①) — 이 런의 주인(중첩 Task 호출 id). 값이 바뀌면 런을 끊는다 —
   * 부모의 사고와 자식의 사고를 한 덩어리로 재면 **아무도 그만큼 생각하지 않은 시간**이 적힌다
   * (본문 말풍선이 주인이 바뀔 때 끊기는 것과 같은 규율).
   */
  nested?: string;
}

/**
 * 이 사고 런에 자국을 남길 만한가. **분량 또는 시간 중 하나만 넘어도 남긴다** —
 * 짧게 여러 번 끊어 생각하는 모델과 길게 한 번 생각하는 모델을 같은 잣대로 보면 한쪽이 통째로 사라진다.
 */
export function shouldTraceThinking(run: { chars: number; startedAt: number; endedAt: number }): boolean {
  if (run.chars >= THINK_TRACE_MIN_CHARS) return true;
  return run.endedAt - run.startedAt >= THINK_TRACE_MIN_MS;
}

/** 본문 말풍선 아래에 작성 자국을 붙일 만한가(분량 기준 — 시간은 자국 **안에서** 조건부로 적힌다). */
export function shouldTraceWriting(chars: number): boolean {
  return chars >= WRITE_TRACE_MIN_CHARS;
}

/**
 * 봉인된 사고 런을 전부 뽑는다(메인 탭용). ⚠ 버퍼 끝에 걸린 런은 **뽑지 않는다** — 자라는 자국은 매 틱 숫자가 바뀌며 깜빡인다(#17-24).
 * Sub 탭 증분 파서도 같은 규약이라 두 탭의 자국 개수가 같다.
 */
export function collectThinkRuns(
  events: readonly SubAgentStreamEvent[],
  isSkipped: (evt: SubAgentStreamEvent) => boolean,
): ThinkRun[] {
  const runs: ThinkRun[] = [];
  let open: ThinkRun | null = null;
  for (const evt of events) {
    if (isSkipped(evt)) continue;
    if (evt.eventType === 'thinking') {
      if (open && open.nested !== evt.nestedUnderToolUseId) {
        if (shouldTraceThinking(open)) runs.push(open);
        open = null;
      }
      if (open) {
        open.endedAt = evt.timestamp;
        open.chars += evt.content.length;
      } else {
        open = {
          firstId: evt.id, startedAt: evt.timestamp, endedAt: evt.timestamp, chars: evt.content.length,
          ...(evt.nestedUnderToolUseId ? { nested: evt.nestedUnderToolUseId } : {}),
        };
      }
      continue;
    }
    if (open) {
      if (shouldTraceThinking(open)) runs.push(open);
      open = null;
    }
  }
  return runs;
}

// ─── 간결: 이어 붙은 사고 자국 합치기 ───

/**
 * 합치기가 읽는 자국 한 장의 모양. Sub 탭(`StreamStep`)·메인 탭(`TerminalEntry`)이 각자 이 모양으로 읽어 넘긴다.
 * 자국이 아닌 항목은 `null` 로 읽혀 거기서 구간이 끊긴다.
 */
export interface ThinkTraceView {
  /** 이 자국 하나가 잰 사고 시간(ms) — `endedAt - timestamp`. */
  ms: number;
  /** 사고 분량(글자). */
  chars: number;
  /** 주인. 다르면 합치지 않는다 — 부모와 중첩 Task 의 사고를 한 덩어리로 재지 않는다(`ThinkRun.nested` 와 같은 규율). */
  owner: string | undefined;
}

/**
 * §5.5 #17-39 ⑩ — 간결에서 이어 붙은 사고 자국을 **주인별 한 줄**로 합친다. 시간은 자국마다 잰 시간의 **합**(폭이면 사이 도구 시간이 사고로 적힌다).
 * 주인이 다르면 섞지 않는다. 합친 줄은 그 주인의 첫 자국 id·자리를 쓴다(구간이 자라도 숫자만 오른다).
 * @param readTrace  자국이면 그 모양, 아니면 `null`(= 여기서 구간이 끊긴다).
 * @param writeTrace 합친 시간·분량으로 갈아 끼운 **새 항목**을 만든다(원본을 변형하지 말 것).
 * @returns 합칠 것이 없으면 입력 배열 그대로(참조 보존).
 */
export function mergeAdjacentThinkTraces<T>(
  items: T[],
  readTrace: (item: T) => ThinkTraceView | null,
  writeTrace: (first: T, ms: number, chars: number) => T,
): T[] {
  let out: T[] | null = null;
  let i = 0;
  while (i < items.length) {
    let view = readTrace(items[i]!);
    if (view === null) {
      out?.push(items[i]!);
      i++;
      continue;
    }
    // 구간 [i, j) — 자국이 끊김 없이 이어진 자리. 주인마다 첫 자리와 합을 모은다(Map 은 넣은 순서를 지킨다).
    const slots = new Map<string | undefined, { at: number; ms: number; chars: number; count: number }>();
    let j = i;
    while (view !== null) {
      const ms = Math.max(0, view.ms);
      const slot = slots.get(view.owner);
      if (slot) {
        slot.ms += ms;
        slot.chars += view.chars;
        slot.count++;
      } else {
        slots.set(view.owner, { at: j, ms, chars: view.chars, count: 1 });
      }
      j++;
      view = j < items.length ? readTrace(items[j]!) : null;
    }
    if (slots.size === j - i) {
      // 주인마다 한 장뿐이다 — 합칠 것이 없으므로 원래 항목 그대로.
      if (out) for (let k = i; k < j; k++) out.push(items[k]!);
    } else {
      if (!out) out = items.slice(0, i);
      for (const slot of slots.values()) {
        out.push(slot.count === 1 ? items[slot.at]! : writeTrace(items[slot.at]!, slot.ms, slot.chars));
      }
    }
    i = j;
  }
  return out ?? items;
}

// ─── 도구 묶음 경과 ───

/**
 * 도구 묶음이 걸린 시간 — 항목 시각의 폭. 도구 상자는 결과 도착 시각(`endedAt`)도 넣어 마지막 도구 실행 시간까지 든다(메인 탭과 같은 폭).
 * 결과 없는 도구는 호출 시각만(없는 시각을 지어내지 않는다). 진행 중 묶음은 재지 않는다.
 */
export function toolGroupElapsedMs(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  let min = timestamps[0]!;
  let max = timestamps[0]!;
  for (const ts of timestamps) {
    if (ts < min) min = ts;
    if (ts > max) max = ts;
  }
  return max - min;
}

/**
 * Sub 탭 묶음의 자식들 → 시각 폭을 잴 시각 목록. 도구 상자는 호출 시각과 **결과 도착 시각**을 둘 다 낸다
 * (결과가 따로 줄이 되는 메인 탭과 같은 폭을 재기 위함 — 두 탭이 같은 묶음에 다른 숫자를 적지 않게).
 */
export function toolSpanTimestamps(items: readonly { timestamp: number; endedAt?: number | undefined }[]): number[] {
  const out: number[] = [];
  for (const it of items) {
    out.push(it.timestamp);
    if (it.endedAt !== undefined) out.push(it.endedAt);
  }
  return out;
}

/**
 * §5.5 #17-39 ⑪ — 도구 호출 **하나**가 쓴 시간: 호출이 나간 시각부터 그 결과가 도착한 시각까지.
 * 결과가 없으면(진행 중·중지·거부) 잴 수 없다 → `null`(0 이 아니다 — 0 은 "곧바로 끝났다"는 잰 값이다).
 * 시각이 거꾸로 온 짝(순서 짝맞추기가 어긋난 자리)은 음수를 적지 않고 0 으로 접는다.
 */
export function toolCallElapsedMs(startedAt: number, endedAt: number | undefined): number | null {
  if (endedAt === undefined || !Number.isFinite(endedAt) || !Number.isFinite(startedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}
