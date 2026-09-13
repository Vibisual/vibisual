import { create } from 'zustand';
import { COMMANDS, type CommandId } from '@vibisual/shared';

/**
 * keyPromoter.ts — **"이건 키로도 됩니다"를 마우스가 반복될 때만 알려 준다.**
 *
 * 힌트를 아무리 잘 그려 놔도 사람은 툴팁을 안 본다. JetBrains 의 Key Promoter 가 푼 방식이
 * 유일하게 읽히는 방식이다 — **사용자가 실제로 반복하는 동작**만 골라 정확히 그 순간에 말한다.
 *
 * 규율 셋(없으면 이건 잔소리가 된다):
 *  1. **반복일 때만.** `PROMOTE_AFTER` 회 이상, 그것도 `PROMOTE_WINDOW_MS` 안에 몰렸을 때.
 *  2. **한 번만.** 한 명령은 이 세션에서 한 번 알리고 끝이다(닫으면 다시 안 뜬다).
 *  3. **해제된 명령은 알리지 않는다.** 키가 없는데 "키로도 됩니다"는 거짓말이다.
 *
 * 비영속 — 새로고침하면 카운터가 사라진다(§3.2 에 새 필드 ❌). 잃어도 다음에 다시 세면 된다.
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
