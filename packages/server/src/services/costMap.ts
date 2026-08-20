// SCENARIO.md §5.21 — 비용·토큰 지도.
//
// **새 수집기가 아니다.** 세션 JSONL 증분 스캐너(`readSessionTokenData` — §5.5 컨텍스트 게이지가
// 이미 쓰는 그 함수)가 준 턴들을 §4 v2.38 레지스트리 우선 단가(`calculateTokenCost`)로 환산해
// 원장에 쌓을 뿐이다. 계측 훅을 새로 심지 않고, 트랜스크립트를 우리가 다시 파싱하지도 않는다.
//
// 원장은 **세션 하나**이고 에이전트·프로젝트 합계와 날짜 버킷은 전부 그 원장에서 접은 파생이다.
// 파생을 따로 누적하지 않는 이유는 단순하다 — 두 군데서 더하면 한쪽이 틀어졌을 때 어느 쪽이
// 진실인지 판정할 방법이 없다.

import type {
  CostAgentTotal,
  CostDayBucket,
  CostSessionEntry,
  CostTotals,
  ModelRegistry,
  ProjectCostMap,
  TurnTokenUsage,
} from '@vibisual/shared';
import {
  COST_MAP_AGENTS_MAX,
  COST_MAP_DAYS_MAX,
  COST_MAP_SESSIONS_MAX,
  addCostTotals,
  buildCostPeriodTotals,
  calculateTokenCost,
  costDayKey,
  emptyCostTotals,
  hasCostActivity,
} from '@vibisual/shared';

/** 스윕 한 번에 넘기는 세션 한 줄 — 호출부가 그래프에서 뽑아 채운다. */
export interface CostSweepSession {
  sessionId: string;
  /** 이 세션을 소유한 에이전트 버블 id. */
  agentId?: string;
  /** 그 에이전트의 세션 탭(sub.id). */
  subAgentId?: string;
  /** 표에 보일 이름. */
  label?: string;
  /** 세션 JSONL 을 찾을 기준 폴더. */
  cwd: string;
  /** 이 세션이 속한 프로젝트 이름. */
  projectName: string;
  /** 버블 이름(에이전트 표의 라벨). */
  agentLabel?: string;
}

/** 턴을 읽어 오는 통로 — 테스트가 JSONL 없이 주입할 수 있게 함수로 받는다. */
export type TurnReader = (cwd: string, sessionId: string) => TurnTokenUsage[] | null;

/** 세션 원장 한 줄의 내부 표현(스냅샷에서 `days` 를 떼기 전 원본). */
type LedgerEntry = CostSessionEntry & { days: Record<string, CostTotals> };

/** 턴 하나의 비용 — 그 턴이 말한 모델의 단가로 4종을 각각 환산한다. */
function turnCost(turn: TurnTokenUsage, registry: ModelRegistry | null): number {
  return calculateTokenCost(
    turn.inputTokens,
    turn.outputTokens,
    turn.cacheReadTokens,
    turn.cacheCreateTokens,
    turn.model,
    registry,
  ).total;
}

/** 합계에 턴 하나를 더한 **새** 객체. */
function accrueTurn(base: CostTotals, turn: TurnTokenUsage, registry: ModelRegistry | null): CostTotals {
  return {
    inputTokens: base.inputTokens + turn.inputTokens,
    outputTokens: base.outputTokens + turn.outputTokens,
    cacheReadTokens: base.cacheReadTokens + turn.cacheReadTokens,
    cacheCreateTokens: base.cacheCreateTokens + turn.cacheCreateTokens,
    costUsd: base.costUsd + turnCost(turn, registry),
  };
}

/** 날짜 분해 맵을 복사(얕은 값 객체는 새로 만들지 않고 그대로 재사용 — 아래에서 교체만 한다). */
function copyDays(days: Record<string, CostTotals> | undefined): Record<string, CostTotals> {
  return days ? { ...days } : {};
}

/**
 * §5.21 — 프로젝트별 비용·토큰 지도의 서버측 보관소.
 *
 * 상태는 이 클래스 안에만 있고 바깥으로는 스냅샷/체크포인트 두 모양으로만 나간다.
 */
export class CostMapService {
  private ledgers = new Map<string, Map<string, LedgerEntry>>();
  private retired = new Map<string, CostTotals>();
  private updatedAt = new Map<string, number>();

  /**
   * 세션들을 훑어 원장을 갱신한다. 바뀐 게 있으면 true.
   *
   * 턴 배열은 append-only 이므로 **이미 읽은 턴 수 다음부터만** 이어서 더한다. 파일이 줄어
   * 턴 수가 되레 작아졌으면(재작성·rotate) 그 세션만 처음부터 다시 센다.
   */
  sweep(
    sessions: readonly CostSweepSession[],
    readTurns: TurnReader,
    registry: ModelRegistry | null,
    now: number = Date.now(),
  ): boolean {
    let changed = false;

    for (const s of sessions) {
      if (!s.sessionId || !s.cwd || !s.projectName) continue;

      const ledger = this.ledgers.get(s.projectName) ?? new Map<string, LedgerEntry>();
      const prev = ledger.get(s.sessionId);

      let turns: TurnTokenUsage[] | null = null;
      try {
        turns = readTurns(s.cwd, s.sessionId);
      } catch {
        turns = null;
      }

      // 읽히지 않은 세션 — 원장에 없으면 "측정 없음" 한 줄로 올려 둔다(0 원이 아니라 미측정이다).
      if (!turns || turns.length === 0) {
        if (prev) continue;
        ledger.set(s.sessionId, {
          ...emptyCostTotals(),
          sessionId: s.sessionId,
          ...(s.agentId ? { agentId: s.agentId } : {}),
          ...(s.subAgentId ? { subAgentId: s.subAgentId } : {}),
          projectName: s.projectName,
          ...(s.label ? { label: s.label } : {}),
          turns: 0,
          firstAt: now,
          lastAt: now,
          measured: false,
          days: {},
        });
        this.ledgers.set(s.projectName, ledger);
        changed = true;
        continue;
      }

      // 늘어난 게 없고 소속 정보도 그대로면 건드리지 않는다.
      const sameShape = prev
        && prev.turns === turns.length
        && prev.agentId === s.agentId
        && prev.label === s.label;
      if (sameShape) continue;

      const resume = prev !== undefined && turns.length > prev.turns;
      let totals: CostTotals = resume ? { ...(prev as CostTotals) } : emptyCostTotals();
      const days = resume ? copyDays(prev.days) : {};
      let model = resume ? prev.model : undefined;
      let firstAt = resume ? prev.firstAt : 0;
      let lastAt = resume ? prev.lastAt : 0;

      for (let i = resume ? prev.turns : 0; i < turns.length; i++) {
        const turn = turns[i]!;
        totals = accrueTurn(totals, turn, registry);
        const key = costDayKey(turn.timestamp || now);
        days[key] = accrueTurn(days[key] ?? emptyCostTotals(), turn, registry);
        if (turn.model) model = turn.model;
        if (turn.timestamp) {
          if (!firstAt || turn.timestamp < firstAt) firstAt = turn.timestamp;
          if (turn.timestamp > lastAt) lastAt = turn.timestamp;
        }
      }

      ledger.set(s.sessionId, {
        ...totals,
        sessionId: s.sessionId,
        ...(s.agentId ? { agentId: s.agentId } : {}),
        ...(s.subAgentId ? { subAgentId: s.subAgentId } : {}),
        projectName: s.projectName,
        ...(s.label ? { label: s.label } : {}),
        ...(model ? { model } : {}),
        turns: turns.length,
        firstAt: firstAt || now,
        lastAt: lastAt || now,
        measured: true,
        days,
      });
      this.ledgers.set(s.projectName, ledger);
      this.updatedAt.set(s.projectName, now);
      changed = true;
    }

    if (changed) this.applyCaps();
    return changed;
  }

  /**
   * 키 개수 캡(§9). 밀려난 세션의 몫은 `retired` 로 접히므로 **합계는 줄지 않는다** —
   * 사라지는 것은 "어느 세션이었나"라는 내역뿐이다.
   */
  private applyCaps(): void {
    for (const [projectName, ledger] of this.ledgers) {
      if (ledger.size <= COST_MAP_SESSIONS_MAX) continue;
      const ordered = [...ledger.values()].sort((a, b) => b.lastAt - a.lastAt);
      const drop = ordered.slice(COST_MAP_SESSIONS_MAX);
      let retired = this.retired.get(projectName) ?? emptyCostTotals();
      for (const entry of drop) {
        retired = addCostTotals(retired, entry);
        ledger.delete(entry.sessionId);
      }
      this.retired.set(projectName, retired);
    }
  }

  /** 그 프로젝트의 날짜 버킷 — 세션 원장의 분해를 합쳐 최신 순으로 자른다. */
  private buildDays(projectName: string): CostDayBucket[] {
    const ledger = this.ledgers.get(projectName);
    const acc = new Map<string, CostTotals>();
    if (ledger) {
      for (const entry of ledger.values()) {
        for (const [date, totals] of Object.entries(entry.days)) {
          acc.set(date, addCostTotals(acc.get(date) ?? emptyCostTotals(), totals));
        }
      }
    }
    return [...acc.entries()]
      .map(([date, totals]): CostDayBucket => ({ date, ...totals }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, COST_MAP_DAYS_MAX);
  }

  /** 에이전트 합 — 세션 원장을 `agentId` 로 접는다. 배지가 읽는 값이 여기서 나온다. */
  private buildAgents(projectName: string, now: number): CostAgentTotal[] {
    const ledger = this.ledgers.get(projectName);
    if (!ledger) return [];

    const byAgent = new Map<string, { totals: CostTotals; days: Map<string, CostTotals>; entries: LedgerEntry[] }>();
    for (const entry of ledger.values()) {
      if (!entry.agentId) continue;
      const slot = byAgent.get(entry.agentId)
        ?? { totals: emptyCostTotals(), days: new Map<string, CostTotals>(), entries: [] };
      slot.totals = addCostTotals(slot.totals, entry);
      slot.entries.push(entry);
      for (const [date, totals] of Object.entries(entry.days)) {
        slot.days.set(date, addCostTotals(slot.days.get(date) ?? emptyCostTotals(), totals));
      }
      byAgent.set(entry.agentId, slot);
    }

    const out: CostAgentTotal[] = [];
    for (const [agentId, slot] of byAgent) {
      const latest = slot.entries.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
      const days = [...slot.days.entries()].map(([date, totals]): CostDayBucket => ({ date, ...totals }));
      out.push({
        ...slot.totals,
        agentId,
        ...(latest.label ? { label: latest.label } : {}),
        ...(latest.model ? { model: latest.model } : {}),
        sessions: slot.entries.length,
        turns: slot.entries.reduce((sum, e) => sum + e.turns, 0),
        lastAt: latest.lastAt,
        measured: slot.entries.some((e) => e.measured) && hasCostActivity(slot.totals),
        periods: buildCostPeriodTotals(days, now),
      });
    }
    return out.sort((a, b) => b.costUsd - a.costUsd).slice(0, COST_MAP_AGENTS_MAX);
  }

  /**
   * 프로젝트 한 벌의 지도.
   *
   * `withSessionDays=false`(전선용)면 세션 원장에서 날짜 분해를 뗀다 — 세션 × 날짜라 스냅샷마다
   * 실어 보내기엔 크고, 화면이 쓰는 것은 프로젝트·에이전트 쪽 버킷이다.
   */
  private build(projectName: string, withSessionDays: boolean, now: number): ProjectCostMap {
    const ledger = this.ledgers.get(projectName);
    const days = this.buildDays(projectName);
    const retired = this.retired.get(projectName);

    const sessions: CostSessionEntry[] = ledger
      ? [...ledger.values()]
        .sort((a, b) => b.lastAt - a.lastAt)
        .map((e): CostSessionEntry => (withSessionDays ? { ...e } : (() => {
          const { days: _days, ...rest } = e;
          return rest;
        })()))
      : [];

    // 프로젝트 기간 합계는 날짜 버킷에서 접되, 캡에 밀린 몫(`retired`)은 전체(all)에만 더한다 —
    // 그 몫이 어느 날짜였는지는 이미 잃었으므로 오늘·이번 주에 얹으면 거짓이 된다.
    const periods = buildCostPeriodTotals(days, now);
    if (retired) periods.all = addCostTotals(periods.all, retired);

    return {
      projectName,
      sessions,
      agents: this.buildAgents(projectName, now),
      days,
      periods,
      ...(retired ? { retired } : {}),
      measured: sessions.some((s) => s.measured),
      updatedAt: this.updatedAt.get(projectName) ?? 0,
    };
  }

  /** 전선용(스냅샷) — 세션 날짜 분해 없이. */
  getSnapshot(now: number = Date.now()): ProjectCostMap[] {
    return [...this.ledgers.keys()].map((name) => this.build(name, false, now));
  }

  /** 그 세션이 이미 원장에 있는가 — 조용한 세션을 스윕에서 건너뛸지 판정하는 데 쓴다. */
  hasSession(projectName: string, sessionId: string): boolean {
    return this.ledgers.get(projectName)?.has(sessionId) ?? false;
  }

  /** 체크포인트용 — 세션 날짜 분해 포함. 그 프로젝트에 아무것도 없으면 undefined. */
  toCheckpoint(projectName: string, now: number = Date.now()): ProjectCostMap | undefined {
    if (!this.ledgers.has(projectName)) return undefined;
    return this.build(projectName, true, now);
  }

  /** 체크포인트 복원 — 그 프로젝트의 원장을 통째로 갈아 끼운다. */
  restore(map: ProjectCostMap | undefined): void {
    if (!map?.projectName) return;
    const ledger = new Map<string, LedgerEntry>();
    for (const s of map.sessions ?? []) {
      if (!s.sessionId) continue;
      ledger.set(s.sessionId, { ...s, projectName: map.projectName, days: copyDays(s.days) });
    }
    this.ledgers.set(map.projectName, ledger);
    if (map.retired) this.retired.set(map.projectName, map.retired);
    this.updatedAt.set(map.projectName, map.updatedAt ?? 0);
  }

  /**
   * 멀티프로젝트 부트 병합 — 세션 id 기준 합집합이고, 겹치면 **턴을 더 많이 읽은 쪽**이 이긴다
   * (같은 세션을 두 번 더하지 않기 위해 합산이 아니라 선택이다).
   */
  merge(map: ProjectCostMap | undefined): void {
    if (!map?.projectName) return;
    const ledger = this.ledgers.get(map.projectName) ?? new Map<string, LedgerEntry>();
    for (const s of map.sessions ?? []) {
      if (!s.sessionId) continue;
      const prev = ledger.get(s.sessionId);
      if (prev && prev.turns >= s.turns) continue;
      ledger.set(s.sessionId, { ...s, projectName: map.projectName, days: copyDays(s.days) });
    }
    this.ledgers.set(map.projectName, ledger);
    if (map.retired) {
      const prev = this.retired.get(map.projectName);
      // 양쪽 다 있으면 큰 쪽을 취한다 — 같은 은퇴분을 두 번 더하지 않기 위해서.
      if (!prev || map.retired.costUsd > prev.costUsd) this.retired.set(map.projectName, map.retired);
    }
    this.updatedAt.set(map.projectName, Math.max(this.updatedAt.get(map.projectName) ?? 0, map.updatedAt ?? 0));
    this.applyCaps();
  }

}
