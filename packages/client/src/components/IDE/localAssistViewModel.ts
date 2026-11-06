import type { LocalAssistOptions, LocalAssistPreset, LocalPlanSummary, SessionLoop } from '@vibisual/shared';

/** §5.19 (J) ④ — 화면에 보일 계획 상태. 서버의 running 은 릴레이 루프가 실제로 켜져 있을 때만 running(멈췄으면 paused). */
export type PlanDisplayState = 'proposed' | 'approved' | 'running' | 'paused' | 'done';

export function planDisplayState(plan: LocalPlanSummary, loop: SessionLoop | undefined): PlanDisplayState {
  if (plan.state !== 'running') return plan.state;
  return loop?.enabled && loop.stopWhenChecklistDone ? 'running' : 'paused';
}

export type PlanAction = 'approve' | 'resume' | 'reset';

/** 그 상태에서 낼 손잡이 — 남은 항목이 없으면 시작 손잡이를 내지 않는다(눌러도 아무 일이 없다). */
export function planActions(state: PlanDisplayState, pending: number): PlanAction[] {
  if (state === 'proposed') return pending > 0 ? ['approve', 'reset'] : ['reset'];
  if (state === 'approved' || state === 'paused') return pending > 0 ? ['resume', 'reset'] : ['reset'];
  return ['reset'];
}

export const PRESET_ORDER: readonly Exclude<LocalAssistPreset, 'custom'>[] = ['off', 'lowSpec', 'balanced', 'longTask'];

/** 지금 칸들이 어느 이름으로 불리나. 아무것도 없으면 off, 이름이 없는데 칸이 있으면 custom(칸으로 짐작하지 않는다). */
export function currentPresetOf(assist: LocalAssistOptions | undefined): LocalAssistPreset {
  if (!assist || Object.keys(assist).length === 0) return 'off';
  return assist.preset ?? 'custom';
}
