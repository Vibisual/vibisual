import { RECENT_USE_RING } from '@vibisual/shared';

/** 한 에이전트의 접촉 장부 — 경로 → 쓰임 도장. Map 순서가 최근 순이라 넘치면 앞(오래된 것)부터 버린다. */
interface AgentRecentUse {
  stamps: Map<string, number>;
  /** 지금 쓰임이 시작된 시각과 그 도장. `sameUseMs` 를 넘기면 새 도장을 뗀다(이어지는 접촉끼리 끝없이 묶이지 않게 시작 시각 기준). */
  useStartedAt: number;
  stamp: number;
}

export interface RecentUseLedgerOptions {
  sameUseMs: number;
  max: number;
}

/**
 * §5.1 #3-5 — 에이전트별 최근 사용 순서. 버블의 `lastActivity` 는 누가 만졌든 하나라 함께 쓴 버블의 에이전트별 순위를 못 낸다.
 * 메모리 전용 관찰이다(체크포인트 ❌) — 링은 일하는 에이전트에만 두르므로 재시작 뒤 첫 쓰임부터 다시 쌓여도 잃는 그림이 없다.
 */
export class RecentUseLedger {
  private readonly agents = new Map<string, AgentRecentUse>();
  private readonly opts: RecentUseLedgerOptions;

  constructor(opts?: Partial<RecentUseLedgerOptions>) {
    this.opts = { sameUseMs: RECENT_USE_RING.sameUseMs, max: RECENT_USE_RING.ledgerMax, ...opts };
  }

  /** 쓰임 한 번 — 파일과 그 조상 폴더처럼 한 도구 호출이 잇달아 만지는 경로는 같은 도장을 받아 같은 순위가 된다. */
  touch(agentId: string, path: string, now: number): void {
    let led = this.agents.get(agentId);
    if (!led) {
      led = { stamps: new Map(), useStartedAt: Number.NEGATIVE_INFINITY, stamp: 0 };
      this.agents.set(agentId, led);
    }
    if (now - led.useStartedAt > this.opts.sameUseMs) {
      led.useStartedAt = now;
      // 시계가 뒤로 가도 새 쓰임은 늘 앞선 도장보다 크다.
      led.stamp = Math.max(now, led.stamp + 1);
    }
    led.stamps.delete(path);
    led.stamps.set(path, led.stamp);
    while (led.stamps.size > this.opts.max) {
      const oldest = led.stamps.keys().next().value;
      if (oldest === undefined) break;
      led.stamps.delete(oldest);
    }
  }

  /** 버블이 합쳐지거나(명령 앱) 접합이 자손을 대신 서면 그 자리는 새로 쓴 것이 아니라 자손의 쓰임을 물려받는다. */
  inherit(agentId: string, from: string, to: string): void {
    const led = this.agents.get(agentId);
    const stamp = led?.stamps.get(from);
    if (!led || stamp === undefined) return;
    if ((led.stamps.get(to) ?? Number.NEGATIVE_INFINITY) < stamp) led.stamps.set(to, stamp);
  }

  forgetAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * 그 에이전트의 최근 쓰임 `limit` 번 안에 든 경로 → 순위(0 = 가장 최근). 순위는 버블 수가 아니라 **쓰임** 단위다 —
   * 한 번의 쓰임에 파일과 폴더가 함께 서면 둘은 같은 순위다. `isLive` 가 아닌 경로(지워진 버블 등)는 자리를 차지하지 않는다.
   */
  ranks(agentId: string, limit: number, isLive: (path: string) => boolean): Map<string, number> {
    const out = new Map<string, number>();
    const led = this.agents.get(agentId);
    if (!led || limit <= 0) return out;
    const live: Array<[string, number]> = [];
    for (const entry of led.stamps) if (isLive(entry[0])) live.push(entry);
    const recent = [...new Set(live.map(([, stamp]) => stamp))].sort((a, b) => b - a).slice(0, limit);
    const rankOf = new Map(recent.map((stamp, i) => [stamp, i]));
    for (const [path, stamp] of live) {
      const rank = rankOf.get(stamp);
      if (rank !== undefined) out.set(path, rank);
    }
    return out;
  }
}
