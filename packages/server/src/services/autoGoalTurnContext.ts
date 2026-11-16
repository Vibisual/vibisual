/**
 * §5.10 · §5.5 #17-28 ⑧(c) — 절차 주입을 한 턴에 어떻게 나눠 싣는가.
 * 우리가 띄운 Claude 세션: 규약은 시스템 프롬프트 한 벌, 턴 메시지에는 목록 + 신원 한 줄, 그 목록도 바뀌었을 때만.
 * 그 밖(훅으로 붙은 세션 · 매 턴 컨텍스트를 새로 조립하는 코덱스·로컬 러너): 목록과 규약 전문을 한 덩어리로.
 */
import { createHash } from 'node:crypto';
import {
  AGENT_COMPACT_COMMAND,
  SESSION_KEYED_MAP_MAX,
  SESSION_LOOP_CLEAR_COMMAND,
  capMapSize,
  type AutoGoalSettings,
} from '@vibisual/shared';
import { buildAutoGoalPromptContext } from './autoGoalService.js';
import { buildAutoGoalAgentProtocol, buildAutoGoalIdentityLine, buildAutoGoalSystemRules } from './autoGoalAgentProtocol.js';

export interface AutoGoalTurnParts {
  /** 턴 메시지에 실을 블록(실을 것이 없으면 빈 문자열). */
  turn: string;
  /** 시스템 프롬프트에 실을 규약(가르지 않는 세션이면 빈 문자열). */
  system: string;
  /**
   * "이 대화에 이미 실은 목록인가"를 견줄 값 — 순서를 뺀 목록 내용 + 신원 줄. 가르는 세션에서 목록이 실릴 때만 선다.
   * `turn` 을 그대로 견주면 같은 절차들이 관련도 순위만 바뀐 턴마다 다시 실린다.
   */
  listKey: string;
}

export const EMPTY_AUTO_GOAL_TURN_PARTS: AutoGoalTurnParts = { turn: '', system: '', listKey: '' };

/**
 * 부작용 없음 — 주입원 표를 재는 길도 이 함수를 지난다.
 * `system` 은 작업 본문을 보지 않는다: 이번 턴에 닿는 절차가 있느냐로 켜고 끄면 턴마다 시스템 프롬프트가 바뀌어 캐시 접두가 깨진다.
 */
export function buildAutoGoalTurnParts(input: {
  root: string;
  settings: AutoGoalSettings | undefined;
  agentId: string;
  /** 절차 창구의 세션 키. 없으면 신원을 줄 수 없어 목록만 싣는다. */
  sessionId?: string | null;
  task: string;
  identityFile?: string;
  /** 규약을 시스템 프롬프트로 가르는 세션인가(우리가 띄운 Claude 세션). */
  rulesInSystem: boolean;
}): AutoGoalTurnParts {
  const { root, agentId, sessionId } = input;
  // 신원 줄 없이 규약만 시스템 프롬프트에 서면 부를 수 없는 창구가 된다 — 세션 키가 있을 때만 가른다.
  const splitSessionId = input.rulesInSystem && sessionId ? sessionId : null;
  const context = buildAutoGoalPromptContext(root, input.settings, { agentId, subAgentId: sessionId ?? null }, input.task, { rulesInSystem: splitSessionId !== null });
  const identityFile = input.identityFile ? { identityFile: input.identityFile } : {};
  if (splitSessionId !== null) {
    const identity = context.block ? buildAutoGoalIdentityLine({ root, agentId, subAgentId: splitSessionId }) : '';
    return {
      turn: context.block ? `${context.block}\n\n${identity}` : '',
      system: context.listable ? buildAutoGoalSystemRules(identityFile) : '',
      listKey: context.block ? `${context.listKey ?? context.block}\n${identity}` : '',
    };
  }
  if (!context.block) return EMPTY_AUTO_GOAL_TURN_PARTS;
  return {
    turn: sessionId
      ? `${context.block}\n\n${buildAutoGoalAgentProtocol({ root, agentId, subAgentId: sessionId, ...identityFile })}`
      : context.block,
    system: '',
    listKey: '',
  };
}

/** 대화를 접거나 비우는 내장 명령인가(인자가 붙어도). 이 턴이 지나면 앞서 실은 목록이 이력에 없다. */
export function dropsConversationHistory(text: string): boolean {
  const first = text.trim().split(/\s/, 1)[0] ?? '';
  return first === AGENT_COMPACT_COMMAND || first === SESSION_LOOP_CLEAR_COMMAND;
}

function digestOf(listKey: string): string {
  return createHash('sha256').update(listKey).digest('hex');
}

/**
 * 세션별 "마지막으로 실제 보낸 목록"의 지문 — 같은 목록을 매 턴 다시 실으면 대화 이력에 턴 수만큼 쌓인다.
 * 메모리 전용이다. 서버가 다시 뜨면 비는데, 그때는 창구 토큰도 새로 서므로 다시 싣는 것이 맞다.
 * 압축·비우기로 이력이 사라지면 호출부가 `forget` 으로 알린다. 놓쳐도 잃는 것은 없다 — 목록이 한 번 더 실릴 뿐이다.
 */
export class AutoGoalSentLists {
  private readonly sent = new Map<string, { digest: string; commandId?: string }>();

  constructor(private readonly max: number = SESSION_KEYED_MAP_MAX) {}

  /** 이 목록이 그 세션의 대화에 이미 있는가. 읽기만 한다. */
  isRepeat(subAgentId: string, listKey: string, commandId?: string): boolean {
    if (!listKey) return false;
    const last = this.sent.get(subAgentId);
    if (!last || last.digest !== digestOf(listKey)) return false;
    // 같은 명령이 다시 나가는 것은 앞 시도가 모델에 닿지 못했을 수 있다(되태우기·재개) — 다시 싣는다.
    return commandId === undefined || last.commandId !== commandId;
  }

  /** 실어 보낸 뒤에만 부른다. 다시 넣어 가장 최근으로 올린다 — 상한에서는 오래전에 보낸 세션부터 빠진다. */
  commit(subAgentId: string, listKey: string, commandId?: string): void {
    if (!listKey) return;
    this.sent.delete(subAgentId);
    this.sent.set(subAgentId, { digest: digestOf(listKey), ...(commandId !== undefined ? { commandId } : {}) });
    capMapSize(this.sent, this.max);
  }

  forget(subAgentId: string): void {
    this.sent.delete(subAgentId);
  }

  get size(): number {
    return this.sent.size;
  }
}
