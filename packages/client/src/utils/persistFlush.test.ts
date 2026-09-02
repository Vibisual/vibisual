/**
 * persistFlush.test.ts — "종료 직전 400ms 안에 친 글자를 잃지 않는다" 회귀.
 *
 * 초안 저장소들은 타이핑 핫패스를 지키려고 debounce 로 localStorage 에 쓴다. 그래서 **debounce 가
 * 아직 안 터진 상태에서 앱이 닫히면** 그 글자는 없던 것이 된다 — 종전에는 `pagehide`/`beforeunload`
 * 가 그 자리를 메우기로 돼 있었는데, 앱 종료가 `app.exit(0)` 이라 그 이벤트가 뜨지 않았다.
 * 이 파일은 그 자리를 메운 창구(`flushAllPersisted`)가 실제로 저장소까지 밀어 넣는지를 고정한다.
 *
 * ⚠ **DOM 없이 돈다** — 이 패키지에는 jsdom·happy-dom 이 없다(전 테스트가 node 환경이다).
 *   저장소 모듈들은 `typeof window === 'undefined'` 를 스스로 보고 리스너 등록을 건너뛰므로,
 *   저장소만 대역으로 갈아 끼우면 영속 계층은 그대로 검증된다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerPersistFlush,
  flushAllPersisted,
  persistFlushCount,
  installPersistFlushBridge,
} from './persistFlush.js';

/** 이 파일이 등록한 것만 걷어 내기 위한 해제 목록(앱 모듈이 올린 것은 건드리지 않는다). */
let cleanups: Array<() => void> = [];

function track(fn: () => void): void {
  cleanups.push(registerPersistFlush(fn));
}

/** 메모리 localStorage 대역 — 저장소 모듈이 쓰는 세 함수만. */
function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => { map.set(k, v); },
    removeItem: (k: string): void => { map.delete(k); },
    get size(): number { return map.size; },
  };
}

beforeEach(() => {
  cleanups = [];
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  vi.unstubAllGlobals();
});

describe('flushAllPersisted', () => {
  it('올라온 flush 를 전부 부른다', () => {
    const a = vi.fn();
    const b = vi.fn();
    const before = persistFlushCount();
    track(a);
    track(b);

    expect(persistFlushCount()).toBe(before + 2);
    flushAllPersisted();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('하나가 던져도 나머지는 민다(규약 2 — 한 저장소의 실패가 남의 손글씨를 잃게 하지 않는다)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = vi.fn(() => { throw new Error('QuotaExceededError'); });
    const after = vi.fn();
    track(boom);
    track(after);

    expect(() => flushAllPersisted()).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('해제하면 더는 불리지 않는다', () => {
    const a = vi.fn();
    const off = registerPersistFlush(a);

    off();
    flushAllPersisted();
    expect(a).not.toHaveBeenCalled();
  });

  it('여러 번 불려도 안전하다(규약 3 — before-quit 와 pagehide 가 겹칠 수 있다)', () => {
    const a = vi.fn();
    track(a);

    flushAllPersisted();
    flushAllPersisted();
    expect(a).toHaveBeenCalledTimes(2); // no-op 판정은 각 저장소의 몫 — 창구는 그냥 두 번 부른다
  });

  it('순회 중 새로 등록돼도 터지지 않는다(사본 순회)', () => {
    const later = vi.fn();
    track(() => { track(later); });

    expect(() => flushAllPersisted()).not.toThrow();
    // 이번 회차에는 안 불리고 다음 회차부터 불린다.
    expect(later).not.toHaveBeenCalled();
    flushAllPersisted();
    expect(later).toHaveBeenCalled();
  });
});

describe('installPersistFlushBridge', () => {
  it('window 자체가 없으면(테스트·SSR) 조용히 아무것도 하지 않는다', () => {
    expect(() => installPersistFlushBridge()()).not.toThrow();
  });

  it('window.api 가 없으면(웹 모드) 조용히 아무것도 하지 않는다', () => {
    vi.stubGlobal('window', {});
    expect(() => installPersistFlushBridge()()).not.toThrow();
  });

  it('구버전 preload(lifecycle 부재)에서도 터지지 않는다', () => {
    vi.stubGlobal('window', { api: {} });
    expect(() => installPersistFlushBridge()()).not.toThrow();
  });

  it('main 의 물음이 오면 올라온 flush 를 전부 부른다', () => {
    // 콜백 안에서 대입하는 값은 tsc 가 `never` 로 좁히므로 객체 칸에 담는다.
    const captured: { handler: (() => void) | null } = { handler: null };
    const off = vi.fn();
    vi.stubGlobal('window', {
      api: { lifecycle: { onFlushDrafts: (cb: () => void) => { captured.handler = cb; return off; } } },
    });

    const a = vi.fn();
    track(a);
    const dispose = installPersistFlushBridge();

    expect(captured.handler).toBeTypeOf('function');
    captured.handler?.();
    expect(a).toHaveBeenCalledTimes(1);

    dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });
});

// ─── 실제 저장소와의 종단 회귀 ───
//
// 여기가 핵심이다. 위 단위 테스트는 창구만 보지만, 실제로 잃던 것은 **debounce 가 아직 안 터진
// 초안**이었다. 저장소를 진짜로 import 해서 "쓰고 → 곧바로 종료 flush → 저장소에 있다"를 확인한다.
// 저장소가 창구에 자기를 올리는 그 한 줄이 빠지면 여기서 잡힌다.

describe('세션 폼 초안(§5.5 ⑬) — debounce 가 안 터진 상태에서 종료해도 남는다', () => {
  it('setDraft 직후 flushAllPersisted() 면 저장소에 앉는다', async () => {
    vi.useFakeTimers();
    const store = memStorage();
    vi.stubGlobal('localStorage', store);
    try {
      const { useSessionFormDraftStore, sessionFormDraftKey, SESSION_FORM_DRAFT_STORAGE_KEY } =
        await import('../stores/sessionFormDrafts.js');

      useSessionFormDraftStore
        .getState()
        .patchFormDraft(sessionFormDraftKey('ide.loop', 'agent-1|sess-1'), { body: '아직 안 보낸 문장' });

      // debounce 창이 아직 안 터졌다 = 종전이라면 여기서 앱이 닫히면 사라지던 자리.
      expect(store.getItem(SESSION_FORM_DRAFT_STORAGE_KEY)).toBeNull();

      flushAllPersisted();

      const raw = store.getItem(SESSION_FORM_DRAFT_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(raw).toContain('아직 안 보낸 문장');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── 구조 회귀 — 앞으로 생길 저장소도 자동으로 걸린다 ───
//
// 위 두 종단 테스트는 지금 있는 저장소 둘을 본다. 그런데 이 결함의 본질은 **"`beforeunload` 에만
// 기대면 앱 종료에서는 안 돈다"** 이고, 그건 새로 만드는 저장소에서 똑같이 재발한다.
// 그래서 소스를 훑어 **`beforeunload` 로 flush 하는 함수는 종료 창구에도 올라와 있어야 한다**를
// 못 박는다. `node:fs` 는 쓰지 않는다 — 클라이언트 tsconfig 에 Node 타입이 없다
// (`typographyFloor.test.ts` 와 같은 제약·같은 수법).

const tsSources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true });
const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/**
 * `beforeunload` 예외 — **초안 저장이 아닌** 핸들러.
 * 키는 `<src 기준 경로>::<핸들러 이름>`. 넣을 때는 반드시 이유를 적는다.
 */
const BEFOREUNLOAD_EXCEPTIONS: Record<string, string> = {
  'components/BubbleMap/BubbleMap.tsx::handleUnload':
    '버블 좌표를 서버로 보내는 네트워크 flush(sendBeacon/fetch) — localStorage 초안이 아니고, ' +
    '종료 정리에서는 IPC 창구가 이미 닫혀 있어 같은 창구에 태울 수 없다(별도 축).',
};

function collectClientSources(): { path: string; text: string }[] {
  const all = { ...tsSources, ...tsxSources } as Record<string, string>;
  return Object.entries(all)
    .map(([key, text]) => ({ path: key.replace(/^\.\.\//, ''), text }))
    .filter(({ path }) => !/\.test\.tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('구조 — beforeunload flush 는 종료 창구에도 올라와 있어야 한다', () => {
  it('소스를 실제로 읽어 온다(glob 이 비면 이 검사가 조용히 통과한다)', () => {
    expect(collectClientSources().length).toBeGreaterThan(50);
  });

  it('`beforeunload` 로 미는 함수는 registerPersistFlush 에도 올라와 있다', () => {
    const violations: string[] = [];

    for (const { path, text } of collectClientSources()) {
      const re = /window\.addEventListener\(\s*['"]beforeunload['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const fn = m[1];
        if (!fn) continue;
        if (BEFOREUNLOAD_EXCEPTIONS[`${path}::${fn}`]) continue;
        const registered = new RegExp(`registerPersistFlush\\(\\s*${fn}\\s*\\)`).test(text);
        if (!registered) {
          violations.push(
            `${path}: \`${fn}\` 이 beforeunload 로만 flush 된다. ` +
            '앱 종료는 app.exit(0) 이라 그 이벤트가 안 뜬다 — `registerPersistFlush(' + fn + ')` 를 ' +
            '함께 올리거나, 초안 저장이 아니면 BEFOREUNLOAD_EXCEPTIONS 에 이유와 함께 등록하라.',
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('예외 표에 죽은 항목이 남아 있지 않다', () => {
    const sources = collectClientSources();
    const stale = Object.keys(BEFOREUNLOAD_EXCEPTIONS).filter((key) => {
      const [path, fn] = key.split('::');
      const src = sources.find((s) => s.path === path);
      if (!src || !fn) return true;
      return !new RegExp(`window\\.addEventListener\\(\\s*['"]beforeunload['"]\\s*,\\s*${fn}\\s*\\)`).test(src.text);
    });

    expect(stale).toEqual([]);
  });
});

describe('명령 히스토리(§5.5 #17-23) — debounce 가 안 터진 상태에서 종료해도 남는다', () => {
  it('recordCommandHistory 직후 flushAllPersisted() 면 저장소에 앉는다', async () => {
    vi.useFakeTimers();
    const store = memStorage();
    try {
      const mod = await import('../components/IDE/commandHistory.js');
      mod.setCommandHistoryStorage(store);

      mod.recordCommandHistory('agent-1', 'sess-1', '방금 보낸 프롬프트');
      expect(store.getItem(mod.COMMAND_HISTORY_STORAGE_KEY)).toBeNull();

      flushAllPersisted();

      const raw = store.getItem(mod.COMMAND_HISTORY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(raw).toContain('방금 보낸 프롬프트');

      mod.setCommandHistoryStorage(undefined); // 다음 테스트로 새지 않게 원복
    } finally {
      vi.useRealTimers();
    }
  });
});
