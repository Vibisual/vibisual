import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orchestraEnginePreparation, type AppBubble, type OrchestraPreparation } from '@vibisual/shared';
import type { VideoEngineKind } from '@vibisual/video';

import { useGraphStore, selectIDEActiveSessionForAgent } from '../../stores/graphStore.js';
import { getInternalApp } from '../../apps/registry.js';
import { appNodeSize, formChangeMove } from '../../apps/appNodeForm.js';
import { pickCardSession } from '../BubbleMap/agentCard.js';
import { readJsonResponse } from './videoApi.js';
import { newPassId, recordHistory } from './studioApi.js';

/**
 * §5.13 (V) 37-2 — 스튜디오의 AI 쪽: 엔진 칩(설치·로그인 감지) · 이 문서에 이어진 에이전트 · 없으면 커스텀 에이전트 생성 경로로 만들어 이 문서의 노드에 잇기 ·
 * 바퀴 열기(맡기기 직전 판) · 명령 큐로 보내기. 새 전송 경로를 만들지 않는다 — 생성은 캔버스 [커스텀 에이전트]와 같은 `POST /api/create-custom-agent`,
 * 연결은 참조선과 같은 `linkAppBubbleAgent`/`createAppBubble`, 보내기는 `addCommand` 하나다.
 */

/** 이 앱의 id — 이 문서에 묶인 캔버스 노드를 고를 때 쓴다(레지스트리 항목과 같은 값). */
const APP_ID = 'vibistudio';
/** 새로 만든 에이전트가 스토어에 보일 때까지 기다리는 상한(ms) — `addCommand` 는 스토어에 없는 에이전트를 조용히 버린다. */
const AGENT_APPEAR_TIMEOUT_MS = 10_000;
/** 노드 옆에 새 에이전트를 세울 때의 간격(캔버스 px). */
const AGENT_SPAWN_GAP = 320;

export interface StudioAgentInfo {
  readonly id: string;
  readonly label: string;
  readonly engine: VideoEngineKind;
  readonly running: boolean;
}

export interface StudioSendArgs {
  /** 화면에 보이고 판 기록에 남는 사용자의 말(문맥 블록 없이). */
  readonly request: string;
  readonly mode: string;
  readonly chapterId?: string | undefined;
  readonly engine?: VideoEngineKind | undefined;
  /**
   * 맡길 문서(없으면 지금 화면의 문서). 방금 만든 문서는 화면이 다시 그려지기 전이라 훅이 아직 모른다 — 그때 보내는 쪽이
   * 문서를 직접 알려야 맡기기 직전 판·노드 연결이 그 문서로 간다.
   */
  readonly doc?: { readonly id: string; readonly title: string } | undefined;
  /** 바퀴 id 를 받아 보낼 글(사용자의 말 + 문맥 블록)을 짓는다. */
  readonly compose: (passId: string) => string;
}

export interface StudioAgent {
  readonly engine: VideoEngineKind;
  readonly setEngine: (engine: VideoEngineKind) => void;
  /** 엔진마다 준비 상태(null = 준비됨). */
  readonly preparation: Readonly<Record<VideoEngineKind, OrchestraPreparation | null>>;
  readonly prepare: (engine: VideoEngineKind) => void;
  /** 지금 엔진의 이어진 에이전트(없으면 null — 보낼 때 만든다). */
  readonly agent: StudioAgentInfo | null;
  readonly linked: readonly StudioAgentInfo[];
  /** 이 문서에 묶인 노드(첫째). */
  readonly bubble: AppBubble | null;
  /** 지금 엔진 에이전트의 세션(대화를 읽는 자리). */
  readonly sessionId: string | null;
  readonly sending: boolean;
  /** 보낸다 — 성공하면 바퀴 id. 실패는 던진다(화면이 사람 말로 알린다). */
  readonly send: (args: StudioSendArgs) => Promise<string>;
}

function engineOf(provider: { kind?: string } | undefined): VideoEngineKind | null {
  if (!provider) return 'claude';
  if (provider.kind === 'codex-cli') return 'codex';
  return null; // 로컬 모델 에이전트는 이 일을 맡기지 않는다.
}

type GraphState = ReturnType<typeof useGraphStore.getState>;

/** 이 문서(또는 이 창을 연 노드)에 묶인 캔버스 노드들. */
function boundBubblesOf(st: Pick<GraphState, 'appBubbles'>, projectName: string, docId: string, bubbleId: string): AppBubble[] {
  return (st.appBubbles ?? []).filter((b) =>
    b.appId === APP_ID && b.projectName === projectName && ((docId !== '' && b.ref === docId) || (bubbleId !== '' && b.id === bubbleId)));
}

/** 그 노드들에 이어진 커스텀 에이전트(엔진을 아는 것만 — 로컬 모델 에이전트는 이 일을 맡기지 않는다). */
function linkedAgentsOf(st: Pick<GraphState, 'agents' | 'agentConfigs'>, bound: readonly AppBubble[]): StudioAgentInfo[] {
  const ids = new Set(bound.flatMap((b) => b.linkedAgentIds ?? []));
  const out: StudioAgentInfo[] = [];
  for (const a of st.agents ?? []) {
    if (!ids.has(a.id) || a.customCreated !== true || a.trashed === true) continue;
    const engine = engineOf(st.agentConfigs?.[a.id]?.provider);
    if (engine) out.push({ id: a.id, label: a.label, engine, running: a.status === 'active' });
  }
  return out;
}

/**
 * §5.13 (X) 39-7 — 이 문서에 이어진 것의 지문(원시 문자열). `agents`·`subAgents`·`agentConfigs`·`appBubbles` 를 통째로 구독하면 다른 프로젝트·세션이
 * 움직일 때마다(AI 가 일하는 동안 초당 여러 번) 스튜디오 전체가 다시 그려진다. 지문은 이 문서의 노드와 이어진 에이전트가 바뀔 때만 달라지고,
 * 목록은 그때 스토어에서 다시 만든다(지문 구독 + 재구성).
 */
function linkSignature(st: Pick<GraphState, 'appBubbles' | 'agents' | 'agentConfigs'>, projectName: string, docId: string, bubbleId: string): string {
  const bound = boundBubblesOf(st, projectName, docId, bubbleId);
  if (bound.length === 0) return '';
  return JSON.stringify([
    bound.map((b) => [b.id, b.x, b.y, b.ref ?? '', b.file ?? '', b.linkedAgentIds ?? []]),
    linkedAgentsOf(st, bound).map((a) => [a.id, a.label, a.engine, a.running]),
  ]);
}

function waitForAgent(agentId: string): Promise<void> {
  if (useGraphStore.getState().agents?.some((a) => a.id === agentId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('agent did not appear')); }, AGENT_APPEAR_TIMEOUT_MS);
    const unsubscribe = useGraphStore.subscribe((s) => {
      if (s.agents?.some((a) => a.id === agentId)) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export function useStudioAgent(opts: { projectName: string; docId: string; docTitle: string; bubbleId: string }): StudioAgent {
  const { projectName, docId, docTitle, bubbleId } = opts;
  const { t } = useTranslation();
  const signature = useGraphStore((s) => linkSignature(s, projectName, docId, bubbleId));
  const claudeSetup = useGraphStore((s) => s.claudeSetup);
  const claudeAuth = useGraphStore((s) => s.claudeAuth);
  const codexSetup = useGraphStore((s) => s.codexSetup);
  const codexAuth = useGraphStore((s) => s.codexAuth);
  const engineChoice = useGraphStore((s) => s.userDefaults?.engineChoice?.kind);
  const [sending, setSending] = useState(false);

  // 지문이 바뀔 때만 스토어에서 다시 만든다 — 지문이 비면(이어진 노드 없음) 스토어를 열어 보지도 않는다.
  const { bound, linked } = useMemo((): { bound: AppBubble[]; linked: StudioAgentInfo[] } => {
    if (signature === '') return { bound: [], linked: [] };
    const st = useGraphStore.getState();
    const nodes = boundBubblesOf(st, projectName, docId, bubbleId);
    return { bound: nodes, linked: linkedAgentsOf(st, nodes) };
  }, [signature, projectName, docId, bubbleId]);
  const bubble = bound[0] ?? null;

  const initialEngine = (): VideoEngineKind => linked[0]?.engine ?? (engineChoice === 'codex' ? 'codex' : 'claude');
  const [engine, setEngine] = useState<VideoEngineKind>(initialEngine);
  const engineDocRef = useRef(docId);
  useEffect(() => {
    // 문서가 바뀌면 그 문서에 이어진 에이전트의 엔진으로 다시 앉는다.
    if (engineDocRef.current === docId) return;
    engineDocRef.current = docId;
    setEngine(initialEngine());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const preparation = useMemo(() => {
    const state = { claudeSetup, claudeAuth, codexSetup, codexAuth };
    return { claude: orchestraEnginePreparation('claude', state), codex: orchestraEnginePreparation('codex', state) };
  }, [claudeSetup, claudeAuth, codexSetup, codexAuth]);

  const prepare = useCallback((kind: VideoEngineKind): void => {
    const prep = preparation[kind];
    if (prep) void useGraphStore.getState().prepareOrchestraEngine(prep);
  }, [preparation]);

  const agent = linked.find((a) => a.engine === engine) ?? null;
  // 세션은 **그 에이전트의 것만** 원시값(id)으로 구독한다 — 다른 세션이 움직여도 깨지 않는다(39-7).
  const linkedAgentId = agent?.id ?? null;
  const sessionId = useGraphStore((s) => (linkedAgentId
    ? pickCardSession(s.subAgents?.[linkedAgentId], selectIDEActiveSessionForAgent(s, linkedAgentId), s.selectedSubByAgent?.[linkedAgentId])
    : null));

  /**
   * 그 엔진의 이어진 에이전트 — 없으면 기존 생성 경로로 만들어 이 문서의 노드에 잇는다. 묶인 노드·에이전트는 **부르는 순간의
   * 스토어**에서 다시 고른다(방금 만든 문서는 화면이 아직 그 문서로 다시 그려지기 전이다).
   */
  const ensureAgent = useCallback(async (kind: VideoEngineKind, target: { id: string; title: string }): Promise<string> => {
    const now = useGraphStore.getState();
    const nodes = boundBubblesOf(now, projectName, target.id, bubbleId);
    const existing = linkedAgentsOf(now, nodes).find((a) => a.engine === kind);
    if (existing) return existing.id;
    const node = nodes[0] ?? null;
    const x = node ? node.x - AGENT_SPAWN_GAP : 0;
    const y = node ? node.y : 0;
    const label = t('panel.videoStudio.ai.autoAgentName', { title: target.title.trim() || t('panel.videoStudio.untitled') });
    const res = await fetch('/api/create-custom-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, x, y, project: projectName, ...(kind === 'codex' ? { provider: { kind: 'codex-cli', modelId: '' } } : {}) }),
    });
    const body = await readJsonResponse<{ agent?: { id?: string } }>(res);
    const agentId = body.agent?.id;
    if (!agentId) throw new Error('create-custom-agent returned no agent');
    const store = useGraphStore.getState();
    if (node) {
      const at = formChangeMove(getInternalApp(node.appId), node, { linkedAgentIds: [...(node.linkedAgentIds ?? []), agentId], file: node.file, ref: node.ref });
      store.linkAppBubbleAgent(node.id, agentId, at);
    } else if (target.id !== '') {
      const size = appNodeSize(getInternalApp(APP_ID), 'screen', { width: 200, height: 200 });
      store.createAppBubble({ projectName, appId: APP_ID, x: x + AGENT_SPAWN_GAP, y, width: size.width, height: size.height, linkedAgentIds: [agentId], ref: target.id });
    }
    await waitForAgent(agentId);
    return agentId;
  }, [t, projectName, bubbleId]);

  const send = useCallback(async (args: StudioSendArgs): Promise<string> => {
    const kind = args.engine ?? engine;
    const target = args.doc ?? { id: docId, title: docTitle };
    setSending(true);
    try {
      const agentId = await ensureAgent(kind, target);
      const passId = newPassId();
      // 맡기기 직전 판 — [이 바퀴 되돌리기]의 자리. 남기지 못해도 보내기는 막지 않는다(판본은 그래도 적힌다).
      await recordHistory(projectName, target.id, { kind: 'pass-start', passId, request: args.request, mode: args.mode, ...(args.chapterId ? { chapterId: args.chapterId } : {}) }).catch(() => undefined);
      const st = useGraphStore.getState();
      const session = pickCardSession(st.subAgents?.[agentId], selectIDEActiveSessionForAgent(st, agentId), st.selectedSubByAgent?.[agentId]);
      st.addCommand(agentId, args.compose(passId), session);
      return passId;
    } finally {
      setSending(false);
    }
  }, [engine, ensureAgent, projectName, docId, docTitle]);

  return { engine, setEngine, preparation, prepare, agent, linked, bubble, sessionId, sending, send };
}
