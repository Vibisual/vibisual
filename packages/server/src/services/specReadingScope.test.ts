/**
 * §5.5 #17-44 ⑧ — 정독 켬/끔 **3층 판정** 고정.
 *
 * 이 판정이 갈리면 "화면은 켜졌다는데 프롬프트엔 안 실린다"가 만들어지고, 그 순간 사용자는 켠 결과를
 * 확인할 방법을 잃는다. 그래서 여기서 고정할 것은 셋이다 — **기본이 정말 꺼짐인가**, **아래 층이 위를
 * 덮는가**, **한 칸만 갈아 끼우는 함수가 나머지를 안 건드리는가**(전량 교체 사고의 재발 방지).
 *
 * 함수는 shared 순수 모듈이지만 shared 에는 러너가 없다 — `externalFolderView.test.ts` 선례대로
 * 서버 패키지에서 돌린다.
 */
import { describe, it, expect } from 'vitest';
import {
  SPEC_SCOPE_ENTRY_MAX,
  SPEC_SCOPE_ORDER,
  capScopeMap,
  normalizeScopeMap,
  resolveSpecReadingEnabled,
  specReadingScopeStates,
  withSpecReadingScope,
} from '@vibisual/shared';
import type { SpecReadingSettings } from '@vibisual/shared';

const base = (over: Partial<SpecReadingSettings> = {}): SpecReadingSettings =>
  ({ strength: 'observe', ...over });

const IDS = { agentId: 'agent-1', subAgentId: 'sub-1' };

describe('기본은 꺼짐', () => {
  it('설정이 없으면 꺼짐 — 이 기능이 없던 때와 완전히 같아야 한다', () => {
    expect(resolveSpecReadingEnabled(undefined, IDS)).toBe(false);
    expect(resolveSpecReadingEnabled(null, IDS)).toBe(false);
    expect(resolveSpecReadingEnabled(base(), IDS)).toBe(false);
  });

  it('빈 맵만 있는 것도 꺼짐이다 — 칸이 생겼다는 것과 켰다는 것은 다르다', () => {
    expect(resolveSpecReadingEnabled(base({ enabledAgents: {}, enabledSessions: {} }), IDS)).toBe(false);
  });
});

describe('아래 층이 위를 덮는다', () => {
  it('프로젝트만 켜면 모든 에이전트·세션이 켜진다', () => {
    expect(resolveSpecReadingEnabled(base({ enabledProject: true }), IDS)).toBe(true);
  });

  it('세션이 프로젝트를 덮는다 — "프로젝트는 켜되 이 세션만 끄기"', () => {
    const s = base({ enabledProject: true, enabledSessions: { 'sub-1': false } });
    expect(resolveSpecReadingEnabled(s, IDS)).toBe(false);
    expect(resolveSpecReadingEnabled(s, { agentId: 'agent-1', subAgentId: 'sub-2' })).toBe(true);
  });

  it('에이전트가 프로젝트를 덮고, 세션이 그 에이전트를 덮는다', () => {
    const s = base({ enabledProject: true, enabledAgents: { 'agent-1': false } });
    expect(resolveSpecReadingEnabled(s, IDS)).toBe(false);
    expect(resolveSpecReadingEnabled({ ...s, enabledSessions: { 'sub-1': true } }, IDS)).toBe(true);
  });

  it('프로젝트가 꺼져 있어도 세션 하나만 켤 수 있다 — 반대 방향도 성립해야 한다', () => {
    expect(resolveSpecReadingEnabled(base({ enabledSessions: { 'sub-1': true } }), IDS)).toBe(true);
  });

  it('id 를 모르는 자리에서는 그 층이 조용히 접힌다(막지 않는다)', () => {
    const s = base({ enabledProject: true, enabledSessions: { 'sub-1': false } });
    expect(resolveSpecReadingEnabled(s, { agentId: 'agent-1' })).toBe(true);
    expect(resolveSpecReadingEnabled(s, {})).toBe(true);
  });
});

describe('화면이 읽는 층별 상태', () => {
  it('층 순서는 위에서 아래로 고정 — 뒤바꾸면 덮어쓰기 방향이 통째로 뒤집힌다', () => {
    expect([...SPEC_SCOPE_ORDER]).toEqual(['project', 'agent', 'session']);
    expect(specReadingScopeStates(base(), IDS).map((s) => s.scope)).toEqual([...SPEC_SCOPE_ORDER]);
  });

  it('상속과 명시를 구분한다 — 둘을 뭉개면 "안 정함"과 "꺼 둠"이 같아 보인다', () => {
    const st = specReadingScopeStates(base({ enabledProject: true, enabledSessions: { 'sub-1': false } }), IDS);
    expect(st[0]).toMatchObject({ scope: 'project', own: true, inherited: false, effective: true });
    expect(st[1]).toMatchObject({ scope: 'agent', own: null, inherited: true, effective: true });
    expect(st[2]).toMatchObject({ scope: 'session', own: false, inherited: false, effective: false });
  });

  it('마지막 층의 effective 는 판정 함수와 항상 같다 — 갈리면 화면과 집행이 어긋난다', () => {
    const cases: SpecReadingSettings[] = [
      base(),
      base({ enabledProject: true }),
      base({ enabledProject: true, enabledAgents: { 'agent-1': false } }),
      base({ enabledAgents: { 'agent-1': true }, enabledSessions: { 'sub-1': false } }),
      base({ enabledSessions: { 'sub-1': true } }),
    ];
    for (const s of cases) {
      const st = specReadingScopeStates(s, IDS);
      expect(st[st.length - 1]?.effective).toBe(resolveSpecReadingEnabled(s, IDS));
    }
  });

  it('id 가 없는 층은 고를 수 없다고 말한다 — 못 누르는 이유가 화면에 있어야 한다', () => {
    const st = specReadingScopeStates(base(), { agentId: 'agent-1' });
    expect(st.map((s) => s.available)).toEqual([true, true, false]);
    expect(specReadingScopeStates(base(), {}).map((s) => s.available)).toEqual([true, false, false]);
  });
});

describe('한 칸만 갈아 끼운다', () => {
  it('나머지 설정을 그대로 옮겨 담는다 — 전량 교체가 강도·면제를 강등시킨 사고의 재발 방지', () => {
    const before = base({ strength: 'enforce', waived: ['REQ-14'], roots: ['docs/기획'] });
    const after = withSpecReadingScope(before, 'project', null, true);
    expect(after.strength).toBe('enforce');
    expect(after.waived).toEqual(['REQ-14']);
    expect(after.roots).toEqual(['docs/기획']);
    expect(after.enabledProject).toBe(true);
  });

  it('null 은 그 칸을 지운다(상속으로) — false 와 다르다', () => {
    const on = withSpecReadingScope(base(), 'session', 'sub-1', true);
    expect(on.enabledSessions).toEqual({ 'sub-1': true });
    const off = withSpecReadingScope(on, 'session', 'sub-1', false);
    expect(off.enabledSessions).toEqual({ 'sub-1': false });
    const cleared = withSpecReadingScope(off, 'session', 'sub-1', null);
    expect(cleared.enabledSessions).toEqual({});
    expect(resolveSpecReadingEnabled(cleared, IDS)).toBe(false);
  });

  it('원본을 바꾸지 않는다 — 서버가 저장 전 값을 그대로 들고 있어야 한다', () => {
    const before = base({ enabledProject: true });
    const after = withSpecReadingScope(before, 'agent', 'agent-1', false);
    expect(before.enabledAgents).toBeUndefined();
    expect(after.enabledAgents).toEqual({ 'agent-1': false });
  });

  it('id 없이 에이전트·세션 층을 쓰면 아무것도 안 바뀐다', () => {
    const before = base({ enabledProject: true });
    expect(withSpecReadingScope(before, 'agent', null, true)).toEqual(before);
    expect(withSpecReadingScope(before, 'session', '  ', true)).toEqual(before);
  });
});

describe('잔칸은 무한히 늘지 않는다', () => {
  it('상한을 넘으면 가장 먼저 적힌 칸부터 버린다', () => {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < SPEC_SCOPE_ENTRY_MAX + 5; i++) map[`sub-${i}`] = true;
    const capped = capScopeMap(map);
    expect(Object.keys(capped).length).toBe(SPEC_SCOPE_ENTRY_MAX);
    expect(capped['sub-0']).toBeUndefined();
    expect(capped[`sub-${SPEC_SCOPE_ENTRY_MAX + 4}`]).toBe(true);
  });

  it('상한 이내면 같은 객체를 그대로 돌려준다(불필요한 사본 ❌)', () => {
    const map = { a: true };
    expect(capScopeMap(map)).toBe(map);
  });
});

describe('바깥에서 온 값 접기', () => {
  it('boolean 이 아닌 칸은 버린다 — 손으로 적은 JSON 이 그대로 들어오는 자리다', () => {
    expect(normalizeScopeMap({ a: true, b: 'yes', c: 0, d: false })).toEqual({ a: true, d: false });
  });

  it('맵이 아니거나 비면 undefined — 빈 칸을 만들어 두면 "켰다"로 오해된다', () => {
    expect(normalizeScopeMap(null)).toBeUndefined();
    expect(normalizeScopeMap([1, 2])).toBeUndefined();
    expect(normalizeScopeMap({})).toBeUndefined();
    expect(normalizeScopeMap({ x: 'no' })).toBeUndefined();
  });
});
