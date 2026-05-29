/**
 * §5.3 #10-2 v2.37 — Auto Agent 런타임.
 *
 * 사용자 자연어 요청을 받아 (1) 휴리스틱 복잡도 판정 → (2) 토폴로지 선택 →
 * (3) 서브 커스텀 에이전트 군 spawn + AgentConfig 자동 채움 →
 * (4) Task Edge 자동 연결 → (5) 사용자 메시지를 엔트리 노드의 command queue 에 forward →
 * (6) 진행 상태/요약을 auto-agent 의 AutoAgentSummary 슬롯에 기록.
 *
 * 본인은 `claude -p` spawn 하지 않는다 — 메타 동작(orchestration)만. 서브 에이전트들은 사용자가 더블클릭해
 * IDE 오버레이를 열면 큐에 쌓인 메시지가 자동 처리된다.
 */

import { logger } from '../logger.js';
import type {
  AutoAgentRole,
  AutoAgentTopology,
  AutoAgentComplexity,
  AutoAgentSummary,
  AutoAgentTopologyPreset,
  AutoAgentSpawnedNode,
  QueuedCommand,
} from '@vibisual/shared';
import {
  AUTO_AGENT_LAYOUT_RADIUS,
  AUTO_AGENT_ROLE_POLICY,
  AUTO_AGENT_TOPOLOGY_PRESETS,
  DEFAULT_AGENT_CONFIG,
  AVAILABLE_AGENT_TOOLS,
} from '@vibisual/shared';
import type { ProjectGraphManager } from './projectGraphManager.js';

// ─── 복잡도 휴리스틱 ───

/**
 * 사용자 요청 1줄 → low/medium/high.
 * 정확한 분류보다 "토폴로지 분기를 만들기 위한 신호" 가 목적이라 휴리스틱으로 충분.
 */
export function analyzeComplexity(message: string): AutoAgentComplexity {
  const text = message.trim();
  const lower = text.toLowerCase();
  const length = text.length;

  // 모호 신호 (vague intents) — 짧고 동사·대상이 불명확
  const vagueKeywords = [
    '도와줘', '도와주세요', '뭐', '뭔가', '어떻게', '어떡', '알아서',
    'help', 'something', 'somehow', 'idk', "i don't know",
    '앱', '프로그램', '시스템', '솔루션',
  ];
  const isVague = vagueKeywords.some((k) => lower.includes(k));

  // 다중 도메인 신호 — 한 요청에 여러 큰 축이 등장
  const domainKeywords = ['auth', '인증', 'db', '데이터베이스', 'ui', '프론트', '백엔드', 'backend', 'frontend', 'api', '서버', 'server', '클라이언트', 'client', '결제', 'payment'];
  const domainHitCount = domainKeywords.reduce((acc, k) => (lower.includes(k) ? acc + 1 : acc), 0);

  // 구체 신호 — 파일·함수 경로 또는 명확한 동사
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

/**
 * 복잡도 + 메시지 키워드 → 토폴로지 선택.
 * - autopilot: 사용자가 "그냥 알아서", "단일" 류 명시
 * - low: pipeline (직선 체인)
 * - medium: team (PM 허브)
 * - high: ralph (team + critique rework 루프)
 */
export function selectTopology(complexity: AutoAgentComplexity, message: string): AutoAgentTopology {
  const lower = message.toLowerCase();
  if (lower.includes('알아서') || lower.includes('단일') || lower.includes('autopilot') || lower.includes('하나로')) {
    return 'autopilot';
  }
  if (complexity === 'low') return 'pipeline';
  if (complexity === 'medium') return 'team';
  return 'ralph';
}

// ─── 명확화 질문 생성 ───

/**
 * high 복잡도일 때 사용자에게 띄울 명확화 질문 2~3개 생성 (휴리스틱).
 * LLM 호출 없이 결정적으로 — "범위", "산출물", "주력 모듈" 류 표준 질문.
 */
export function generateClarifyingQuestions(message: string): { question: string; options: { label: string; description?: string }[]; multiSelect: boolean }[] {
  const lower = message.toLowerCase();
  const questions: { question: string; options: { label: string; description?: string }[]; multiSelect: boolean }[] = [];

  // Q1 — 산출물 형태
  questions.push({
    question: '원하는 산출물의 형태는?',
    multiSelect: false,
    options: [
      { label: '실제 코드 변경(파일 작성/수정)', description: 'Coder/Tester 가 직접 코드 작성' },
      { label: '설계·계획 문서만 (코드 ❌)', description: 'Planner/Architect 중심, 변경 ❌' },
      { label: '탐색·조사 보고서', description: 'Researcher/Reviewer 중심, 출력은 분석 보고' },
    ],
  });

  // Q2 — 우선순위
  questions.push({
    question: '품질 vs 속도, 어느 쪽이 우선?',
    multiSelect: false,
    options: [
      { label: '품질 우선 (Reviewer rework 루프)', description: 'Ralph 토폴로지로 reviewer 가 reject 시 재작업 자동' },
      { label: '속도 우선 (단발 처리)', description: 'PM 1회 분배 후 결과 즉시 보고' },
      { label: '균형', description: 'Team 토폴로지 기본' },
    ],
  });

  // Q3 — 도메인 (다중 도메인 의심 시만)
  const hasAuth = lower.includes('auth') || lower.includes('인증');
  const hasDb = lower.includes('db') || lower.includes('데이터');
  const hasUi = lower.includes('ui') || lower.includes('프론트');
  if ([hasAuth, hasDb, hasUi].filter(Boolean).length >= 2) {
    questions.push({
      question: '이번 작업의 주력 도메인은? (여러 선택 가능)',
      multiSelect: true,
      options: [
        { label: 'Auth / 인증' },
        { label: 'Database / 데이터 모델' },
        { label: 'UI / 프론트' },
        { label: 'Backend / API' },
      ],
    });
  }

  return questions.slice(0, 3);
}

// ─── 노드 배치 (원형) ───

/**
 * Auto-agent 버블 위치 기준으로 N개의 노드를 프리셋 각도에 따라 원형 배치.
 * 반지름 = AUTO_AGENT_LAYOUT_RADIUS.
 */
function computeNodePositions(
  autoAgentPos: { x: number; y: number },
  preset: AutoAgentTopologyPreset,
): { role: AutoAgentRole; position: { x: number; y: number } }[] {
  return preset.nodes.map((n) => {
    const rad = (n.offsetAngleDeg * Math.PI) / 180;
    return {
      role: n.role,
      position: {
        x: autoAgentPos.x + Math.cos(rad) * AUTO_AGENT_LAYOUT_RADIUS,
        y: autoAgentPos.y - Math.sin(rad) * AUTO_AGENT_LAYOUT_RADIUS, // y 는 화면 좌표라 -sin
      },
    };
  });
}

// ─── 런타임 본체 ───

export interface AutoAgentRuntimeDeps {
  graphManager: ProjectGraphManager;
  /** 커스텀 에이전트 설정 저장 — index.ts 의 동일 함수와 동일 효과 */
  setAgentConfig: (agentId: string, config: Partial<import('@vibisual/shared').AgentConfig>) => void;
  /** 사용자 메시지를 엔트리 노드의 command queue 에 enqueue */
  enqueueCommand: (sessionId: string, text: string) => void;
  /** 변경 후 클라이언트에 스냅샷 broadcast */
  broadcastSnapshot: () => void;
  /** 체크포인트 저장 (영속) */
  saveCheckpoint: () => void;
  /** auto-agent 진행 신호 WS broadcast (선택) */
  broadcastAutoAgentProgress?: (autoAgentId: string, summary: AutoAgentSummary) => void;
}

export class AutoAgentRuntime {
  constructor(private readonly deps: AutoAgentRuntimeDeps) {}

  /**
   * 사용자 메시지 1건을 받아 처리.
   * - high 복잡도 + askQuestionsEnabled 면 phase='asking' 으로 두고 질문 모음만 채워 즉시 반환.
   *   사용자가 별도 endpoint 로 답을 주면 `resumeWithAnswers` 가 spawn 단계로 진입.
   * - 그 외는 즉시 spawn → dispatch.
   */
  processRequest(autoAgentSessionId: string, message: string): AutoAgentSummary {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) {
      throw new Error(`auto-agent not found: ${autoAgentSessionId}`);
    }
    const existing = inst.getAutoAgentSummary(autoAgentSessionId);
    const askQuestionsEnabled = existing?.askQuestionsEnabled ?? true;

    const complexity = analyzeComplexity(message);
    const topology = selectTopology(complexity, message);

    const initial: AutoAgentSummary = {
      autoAgentId: autoAgentSessionId,
      complexity,
      topology,
      spawnedAgentIds: [],
      entryAgentId: '',
      userRequest: message,
      phase: 'analyzing',
      startedAt: Date.now(),
      askQuestionsEnabled,
    };
    inst.setAutoAgentSummary(autoAgentSessionId, initial);

    // 명확화 질문 분기 — high + 토글 ON
    if (complexity === 'high' && askQuestionsEnabled) {
      const questions = generateClarifyingQuestions(message).map((q) => ({ ...q }));
      const askingSummary: AutoAgentSummary = {
        ...initial,
        phase: 'asking',
        questionsAsked: questions,
      };
      inst.setAutoAgentSummary(autoAgentSessionId, askingSummary);
      this.notify(autoAgentSessionId, askingSummary);
      return askingSummary;
    }

    // 즉시 spawn
    return this.spawnAndDispatch(autoAgentSessionId, message, complexity, topology);
  }

  /**
   * asking 단계에서 사용자가 답을 보냈을 때 호출. 답을 기록하고 spawn → dispatch.
   */
  resumeWithAnswers(
    autoAgentSessionId: string,
    answers: { questionIndex: number; selectedLabels: string[]; note?: string }[],
  ): AutoAgentSummary {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) throw new Error(`auto-agent not found: ${autoAgentSessionId}`);
    const summary = inst.getAutoAgentSummary(autoAgentSessionId);
    if (!summary) throw new Error(`auto-agent summary not found: ${autoAgentSessionId}`);
    if (summary.phase !== 'asking') {
      logger.warn(`resumeWithAnswers called for non-asking phase: ${summary.phase}`);
    }
    const questionsAsked = (summary.questionsAsked ?? []).map((q, i) => {
      const answer = answers.find((a) => a.questionIndex === i);
      if (!answer) return q;
      return { ...q, answer: { selectedLabels: answer.selectedLabels, ...(answer.note ? { note: answer.note } : {}) } };
    });
    const next: AutoAgentSummary = { ...summary, questionsAsked };
    inst.setAutoAgentSummary(autoAgentSessionId, next);
    return this.spawnAndDispatch(autoAgentSessionId, summary.userRequest, summary.complexity, summary.topology);
  }

  /**
   * 토글 갱신 — UI 의 "질문하기" 버튼.
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
   * 토폴로지에 따라 서브 커스텀 에이전트들을 spawn 하고 Task Edge 연결 후
   * 엔트리 노드에 사용자 원본 메시지를 enqueue.
   */
  private spawnAndDispatch(
    autoAgentSessionId: string,
    userRequest: string,
    complexity: AutoAgentComplexity,
    topology: AutoAgentTopology,
  ): AutoAgentSummary {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) throw new Error(`auto-agent not found: ${autoAgentSessionId}`);
    const autoBubble = inst.getAgentBySession(autoAgentSessionId);
    if (!autoBubble) throw new Error(`auto-agent bubble not found: ${autoAgentSessionId}`);
    const autoPos = autoBubble.position ?? { x: 0, y: 0 };
    const preset = AUTO_AGENT_TOPOLOGY_PRESETS[topology];

    // phase: spawning
    inst.updateAutoAgentSummary(autoAgentSessionId, { phase: 'spawning' });
    this.notify(autoAgentSessionId, inst.getAutoAgentSummary(autoAgentSessionId)!);

    // 노드 배치 + spawn
    const positioned = computeNodePositions(autoPos, preset);
    const spawned: AutoAgentSpawnedNode[] = [];
    const projectName = inst.getPrimaryProjectName() ?? null;
    const labelPrefix = autoBubble.label.replace(/^Auto[:\s]*/i, '').trim() || 'Auto';
    for (const node of positioned) {
      const policy = AUTO_AGENT_ROLE_POLICY[node.role];
      const label = `${labelPrefix} · ${node.role}`;
      const bubble = this.deps.graphManager.createCustomAgent(label, node.position, projectName);
      // 기본 + role 정책 머지 (사용자가 이후 자유 편집 가능)
      const merged: import('@vibisual/shared').AgentConfig = {
        ...DEFAULT_AGENT_CONFIG,
        ...policy,
        tools: policy.tools ?? [...AVAILABLE_AGENT_TOOLS],
      };
      this.deps.setAgentConfig(bubble.id, merged);
      spawned.push({ role: node.role, agentId: bubble.id, sessionId: bubble.path, position: node.position });
    }

    // role → agentId 매핑 (같은 role 이 여러 번 있을 경우 첫 번째 만 entry 후보)
    const roleToAgentId = new Map<AutoAgentRole, string>();
    for (const s of spawned) {
      if (!roleToAgentId.has(s.role)) roleToAgentId.set(s.role, s.agentId);
    }

    // Task Edge 생성
    for (const e of preset.edges) {
      const from = roleToAgentId.get(e.from);
      const to = roleToAgentId.get(e.to);
      if (!from || !to) {
        logger.warn(`auto-agent: edge role ${e.from}→${e.to} missing spawned node`);
        continue;
      }
      try {
        inst.createTaskEdge(from, to, '', 'auto', null, {
          kind: e.kind,
          ...(e.returnFormat !== undefined && { returnFormat: e.returnFormat }),
          ...(e.commandMode !== undefined && { commandMode: e.commandMode }),
          ...(e.critiqueAuthority !== undefined && { critiqueAuthority: e.critiqueAuthority }),
        });
      } catch (err) {
        logger.warn(`auto-agent createTaskEdge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 엔트리 노드 결정
    const entryNode = preset.nodes.find((n) => n.entry);
    if (!entryNode) throw new Error(`topology ${topology} missing entry node`);
    const entrySpawned = spawned.find((s) => s.role === entryNode.role);
    if (!entrySpawned) throw new Error(`entry role ${entryNode.role} not spawned`);

    // phase: dispatching
    inst.updateAutoAgentSummary(autoAgentSessionId, { phase: 'dispatching' });

    // 사용자 메시지를 엔트리 노드의 command queue 로 enqueue
    try {
      this.deps.enqueueCommand(entrySpawned.sessionId, userRequest);
    } catch (err) {
      logger.error(`auto-agent enqueueCommand failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 최종 요약 (phase=running, 완료는 후속 Stop 훅에서 갱신)
    const finalSummary: AutoAgentSummary = {
      autoAgentId: autoAgentSessionId,
      complexity,
      topology,
      spawnedAgentIds: spawned.map((s) => s.agentId),
      entryAgentId: entrySpawned.agentId,
      userRequest,
      phase: 'running',
      startedAt: Date.now(),
      askQuestionsEnabled: inst.getAutoAgentSummary(autoAgentSessionId)?.askQuestionsEnabled ?? true,
      questionsAsked: inst.getAutoAgentSummary(autoAgentSessionId)?.questionsAsked,
    };
    inst.setAutoAgentSummary(autoAgentSessionId, finalSummary);
    this.notify(autoAgentSessionId, finalSummary);

    // broadcast + 체크포인트
    this.deps.broadcastSnapshot();
    this.deps.saveCheckpoint();

    return finalSummary;
  }

  /**
   * 외부 (Stop 훅 등) 에서 엔트리 에이전트 완료 신호 수신 시 호출 — 요약 합성.
   * 본 라운드는 마지막 응답 텍스트의 첫 200자를 그대로 finalSummary 로 사용.
   */
  handleCompletion(autoAgentSessionId: string, finalText?: string): AutoAgentSummary | null {
    const inst = this.deps.graphManager.findInstanceByAutoAgentSession(autoAgentSessionId);
    if (!inst) return null;
    const truncated = finalText ? finalText.slice(0, 200).trim() : undefined;
    const updated = inst.updateAutoAgentSummary(autoAgentSessionId, {
      phase: 'completed',
      completedAt: Date.now(),
      ...(truncated !== undefined && { finalSummary: truncated }),
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
