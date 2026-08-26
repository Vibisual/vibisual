/**
 * §5.10 v2 (D)(G) — 넛지 빈도 · 운영자 관찰 회귀.
 *
 * 넛지는 값이 싼 대신 **매 턴 붙으면 그게 곧 잡음**이라, 이 축의 회귀는 "얹히는가"가 아니라
 * **"안 얹혀야 할 때 안 얹히는가"** 다. 운영자 관찰은 사람에 대한 기록이라
 * 축이 꺼져 있을 때 한 줄도 새지 않는 것이 계약이다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BRAIN_NUDGE_MAX_PER_SESSION, BRAIN_NUDGE_MIN_INTERVAL_MS } from '@vibisual/shared';

const ROOT = 'C:/proj/demo';

function mockAxes(axes: Record<string, boolean>): void {
  vi.doMock('./userDefaultsService.js', () => ({
    userDefaultsService: {
      get: () => ({ brainByProject: { [ROOT]: { enabled: true, axes } } }),
    },
  }));
}

beforeEach(() => {
  vi.resetModules();
});

describe('넛지 빈도 — 안 얹혀야 할 때 안 얹힌다', () => {
  it('축이 꺼져 있으면 절대 얹지 않는다', async () => {
    mockAxes({ nudge: false });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    expect(claimNudgeSlot(ROOT, 'sess-1')).toBe(false);
  });

  it('마스터가 꺼져 있으면 축이 켜져 있어도 안 얹는다', async () => {
    vi.doMock('./userDefaultsService.js', () => ({
      userDefaultsService: { get: () => ({ brainByProject: { [ROOT]: { enabled: false, axes: { nudge: true } } } }) },
    }));
    const { claimNudgeSlot } = await import('./brainNudge.js');
    expect(claimNudgeSlot(ROOT, 'sess-1')).toBe(false);
  });

  it('첫 턴에는 얹는다', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    expect(claimNudgeSlot(ROOT, 'sess-1')).toBe(true);
  });

  it('간격 안에 다시 물으면 거절한다 (매 턴 붙는 것을 막는 자리)', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    const t0 = 1_000_000;
    expect(claimNudgeSlot(ROOT, 'sess-1', t0)).toBe(true);
    expect(claimNudgeSlot(ROOT, 'sess-1', t0 + 1000)).toBe(false);
    expect(claimNudgeSlot(ROOT, 'sess-1', t0 + BRAIN_NUDGE_MIN_INTERVAL_MS - 1)).toBe(false);
  });

  it('간격을 넘기면 다시 얹는다', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    const t0 = 1_000_000;
    expect(claimNudgeSlot(ROOT, 'sess-1', t0)).toBe(true);
    expect(claimNudgeSlot(ROOT, 'sess-1', t0 + BRAIN_NUDGE_MIN_INTERVAL_MS)).toBe(true);
  });

  it('세션당 총량 상한을 넘지 않는다', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    let t = 1_000_000;
    let granted = 0;
    for (let i = 0; i < BRAIN_NUDGE_MAX_PER_SESSION + 3; i++) {
      if (claimNudgeSlot(ROOT, 'sess-1', t)) granted++;
      t += BRAIN_NUDGE_MIN_INTERVAL_MS;
    }
    expect(granted).toBe(BRAIN_NUDGE_MAX_PER_SESSION);
  });

  it('세션이 다르면 각자 센다', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    expect(claimNudgeSlot(ROOT, 'sess-1')).toBe(true);
    expect(claimNudgeSlot(ROOT, 'sess-2')).toBe(true);
  });

  it('세션 키가 비면 얹지 않는다', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot } = await import('./brainNudge.js');
    expect(claimNudgeSlot(ROOT, '')).toBe(false);
  });

  it('세션을 잊으면 카운터도 사라진다 (키 개수가 무한히 늘지 않는다)', async () => {
    mockAxes({ nudge: true });
    const { claimNudgeSlot, forgetNudgeSession } = await import('./brainNudge.js');
    const t0 = 1_000_000;
    expect(claimNudgeSlot(ROOT, 'sess-1', t0)).toBe(true);
    expect(claimNudgeSlot(ROOT, 'sess-1', t0 + 10)).toBe(false);
    forgetNudgeSession('sess-1');
    expect(claimNudgeSlot(ROOT, 'sess-1', t0 + 20)).toBe(true);
  });
});

describe('넛지 문구', () => {
  it('없는 교훈을 지어내지 말라고 명시한다', async () => {
    const { buildBrainNudgeSection } = await import('@vibisual/shared');
    const s = buildBrainNudgeSection();
    expect(s).toContain('learned');
    expect(s).toContain('아무것도 남기지 마라');
  });
});

describe('운영자 관찰 파싱 (§5.10 v2 (G))', () => {
  it('type:operator 항목을 꺼낸다', async () => {
    const { parseOperatorNote } = await import('./brainReflectionService.js');
    const out = JSON.stringify([
      { type: 'lesson', title: '교훈', body: '본문' },
      { type: 'operator', title: '결론을 먼저 원한다', body: '긴 목록을 세 번 되돌려 받았다' },
    ]);
    expect(parseOperatorNote(out)?.title).toBe('결론을 먼저 원한다');
  });

  it('제목이 없으면 관찰이 아니다', async () => {
    const { parseOperatorNote } = await import('./brainReflectionService.js');
    expect(parseOperatorNote(JSON.stringify([{ type: 'operator', body: '본문만' }]))).toBeNull();
  });

  it('운영자 관찰이 lesson 카드로 둔갑하지 않는다', async () => {
    const { parseCandidates } = await import('./brainReflectionService.js');
    const out = JSON.stringify([
      { type: 'operator', title: '관찰', body: '근거' },
      { type: 'lesson', title: '진짜 교훈', body: '본문' },
    ]);
    const cards = parseCandidates(out);
    expect(cards.length).toBe(1);
    expect(cards[0]?.title).toBe('진짜 교훈');
  });

  it('축이 꺼져 있으면 프롬프트에 관찰 지시문이 실리지 않는다', async () => {
    const { buildBrainReflectionPrompt } = await import('@vibisual/shared');
    const p = buildBrainReflectionPrompt({ knownTitles: [], topicSlugs: [] });
    expect(p).not.toContain('이 사용자에 대한 관찰');
  });

  it('축이 켜지면 관찰 지시문이 실리고 한 번짜리 일은 배제한다', async () => {
    const { buildBrainReflectionPrompt } = await import('@vibisual/shared');
    const p = buildBrainReflectionPrompt({ knownTitles: [], topicSlugs: [], wantOperator: true });
    expect(p).toContain('이 사용자에 대한 관찰');
    expect(p).toContain('한 번 있었던 일은 관찰이 아니다');
  });
});
