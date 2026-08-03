/**
 * §5.11 v3.88 — 최소 권한(Least Privilege) 판정 — 순수 함수.
 *
 * "필요한 최소한의 권한만, 필요한 최소 시간만"이 원칙이지만, 실제로는 기본값이 전부 켜진 채로 남는다.
 * 여기서는 부여된 도구를 **성격별로 갈라** 보여주고, 되돌릴 수 없는 힘을 몇 개나 쥐고 있는지 센다.
 *
 * 판정은 도구 목록만 본다(치명적 3요소와 같은 규율). 사용 이력 기반 회수 제안은 클라이언트에
 * 에이전트별 도구 사용 집계가 없어 이번 범위에 넣지 않았다 — 없는 데이터를 추측으로 채우면
 * "안 쓰는 도구"를 잘못 지목하게 된다.
 */
import type { AgentConfig } from '@vibisual/shared';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';

export type ToolClass = 'mutating' | 'reach' | 'read' | 'meta';

/** 되돌릴 수 없는 변경을 만들 수 있는 도구. */
const MUTATING = ['Write', 'Edit', 'NotebookEdit', 'Bash'] as const;
/** 바깥 세계에 닿는 도구. */
const REACH = ['WebFetch', 'WebSearch'] as const;
/** 읽기 전용. */
const READ = ['Read', 'Grep', 'Glob'] as const;

export interface LeastPrivilegeVerdict {
  byClass: Record<ToolClass, string[]>;
  /** 되돌릴 수 없는 힘(mutating) + 바깥에 닿는 힘(reach) 의 합 — 권한 폭의 대리 지표. */
  powerCount: number;
  /** 사용자가 명시적으로 막아 둔 도구 — 최소 권한을 실제로 실천한 흔적. */
  denied: string[];
  /** 잠겨 있어 회수할 수 없는 도구(현재 Bash). "왜 못 끄는가"를 설명하기 위해 따로 센다. */
  locked: string[];
  level: 'tight' | 'broad' | 'wide';
}

export function judgeLeastPrivilege(config: AgentConfig | undefined): LeastPrivilegeVerdict {
  const tools = effectiveTools(config);
  const has = (list: readonly string[]): string[] => list.filter((t) => tools.has(t));

  const mutating = has(MUTATING);
  const reach = has(REACH);
  const read = has(READ);
  const meta = [...tools].filter(
    (t) => !MUTATING.includes(t as never) && !REACH.includes(t as never) && !READ.includes(t as never),
  );

  const denied = [...(config?.disallowedTools ?? [])];
  const locked = mutating.filter((t) => t === 'Bash');
  const powerCount = mutating.length + reach.length;

  const level: LeastPrivilegeVerdict['level'] =
    powerCount <= 1 ? 'tight' : powerCount <= 3 ? 'broad' : 'wide';

  return { byClass: { mutating, reach, read, meta }, powerCount, denied, locked, level };
}
