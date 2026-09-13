import { create } from 'zustand';
import {
  COMMANDS,
  COMMAND_IDS,
  defaultKeymap,
  normalizeKeymapOverrides,
  resolveKeymap,
  type CommandId,
  type KeymapOverrides,
} from '@vibisual/shared';

/**
 * §6 — **지금 이 앱에서 실제로 도는 단축키.**
 *
 * 정본 표는 `shared/keymap.ts` 의 `COMMANDS` 이고, 이 스토어가 들고 있는 것은 **사용자가 바꾼
 * 것만**(`overrides`)이다. 기본값은 코드에 있으므로 여기 오지 않는다 — 그래야 다음 판올림에서
 * 기본 바인딩을 고치면 사용자가 안 건드린 칸이 자동으로 새 값을 따라간다.
 *
 * **`graphStore` 에 넣지 않는다**(`linkFocus`·`canvasVisibility` 와 같은 이유). 단축키는
 * 프로젝트가 아니라 **기계**의 것이라 스냅샷·체크포인트와 무관하고, 저쪽은 스냅샷 1건에 `set()`
 * 이 수십 번 도는 자리라 여기 구독을 얹으면 키를 누를 때마다 그 통지에 묻어 다시 계산된다.
 *
 * 영속은 서버(`~/.vibisual/app-state.json`)다 — 창이 여럿이면 WS `keymap_updated` 로 다른 창도
 * 즉시 같은 키를 쓴다(창마다 다른 단축키가 되면 그게 곧 버그 신고다).
 */

interface KeymapState {
  /** 사용자가 바꾼 것만. `null` = 해제(키보드에서 내림). */
  overrides: KeymapOverrides;
  /** 기본값 + 덮어쓰기 = 지금 도는 바인딩. **디스패처가 매 키 입력마다 읽는 값이다.** */
  resolved: Record<CommandId, string | null>;
  /** 서버에서 한 번이라도 받아 왔는가(설정 화면이 "아직 로딩 중"을 구분한다). */
  loaded: boolean;

  /** 서버·WS 에서 온 덮어쓰기를 반영. */
  applyOverrides: (raw: unknown) => void;
  /** 최초 1회 서버에서 읽어 온다. */
  fetchKeymap: () => Promise<void>;
  /** 바인딩 하나를 바꾼다(`null` = 해제). 화면을 먼저 옮기고 저장은 뒤따른다. */
  setBinding: (id: CommandId, binding: string | null) => Promise<void>;
  /** 그 명령만 기본값으로. */
  resetBinding: (id: CommandId) => Promise<void>;
  /** 전부 기본값으로. */
  resetAll: () => Promise<void>;
}

/** 두 덮어쓰기가 같은가(불필요한 리렌더·저장을 막는다). */
function sameOverrides(a: KeymapOverrides, b: KeymapOverrides): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  overrides: {},
  resolved: resolveKeymap({}),
  loaded: false,

  applyOverrides: (raw) => {
    const overrides = normalizeKeymapOverrides(raw);
    // 같은 값이면 통지하지 않는다 — `resolved` 는 디스패처가 매 키 입력마다 읽는 참조라
    // 무의미하게 갈아끼우면 그것을 구독하는 힌트 전부가 함께 다시 그려진다.
    if (get().loaded && sameOverrides(get().overrides, overrides)) return;
    set({ overrides, resolved: resolveKeymap(overrides), loaded: true });
  },

  fetchKeymap: async () => {
    try {
      const r = await fetch('/api/keymap');
      const data = await r.json() as { overrides?: unknown };
      get().applyOverrides(data?.overrides ?? {});
    } catch {
      // 못 읽으면 기본 바인딩 그대로 — 단축키가 통째로 죽는 것보다 낫다.
      set({ loaded: true });
    }
  },

  setBinding: async (id, binding) => {
    // 화면을 기다리게 하지 않는다. 저장이 실패하면 다음 `keymap_updated`·재조회가 되돌린다.
    const next: KeymapOverrides = { ...get().overrides, [id]: binding };
    set({ overrides: next, resolved: resolveKeymap(next) });
    try {
      const r = await fetch('/api/keymap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: { [id]: binding } }),
      });
      const data = await r.json() as { overrides?: unknown };
      if (data?.overrides) get().applyOverrides(data.overrides);
    } catch { /* 저장 실패 — 서버가 진짜 값을 다시 보내 줄 때 맞춰진다 */ }
  },

  resetBinding: async (id) => {
    const next = { ...get().overrides };
    delete next[id];
    set({ overrides: next, resolved: resolveKeymap(next) });
    try {
      const r = await fetch('/api/keymap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: [id] }),
      });
      const data = await r.json() as { overrides?: unknown };
      if (data?.overrides) get().applyOverrides(data.overrides);
    } catch { /* 위와 같음 */ }
  },

  resetAll: async () => {
    set({ overrides: {}, resolved: resolveKeymap({}) });
    try {
      const r = await fetch('/api/keymap', { method: 'DELETE' });
      const data = await r.json() as { overrides?: unknown };
      if (data?.overrides) get().applyOverrides(data.overrides);
    } catch { /* 위와 같음 */ }
  },
}));

/**
 * 지금 그 명령에 배정된 바인딩. 없으면(해제) `null`.
 *
 * ⚠ **선택자는 문자열 하나를 돌려준다** — `resolved` 객체째 구독하면 아무 명령이나 바뀔 때마다
 * 모든 힌트가 다시 그려진다(§9 "버블은 자기 키만 구독"과 같은 규율).
 */
export function selectBinding(id: CommandId) {
  return (s: KeymapState): string | null => s.resolved[id];
}

/** 그 명령이 기본값에서 바뀌었는가(설정 화면의 "변경한 것만 보기"). */
export function isRemapped(overrides: KeymapOverrides, id: CommandId): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, id);
}

/** 내보내기용 — 사용자가 바꾼 것만 담은 한 장(기기를 옮겨도 손이 안 바뀐다). */
export function exportKeymap(overrides: KeymapOverrides): string {
  return JSON.stringify({ version: 1, keymap: overrides }, null, 2);
}

/** 가져오기 — 모르는 명령·못 읽는 바인딩은 shared 정규화가 버린다. 못 읽으면 `null`. */
export function parseKeymapImport(text: string): KeymapOverrides | null {
  try {
    const parsed = JSON.parse(text) as { keymap?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return null;
    // 통째로 `{ "canvas.copy": "Ctrl+X" }` 형태로 붙여 넣는 사람도 있다 — 둘 다 받는다.
    const raw = parsed.keymap ?? parsed;
    return normalizeKeymapOverrides(raw);
  } catch {
    return null;
  }
}

/** 표를 그리는 쪽이 쓰는 목록(스코프 순 → 표 순서). */
export function commandsInScopeOrder(): CommandId[] {
  return [...COMMAND_IDS].sort((a, b) => {
    const sa = COMMANDS[a].scope;
    const sb = COMMANDS[b].scope;
    if (sa === sb) return COMMAND_IDS.indexOf(a) - COMMAND_IDS.indexOf(b);
    return 0;
  });
}

/** 기본 바인딩(설정 화면의 "되돌리기" 미리보기). */
export const DEFAULT_KEYMAP = defaultKeymap();
