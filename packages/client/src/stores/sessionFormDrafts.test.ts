import { describe, it, expect, beforeEach } from 'vitest';
import {
  SESSION_FORM_DRAFT_TEXT_MAX,
  type SessionFormDraft,
  mergeFormDraft,
  parseStoredDrafts,
  pruneDrafts,
  sanitizeDraftValues,
  sessionFormDraftKey,
  useSessionFormDraftStore,
} from './sessionFormDrafts.js';

// §5.5 #17-11 ⑬ — 세션 스코프 폼 초안.
// 지키는 약속: ① 손댄 칸만 저장 ② 손대지 않은 칸은 서버 값을 계속 따라간다
// ③ 스코프(세션 탭)마다 독립 ④ 낡거나 깨진 초안이 화면을 깨지 않는다.

describe('sessionFormDraftKey', () => {
  it('폼과 스코프를 합쳐 초안 키를 만든다', () => {
    expect(sessionFormDraftKey('ide.loop', 'agent-1|sub-2')).toBe('ide.loop::agent-1|sub-2');
  });
});

describe('sanitizeDraftValues', () => {
  it('원시 타입만 남기고 객체·배열·null·undefined 는 버린다', () => {
    expect(sanitizeDraftValues({
      text: 'hello', count: 3, flag: true,
      nested: { a: 1 }, list: [1], nothing: null, missing: undefined,
    })).toEqual({ text: 'hello', count: 3, flag: true });
  });

  it('NaN·Infinity 는 숫자로 치지 않는다', () => {
    expect(sanitizeDraftValues({ a: NaN, b: Infinity, c: 0 })).toEqual({ c: 0 });
  });

  it('빈 문자열·false·0 은 사용자가 지운 값이므로 그대로 남긴다', () => {
    expect(sanitizeDraftValues({ text: '', flag: false, count: 0 })).toEqual({ text: '', flag: false, count: 0 });
  });

  it('상한을 넘는 문자열은 잘라서 담는다', () => {
    const long = 'x'.repeat(SESSION_FORM_DRAFT_TEXT_MAX + 500);
    const out = sanitizeDraftValues({ text: long });
    expect(out['text']).toHaveLength(SESSION_FORM_DRAFT_TEXT_MAX);
  });

  it('객체가 아니면 빈 초안이다', () => {
    expect(sanitizeDraftValues(null)).toEqual({});
    expect(sanitizeDraftValues('text')).toEqual({});
  });
});

describe('mergeFormDraft', () => {
  const base = { command: '서버에 저장된 명령', total: 5, stopOnError: true };

  it('초안이 없으면 바탕값 참조를 그대로 돌려준다(불필요한 리렌더 ❌)', () => {
    expect(mergeFormDraft(base, undefined)).toBe(base);
  });

  it('건드린 칸만 덮고 나머지는 바탕값을 따라간다', () => {
    expect(mergeFormDraft(base, { command: '내가 친 명령' }))
      .toEqual({ command: '내가 친 명령', total: 5, stopOnError: true });
  });

  it('바탕값과 같은 값만 든 초안은 새 객체를 만들지 않는다', () => {
    expect(mergeFormDraft(base, { total: 5 })).toBe(base);
  });

  it('폼이 개편돼 사라진 칸은 무시한다', () => {
    expect(mergeFormDraft(base, { gone: 'x' })).toBe(base);
  });

  it('타입이 어긋난 칸은 바탕값을 지킨다', () => {
    expect(mergeFormDraft(base, { total: '다섯' })).toBe(base);
  });

  it('빈 문자열·false 로 지운 것도 초안으로 인정한다', () => {
    expect(mergeFormDraft(base, { command: '', stopOnError: false }))
      .toEqual({ command: '', total: 5, stopOnError: false });
  });
});

describe('pruneDrafts', () => {
  const draft = (at: number): SessionFormDraft => ({ values: { a: 'x' }, at });

  it('상한 이하면 그대로 돌려준다', () => {
    const drafts = { a: draft(1), b: draft(2) };
    expect(pruneDrafts(drafts, 5)).toBe(drafts);
  });

  it('상한을 넘으면 최근 것부터 남기고 오래된 초안을 버린다', () => {
    const kept = pruneDrafts({ old: draft(1), mid: draft(2), fresh: draft(3) }, 2);
    expect(Object.keys(kept).sort()).toEqual(['fresh', 'mid']);
  });
});

describe('parseStoredDrafts', () => {
  it('빈 값·깨진 JSON 은 빈 맵이다', () => {
    expect(parseStoredDrafts(null)).toEqual({});
    expect(parseStoredDrafts('{not json')).toEqual({});
  });

  it('저장된 초안을 값·시각과 함께 되살린다', () => {
    const raw = JSON.stringify({ 'ide.loop::a|b': { values: { command: '하던 말' }, at: 42 } });
    expect(parseStoredDrafts(raw)).toEqual({ 'ide.loop::a|b': { values: { command: '하던 말' }, at: 42 } });
  });

  it('모양이 깨진 항목·값이 남지 않은 항목은 버린다', () => {
    const raw = JSON.stringify({
      broken: 'not an object',
      empty: { values: {}, at: 1 },
      lost: { values: { nested: { a: 1 } }, at: 1 },
      good: { values: { flag: true } },
    });
    const out = parseStoredDrafts(raw);
    expect(Object.keys(out)).toEqual(['good']);
    expect(out['good']).toEqual({ values: { flag: true }, at: 0 });
  });
});

describe('useSessionFormDraftStore', () => {
  beforeEach(() => {
    useSessionFormDraftStore.setState({ drafts: {} });
  });

  it('건드린 칸만 쌓이고 여러 번 고쳐도 합쳐진다', () => {
    const key = sessionFormDraftKey('ide.loop', 'agent-1|sub-1');
    useSessionFormDraftStore.getState().patchFormDraft(key, { command: '가' });
    useSessionFormDraftStore.getState().patchFormDraft(key, { total: 3 });
    useSessionFormDraftStore.getState().patchFormDraft(key, { command: '가나' });
    expect(useSessionFormDraftStore.getState().drafts[key]?.values).toEqual({ command: '가나', total: 3 });
  });

  it('세션 탭마다 초안이 독립이다(다른 탭에 다녀와도 섞이지 않는다)', () => {
    const a = sessionFormDraftKey('ide.loop', 'agent-1|sub-1');
    const b = sessionFormDraftKey('ide.loop', 'agent-1|sub-2');
    useSessionFormDraftStore.getState().patchFormDraft(a, { command: '탭1' });
    useSessionFormDraftStore.getState().patchFormDraft(b, { command: '탭2' });
    expect(useSessionFormDraftStore.getState().drafts[a]?.values['command']).toBe('탭1');
    expect(useSessionFormDraftStore.getState().drafts[b]?.values['command']).toBe('탭2');
  });

  it('담을 값이 없는 patch 는 초안을 만들지 않는다', () => {
    const key = sessionFormDraftKey('ide.loop', 'agent-1|sub-1');
    useSessionFormDraftStore.getState().patchFormDraft(key, {});
    expect(useSessionFormDraftStore.getState().drafts[key]).toBeUndefined();
  });

  it('저장이 끝나면 그 스코프 초안만 비운다', () => {
    const a = sessionFormDraftKey('ide.loop', 'agent-1|sub-1');
    const b = sessionFormDraftKey('ide.loop', 'agent-1|sub-2');
    useSessionFormDraftStore.getState().patchFormDraft(a, { command: '탭1' });
    useSessionFormDraftStore.getState().patchFormDraft(b, { command: '탭2' });
    useSessionFormDraftStore.getState().clearFormDraft(a);
    expect(useSessionFormDraftStore.getState().drafts[a]).toBeUndefined();
    expect(useSessionFormDraftStore.getState().drafts[b]?.values['command']).toBe('탭2');
  });

  it('초안을 비운 뒤에는 화면이 서버 값으로 돌아간다', () => {
    const key = sessionFormDraftKey('ide.loop', 'agent-1|sub-1');
    const base = { command: '서버 값' };
    useSessionFormDraftStore.getState().patchFormDraft(key, { command: '초안' });
    expect(mergeFormDraft(base, useSessionFormDraftStore.getState().drafts[key]?.values).command).toBe('초안');
    useSessionFormDraftStore.getState().clearFormDraft(key);
    expect(mergeFormDraft(base, useSessionFormDraftStore.getState().drafts[key]?.values).command).toBe('서버 값');
  });
});
