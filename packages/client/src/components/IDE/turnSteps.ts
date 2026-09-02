/**
 * turnSteps.ts — §5.5 #17-39 단계 자국(사고·작성·도구가 **얼마나 걸렸고 얼마나 나왔는지**).
 *
 * §5.5 #17-15 가 없앤 것은 **사고 원문을 보여 주는 표면**이지 "얼마나 생각했는가"라는 사실이 아니다.
 * 그 자국마저 사라져 화면에는 도는 동안의 라이브 1줄만 남았고, 끝난 턴을 돌아보면 **에이전트가 2분을
 * 썼는지 20초를 썼는지, 그중 무엇에 썼는지 알 방법이 없었다.** 이 모듈은 그 사실만 숫자로 남긴다 —
 * 원문은 여전히 어디에도 저장하지 않고 쌓지 않는다(길이만 센다).
 *
 * 순수 함수라 Vitest 로 단독 검증한다(`turnSteps.test.ts`). 표시 문자열은 만들지 않는다 —
 * 로케일 조립은 렌더가 하고, 여기서는 **무엇을 어떤 단위로 보여줄지**까지만 정한다.
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
 * 이벤트 버퍼에서 **봉인된** 사고 런을 전부 뽑는다(메인 탭용 — 그쪽은 매 렌더 전량 스캔이 이미 기본이다).
 *
 * ⚠ 버퍼 끝에 걸린 런은 **뽑지 않는다.** 아직 끝났다는 증거가 없어서다 — 자라는 자국을 그리면 매 틱
 * 숫자가 바뀌며 깜빡이고, 그건 #17-24 가 없앤 바로 그 화면이다(지금 생각 중은 라이브 1줄이 맡는다).
 * Sub 탭 증분 파서도 같은 규약이라 두 탭의 자국 개수가 어긋나지 않는다.
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

// ─── 도구 묶음 경과 ───

/**
 * 도구 묶음 하나가 걸린 시간 — 첫 호출이 나간 시각부터 마지막 항목까지.
 *
 * 도구는 짝(`tool_use`↔`tool_result`)이 붙어야 끝이 정해지는데 우리 항목에는 결과 시각이 없다.
 * 그래서 **묶음 안 항목들의 시각 폭**으로 잰다 — 마지막 도구의 실행 시간만큼 짧게 잡히지만,
 * 없는 시각을 지어내는 것보다 낫다(진행 중 묶음은 애초에 재지 않는다).
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
