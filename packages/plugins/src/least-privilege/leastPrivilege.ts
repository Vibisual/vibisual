/**
 * §5.11 — 최소 권한(Least Privilege) 판정, 순수 함수: 부여된 도구를 성격별로 갈라 되돌릴 수 없는 힘을 몇 개 쥐었는지 센다.
 * 도구 목록만 본다(치명적 3요소와 같은 규율). 사용 이력 기반 회수 제안은 넣지 않는다 — 클라에 에이전트별 도구 사용 집계가 없어, 추측하면 "안 쓰는 도구"를 잘못 지목한다.
 */
import type { AgentConfig } from '@vibisual/shared';
import { effectiveTools } from '../sdk/index.js';

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
