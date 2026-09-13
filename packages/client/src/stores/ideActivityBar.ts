import { create } from 'zustand';
import {
  moveActivityItem,
  normalizeIDEActivityBarPrefs,
  resolveActivityOrder,
  type IDEActivityBarPrefs,
} from '@vibisual/shared';
import { DEFAULT_ACTIVITY_ORDER } from '../components/IDE/ideActivityItems.js';
import type { IDEViewType } from './graphStore.js';

/**
 * §5.5 #16-1 — **사용자가 만들어 둔 IDE 활동바 배치**(순서 + 내려놓은 항목).
 *
 * `graphStore` 에 넣지 않는다(`keymap` 과 같은 이유). 활동바 배치는 프로젝트가 아니라 **그 사람**의
 * 것이라 스냅샷·체크포인트와 무관하고, 저쪽은 스냅샷 1건에 `set()` 이 수십 번 도는 자리라 여기
 * 구독을 얹으면 활동바가 매 스냅샷마다 다시 그려진다.
 *
 * 영속은 서버(`~/.vibisual/app-state.json`)다 — 창이 여럿이면 WS `ide_activity_bar_updated` 로
 * 다른 창도 즉시 같은 배치를 쓴다(창마다 항목 순서가 다르면 그게 곧 버그 신고다).
 */

interface IDEActivityBarState {
  /** 사용자가 끌어 만든 순서. 비어 있으면 코드의 기본 순서 그대로. */
  order: IDEViewType[];
  /** 활동바에서 내려놓은 항목(지운 것이 아니라 접어 둔 것 — 구성 패널에 그대로 남는다). */
  hidden: IDEViewType[];
  /** 서버에서 한 번이라도 받아 왔는가. */
  loaded: boolean;

  /** 서버·WS 에서 온 구성을 반영. */
  applyPrefs: (raw: unknown) => void;
  /** 최초 1회 서버에서 읽어 온다. */
  fetchPrefs: () => Promise<void>;
  /** 순서 전체를 치환(드래그·화살표가 만든 최종 순서를 그대로 보낸다). */
  setOrder: (order: readonly IDEViewType[]) => Promise<void>;
  /** 한 항목을 뽑아 다른 자리에 꽂는다(`to` 는 뽑기 전 기준 인덱스). */
  moveItem: (from: number, to: number) => Promise<void>;
  /** 그 항목을 활동바에서 내려놓거나 도로 올린다. */
  setHiddenState: (view: IDEViewType, hidden: boolean) => Promise<void>;
  /** 기본 배치로 되돌린다(순서·제외 둘 다). */
  resetPrefs: () => Promise<void>;
}

/** 두 목록이 같은가(불필요한 리렌더·저장을 막는다). */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 아는 뷰만 남긴다 — 저장분에는 판올림에서 사라진 옛 이름이 섞여 있을 수 있다. */
function knownViews(list: readonly string[] | undefined): IDEViewType[] {
  const known = new Set<string>(DEFAULT_ACTIVITY_ORDER);
  return (list ?? []).filter((v): v is IDEViewType => known.has(v));
}

/** 서버에 보낼 본문. 실패해도 화면은 이미 옮겨 놓았다(다음 조회·WS 가 진짜 값을 되돌린다). */
async function put(body: Record<string, unknown>): Promise<unknown> {
  try {
    const r = await fetch('/api/ide-activity-bar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json() as { prefs?: unknown };
    return data?.prefs;
  } catch {
    return undefined; // 저장 실패 — 서버가 진짜 값을 다시 보내 줄 때 맞춰진다.
  }
}

export const useIDEActivityBarStore = create<IDEActivityBarState>((set, get) => ({
  order: [],
  hidden: [],
  loaded: false,

  applyPrefs: (raw) => {
    const prefs: IDEActivityBarPrefs = normalizeIDEActivityBarPrefs(raw) ?? {};
    const order = knownViews(prefs.order);
    const hidden = knownViews(prefs.hidden);
    // 같은 값이면 통지하지 않는다 — 활동바는 IDE 창마다 하나씩 떠 있어 무의미한 통지가 곱해진다.
    if (get().loaded && sameList(get().order, order) && sameList(get().hidden, hidden)) return;
    set({ order, hidden, loaded: true });
  },

  fetchPrefs: async () => {
    try {
      const r = await fetch('/api/ide-activity-bar');
      const data = await r.json() as { prefs?: unknown };
      get().applyPrefs(data?.prefs ?? {});
    } catch {
      // 못 읽으면 기본 배치 그대로 — 활동바가 통째로 비는 것보다 낫다.
      set({ loaded: true });
    }
  },

  setOrder: async (order) => {
    const next = knownViews(order);
    if (sameList(get().order, next)) return;
    set({ order: next }); // 화면을 기다리게 하지 않는다.
    const prefs = await put({ order: next });
    if (prefs) get().applyPrefs(prefs);
  },

  moveItem: async (from, to) => {
    // 저장분이 비어 있으면(한 번도 안 만짐) 지금 그리는 순서를 기준으로 삼는다 —
    // 그러지 않으면 첫 드래그가 빈 배열 위에서 돌아 아무 일도 일어나지 않는다.
    const base = get().order.length > 0
      ? get().order
      : resolveActivityOrder(undefined, DEFAULT_ACTIVITY_ORDER) as IDEViewType[];
    await get().setOrder(moveActivityItem(base, from, to) as IDEViewType[]);
  },

  setHiddenState: async (view, hidden) => {
    const cur = get().hidden;
    const next = hidden ? (cur.includes(view) ? cur : [...cur, view]) : cur.filter((v) => v !== view);
    if (sameList(cur, next)) return;
    set({ hidden: next });
    const prefs = await put({ hidden: next });
    if (prefs) get().applyPrefs(prefs);
  },

  resetPrefs: async () => {
    set({ order: [], hidden: [] });
    const prefs = await put({ reset: true });
    if (prefs) get().applyPrefs(prefs);
  },
}));

/**
 * **지금 활동바에 그릴 순서** — 저장된 순서 + 판올림에서 새로 생긴 칸.
 *
 * ⚠ 선택자가 매번 새 배열을 만들면 zustand 가 참조 비교로 "바뀌었다"고 판정해 무한 리렌더가 된다
 * (§9 파생 선택자 함정). 그래서 **입력이 같으면 같은 배열을 돌려주도록** 한 벌만 캐시한다.
 */
let orderMemo: { key: string; value: IDEViewType[] } | null = null;

export function selectActivityOrder(s: IDEActivityBarState): IDEViewType[] {
  const key = s.order.join(',');
  if (orderMemo && orderMemo.key === key) return orderMemo.value;
  const value = resolveActivityOrder(s.order, DEFAULT_ACTIVITY_ORDER) as IDEViewType[];
  orderMemo = { key, value };
  return value;
}

/** 이 항목이 지금 활동바에서 내려가 있는가. 원시값(boolean) 하나만 구독한다. */
export function selectIsHidden(view: IDEViewType) {
  return (s: IDEActivityBarState): boolean => s.hidden.includes(view);
}
