/**
 * §5.3 #10-2 — Auto Agent 런타임: 요청 1건 → auto-agent 자신의 AgentConfig 를 하네스 빌더 설정으로 바꾸고 요청을 자기 세션에 enqueue(기존 processNextCommand 가 스폰).
 * 빌더는 loopback REST 로 커스텀 에이전트 군 + Task Edge 하네스를 짓고 엔트리 노드에 요청을 넘긴다. `analyzeComplexity` 는 요약 배지에만 쓴다.
 */

import { logger } from '../logger.js';
import type {
  AutoAgentTopology,
  AutoAgentComplexity,
  AutoAgentSummary,
  AgentConfig,
} from '@vibisual/shared';
import {
  AUTO_AGENT_LAYOUT_RADIUS,
  AUTO_AGENT_BUILDER_CONFIG,
  AUTO_AGENT_BUILDER_INTERVIEW_TOOL,
  buildHarnessBuilderRules,
  agentRuleShell,
  DEFAULT_AGENT_CONFIG,
} from '@vibisual/shared';
import type { ProjectGraphManager } from './projectGraphManager.js';

/** 요청 1줄 → low/medium/high. `AutoAgentSummary.complexity` 배지(정보 표시)에만 쓴다 — spawn 분기에는 안 쓴다. */
export function analyzeComplexity(message: string): AutoAgentComplexity {
  const text = message.trim();
  const lower = text.toLowerCase();
  const length = text.length;

  const vagueKeywords = [
    '도와줘', '도와주세요', '뭐', '뭔가', '어떻게', '어떡', '알아서',
    'help', 'something', 'somehow', 'idk', "i don't know",
    '앱', '프로그램', '시스템', '솔루션',
  ];
  const isVague = vagueKeywords.some((k) => lower.includes(k));

  const domainKeywords = ['auth', '인증', 'db', '데이터베이스', 'ui', '프론트', '백엔드', 'backend', 'frontend', 'api', '서버', 'server', '클라이언트', 'client', '결제', 'payment'];
  const domainHitCount = domainKeywords.reduce((acc, k) => (lower.includes(k) ? acc + 1 : acc), 0);

  const hasFilePath = /[./\\][a-zA-Z0-9_-]+\.[a-z]{1,5}\b/.test(text);
  const hasFunctionRef = /\b[a-zA-Z_][\w]*\s*\(/.test(text);
  const concreteVerbs = ['리팩터링', '리펙터링', '수정', '추가', '제거', '삭제', '리네임', 'rename', 'refactor', 'add', 'remove', 'fix', 'update'];
  const hasConcreteVerb = concreteVerbs.some((v) => lower.includes(v));

  if (isVague || domainHitCount >= 3 || length > 600) return 'high';
  if ((hasFilePath || hasFunctionRef) && hasConcreteVerb && length < 200) return 'low';
  if (hasConcreteVerb && length < 300) return 'medium';
  if (domainHitCount >= 2) return 'high';
  return 'medium';
}

// ─── 런타임 본체 ───

export interface AutoAgentRuntimeDeps {
  graphManager: ProjectGraphManager;
  /** 커스텀 에이전트 설정 저장 — index.ts 의 동일 함수와 동일 효과 */
  setAgentConfig: (agentId: string, config: Partial<AgentConfig>) => void;
  /** 명령을 세션 큐에 enqueue + processNextCommand 즉시 발사 (= 스폰 트리거) */
  enqueueCommand: (sessionId: string, text: string) => void;
  /** 변경 후 클라이언트에 스냅샷 broadcast */
  broadcastSnapshot: () => void;
  /** 체크포인트 저장 (영속) */
  saveCheckpoint: () => void;
  /** 빌더가 curl 로 닿을 loopback 서버 베이스 URL (hook 리스너 포트). */
  getServerBase: () => string;
  /** 빌더 구축 curl 인증용 per-launch 토큰(x-vibisual-hook-token). */
  getServerToken: () => string;
  /** auto-agent 진행 신호 WS broadcast (선택) */
  broadcastAutoAgentProgress?: (autoAgentId: string, summary: AutoAgentSummary) => void;
}

export class AutoAgentRuntime {
  constructor(private readonly deps: AutoAgentRuntimeDeps) {}

  processRequest(autoAgentSessionId: string, message: string): AutoAgentSummary {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) {
      throw new Error(`auto-agent not found: ${autoAgentSessionId}`);
    }
    const autoBubble = inst.getAgentBySession(autoAgentSessionId);
    if (!autoBubble) {
      throw new Error(`auto-agent bubble not found: ${autoAgentSessionId}`);
    }
    const existing = inst.getAutoAgentSummary(autoAgentSessionId);
    const askQuestionsEnabled = existing?.askQuestionsEnabled ?? true;

    // 정보 표시용 배지 (spawn 분기에는 미사용)
    const complexity = analyzeComplexity(message);

    // ── 빌더 config 조립 ──
    const center = autoBubble.position ?? { x: 0, y: 0 };
    const projectName = inst.getPrimaryProjectName() ?? null;
    const serverBase = this.deps.getServerBase();
    const serverToken = this.deps.getServerToken();
    const provider = this.deps.graphManager.getAgentConfig(autoBubble.id)?.provider;
    const rules = buildHarnessBuilderRules({
      shell: agentRuleShell(provider?.kind === 'codex-cli' ? 'codex' : 'claude', process.platform),
      serverBase,
      serverToken,
      centerX: center.x,
      centerY: center.y,
      layoutRadius: AUTO_AGENT_LAYOUT_RADIUS,
      projectName,
    });
    const tools = [...(AUTO_AGENT_BUILDER_CONFIG.tools ?? [])];
    if (askQuestionsEnabled && !tools.includes(AUTO_AGENT_BUILDER_INTERVIEW_TOOL)) {
      tools.push(AUTO_AGENT_BUILDER_INTERVIEW_TOOL);
    }
    const builderConfig: AgentConfig = {
      ...DEFAULT_AGENT_CONFIG,
      ...AUTO_AGENT_BUILDER_CONFIG,
      ...(provider ? { provider } : {}),
      tools,
      rules,
    };
    this.deps.setAgentConfig(autoBubble.id, builderConfig);

    // §5.3 #10-3 — 요청 1건 = 검증 런 1개. Summary 는 autoAgentId 키라 새 요청이 덮으므로 증거·예산은 런에, Summary 엔 포인터만.
    const run = inst.createAutoAgentRun({ autoAgentId: autoAgentSessionId, userRequest: message });

    const summary: AutoAgentSummary = {
      autoAgentId: autoAgentSessionId,
      complexity,
      topology: 'custom',
      spawnedAgentIds: [],
      entryAgentId: '',
      userRequest: message,
      phase: 'building',
      startedAt: Date.now(),
      askQuestionsEnabled,
      currentRunId: run.runId,
      ...(existing?.questionsAsked ? { questionsAsked: existing.questionsAsked } : {}),
    };
    inst.setAutoAgentSummary(autoAgentSessionId, summary);
    this.notify(autoAgentSessionId, summary);

    // ── 빌더 스폰: 사용자 원본 요청을 auto-agent 자기 세션에 enqueue (= processNextCommand 즉시 발사) ──
    try {
      this.deps.enqueueCommand(autoAgentSessionId, message);
    } catch (err) {
      logger.error(`auto-agent builder spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      const errored: AutoAgentSummary = { ...summary, phase: 'error' };
      inst.setAutoAgentSummary(autoAgentSessionId, errored);
      this.notify(autoAgentSessionId, errored);
      this.deps.broadcastSnapshot();
      return errored;
    }

    this.deps.broadcastSnapshot();
    this.deps.saveCheckpoint();
    return summary;
  }

  /** 레거시 asking 엔드포인트 호환 — 빌더가 AskUserQuestion 으로 직접 묻기 때문에 실제로는 생기지 않는다. 답을 기록하고 원본 요청으로 빌더를 (재)기동한다. */
  resumeWithAnswers(
    autoAgentSessionId: string,
    answers: { questionIndex: number; selectedLabels: string[]; note?: string }[],
  ): AutoAgentSummary {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) throw new Error(`auto-agent not found: ${autoAgentSessionId}`);
    const summary = inst.getAutoAgentSummary(autoAgentSessionId);
    if (!summary) throw new Error(`auto-agent summary not found: ${autoAgentSessionId}`);
    const questionsAsked = (summary.questionsAsked ?? []).map((q, i) => {
      const answer = answers.find((a) => a.questionIndex === i);
      if (!answer) return q;
      return { ...q, answer: { selectedLabels: answer.selectedLabels, ...(answer.note ? { note: answer.note } : {}) } };
    });
    inst.setAutoAgentSummary(autoAgentSessionId, { ...summary, questionsAsked });
    return this.processRequest(autoAgentSessionId, summary.userRequest);
  }

  /**
   * 토글 갱신 — UI 의 "질문하기" 버튼. ON 이면 빌더 tools 에 AskUserQuestion 포함.
   */
  toggleQuestions(autoAgentSessionId: string, enabled: boolean): AutoAgentSummary | null {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) return null;
    const updated = inst.updateAutoAgentSummary(autoAgentSessionId, { askQuestionsEnabled: enabled });
    if (updated) {
      this.notify(autoAgentSessionId, updated);
      this.deps.broadcastSnapshot();
    }
    return updated;
  }

  /**
   * 외부 (Stop 훅 등) 에서 빌더 완료 신호 수신 시 호출 — 요약 합성.
   * 마지막 응답 텍스트의 첫 200자를 finalSummary 로 사용.
   */
  handleCompletion(autoAgentSessionId: string, finalText?: string): AutoAgentSummary | null {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) return null;
    const truncated = finalText ? finalText.slice(0, 200).trim() : undefined;

    // §5.3 #10-3 — 빌더 완료 ≠ 작업 완료. 열린 검증 런이 있으면 `running` 까지만 — `completed` 는 그 런이 증거와 함께 닫힐 때(`handleRunClosed`)만
    // (아니면 워커가 시작하기도 전에 "완료"가 뜬다).
    const activeRun = inst.getActiveAutoAgentRun(autoAgentSessionId);
    const updated = inst.updateAutoAgentSummary(autoAgentSessionId, {
      phase: activeRun ? 'running' : 'completed',
      ...(activeRun ? {} : { completedAt: Date.now() }),
      ...(truncated !== undefined && { finalSummary: truncated }),
    });
    if (updated) {
      this.notify(autoAgentSessionId, updated);
      this.deps.broadcastSnapshot();
    }
    return updated;
  }

  /** §5.3 #10-3 — 런이 닫히면: `verified` → `completed`(초록), `escalated`(예산 소진·증거 없음) → `error`(빨강) + 사유. 스스로 못 끝낸 런을 초록으로 칠하지 않는다. */
  handleRunClosed(autoAgentSessionId: string, status: string, escalation?: string): AutoAgentSummary | null {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) return null;
    const verified = status === 'verified';
    const updated = inst.updateAutoAgentSummary(autoAgentSessionId, {
      phase: verified ? 'completed' : 'error',
      completedAt: Date.now(),
      ...(verified ? {} : { errorMessage: `run ${status}${escalation ? ` — ${escalation}` : ''}` }),
    });
    if (updated) {
      this.notify(autoAgentSessionId, updated);
      this.deps.broadcastSnapshot();
    }
    return updated;
  }

  private notify(autoAgentId: string, summary: AutoAgentSummary): void {
    if (this.deps.broadcastAutoAgentProgress) {
      try {
        this.deps.broadcastAutoAgentProgress(autoAgentId, summary);
      } catch (err) {
        logger.warn(`auto-agent broadcast failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
