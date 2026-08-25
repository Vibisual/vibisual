/**
 * §5.19 (D) 로컬 턴이 화면에 실어 보내는 이벤트 — 같은 답을 두 번 그리지 않기.
 *
 * 회귀 방지 대상 — 2026-08-21 사용자 보고. 로컬 모델의 답이 **말풍선에 한 번, 초록 결과
 * 상자에 한 번** 해서 두 벌로 떴다. 원인은 로컬 경로만 `result` 이벤트를 전선에 흘린 것 —
 * 그 본문은 이미 `text` 델타로 흘러 말풍선에 쌓인 뒤라 두 번째 그림이 된다.
 *
 * 클로드 경로는 같은 이유로 이 줄을 버린다(`parseStreamLine`: "최종 결과 — UI에 다시 그리지
 * 않는다"). 조건은 둘 — **`result` 는 전선에 나가지 말 것**, 그리고 **나머지 여섯 종은 그대로
 * 나갈 것**(하나라도 함께 막히면 도구 카드·사고 접기·실패 사유가 통째로 사라진다).
 */
import { describe, it, expect } from 'vitest';
import type { StreamEventType } from '@vibisual/shared';
import { isRenderableLocalEvent } from './localRunner.js';

/** 실제로 받아 본 한 턴의 이벤트 순서(2026-08-21 실측 — Qwen2.5-3B-Instruct Q4_K_M). */
const ANSWER = '나는 AI 도우미입니다.';
const MEASURED_TURN: ReadonlyArray<{ type: StreamEventType; content: string }> = [
  { type: 'text', content: ANSWER },
  { type: 'result', content: ANSWER },
];

describe('isRenderableLocalEvent — 화면에 나갈 이벤트만', () => {
  it('result 는 전선에 나가지 않는다 — 두 번째 그림이 되는 자리', () => {
    expect(isRenderableLocalEvent('result')).toBe(false);
  });

  it('나머지 여섯 종은 그대로 나간다', () => {
    const rest: StreamEventType[] = ['text', 'thinking', 'tool_use', 'tool_result', 'system', 'error'];
    for (const type of rest) expect(isRenderableLocalEvent(type)).toBe(true);
  });
});

describe('실측 한 턴 — 답이 화면에 몇 번 그려지는가', () => {
  it('거르기 전에는 같은 답이 두 벌이다(사고 당시 모습)', () => {
    const bodies = MEASURED_TURN.filter((e) => e.content === ANSWER);
    expect(bodies).toHaveLength(2);
  });

  it('거른 뒤에는 정확히 한 벌만 남는다', () => {
    const onWire = MEASURED_TURN.filter((e) => isRenderableLocalEvent(e.type));
    expect(onWire.map((e) => e.type)).toEqual(['text']);
    expect(onWire.filter((e) => e.content === ANSWER)).toHaveLength(1);
  });

  it('걸러도 최종 본문 자체는 남는다 — cmd.result 가 쓰는 값', () => {
    // 호출자(`executeLocalProvider`)는 거르기와 무관하게 `result` 에서 finalText 를 챙긴다.
    const finalText = MEASURED_TURN.filter((e) => e.type === 'result').at(-1)?.content ?? '';
    expect(finalText).toBe(ANSWER);
  });
});
