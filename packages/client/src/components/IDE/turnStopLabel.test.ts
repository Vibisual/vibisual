import { describe, expect, it } from 'vitest';
import { TURN_STOP_REASONS } from '@vibisual/shared';
import { turnStopLabelKey } from './turnStopLabel.js';
import en from '../../i18n/locales/en.json';

// §5.5 #17-12 ③-6 — 턴 끝 이유 낱말. 상태바와 말풍선이 같은 키를 읽는다.

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (
    node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  ), en);
}

describe('turnStopLabelKey', () => {
  it('평범한 끝과 값 없는 옛 명령은 말하지 않는다(종전 화면 그대로)', () => {
    expect(turnStopLabelKey('end_turn', 'completed')).toBeNull();
    expect(turnStopLabelKey(undefined, 'completed')).toBeNull();
  });

  it('실패한 턴은 이유 줄을 덧대지 않는다 — 오류 사유가 이미 말한다', () => {
    expect(turnStopLabelKey('max_turns', 'error')).toBeNull();
    expect(turnStopLabelKey('cancelled', 'error')).toBeNull();
  });

  it('끝나지 않은 턴에는 끝 이유가 없다', () => {
    expect(turnStopLabelKey('cancelled', 'executing')).toBeNull();
    expect(turnStopLabelKey('usage_limit', 'queued')).toBeNull();
  });

  it('평범한 끝을 뺀 다섯 이유가 서로 다른 키를 갖고, en 에 문구가 있다', () => {
    const notable = TURN_STOP_REASONS.filter((r) => r !== 'end_turn');
    const keys = notable.map((r) => turnStopLabelKey(r, 'completed'));
    expect(keys.every((k) => typeof k === 'string')).toBe(true);
    expect(new Set(keys).size).toBe(notable.length);
    for (const key of keys) expect(typeof lookup(key as string)).toBe('string');
  });
});
