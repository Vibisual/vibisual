import { create } from 'zustand';
import { COMMANDS, type CommandId } from '@vibisual/shared';

/**
 * "이건 키로도 됩니다"를 **마우스 동작이 반복될 때만** 알린다(JetBrains Key Promoter): `PROMOTE_WINDOW_MS` 안에 `PROMOTE_AFTER` 회 이상 ·
 * 명령당 세션에 한 번 · 해제된(키 없는) 명령은 ❌. 비영속(§3.2 새 필드 ❌).
 */

/** 이 횟수부터 알린다. */
export const PROMOTE_AFTER = 3;
/** 이 시간 안에 몰린 것만 "반복"으로 센다(ms). */
export const PROMOTE_WINDOW_MS = 90_000;
/** 토스트가 스스로 사라지기까지(ms). */
export const PROMOTE_TOAST_MS = 6_000;

interface KeyPromoterState {
  /** 지금 알리는 명령. 없으면 `null`. */
  current: CommandId | null;
  /** 명령별 최근 마우스 사용 시각들(창 안의 것만 남는다). */
  hits: Partial<Record<CommandId, number[]>>;
  /** 이미 알린 명령 — 두 번은 알리지 않는다. */
  promoted: Partial<Record<CommandId, true>>;

  /** 그 동작을 **마우스로** 했다고 신고. 조건이 차면 `current` 가 선다. */
  notePointerUse: (id: CommandId, now?: number) => void;
  dismiss: () => void;
  /** 테스트 전용 — 카운터를 비운다. */
  reset: () => void;
}

export const useKeyPromoterStore = create<KeyPromoterState>((set, get) => ({
  current: null,
  hits: {},
  promoted: {},

  notePointerUse: (id, now = Date.now()) => {
    if (get().promoted[id]) return;
    const prev = get().hits[id] ?? [];
    const recent = [...prev.filter((at) => now - at <= PROMOTE_WINDOW_MS), now];
    const hits = { ...get().hits, [id]: recent };
    if (recent.length < PROMOTE_AFTER) { set({ hits }); return; }
    set({
      hits: { ...hits, [id]: [] },
      promoted: { ...get().promoted, [id]: true },
      current: id,
    });
  },

  dismiss: () => set({ current: null }),
  reset: () => set({ current: null, hits: {}, promoted: {} }),
}));

/** 알려도 되는 명령인가 — 표에 있고 키가 붙어 있어야 한다. */
export function isPromotable(id: CommandId, binding: string | null): boolean {
  return !!binding && Object.prototype.hasOwnProperty.call(COMMANDS, id);
}

/** 컴포넌트 밖(이벤트 처리기 안)에서 부르는 짧은 창구. */
export function notePointerUse(id: CommandId): void {
  useKeyPromoterStore.getState().notePointerUse(id);
}
