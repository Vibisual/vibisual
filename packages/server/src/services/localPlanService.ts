/**
 * localPlanService.ts — §5.19 (J) ④ 계획 먼저·릴레이·이어하기의 서버 판정.
 * 항목은 프로젝트의 계획 파일이, 상태는 세션 이력 파일(`readLocalPlanState`)이 든다. 화면은 `SubAgent.localPlan` 만 그린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCAL_PLAN_ITEMS_MAX,
  LOCAL_RELAY_DEFAULT_MAX_ROUNDS,
  executePlanCommand,
  extractPlanItemsFromAnswer,
  parseChecklist,
  relayRoundCommand,
  renderChecklist,
  type LocalAssistOptions,
  type LocalPlanItem,
  type LocalPlanState,
  type LocalPlanSummary,
  type SubAgent,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { readLocalPlanState, writeLocalPlanState } from './localRunner.js';
import { localPlanRel } from './localAssistRuntime.js';

/** 세션 루프로 릴레이를 돌릴 때 넘기는 것(§5.5 #17-11 재사용 — 새 실행 레일 ❌). */
export interface RelayLoopRequest {
  command: string;
  total: number;
  progressFile: string;
}

/** 루프·명령 큐는 서버 진입점이 쥐고 있다 — 여기서는 부르기만 한다. */
export interface LocalPlanHooks {
  startRelayLoop(agentId: string, subAgentId: string, req: RelayLoopRequest): boolean;
  enqueueCommand(agentId: string, subAgentId: string, text: string): boolean;
}

/** 이 턴이 계획을 세우는 턴인가 — 계획 먼저나 릴레이가 켜졌고, 승인된 계획이 아직 돌고 있지 않을 때. */
export function isPlanningTurn(assist: LocalAssistOptions | undefined, state: LocalPlanState | undefined): boolean {
  if (!assist?.planFirst && !assist?.relay) return false;
  return state !== 'approved' && state !== 'running';
}

function planAbs(root: string, subAgentId: string): string {
  return path.join(root, localPlanRel(subAgentId));
}

/** 계획 파일의 항목. 파일이 없으면 `null`. */
export function readPlanItems(root: string, subAgentId: string): LocalPlanItem[] | null {
  try {
    return parseChecklist(fs.readFileSync(planAbs(root, subAgentId), 'utf8'));
  } catch {
    return null;
  }
}

/** 화면에 실을 요약. 상태가 없으면(계획을 안 쓰는 세션) `undefined`. */
export function planSummary(root: string, subAgentId: string): LocalPlanSummary | undefined {
  const state = readLocalPlanState(subAgentId);
  if (!state) return undefined;
  const items = readPlanItems(root, subAgentId) ?? [];
  return {
    state,
    file: localPlanRel(subAgentId),
    total: items.length,
    done: items.filter((i) => i.done).length,
    items: items.slice(0, LOCAL_PLAN_ITEMS_MAX),
  };
}

/** `sub.localPlan` 을 지금 파일·상태로 맞춘다. 바뀌었으면 `true`(부르는 쪽이 방송한다). */
export function refreshLocalPlan(sub: SubAgent, root: string): boolean {
  const next = planSummary(root, sub.id);
  const before = JSON.stringify(sub.localPlan ?? null);
  if (next) sub.localPlan = next;
  else delete sub.localPlan;
  return before !== JSON.stringify(next ?? null);
}

/** 새 계획을 세우기 전 — 다 끝난 지난 계획이 새 요청의 계획 행세를 하지 않게 걷는다(고치는 중인 `proposed` 는 둔다). */
export function prepareNewPlan(root: string, subAgentId: string): void {
  const state = readLocalPlanState(subAgentId);
  if (state === 'proposed') return;
  try { fs.rmSync(planAbs(root, subAgentId), { force: true }); } catch { /* 없으면 그만 */ }
  if (state) writeLocalPlanState(subAgentId, undefined);
}

/**
 * 계획 턴이 끝난 뒤. 파일이 없으면 답에 쓴 목록을 우리가 파일로 옮긴다(작은 모델은 파일 쓰기를 자주 건너뛴다).
 * 돌려주는 `notice` 는 사람에게 보일 한 줄이다.
 */
export function afterPlanningTurn(
  root: string,
  subAgentId: string,
  answer: string,
  assist: LocalAssistOptions | undefined,
): { state?: LocalPlanState; notice: string } {
  const rel = localPlanRel(subAgentId);
  let items = readPlanItems(root, subAgentId);
  if ((!items || items.length === 0) && answer.trim()) {
    const extracted = extractPlanItemsFromAnswer(answer);
    if (extracted.length > 0) {
      try {
        fs.mkdirSync(path.dirname(planAbs(root, subAgentId)), { recursive: true });
        fs.writeFileSync(planAbs(root, subAgentId), renderChecklist('Plan', extracted), 'utf8');
        items = readPlanItems(root, subAgentId);
      } catch (err) {
        logger.warn(`[localPlan] could not write the plan for ${subAgentId}`, err);
      }
    }
  }
  if (!items || items.length === 0) {
    return { notice: `[local] plan first: no checklist was written to ${rel}. Ask again with the task, or turn off "plan first" in the assist panel.` };
  }
  const pending = items.filter((i) => !i.done).length;
  if (pending === 0) {
    writeLocalPlanState(subAgentId, 'done');
    return { state: 'done', notice: `[local] every step in ${rel} is already checked off.` };
  }
  writeLocalPlanState(subAgentId, 'proposed');
  const how = assist?.planFirst
    ? `Approve it in the assist panel to start${assist.relay ? ' the relay' : ''}, or reply to change it.`
    : 'Starting the relay.';
  return { state: 'proposed', notice: `[local] plan ready — ${String(items.length)} steps in ${rel}. ${how}` };
}

/** 승인·이어하기 — 릴레이면 세션 루프로, 아니면 실행 명령 한 줄을 큐에 넣는다. */
export function approvePlan(
  agentId: string,
  subAgentId: string,
  root: string,
  assist: LocalAssistOptions | undefined,
  hooks: LocalPlanHooks,
): { ok: boolean; state?: LocalPlanState; error?: string } {
  const items = readPlanItems(root, subAgentId);
  if (!items || items.length === 0) return { ok: false, error: 'no plan' };
  const pending = items.filter((i) => !i.done).length;
  if (pending === 0) {
    writeLocalPlanState(subAgentId, 'done');
    return { ok: false, state: 'done', error: 'nothing left to do' };
  }
  const rel = localPlanRel(subAgentId);
  if (assist?.relay) {
    const cap = assist.relayMaxRounds ?? LOCAL_RELAY_DEFAULT_MAX_ROUNDS;
    // 항목당 한 회차가 원칙이고, 확인·재시도 몫으로 두 배를 준다(상한은 사용자 값).
    const total = Math.max(1, Math.min(cap, pending * 2));
    if (!hooks.startRelayLoop(agentId, subAgentId, { command: relayRoundCommand(rel, assist.relayVerifyCommand), total, progressFile: rel })) {
      return { ok: false, error: 'could not start the relay' };
    }
    writeLocalPlanState(subAgentId, 'running');
    return { ok: true, state: 'running' };
  }
  if (!hooks.enqueueCommand(agentId, subAgentId, executePlanCommand(rel, assist?.relayVerifyCommand))) {
    return { ok: false, error: 'could not queue the plan' };
  }
  writeLocalPlanState(subAgentId, 'approved');
  return { ok: true, state: 'approved' };
}

/** 새 계획 — 파일과 상태를 걷는다. */
export function resetPlan(root: string, subAgentId: string): void {
  try { fs.rmSync(planAbs(root, subAgentId), { force: true }); } catch { /* 없으면 그만 */ }
  writeLocalPlanState(subAgentId, undefined);
}

/** 릴레이 루프가 끝났을 때 — 남은 항목이 없으면 done, 있으면 approved(이어하기로 다시 돌린다). */
export function onRelayEnded(root: string, subAgentId: string): LocalPlanState | undefined {
  if (readLocalPlanState(subAgentId) !== 'running') return readLocalPlanState(subAgentId);
  const items = readPlanItems(root, subAgentId) ?? [];
  const next: LocalPlanState = items.length > 0 && items.every((i) => i.done) ? 'done' : 'approved';
  writeLocalPlanState(subAgentId, next);
  return next;
}

/** 루프 회차 경계의 완료 판정(`SessionLoop.stopWhenChecklistDone`) — 항목이 있고 남은 것이 0 이면 참. */
export function checklistFileDone(root: string, relativeFile: string): boolean {
  try {
    const items = parseChecklist(fs.readFileSync(path.join(root, relativeFile), 'utf8'));
    return items.length > 0 && items.every((i) => i.done);
  } catch {
    return false;
  }
}
