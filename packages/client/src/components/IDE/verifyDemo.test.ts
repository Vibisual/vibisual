import { describe, it, expect } from 'vitest';
import { VERIFICATION_DEMO_STEP_TEXT_MAX, VERIFICATION_DEMO_LABEL_MAX } from '@vibisual/shared';

import {
  defaultDemoLabel,
  demoHasContent,
  demoSummaryParts,
  formatDemoTime,
  insertDemoStep,
  removeDemoStep,
} from './verifyDemo.js';

// §5.5 #17-35 ⑨ — 시연 순수 계산.
//
// 여기서 지키는 것은 하나다: **창에서 본 순서와 실제로 저장·전송되는 순서가 같다.**
// 프롬프트는 "1. 2. 3." 으로 나가는데 그 번호가 시각과 어긋나면 재현 자체가 뒤집힌다.

describe('formatDemoTime', () => {
  it('밀리초를 분:초로 — 초는 두 자리로 채운다', () => {
    expect(formatDemoTime(0)).toBe('0:00');
    expect(formatDemoTime(3_400)).toBe('0:03');
    expect(formatDemoTime(59_500)).toBe('1:00');
    expect(formatDemoTime(125_000)).toBe('2:05');
  });

  it('음수는 0 으로 접는다(되돌려 보다 구간 앞으로 나가도 표시가 깨지지 않게)', () => {
    expect(formatDemoTime(-1)).toBe('0:00');
  });
});

describe('insertDemoStep', () => {
  it('입력 순서가 아니라 **시각 순서**로 꽂는다', () => {
    let steps = insertDemoStep([], { atMs: 5_000, text: '저장을 누른다' });
    steps = insertDemoStep(steps, { atMs: 1_000, text: '로그인한다' });
    steps = insertDemoStep(steps, { atMs: 3_000, text: '항목을 고른다' });
    expect(steps.map((s) => s.text)).toEqual(['로그인한다', '항목을 고른다', '저장을 누른다']);
  });

  it('같은 시각이면 나중에 적은 것이 뒤로(안정 정렬)', () => {
    let steps = insertDemoStep([], { atMs: 2_000, text: '첫째' });
    steps = insertDemoStep(steps, { atMs: 2_000, text: '둘째' });
    expect(steps.map((s) => s.text)).toEqual(['첫째', '둘째']);
  });

  it('빈 문장은 넣지 않는다(공백만 친 경우 포함)', () => {
    expect(insertDemoStep([], { atMs: 0, text: '   ' })).toHaveLength(0);
  });

  it('상한을 넘기면 넣지 않는다 — 조용히 밀어내지 않는다', () => {
    const full = Array.from({ length: 3 }, (_, i) => ({ atMs: i * 1000, text: `s${i}` }));
    const next = insertDemoStep(full, { atMs: 9_000, text: '넘침' }, 3);
    expect(next).toHaveLength(3);
    expect(next.map((s) => s.text)).not.toContain('넘침');
  });

  it('긴 문장은 상한에서 자른다', () => {
    const long = 'ㄱ'.repeat(VERIFICATION_DEMO_STEP_TEXT_MAX + 50);
    const [step] = insertDemoStep([], { atMs: 0, text: long });
    expect(step?.text).toHaveLength(VERIFICATION_DEMO_STEP_TEXT_MAX);
  });

  it('음수·NaN 시각은 0 으로 — 정렬이 뒤집히지 않게', () => {
    const [a] = insertDemoStep([], { atMs: -5, text: 'a' });
    expect(a?.atMs).toBe(0);
    const [b] = insertDemoStep([], { atMs: Number.NaN, text: 'b' });
    expect(b?.atMs).toBe(0);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const orig = [{ atMs: 0, text: 'a' }];
    insertDemoStep(orig, { atMs: 1, text: 'b' });
    expect(orig).toHaveLength(1);
  });
});

describe('removeDemoStep', () => {
  it('그 자리 하나만 뺀다', () => {
    const steps = [
      { atMs: 0, text: 'a' },
      { atMs: 1, text: 'b' },
      { atMs: 2, text: 'c' },
    ];
    expect(removeDemoStep(steps, 1).map((s) => s.text)).toEqual(['a', 'c']);
  });

  it('범위 밖이면 그대로 — 조용히 마지막을 지우지 않는다', () => {
    const steps = [{ atMs: 0, text: 'a' }];
    expect(removeDemoStep(steps, 5)).toHaveLength(1);
    expect(removeDemoStep(steps, -1)).toHaveLength(1);
  });
});

describe('defaultDemoLabel', () => {
  it('소스 이름이 들어가 목록에서 구별된다', () => {
    const label = defaultDemoLabel('MyApp — main window', Date.UTC(2026, 7, 28, 3, 4), 'en-US');
    expect(label).toContain('MyApp');
  });

  it('소스 이름이 없어도 빈 문자열을 돌려주지 않는다', () => {
    expect(defaultDemoLabel('', Date.now(), 'en-US').length).toBeGreaterThan(0);
  });

  it('상한을 넘기지 않는다', () => {
    const label = defaultDemoLabel('X'.repeat(300), Date.now(), 'en-US');
    expect(label.length).toBeLessThanOrEqual(VERIFICATION_DEMO_LABEL_MAX);
  });
});

describe('demoHasContent', () => {
  it('셋 다 비면 실을 것이 없다', () => {
    expect(demoHasContent({ steps: [], frames: [] })).toBe(false);
    expect(demoHasContent({ steps: [], frames: [], expected: '   ' })).toBe(false);
  });

  it('단계·기대 결과·그림 중 하나만 있어도 실을 것이 있다', () => {
    expect(demoHasContent({ steps: [{ atMs: 0, text: 'a' }], frames: [] })).toBe(true);
    expect(demoHasContent({ steps: [], frames: [], expected: '초록 알림' })).toBe(true);
    expect(demoHasContent({ steps: [], frames: [{ rel: 'd/0.png', atMs: 0 }] })).toBe(true);
  });
});

describe('demoSummaryParts', () => {
  it('단계·그림 수를 그대로 센다', () => {
    expect(demoSummaryParts({ steps: [{ atMs: 0, text: 'a' }], frames: [] })).toEqual({ steps: 1, frames: 0 });
  });
});
