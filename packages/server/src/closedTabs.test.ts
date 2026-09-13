import { describe, it, expect } from 'vitest';
import {
  isCommandId,
  defaultKeymap,
  matchesBinding,
  commandDef,
  closedTabDedupeKey,
  normalizeClosedTabEntries,
  pushClosedTabEntry,
  takeClosedTabEntry,
  pruneMissingClosedTabs,
  MAX_RECENTLY_CLOSED_TABS,
  type ClosedTabEntry,
} from '@vibisual/shared';

/**
 * §5.4 #14-4 "닫은 탭 다시 열기" 스택(`shared/src/closedTabs.ts`)의 회귀 고정.
 *
 * 이 파일이 지키는 것은 셋이다.
 * ① **되열 수 없는 항목은 목록에 들어오지 않는다** — 들어오면 메뉴에 보이는데 눌러도 아무 일이
 *    없는 유령 항목이 되고, 그게 §3.2.3 이 반면교사로 든 Claude Code #62959 다.
 * ② **경로 접기는 OS 가 정한다** — linux 에서 접으면 케이스만 다른 두 프로젝트가 스택에서
 *    한 칸을 다투다 한쪽이 사라진다.
 * ③ **상한은 쌓는 함수 안에서만 지켜진다** — 호출부가 늘어도 25건을 넘지 않는다.
 *
 * shared 패키지에는 테스트 러너가 없어(빌드 전용) 여기 server 쪽에 둔다 — `pathCase.test.ts` 선례.
 */

const proj = (name: string, path: string, closedAt = 1): ClosedTabEntry => ({
  key: `p:${name}`,
  kind: 'project',
  label: name,
  closedAt,
  path,
});

const frame = (id: string, url: string, closedAt = 1): ClosedTabEntry => ({
  key: `i:${id}`,
  kind: 'iframe',
  label: id,
  closedAt,
  url,
  serverKind: 'frontend',
});

describe('closedTabDedupeKey', () => {
  it('프로젝트는 표시명이 아니라 경로로 접는다 — 같은 basename 다른 경로는 서로 다른 항목', () => {
    const a = proj('app', 'C:/work/alpha/app');
    const b = proj('app', 'C:/work/beta/app');
    expect(a.key).toBe(b.key); // 탭 키는 같지만
    expect(closedTabDedupeKey(a, 'win32')).not.toBe(closedTabDedupeKey(b, 'win32'));
  });

  it('win32·darwin 은 케이스를 접고 linux 는 접지 않는다', () => {
    const upper = proj('App', 'C:/Work/App');
    const lower = proj('app', 'c:/work/app');
    expect(closedTabDedupeKey(upper, 'win32')).toBe(closedTabDedupeKey(lower, 'win32'));
    expect(closedTabDedupeKey(upper, 'darwin')).toBe(closedTabDedupeKey(lower, 'darwin'));
    expect(closedTabDedupeKey(upper, 'linux')).not.toBe(closedTabDedupeKey(lower, 'linux'));
  });

  it('iframe 은 탭 id 로 접는다(경로가 없다)', () => {
    expect(closedTabDedupeKey(frame('t1', 'http://a'), 'linux')).toBe('iframe:i:t1');
  });
});

describe('pushClosedTabEntry', () => {
  it('최신이 맨 앞에 온다', () => {
    let list: ClosedTabEntry[] = [];
    list = pushClosedTabEntry(list, proj('a', '/w/a', 1), 'linux');
    list = pushClosedTabEntry(list, proj('b', '/w/b', 2), 'linux');
    expect(list.map((e) => e.label)).toEqual(['b', 'a']);
  });

  it('같은 탭을 두 번 닫으면 한 건으로 접히고 새것이 앞에 선다', () => {
    let list: ClosedTabEntry[] = [];
    list = pushClosedTabEntry(list, proj('a', '/w/a', 1), 'linux');
    list = pushClosedTabEntry(list, proj('b', '/w/b', 2), 'linux');
    list = pushClosedTabEntry(list, proj('a', '/w/a', 3), 'linux');
    expect(list.map((e) => e.label)).toEqual(['a', 'b']);
    expect(list[0]?.closedAt).toBe(3);
  });

  it('linux 에서는 케이스만 다른 두 프로젝트가 각각 남는다', () => {
    let list: ClosedTabEntry[] = [];
    list = pushClosedTabEntry(list, proj('App', '/w/App', 1), 'linux');
    list = pushClosedTabEntry(list, proj('app', '/w/app', 2), 'linux');
    expect(list).toHaveLength(2);
  });

  it('win32 에서는 같은 폴더의 케이스 차이가 한 건으로 접힌다', () => {
    let list: ClosedTabEntry[] = [];
    list = pushClosedTabEntry(list, proj('App', 'C:/w/App', 1), 'win32');
    list = pushClosedTabEntry(list, proj('app', 'c:/w/app', 2), 'win32');
    expect(list).toHaveLength(1);
    expect(list[0]?.closedAt).toBe(2);
  });

  it('상한을 넘으면 가장 오래된 것부터 밀려난다', () => {
    let list: ClosedTabEntry[] = [];
    for (let i = 0; i < MAX_RECENTLY_CLOSED_TABS + 5; i += 1) {
      list = pushClosedTabEntry(list, proj(`p${i}`, `/w/p${i}`, i), 'linux');
    }
    expect(list).toHaveLength(MAX_RECENTLY_CLOSED_TABS);
    expect(list[0]?.label).toBe(`p${MAX_RECENTLY_CLOSED_TABS + 4}`);
    expect(list.some((e) => e.label === 'p0')).toBe(false);
  });

  it('max 0 은 무제한', () => {
    let list: ClosedTabEntry[] = [];
    for (let i = 0; i < 40; i += 1) {
      list = pushClosedTabEntry(list, proj(`p${i}`, `/w/p${i}`, i), 'linux', 0);
    }
    expect(list).toHaveLength(40);
  });

  it('되열 수 없는 모양(경로 없는 프로젝트)은 들이지 않는다', () => {
    const bad = { key: 'p:x', kind: 'project', label: 'x', closedAt: 1 } as ClosedTabEntry;
    expect(pushClosedTabEntry([], bad, 'linux')).toEqual([]);
  });

  it('입력 배열을 건드리지 않는다', () => {
    const before: ClosedTabEntry[] = [proj('a', '/w/a', 1)];
    const after = pushClosedTabEntry(before, proj('b', '/w/b', 2), 'linux');
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe('takeClosedTabEntry', () => {
  const list = [proj('c', '/w/c', 3), proj('b', '/w/b', 2), proj('a', '/w/a', 1)];

  it('키가 없으면 가장 최근에 닫은 것을 꺼낸다', () => {
    const { entry, rest } = takeClosedTabEntry(list);
    expect(entry?.label).toBe('c');
    expect(rest.map((e) => e.label)).toEqual(['b', 'a']);
  });

  it('키를 주면 그 항목만 꺼낸다', () => {
    const { entry, rest } = takeClosedTabEntry(list, 'p:b');
    expect(entry?.label).toBe('b');
    expect(rest.map((e) => e.label)).toEqual(['c', 'a']);
  });

  it('없는 키면 아무것도 꺼내지 않고 목록도 그대로', () => {
    const { entry, rest } = takeClosedTabEntry(list, 'p:zzz');
    expect(entry).toBeNull();
    expect(rest.map((e) => e.label)).toEqual(['c', 'b', 'a']);
  });

  it('빈 스택은 null', () => {
    expect(takeClosedTabEntry([]).entry).toBeNull();
  });
});

describe('normalizeClosedTabEntries', () => {
  it('배열이 아니면 빈 목록', () => {
    expect(normalizeClosedTabEntries(null, 'linux')).toEqual([]);
    expect(normalizeClosedTabEntries({ a: 1 }, 'linux')).toEqual([]);
  });

  it('되열 수 없는 항목을 걸러 낸다 — 경로 없는 프로젝트 · 주소 없는 iframe · 모르는 kind', () => {
    const raw = [
      { key: 'p:a', kind: 'project', label: 'a', closedAt: 1, path: '/w/a' },
      { key: 'p:b', kind: 'project', label: 'b', closedAt: 2 },
      { key: 'i:t', kind: 'iframe', label: 't', closedAt: 3 },
      { key: 'x:c', kind: 'window', label: 'c', closedAt: 4 },
      'nonsense',
    ];
    expect(normalizeClosedTabEntries(raw, 'linux').map((e) => e.key)).toEqual(['p:a']);
  });

  it('중복은 앞(=최신)이 이긴다', () => {
    const raw = [
      { key: 'p:a', kind: 'project', label: 'new', closedAt: 9, path: '/w/a' },
      { key: 'p:a', kind: 'project', label: 'old', closedAt: 1, path: '/w/a' },
    ];
    const out = normalizeClosedTabEntries(raw, 'linux');
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe('new');
  });

  it('상한을 넘겨 저장돼 있어도 읽을 때 잘린다', () => {
    const raw = Array.from({ length: 60 }, (_, i) => ({
      key: `p:p${i}`, kind: 'project', label: `p${i}`, closedAt: i, path: `/w/p${i}`,
    }));
    expect(normalizeClosedTabEntries(raw, 'linux')).toHaveLength(MAX_RECENTLY_CLOSED_TABS);
  });

  it('serverKind 가 이상하면 그 칸만 떨어뜨리고 항목은 살린다', () => {
    const raw = [{ key: 'i:t', kind: 'iframe', label: 't', closedAt: 1, url: 'http://a', serverKind: 'weird' }];
    const out = normalizeClosedTabEntries(raw, 'linux');
    expect(out).toHaveLength(1);
    expect(out[0]?.serverKind).toBeUndefined();
  });
});

describe('pruneMissingClosedTabs', () => {
  it('폴더가 사라진 프로젝트만 걷어내고 iframe 은 건드리지 않는다', () => {
    const list = [proj('gone', '/w/gone', 2), proj('here', '/w/here', 1), frame('t', 'http://dead', 3)];
    const { kept, removed } = pruneMissingClosedTabs(list, (p) => p === '/w/here');
    expect(removed).toBe(1);
    expect(kept.map((e) => e.key)).toEqual(['p:here', 'i:t']);
  });

  it('전부 살아 있으면 아무것도 지우지 않는다', () => {
    const list = [proj('a', '/w/a', 1)];
    expect(pruneMissingClosedTabs(list, () => true).removed).toBe(0);
  });
});

describe('global.reopenClosedTab 바인딩 (§6 · 멀티플랫폼 5축)', () => {
  const KEY = { code: 'KeyT', shiftKey: true, altKey: false } as const;

  it('표에 등록돼 있고 기본값이 브라우저와 같은 Ctrl+Shift+T', () => {
    expect(isCommandId('global.reopenClosedTab')).toBe(true);
    expect(defaultKeymap()['global.reopenClosedTab']).toBe('Ctrl+Shift+T');
  });

  it('win/linux 는 Ctrl, mac 은 ⌘ 로 눌린다 — `Ctrl` 토큰이 mod 라서', () => {
    const binding = 'Ctrl+Shift+T';
    // win/linux
    expect(matchesBinding({ ...KEY, ctrlKey: true, metaKey: false }, binding)).toBe(true);
    // mac (⌘)
    expect(matchesBinding({ ...KEY, ctrlKey: false, metaKey: true }, binding)).toBe(true);
    // 수식키가 모자라면 안 먹는다(Shift 없이 Ctrl+T = 다른 손짓)
    expect(matchesBinding({ ...KEY, shiftKey: false, ctrlKey: true, metaKey: false }, binding)).toBe(false);
  });

  it('입력칸에서는 듣지 않는다 — typingSafe 를 주지 않아 터미널의 Ctrl+Shift+T 를 뺏지 않는다', () => {
    expect(commandDef('global.reopenClosedTab').typingSafe).toBeUndefined();
  });

  it('스코프는 global — 캔버스든 IDE든 어디서나 되돌릴 수 있다', () => {
    expect(commandDef('global.reopenClosedTab').scope).toBe('global');
  });
});
