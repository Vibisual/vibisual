import { describe, expect, it } from 'vitest';
import { decideEnterKey, enterCancelsDefault, type EnterKeyFacts } from './inputEnterKey.js';

const facts = (over: Partial<EnterKeyFacts> = {}): EnterKeyFacts => ({
  key: 'Enter', shiftKey: false, chordKey: false, imeConsumed: false, slashMatchCount: 0, ...over,
});

describe('줄을 만드는 손짓은 Shift+Enter 하나뿐이다', () => {
  it('Enter 는 보낸다', () => {
    expect(decideEnterKey(facts())).toEqual({ kind: 'submit' });
  });

  it('Shift+Enter 만 줄을 만든다 — 브라우저 기본 동작에 맡긴다', () => {
    const outcome = decideEnterKey(facts({ shiftKey: true }));
    expect(outcome).toEqual({ kind: 'newline' });
    expect(enterCancelsDefault(outcome)).toBe(false);
  });

  // 신고된 증상: 한글 마지막 글자를 확정하는 Enter 는 **진짜 Enter**(`isComposing` 이 이미 꺼진)로
  // 온다. 그걸 조합으로 세면 첫 Enter 가 늘 줄바꿈이 된다.
  it('한글 확정 직후의 첫 Enter 는 줄이 아니라 전송이다', () => {
    const outcome = decideEnterKey(facts({ imeConsumed: false }));
    expect(outcome).toEqual({ kind: 'submit' });
    expect(enterCancelsDefault(outcome)).toBe(true);
  });

  it.each([
    ['조합 중(isComposing)', { imeConsumed: true }],
    ['일본어·중국어 변환 확정(keyCode 229)', { imeConsumed: true, slashMatchCount: 3 }],
  ])('%s Enter 는 입력기 것이다 — 보내지 않고 줄만 막는다', (_name, over) => {
    const outcome = decideEnterKey(facts(over));
    expect(outcome).toEqual({ kind: 'imeCommit' });
    // 줄바꿈이 남으면 쓰지도 않은 빈 줄이 글에 붙는다 — 기본 동작은 반드시 막는다.
    expect(enterCancelsDefault(outcome)).toBe(true);
  });

  it('조합 중 Shift+Enter 는 그대로 줄 추가', () => {
    expect(decideEnterKey(facts({ shiftKey: true, imeConsumed: true }))).toEqual({ kind: 'newline' });
  });

  it('슬래시 목록에 고를 것이 있으면 Enter 는 고르기다', () => {
    expect(decideEnterKey(facts({ slashMatchCount: 2 }))).toEqual({ kind: 'slash' });
  });

  it('슬래시 목록이 비었으면(매칭 0) 평소대로 보낸다', () => {
    expect(decideEnterKey(facts({ slashMatchCount: 0 }))).toEqual({ kind: 'submit' });
  });

  it.each(['a', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Process'])('%s 는 이 판정의 것이 아니다', (key) => {
    const outcome = decideEnterKey(facts({ key, imeConsumed: true }));
    expect(outcome).toEqual({ kind: 'pass' });
    expect(enterCancelsDefault(outcome)).toBe(false);
  });

  it('보내기·고르기·입력기 확정은 전부 기본 동작을 막는다', () => {
    for (const over of [{}, { imeConsumed: true }, { slashMatchCount: 1 }]) {
      expect(enterCancelsDefault(decideEnterKey(facts(over)))).toBe(true);
    }
  });
});

describe('Ctrl/Cmd+Enter 로 보내는 칸은 반대로 맨 Enter 가 줄이다', () => {
  const chord = (over: Partial<EnterKeyFacts> = {}) => facts({ gesture: 'chord', ...over });

  it.each([
    ['Ctrl+Enter(win·linux)', { chordKey: true }],
    ['Cmd+Enter(mac)', { chordKey: true }],
  ])('%s 는 보낸다', (_name, over) => {
    expect(decideEnterKey(chord(over))).toEqual({ kind: 'submit' });
  });

  it('맨 Enter 는 줄 추가다 — 이 칸에서는 여러 줄을 먼저 쓴다', () => {
    const outcome = decideEnterKey(chord());
    expect(outcome).toEqual({ kind: 'newline' });
    expect(enterCancelsDefault(outcome)).toBe(false);
  });

  it('Shift+Ctrl+Enter 도 보낸다 — 보내는 손짓은 Ctrl/Cmd 가 정한다', () => {
    expect(decideEnterKey(chord({ chordKey: true, shiftKey: true }))).toEqual({ kind: 'submit' });
  });

  // Chromium 은 textarea 안의 Ctrl+Enter 를 InsertNewline 으로 옮긴다 — 막지 않으면 보내기를
  // 잃는 동시에 큐에 들어간 글에 \n 이 남는다.
  it('조합 중 Ctrl+Enter 는 보내지 않지만 줄도 남기지 않는다', () => {
    const outcome = decideEnterKey(chord({ chordKey: true, imeConsumed: true }));
    expect(outcome).toEqual({ kind: 'imeCommit' });
    expect(enterCancelsDefault(outcome)).toBe(true);
  });

  it('조합 중 맨 Enter 는 입력기의 확정 키다 — 그대로 둔다', () => {
    expect(decideEnterKey(chord({ imeConsumed: true }))).toEqual({ kind: 'newline' });
  });

  it('보내는 손짓을 적지 않으면 Enter 칸으로 본다', () => {
    expect(decideEnterKey(facts({ gesture: undefined }))).toEqual({ kind: 'submit' });
  });
});
