import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COMMAND_HISTORY_STORAGE_KEY,
  HISTORY_MAIN_SESSION_KEY,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ENTRY_CHARS,
  HISTORY_MAX_SESSIONS,
  HISTORY_MAX_TOTAL_CHARS,
  HISTORY_STORE_VERSION,
  type CommandHistoryStore,
  type HistoryStorageLike,
  beginHistory,
  commandHistoryKey,
  createEmptyHistoryStore,
  decideArrowKey,
  dropSessionCommandHistory,
  flushCommandHistory,
  getCommandHistory,
  hasCommandHistory,
  matchHistoryEntries,
  mergeHistoryStores,
  normalizeHistoryEntry,
  parseHistoryStore,
  pushHistoryEntries,
  pushHistoryEntry,
  recordCommandHistory,
  resetCommandHistoryCache,
  seedCommandHistory,
  setCommandHistoryStorage,
  stepHistory,
  trimHistoryStore,
} from './commandHistory';

/** localStorage 대역 — 클라 테스트는 node 환경이라 브라우저 저장소가 없다. */
function fakeStorage(initial: Record<string, string> = {}): HistoryStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function bucket(entries: string[], updatedAt = 1): CommandHistoryStore['sessions'][string] {
  return { updatedAt, entries };
}

describe('commandHistoryKey', () => {
  it('세션마다 다른 키를 준다', () => {
    expect(commandHistoryKey('agent-1', 'sub-a')).toBe('agent-1|sub-a');
    expect(commandHistoryKey('agent-1', 'sub-b')).not.toBe(commandHistoryKey('agent-1', 'sub-a'));
    expect(commandHistoryKey('agent-2', 'sub-a')).not.toBe(commandHistoryKey('agent-1', 'sub-a'));
  });

  it('세션 탭이 없는 메인 입력창은 고정 키 조각을 쓴다', () => {
    expect(commandHistoryKey('agent-1', null)).toBe(`agent-1|${HISTORY_MAIN_SESSION_KEY}`);
  });
});

describe('normalizeHistoryEntry', () => {
  it('앞뒤 공백을 떼고 빈 값은 버린다', () => {
    expect(normalizeHistoryEntry('  build  ')).toBe('build');
    expect(normalizeHistoryEntry('   ')).toBeNull();
    expect(normalizeHistoryEntry('\n\t')).toBeNull();
  });

  it('상한을 넘는 항목은 앞부분만 보관한다', () => {
    const long = 'x'.repeat(HISTORY_MAX_ENTRY_CHARS + 500);
    expect(normalizeHistoryEntry(long)).toHaveLength(HISTORY_MAX_ENTRY_CHARS);
  });
});

describe('pushHistoryEntry', () => {
  it('최신이 맨 뒤에 온다', () => {
    expect(pushHistoryEntries([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('같은 명령은 옛 자리를 지우고 맨 뒤로 옮긴다', () => {
    expect(pushHistoryEntries([], ['a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('빈 명령은 무시하고 원본을 보존한다', () => {
    const base = ['a'];
    const next = pushHistoryEntry(base, '   ');
    expect(next).toEqual(['a']);
    expect(next).not.toBe(base); // 불변 — 원본을 건드리지 않는다
  });

  it('상한(10개)을 넘으면 가장 오래된 것부터 지운다', () => {
    expect(HISTORY_MAX_ENTRIES).toBe(10);
    const many = Array.from({ length: HISTORY_MAX_ENTRIES + 5 }, (_, i) => `cmd-${i}`);
    const out = pushHistoryEntries([], many);
    expect(out).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(out[0]).toBe('cmd-5');
    expect(out[out.length - 1]).toBe(`cmd-${HISTORY_MAX_ENTRIES + 4}`);
  });
});

describe('trimHistoryStore', () => {
  it('세션 수 상한을 넘으면 오래 안 쓴 세션부터 버린다', () => {
    const sessions: CommandHistoryStore['sessions'] = {};
    for (let i = 0; i < HISTORY_MAX_SESSIONS + 5; i++) sessions[`agent-1|sub-${i}`] = bucket([`c${i}`], i);
    const out = trimHistoryStore({ v: HISTORY_STORE_VERSION, sessions });
    expect(Object.keys(out.sessions)).toHaveLength(HISTORY_MAX_SESSIONS);
    expect(out.sessions['agent-1|sub-0']).toBeUndefined(); // updatedAt 가장 오래됨
    expect(out.sessions[`agent-1|sub-${HISTORY_MAX_SESSIONS + 4}`]).toBeDefined();
  });

  it('빈 세션은 제거한다', () => {
    const out = trimHistoryStore({ v: HISTORY_STORE_VERSION, sessions: { a: bucket([]), b: bucket(['x']) } });
    expect(Object.keys(out.sessions)).toEqual(['b']);
  });

  it('전체 문자 예산을 넘으면 오래된 쪽부터 버리고 최신은 남긴다', () => {
    const chunk = 'y'.repeat(3000);
    const sessions: CommandHistoryStore['sessions'] = {};
    for (let i = 0; i < 60; i++) {
      sessions[`agent-1|sub-${i}`] = bucket(Array.from({ length: 10 }, (_, j) => `${i}-${j}-${chunk}`), i);
    }
    const out = trimHistoryStore({ v: HISTORY_STORE_VERSION, sessions });
    let total = 0;
    for (const b of Object.values(out.sessions)) for (const e of b.entries) total += e.length;
    expect(total).toBeLessThanOrEqual(HISTORY_MAX_TOTAL_CHARS);
    expect(out.sessions['agent-1|sub-59']).toBeDefined(); // 최근 세션은 살아남는다
  });
});

describe('parseHistoryStore', () => {
  it('없음·깨진 JSON·버전 불일치는 빈 저장고', () => {
    expect(parseHistoryStore(null)).toEqual(createEmptyHistoryStore());
    expect(parseHistoryStore('{')).toEqual(createEmptyHistoryStore());
    expect(parseHistoryStore(JSON.stringify({ v: 99, sessions: { a: bucket(['x']) } }))).toEqual(createEmptyHistoryStore());
    expect(parseHistoryStore(JSON.stringify({ v: HISTORY_STORE_VERSION }))).toEqual(createEmptyHistoryStore());
  });

  it('버블 단위였던 옛 포맷(v1)은 조용히 버린다', () => {
    const legacy = JSON.stringify({ v: 1, agents: { 'agent-1': { updatedAt: 1, entries: ['old'] } } });
    expect(parseHistoryStore(legacy)).toEqual(createEmptyHistoryStore());
  });

  it('문자열이 아닌 항목은 걸러내고 나머지는 살린다', () => {
    const raw = JSON.stringify({
      v: HISTORY_STORE_VERSION,
      sessions: { 'agent-1|sub-a': { updatedAt: 3, entries: ['x', 42, null, 'y'] }, 'agent-1|sub-b': 'nope' },
    });
    const out = parseHistoryStore(raw);
    expect(out.sessions['agent-1|sub-a']?.entries).toEqual(['x', 'y']);
    expect(out.sessions['agent-1|sub-b']).toBeUndefined();
  });

  it('직렬화 → 파싱 왕복에서 내용이 보존된다', () => {
    const store: CommandHistoryStore = { v: HISTORY_STORE_VERSION, sessions: { 'agent-1|sub-a': bucket(['one', 'two'], 7) } };
    expect(parseHistoryStore(JSON.stringify(store))).toEqual(store);
  });
});

describe('mergeHistoryStores', () => {
  it('디스크 기록 위에 이 창의 기록을 얹는다(같은 명령은 한 자리로)', () => {
    const base: CommandHistoryStore = { v: 2, sessions: { s1: bucket(['x', 'y'], 1) } };
    const ours: CommandHistoryStore = { v: 2, sessions: { s1: bucket(['y', 'z'], 5), s2: bucket(['q'], 2) } };
    const out = mergeHistoryStores(base, ours);
    expect(out.sessions['s1']?.entries).toEqual(['x', 'y', 'z']);
    expect(out.sessions['s1']?.updatedAt).toBe(5);
    expect(out.sessions['s2']?.entries).toEqual(['q']);
  });

  it('지운 세션은 병합이 되살리지 않는다', () => {
    const base: CommandHistoryStore = { v: 2, sessions: { s1: bucket(['x'], 1), s2: bucket(['y'], 1) } };
    const ours: CommandHistoryStore = { v: 2, sessions: { s2: bucket(['y'], 2) } };
    const out = mergeHistoryStores(base, ours, ['s1']);
    expect(out.sessions['s1']).toBeUndefined();
    expect(out.sessions['s2']?.entries).toEqual(['y']);
  });
});

describe('matchHistoryEntries', () => {
  const entries = ['build client', 'build server', 'test all'];

  it('draft 가 비면 전체를 훑는다', () => {
    expect(matchHistoryEntries(entries, '   ')).toEqual(entries);
  });

  it('draft 가 있으면 그 접두사로 시작하는 것만(대소문자 무시)', () => {
    expect(matchHistoryEntries(entries, 'BUILD')).toEqual(['build client', 'build server']);
  });

  it('접두사와 완전히 같은 항목은 뺀다(같은 걸 다시 꺼내지 않게)', () => {
    expect(matchHistoryEntries(['test all', 'test all fast'], 'test all')).toEqual(['test all fast']);
  });

  it('걸리는 게 없으면 전체로 폴백한다', () => {
    expect(matchHistoryEntries(entries, 'zzz')).toEqual(entries);
  });
});

describe('beginHistory / stepHistory', () => {
  const entries = ['first', 'second', 'third'];

  it('↑ 진입은 가장 최근 명령부터', () => {
    const entered = beginHistory(entries, '', 'newest');
    expect(entered?.text).toBe('third');
    expect(entered?.nav?.index).toBe(2);
  });

  it('↓ 진입은 가장 오래된 명령부터', () => {
    const entered = beginHistory(entries, '', 'oldest');
    expect(entered?.text).toBe('first');
    expect(entered?.nav?.index).toBe(0);
  });

  it('히스토리가 비면 진입 자체가 없다(힌트도 뜨면 안 되는 상태)', () => {
    expect(beginHistory([], '', 'newest')).toBeNull();
    expect(beginHistory([], '', 'oldest')).toBeNull();
  });

  it('진입 뒤 ↑ 는 한 번 누름으로 거슬러 오르고 맨 앞에서 멈춘다', () => {
    const e1 = beginHistory(entries, '', 'newest');
    const s1 = stepHistory(e1!.nav!, 'prev');
    expect(s1?.text).toBe('second');
    const s2 = stepHistory(s1!.nav!, 'prev');
    expect(s2?.text).toBe('first');
    expect(stepHistory(s2!.nav!, 'prev')).toBeNull(); // 더 갈 데 없음 — 키를 가로채지 않는다
  });

  it('↓ 로 끝까지 내려오면 원래 draft 를 되돌리고 탐색이 끝난다', () => {
    const e1 = beginHistory(entries, 'my draft', 'newest'); // third
    const d1 = stepHistory(e1!.nav!, 'next');
    expect(d1?.text).toBe('my draft');
    expect(d1?.nav).toBeNull();
  });

  it('탐색 중에는 목록·draft 가 고정된다(다른 창이 히스토리를 고쳐도 흔들리지 않는다)', () => {
    const e1 = beginHistory(entries, 'my draft', 'newest');
    const s1 = stepHistory(e1!.nav!, 'prev');
    expect(s1?.nav?.matches).toEqual(entries);
    expect(s1?.nav?.draft).toBe('my draft');
  });

  it('draft 접두사가 있으면 그 목록만 훑는다', () => {
    const list = ['build client', 'test all', 'build server'];
    const e1 = beginHistory(list, 'build', 'newest');
    expect(e1?.text).toBe('build server');
    const s1 = stepHistory(e1!.nav!, 'prev');
    expect(s1?.text).toBe('build client');
    expect(stepHistory(s1!.nav!, 'prev')).toBeNull();
  });
});

describe('decideArrowKey — 커서 이동이 언제나 우선', () => {
  const entries = ['first', 'second', 'third'];
  const base = { nav: null, hint: null, entries, draft: '', direction: 'prev' } as const;

  it('커서가 움직였으면 히스토리는 관여하지 않는다(워드랩으로 접힌 줄 포함)', () => {
    expect(decideArrowKey({ ...base, caretMoved: true })).toEqual({ kind: 'clearHint' });
    // 힌트가 떠 있었더라도 커서가 움직이면 셈은 처음부터 다시 — 다음 경계 누름이 다시 "첫 번째"다.
    expect(decideArrowKey({ ...base, caretMoved: true, hint: 'prev' })).toEqual({ kind: 'clearHint' });
  });

  it('더 갈 데가 없는 첫 누름은 힌트만 띄운다', () => {
    expect(decideArrowKey({ ...base, caretMoved: false })).toEqual({ kind: 'hint', direction: 'prev' });
  });

  it('같은 방향으로 한 번 더 누르면 히스토리로 들어간다', () => {
    const out = decideArrowKey({ ...base, caretMoved: false, hint: 'prev' });
    expect(out.kind).toBe('apply');
    if (out.kind === 'apply') {
      expect(out.text).toBe('third'); // ↑ 진입 = 최신부터
      expect(out.nav?.index).toBe(2);
    }
  });

  it('↓ 도 대칭 — 첫 누름은 힌트, 두 번째에 가장 오래된 명령', () => {
    expect(decideArrowKey({ ...base, caretMoved: false, direction: 'next' }))
      .toEqual({ kind: 'hint', direction: 'next' });
    const out = decideArrowKey({ ...base, caretMoved: false, direction: 'next', hint: 'next' });
    expect(out.kind === 'apply' && out.text).toBe('first');
  });

  it('반대 방향 힌트가 떠 있으면 그 방향의 첫 누름부터 다시 센다', () => {
    expect(decideArrowKey({ ...base, caretMoved: false, direction: 'next', hint: 'prev' }))
      .toEqual({ kind: 'hint', direction: 'next' });
  });

  it('히스토리가 없으면 힌트조차 뜨지 않는다', () => {
    expect(decideArrowKey({ ...base, caretMoved: false, entries: [] })).toEqual({ kind: 'none' });
    expect(decideArrowKey({ ...base, caretMoved: false, entries: [], hint: 'prev' })).toEqual({ kind: 'none' });
  });

  it('탐색 중에는 한 번 누름으로 움직인다(두 번 누름은 진입에만)', () => {
    const entered = beginHistory(entries, '', 'newest');
    const out = decideArrowKey({ ...base, caretMoved: false, nav: entered!.nav });
    expect(out.kind === 'apply' && out.text).toBe('second');
  });

  it('탐색 중 더 갈 데가 없으면 아무 일도 하지 않는다(키를 가로채지 않는다)', () => {
    const oldest = { matches: entries, index: 0, draft: '' };
    expect(decideArrowKey({ ...base, caretMoved: false, nav: oldest })).toEqual({ kind: 'none' });
  });

  it('탐색 중 ↓ 로 끝을 넘으면 원래 draft 로 돌아오고 탐색이 끝난다', () => {
    const newest = { matches: entries, index: entries.length - 1, draft: 'my draft' };
    const out = decideArrowKey({ ...base, caretMoved: false, direction: 'next', nav: newest });
    expect(out).toEqual({ kind: 'apply', nav: null, text: 'my draft' });
  });
});

describe('영속 계층', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCommandHistoryStorage(fakeStorage());
  });
  afterEach(() => {
    setCommandHistoryStorage(undefined);
    vi.useRealTimers();
  });

  it('세션마다 따로 저장한다', () => {
    recordCommandHistory('agent-1', 'sub-a', 'a-one');
    recordCommandHistory('agent-1', 'sub-b', 'b-one');
    recordCommandHistory('agent-2', 'sub-a', 'other-agent');
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['a-one']);
    expect(getCommandHistory('agent-1', 'sub-b')).toEqual(['b-one']);
    expect(getCommandHistory('agent-2', 'sub-a')).toEqual(['other-agent']);
    expect(getCommandHistory('agent-1', null)).toEqual([]);
  });

  it('세션당 10개까지만 남는다', () => {
    for (let i = 0; i < 15; i++) recordCommandHistory('agent-1', 'sub-a', `cmd-${i}`);
    const out = getCommandHistory('agent-1', 'sub-a');
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('cmd-5');
    expect(out[9]).toBe('cmd-14');
  });

  it('빈 명령·빈 agentId 는 기록하지 않는다', () => {
    recordCommandHistory('agent-1', 'sub-a', '   ');
    recordCommandHistory('', 'sub-a', 'x');
    expect(hasCommandHistory('agent-1', 'sub-a')).toBe(false);
  });

  it('저장은 debounce 되고 flush 하면 즉시 디스크로 간다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'hello');
    expect(storage.map.get(COMMAND_HISTORY_STORAGE_KEY)).toBeUndefined(); // 아직 안 씀
    flushCommandHistory();
    const raw = storage.map.get(COMMAND_HISTORY_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(parseHistoryStore(raw ?? null).sessions['agent-1|sub-a']?.entries).toEqual(['hello']);
  });

  it('타이머가 지나면 자동 저장된다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'hello');
    vi.advanceTimersByTime(1000);
    expect(storage.map.get(COMMAND_HISTORY_STORAGE_KEY)).toBeDefined();
  });

  it('앱을 다시 켜도(캐시 폐기) 저장된 히스토리를 읽는다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'persisted');
    flushCommandHistory();
    resetCommandHistoryCache();
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['persisted']);
  });

  it('세션을 지우면 그 세션 히스토리만 사라진다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'a-one');
    recordCommandHistory('agent-1', 'sub-b', 'b-one');
    flushCommandHistory();

    dropSessionCommandHistory('agent-1', 'sub-a');
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual([]);
    expect(getCommandHistory('agent-1', 'sub-b')).toEqual(['b-one']);

    flushCommandHistory();
    resetCommandHistoryCache();
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual([]); // 디스크에서도 사라짐
    expect(getCommandHistory('agent-1', 'sub-b')).toEqual(['b-one']);
  });

  it('세션 삭제는 디스크 병합으로도 되살아나지 않는다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'a-one');
    flushCommandHistory();
    dropSessionCommandHistory('agent-1', 'sub-a');
    // 그 사이 다른 창이 옛 상태를 그대로 다시 써 넣어도
    storage.setItem(
      COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify({ v: HISTORY_STORE_VERSION, sessions: { 'agent-1|sub-a': bucket(['a-one'], 9) } }),
    );
    flushCommandHistory();
    resetCommandHistoryCache();
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual([]);
  });

  it('다른 창이 먼저 쓴 기록을 덮지 않고 병합한다', () => {
    const storage = fakeStorage();
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'mine');
    storage.setItem(
      COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify({ v: HISTORY_STORE_VERSION, sessions: { 'agent-1|sub-a': bucket(['theirs'], 9) } }),
    );
    flushCommandHistory();
    expect(parseHistoryStore(storage.getItem(COMMAND_HISTORY_STORAGE_KEY)).sessions['agent-1|sub-a']?.entries)
      .toEqual(['theirs', 'mine']);
  });

  it('저장소가 없어도(메모리 전용) 동작한다', () => {
    setCommandHistoryStorage(null);
    recordCommandHistory('agent-1', 'sub-a', 'memory only');
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['memory only']);
    expect(() => flushCommandHistory()).not.toThrow();
  });

  it('저장이 던져도(용량 초과) 무너지지 않는다', () => {
    const storage = fakeStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    setCommandHistoryStorage(storage);
    recordCommandHistory('agent-1', 'sub-a', 'x');
    expect(() => flushCommandHistory()).not.toThrow();
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['x']);
  });

  it('시드는 저장된 게 없을 때만 채운다', () => {
    seedCommandHistory('agent-1', 'sub-a', ['old-1', 'old-2', '  ', 'old-1']);
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['old-2', 'old-1']); // 중복은 최신 자리로
    seedCommandHistory('agent-1', 'sub-a', ['ignored']);
    expect(getCommandHistory('agent-1', 'sub-a')).toEqual(['old-2', 'old-1']);
  });
});
