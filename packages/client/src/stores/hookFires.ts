/**
 * hookFires.ts — §5.5 #17-32 ⑤: "방금 이 훅이 울렸다" 를 몇 초 동안 들고 있는 런타임 스토어.
 *
 * `debugSessions`·`runSessions` 와 같은 결의 **비영속 스토어**다 — 발동은 순간의 사건이라
 * 체크포인트·localStorage 어디에도 남지 않는다(앱을 껐다 켜면 아무것도 켜져 있지 않은 게 맞다).
 *
 * 축은 **세션별**이다(사용자 명시 — 통합 목록 ❌). 서버가 실어 보낸 `agentId`/`subAgentId` 를
 * 그대로 들고 있다가, 화면이 자기 에이전트·자기 탭 것만 골라 쓴다.
 *
 * 어느 훅 줄에 불이 켜질지는 여기서 정하지 않는다 — 발동 신호는 (이벤트 · 도구) 두 값뿐이고,
 * 그걸 훅 줄의 `matcher` 와 맞춰 보는 일은 shared 의 `hookMatcherMatches` 가 한다. 이 스토어는
 * "언제 무엇이 울렸나" 만 들고 있으면 된다.
 */
import { create } from 'zustand';
import type { HookFiredPayload } from '@vibisual/shared';

/** 불이 켜져 있는 시간. 사용자가 곁눈으로 보다가 알아챌 만큼은 남고, 계속 깜빡이지는 않는 길이. */
export const HOOK_FIRE_GLOW_MS = 4000;

/**
 * 들고 있는 발동 상한. 훅은 도구를 쓸 때마다 울리므로 상한이 없으면 긴 세션에서 무한히 쌓인다
 * (§9 "캡이 값 길이에만 있고 키 개수엔 없다" 는 그 함정). 오래된 것부터 버린다.
 */
const MAX_FIRES = 200;

interface HookFiresState {
  /** 최근 발동들(최신이 뒤). 만료된 것은 `prune` 이 걷어낸다. */
  fires: HookFiredPayload[];
  /** 화면이 다시 그릴 이유 — 목록이 바뀔 때마다 오른다. */
  version: number;

  applyFired: (payloads: HookFiredPayload[]) => void;
  /** 만료된 발동을 걷어낸다. 바뀐 게 없으면 상태를 건드리지 않는다(헛 리렌더 ❌). */
  prune: (now?: number) => void;
}

export const useHookFires = create<HookFiresState>((set) => ({
  fires: [],
  version: 0,

  applyFired: (payloads) =>
    set((s) => {
      if (payloads.length === 0) return s;
      const cutoff = Date.now() - HOOK_FIRE_GLOW_MS;
      // 같은 (세션·이벤트·도구) 조합은 마지막 발동만 들고 있으면 된다 — 불은 어차피 하나다.
      const next = s.fires.filter((f) => {
        if (f.at < cutoff) return false;
        return !payloads.some((p) => fireKey(p) === fireKey(f));
      });
      next.push(...payloads);
      return {
        fires: next.length > MAX_FIRES ? next.slice(next.length - MAX_FIRES) : next,
        version: s.version + 1,
      };
    }),

  prune: (now = Date.now()) =>
    set((s) => {
      const cutoff = now - HOOK_FIRE_GLOW_MS;
      const next = s.fires.filter((f) => f.at >= cutoff);
      if (next.length === s.fires.length) return s;
      return { fires: next, version: s.version + 1 };
    }),
}));

/** 같은 불로 볼 조합. 세션까지 넣어야 옆 세션의 발동이 내 줄을 켜지 않는다. */
function fireKey(f: HookFiredPayload): string {
  return `${f.agentId ?? ''}|${f.subAgentId ?? ''}|${f.event}|${f.toolName ?? ''}`;
}

/**
 * 이 발동이 **지금 보고 있는 세션의 것**인가.
 *
 * 서버가 탭(sub)까지 알아내지 못하는 세션도 있다(외부 에디터가 띄운 훅 세션은 탭이 없다).
 * 그때는 에이전트 단위까지만 좁힌다 — 정확도를 조금 잃는 편이, 알 수 없다는 이유로 불을
 * 아예 안 켜서 기능이 죽은 것처럼 보이는 것보다 낫다.
 */
export function fireBelongsToSession(
  fire: HookFiredPayload,
  agentId: string | null,
  activeSessionId: string | null,
): boolean {
  // 아직 어느 에이전트를 보고 있는지 모르면 켤 줄도 없다.
  if (!agentId || fire.agentId !== agentId) return false;
  if (!fire.subAgentId || !activeSessionId) return true;
  return fire.subAgentId === activeSessionId;
}
