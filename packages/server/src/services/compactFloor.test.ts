import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAutoCompactFloor,
  minAutoCompactWindowTokens,
  shouldCompactAfterTurn,
  turnCompactTriggerTokens,
  COMPACT_RESTART_ALLOWANCE_TOKENS,
  TURN_COMPACT_TRIGGER_RATIO,
  AUTOCOMPACT_OFF,
} from '@vibisual/shared';

/**
 * §4 (CLI 사양 추종) (5) 창 하한 — "생각 중"이 1시간 넘게 이어지던 일의 뿌리(2026-10-04).
 *
 * 200k 창에 시작 문맥이 약 71k 인 세션은 접고 나면 곧바로 약 99k 에서 다시 시작해, 몇 턴 만에 또 접었다
 * (2026-10-03 실측: 3시간 49분 동안 24회 · 한 번에 2.4~6분 · 시간의 47%). 창을 시작 문맥에 맞춰
 * 올려 잡는 것이 고친 자리이고, 이 파일이 그 산식과 "올리기만 한다"는 약속을 고정한다.
 *
 * 2026-10-05 부터 창은 스폰(`--autocompact`)에 실리지 않는다 — 작업 도중에는 CLI 가 모델 창 끝에서만
 * 접고, 이 하한은 **명령 사이 조용한 압축**의 발동선(그리고 그것을 미리 보여 주는 화면)에만 걸린다.
 */
const INCIDENT_FLOOR = 70_656; // 2026-10-03 세션의 첫 응답 문맥(실측)

describe('minAutoCompactWindowTokens — 시작 문맥에서 필요한 창', () => {
  it('사고 세션: 71k 로 시작하면 약 252k 창이 있어야 접은 뒤 한 번 더 채울 여유가 남는다', () => {
    const restart = INCIDENT_FLOOR + COMPACT_RESTART_ALLOWANCE_TOKENS;
    expect(minAutoCompactWindowTokens(INCIDENT_FLOOR)).toBe(Math.ceil((2 * restart) / TURN_COMPACT_TRIGGER_RATIO));
    expect(minAutoCompactWindowTokens(INCIDENT_FLOOR)).toBe(251_640);
  });

  it('근거가 없으면 null — 모르는 채로 올리지 않는다', () => {
    for (const v of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(minAutoCompactWindowTokens(v)).toBeNull();
    }
  });
});

describe('applyAutoCompactFloor — 창을 올려 잡는다', () => {
  it('사고 세션: 200k 는 400k 로 오른다(그 사이 눈금이 없다)', () => {
    expect(applyAutoCompactFloor('200000', INCIDENT_FLOOR)).toEqual({ value: '400000', raisedFrom: '200000' });
  });

  it('올린 창의 발동선은 재시작 수위의 두 배 이상이다 — 접은 뒤 적어도 그만큼은 일한다', () => {
    const effective = applyAutoCompactFloor('200000', INCIDENT_FLOOR).value;
    expect(turnCompactTriggerTokens(effective)!).toBeGreaterThanOrEqual(2 * (INCIDENT_FLOOR + COMPACT_RESTART_ALLOWANCE_TOKENS));
  });

  it('이미 충분하면 그대로 — raisedFrom 이 붙지 않는다', () => {
    expect(applyAutoCompactFloor('400000', INCIDENT_FLOOR)).toEqual({ value: '400000' });
    expect(applyAutoCompactFloor('1000000', INCIDENT_FLOOR)).toEqual({ value: '1000000' });
  });

  it('올리기만 한다 — 시작 문맥이 작아도 고른 창을 줄이지 않는다', () => {
    expect(applyAutoCompactFloor('500000', 5_000)).toEqual({ value: '500000' });
  });

  it('충분한 눈금 중 가장 작은 것을 고른다', () => {
    // 20k 시작 → 재시작 50k → 필요 125k → 100k 는 모자라고 200k 가 첫 눈금.
    expect(applyAutoCompactFloor('100000', 20_000)).toEqual({ value: '200000', raisedFrom: '100000' });
    // 10k 시작 → 필요가 정확히 100k → 그대로(경계는 포함).
    expect(applyAutoCompactFloor('100000', 10_000)).toEqual({ value: '100000' });
  });

  it('꺼짐·auto·미설정은 손대지 않는다 — 숫자 창만 올린다', () => {
    for (const v of [AUTOCOMPACT_OFF, 'auto', '']) {
      expect(applyAutoCompactFloor(v, INCIDENT_FLOOR)).toEqual({ value: v });
    }
  });

  it('근거가 없으면 고른 값 그대로', () => {
    expect(applyAutoCompactFloor('200000', undefined)).toEqual({ value: '200000' });
    expect(applyAutoCompactFloor('200000', null)).toEqual({ value: '200000' });
    expect(applyAutoCompactFloor('200000', 0)).toEqual({ value: '200000' });
  });

  it('모델 창을 넘겨 올리지 않는다 — 200k 모델이면 200k 가 끝이다', () => {
    expect(applyAutoCompactFloor('200000', INCIDENT_FLOOR, 200_000)).toEqual({ value: '200000' });
    expect(applyAutoCompactFloor('100000', INCIDENT_FLOOR, 200_000)).toEqual({ value: '200000', raisedFrom: '100000' });
  });

  it('필요한 창이 눈금을 넘으면 모델 창 안의 가장 큰 눈금까지 올린다', () => {
    // 500k 시작 → 필요 약 1.3M → 눈금 끝(1M).
    expect(applyAutoCompactFloor('200000', 500_000, 1_000_000)).toEqual({ value: '1000000', raisedFrom: '200000' });
    expect(applyAutoCompactFloor('200000', 500_000, 400_000)).toEqual({ value: '400000', raisedFrom: '200000' });
  });
});

describe('shouldCompactAfterTurn — 턴 경계 판정도 같은 하한을 본다', () => {
  it('200k 를 골라도 시작 문맥이 71k 면 발동선은 400k 기준(320k)이다', () => {
    const base = { requested: false, autoCompact: '200000', contextUsed: 170_000 } as const;
    // 하한이 없으면 200k 의 선(160k)을 넘었으니 접는다 — 종전 동작.
    expect(shouldCompactAfterTurn(base)).toBe(true);
    expect(shouldCompactAfterTurn({ ...base, startupFloor: INCIDENT_FLOOR })).toBe(false);
    expect(shouldCompactAfterTurn({ ...base, contextUsed: 320_000, startupFloor: INCIDENT_FLOOR })).toBe(true);
  });

  it('꺼짐은 하한이 있어도 꺼짐이다', () => {
    expect(shouldCompactAfterTurn({
      requested: false, autoCompact: AUTOCOMPACT_OFF, contextUsed: 900_000, startupFloor: INCIDENT_FLOOR,
    })).toBe(false);
  });
});

/**
 * 턴 경계 판정과 화면이 **같은 하한 출처**(세션의 첫 응답 문맥)를 본다. 화면이 다른 값을 보여 주면 사용자는
 * 400k 로 잡혔다고 읽는데 실제로는 200k 기준(160k)에서 접는 일이 생긴다.
 *
 * 2026-10-05 부터 스폰은 창을 싣지 않으므로 하한도 스폰에 닿지 않는다 — 스폰 쪽 배선이 되살아나면 작업 도중
 * 접힘이 함께 되살아난 것이라 첫 검사가 막는다(실제 인자 검사는 `agentCliArgs.test.ts`).
 */
describe('턴 경계 판정과 화면이 같은 하한 출처를 본다 — 스폰에는 닿지 않는다', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('스폰 인자 조립에는 창 해소·하한이 없다', () => {
    const s = read('./subAgentManager.ts');
    expect(s).not.toContain('applyAutoCompactFloor(');
    expect(s).not.toContain('resolveEffectiveAutoCompact(');
    expect(s).not.toContain("'--autocompact'");
    expect(s).not.toContain('compactFloorContext(');
  });

  it('턴 경계 판정이 같은 출처(첫 응답 문맥)를 넘긴다', () => {
    const s = read('../index.ts');
    expect(s).toContain('startupFloor: ctx.floor');
    expect(s).toContain('info.firstContextUsed');
  });

  it('화면도 같은 값을 받는다 — 스냅샷이 시작 문맥을 싣는다', () => {
    expect(read('./projectGraph.ts')).toContain('contextFloor: info.firstContextUsed');
  });
});
