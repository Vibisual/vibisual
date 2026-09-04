import { describe, it, expect } from 'vitest';
import { EFFORT_LEVEL_PROBE_CANDIDATES } from '@vibisual/shared';
import {
  EFFORT_PROBE_SENTINEL,
  isEffortValueRejected,
  isUsableProbeOutput,
  mergeProbedEffortLevels,
  planEffortProbeCandidates,
} from './effortLevelProbe.js';

/** 설치본 2.1.259 실측 — 무효값을 주면 경고를 찍고 **종료 코드 0 으로** 계속 간다. */
const REJECT_WARNING =
  "Warning: Unknown --effort value 'vibisual-probe-invalid-effort' — ignoring it and using the default effort. Valid values: low, medium, high, xhigh, max.\n2.1.259 (Claude Code)\n";
/** 같은 설치본 — 도움말에 없는 `ultracode` 는 경고 없이 그대로 지나간다. */
const ACCEPT_OUTPUT = '2.1.259 (Claude Code)\n';
/** commander 의 choices 거절형(`--autocompact` 가 쓰는 형태) — 즉시 종료한다. */
const COMMANDER_REJECT =
  "error: option '--effort <level>' argument 'ultracode' is invalid. Allowed choices are low, medium, high, xhigh, max.\n";

describe('isEffortValueRejected — 출력이 거절인지 가린다', () => {
  it('경고형 거절을 잡는다 (종료 코드로는 못 가리는 자리)', () => {
    expect(isEffortValueRejected(REJECT_WARNING, EFFORT_PROBE_SENTINEL)).toBe(true);
  });

  it('commander choices 거절을 잡는다', () => {
    expect(isEffortValueRejected(COMMANDER_REJECT, 'ultracode')).toBe(true);
  });

  it('경고 없는 출력은 거절이 아니다', () => {
    expect(isEffortValueRejected(ACCEPT_OUTPUT, 'ultracode')).toBe(false);
  });

  it('그 값을 인용하지 않은 경고는 남의 것이라 거절로 읽지 않는다', () => {
    expect(isEffortValueRejected(REJECT_WARNING, 'ultracode')).toBe(false);
  });

  it('대소문자가 달라도 같은 값으로 본다', () => {
    expect(isEffortValueRejected(COMMANDER_REJECT.toUpperCase(), 'UltraCode')).toBe(true);
  });

  it('빈 출력·빈 값은 판정하지 않는다', () => {
    expect(isEffortValueRejected('', 'ultracode')).toBe(false);
    expect(isEffortValueRejected(ACCEPT_OUTPUT, '')).toBe(false);
  });
});

describe('isUsableProbeOutput — 빈 출력은 수락이 아니다', () => {
  it('정상 출력만 판정에 쓴다', () => {
    expect(isUsableProbeOutput(ACCEPT_OUTPUT)).toBe(true);
  });

  it('spawn 실패·타임아웃의 빈 출력은 거절도 수락도 아니다', () => {
    expect(isUsableProbeOutput('')).toBe(false);
    expect(isUsableProbeOutput('   \n ')).toBe(false);
  });
});

describe('planEffortProbeCandidates — 찌를 것만 고른다', () => {
  it('도움말에 없는 후보만 남긴다', () => {
    expect(planEffortProbeCandidates(['low', 'medium', 'high', 'xhigh', 'max'], ['ultracode']))
      .toEqual(['ultracode']);
  });

  it('도움말이 이미 적은 값은 찌르지 않는다 (CLI 가 올리면 probe 는 저절로 0회)', () => {
    expect(planEffortProbeCandidates(['low', 'max', 'ultracode'], ['ultracode'])).toEqual([]);
  });

  it("'default' 는 후보가 될 수 없다 (오버라이드 없음을 뜻하는 우리 값)", () => {
    expect(planEffortProbeCandidates(['low'], ['default', 'Default'])).toEqual([]);
  });

  it('대소문자·공백은 도움말 파싱과 같은 규칙으로 접는다', () => {
    expect(planEffortProbeCandidates(['low', 'MAX'], ['  UltraCode  ', 'max'])).toEqual(['ultracode']);
  });

  it('같은 후보가 두 번 적혀도 한 번만 찌른다', () => {
    expect(planEffortProbeCandidates(['low'], ['ultracode', 'ultracode'])).toEqual(['ultracode']);
  });

  it('빈 후보 목록이면 자식 프로세스를 하나도 안 띄운다', () => {
    expect(planEffortProbeCandidates(['low', 'max'], [])).toEqual([]);
  });
});

describe('mergeProbedEffortLevels — 도움말 순서 뒤에 수락분을 붙인다', () => {
  it('도움말 순서를 그대로 두고 꼬리에 얹는다', () => {
    expect(mergeProbedEffortLevels(['low', 'medium', 'high', 'xhigh', 'max'], ['ultracode']))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
  });

  it('수락분이 없으면 도움말 목록과 바이트 단위로 같다', () => {
    const help = ['low', 'medium', 'high', 'xhigh', 'max'];
    expect(mergeProbedEffortLevels(help, [])).toEqual(help);
  });

  it("중복과 'default' 는 걸러진다 (목록 맨 앞은 listEffortLevels 가 붙인다)", () => {
    expect(mergeProbedEffortLevels(['default', 'low', 'low'], ['low', 'ultracode']))
      .toEqual(['low', 'ultracode']);
  });
});

describe('EFFORT_LEVEL_PROBE_CANDIDATES — 후보 목록 자체', () => {
  it('ultracode 를 후보로 든다 (도움말에 없지만 CLI 가 받는 등급)', () => {
    expect(EFFORT_LEVEL_PROBE_CANDIDATES).toContain('ultracode');
  });

  it('보정용 무효값은 어떤 후보와도 겹치지 않는다', () => {
    expect(EFFORT_LEVEL_PROBE_CANDIDATES).not.toContain(EFFORT_PROBE_SENTINEL);
  });
});
