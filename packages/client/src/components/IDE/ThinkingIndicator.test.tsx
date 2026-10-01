/**
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄이 **실제로 그리는** 경과.
 *
 * 순수 함수(`liveLineClockFrom`)만 고정하면, 줄이 그 함수를 멈춘 틱 값으로 부르는 일(= 숫자가
 * 사라지던 것)은 잡히지 않는다. 그래서 컴포넌트를 가짜 시계로 직접 그려 본다.
 * 사용자 보고(2026-09-29) — "정상적인 시간은 표시 못하고 계속 같은 시간이 반복되거나 사라지거나 0만".
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_NO_RESPONSE_MS } from '@vibisual/shared';
import { ThinkingLiveLine } from './ThinkingIndicator.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { value?: string }) => (opts?.value === undefined ? key : `${key}(${opts.value})`),
  }),
}));

const T0 = 1_790_000_000_000;
type Props = Parameters<typeof ThinkingLiveLine>[0];
let renderer: ReactTestRenderer | undefined;

function draw(props: Props): void {
  act(() => {
    if (renderer) renderer.update(<ThinkingLiveLine {...props} />);
    else renderer = create(<ThinkingLiveLine {...props} />);
  });
}

/** 줄 끝의 경과 칸 — 없으면 `null`. */
function elapsedText(): string | null {
  const spans = renderer!.root.findAll((n) => n.type === 'span' && String(n.props.className ?? '').includes('tabular-nums'));
  return spans.length === 0 ? null : spans[0]!.children.join('');
}

function tick(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // `useNowTick` 은 window.setInterval 을 쓴다 — node 에는 window 가 없다.
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live line elapsed time', () => {
  it('counts up from the turn start and does not rewind when a new line arrives', () => {
    const turnStartedAt = T0 - 65_000;
    draw({ label: 'working', mode: 'working', lastActivityAt: T0 - 500, turnStartedAt });
    expect(elapsedText()).toBe('1m 5s');
    tick(1_000);
    expect(elapsedText()).toBe('1m 6s');
    // A line that just arrived. The old clock rewound to `0s` here.
    draw({ label: 'working', mode: 'working', lastActivityAt: Date.now(), turnStartedAt });
    expect(elapsedText()).toBe('1m 6s');
    tick(1_000);
    expect(elapsedText()).toBe('1m 7s');
  });

  it('keeps the number when something newer than the last tick arrives between two ticks', () => {
    draw({ label: 'working', mode: 'working', lastActivityAt: T0 - 500, turnStartedAt: T0 - 65_000 });
    // No tick yet, but the next command already went out, later than the `now` the tick stored.
    vi.setSystemTime(T0 + 400);
    draw({ label: 'working', mode: 'working', lastActivityAt: T0 + 400, turnStartedAt: T0 + 400 });
    expect(elapsedText()).toBe('0s');
    tick(1_000);
    expect(elapsedText()).toBe('1s');
  });

  it('switches to the last-update wording once the turn goes quiet past the threshold', () => {
    const lastLine = T0 - SESSION_NO_RESPONSE_MS - 5_000;
    draw({ label: 'working', mode: 'working', lastActivityAt: lastLine, turnStartedAt: T0 - 10 * 60_000 });
    expect(elapsedText()).toBe('ide.runningSubagents.noResponse(3m 5s)');
  });

  it('keeps counting the turn through a hidden turn, however quiet it is', () => {
    const lastLine = T0 - SESSION_NO_RESPONSE_MS - 5_000;
    draw({ label: 'working', mode: 'working', lastActivityAt: lastLine, turnStartedAt: lastLine, hiddenTurn: true });
    expect(elapsedText()).toBe('3m 5s');
  });

  it('counts a waiting line from when it joined the queue', () => {
    draw({ label: 'waiting', mode: 'waiting', lastActivityAt: T0 - 5 * 60_000, turnStartedAt: T0 - 5 * 60_000 });
    expect(elapsedText()).toBe('5m 0s');
  });

  it('shows no time rather than zero when the turn start is unknown', () => {
    draw({ label: 'working', mode: 'working', lastActivityAt: T0 - 1_000, turnStartedAt: null });
    expect(elapsedText()).toBeNull();
  });

  it('runs no timer when there is nothing to count', () => {
    draw({ label: 'working', mode: 'working', lastActivityAt: null, turnStartedAt: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
