import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { inject, type DispatchFunc } from 'light-my-request';
import {
  CHAT_ACTION_TTL_MS, CHAT_BRIDGE_FILE, CHAT_LOG_BUFFER_LINES, CHAT_PAIR_BAN_MS,
  CHAT_PAIR_MAX_ATTEMPTS, CHAT_PAIR_TICKET_TTL_MS, CHAT_PAIR_TOKEN_BYTES, CHAT_PEER_MAX,
  CHAT_PICK_AUTO_SESSION, CHAT_PICK_LABEL_MAX, CHAT_PICK_MAX, CHAT_TARGETS_TTL_MS,
  DEFAULT_CHAT_VERBOSITY,
} from '@vibisual/shared';
import type {
  AgentQuestions, AgentReport, AgentReview, AskUserQuestionRequest,
  ChatAction, ChatBridgeState, ChatCard, ChatChannelError, ChatChannelKind, ChatChannelState,
  ChatCommandSession, ChatCommandTarget, ChatPeer,
  ChatVerbosity, GraphSnapshot, PermissionRequest, SessionGoal, SubAgentStreamEvent, WSMessage,
} from '@vibisual/shared';
import { listChatCommandTargets } from '@vibisual/server';
import { DiscordChannel } from './discord';
import { TelegramChannel } from './telegram';
import { helpLines, parseChatCommand } from './commands';
import {
  askQuestionCard, clip, goalCard, permissionCard, questionsCard,
  reportCard, reviewCard, streamCard, textCard,
} from './cards';
import {
  canPair, canSend, goalSignature, peerKey, pickActionId, resolvePick, takeNoticeSlot,
  trimExpiring, trimLogBuffers, trimPairAttempts,
} from './policy';
import { chatStrings, fmt } from './strings';
import type { ChatStrings } from './strings';
import type { ChatChannel, ChatInbound } from './types';

// §4 메신저 원격제어 브리지 — 상위 (판올림 번호 발급 대기)
//
// 드라이버가 "그 메신저와 말하는 법"을 안다면, 여기는 **누구의 말을 들을지 · 무엇을 내보낼지 ·
// 그것을 무엇으로 실행할지**를 안다. 판정이 여기 한 곳에 있어야 메신저가 둘이어도 보안이 한 벌이다.
// (판정의 **규칙 자체**는 `policy.ts` 에 순수 함수로 있고 단위 테스트로 고정돼 있다.)
//
// 새 레일을 만들지 않는다는 것이 이 파일의 설계 전부다:
//   · 하행 = `setBroadcastSink` 팬아웃에서 부르는 `chatBroadcast()` 하나(§9 v3.40 선례 옆).
//   · 상행 = `mobileAccess.dispatchToExpress` 와 같은 light-my-request `inject` 로 **기존 REST**.
//            (`/api/commands/:sessionId` · `/api/permission-decide` · `/api/permission-pending`
//             · `/api/ask-user-question/decide` · `/api/subagents/:agentId/stop-all`)
//   · **고를 목록만은 예외** = `listChatCommandTargets()`(server 코어의 얇은 주입, `getUiLocale()`
//     선례). 팬아웃 스냅샷은 §9 스코프드라 **열어 두지 않은 탭의 에이전트가 통째로 빠진다** —
//     밖에서 폰으로 고르는 목록이 집 PC 의 탭 상태로 달라지면 에이전트가 사라진 것으로 보인다.
//   · 페어링 = §4 v3.66 QR 티켓과 같은 모양(3분·메모리 전용·per-발신자 밴) + **DM 에서만**.
//   · 언어 = `GraphSnapshot.uiLocale`(팬아웃으로 이미 오는 값). 별도 조회 레일 ❌.

interface PersistedChannel {
  enabled: boolean;
  /** 봇 토큰. **renderer 로 절대 내보내지 않는다**(상태에는 `hasToken` 만 실린다). */
  token: string | null;
}

interface PersistedChat {
  channels: Record<ChatChannelKind, PersistedChannel>;
  peers: ChatPeer[];
  verbosity: ChatVerbosity;
}

interface RuntimeChannel {
  status: ChatChannelState['status'];
  error: ChatChannelError;
  botName: string | null;
  botUsername: string | null;
  appId: string | null;
  ticket: { token: string; expiresAt: number; usedCount: number } | null;
  ticketTimer: ReturnType<typeof setTimeout> | null;
}

/** 버튼 하나가 가리키는 대기 중인 결정. */
interface PendingAction {
  kind: 'permission' | 'ask';
  requestId: string;
  /** permission 전용 — 이 버튼이 뜻하는 결정. */
  decision?: 'allow' | 'deny';
  /** ask 전용 — 고른 선택지 라벨. */
  label?: string;
  expiresAt: number;
}

interface PairAttempt { count: number; bannedUntil: number }

const KINDS: ChatChannelKind[] = ['telegram', 'discord'];

const drivers: Record<ChatChannelKind, ChatChannel> = {
  telegram: new TelegramChannel(),
  discord: new DiscordChannel(),
};

function defaultPersisted(): PersistedChat {
  return {
    channels: {
      telegram: { enabled: false, token: null },
      discord: { enabled: false, token: null },
    },
    peers: [],
    verbosity: DEFAULT_CHAT_VERBOSITY,
  };
}

function defaultRuntime(): RuntimeChannel {
  return { status: 'off', error: null, botName: null, botUsername: null, appId: null, ticket: null, ticketTimer: null };
}

let persisted: PersistedChat = defaultPersisted();
const runtime: Record<ChatChannelKind, RuntimeChannel> = {
  telegram: defaultRuntime(),
  discord: defaultRuntime(),
};

let expressAppRef: import('express').Express | null = null;

/** 페어링 실패 누적 — 키는 `kind:chatId`. 전역 잠금이 아니라 발신자별(소유자 lockout 방지). */
const pairAttempts = new Map<string, PairAttempt>();

/** 화이트리스트 밖에 안내를 마지막으로 보낸 시각 — 키는 `kind:chatId`. 무제한 답장을 막는다. */
const noticeSeen = new Map<string, number>();

/** 버튼 → 대기 중인 결정. TTL 이 지나면 "만료됨" 으로 답한다. */
const pendingActions = new Map<string, PendingAction>();

/** 마지막으로 본 스냅샷 — `/agents`·`/status`·라벨·**언어** 조회의 유일한 원천(별도 레일 ❌). */
let lastSnapshot: GraphSnapshot | null = null;

/** 이미 내보낸 카드 id — 같은 카드를 스냅샷마다 다시 보내지 않기 위한 기억. */
const seenCardIds = new Set<string>();
/** 목표별 마지막 지문 — 이것이 바뀔 때만 목표 카드가 나간다(스냅샷마다 보내면 스팸). */
const goalSeen = new Map<string, string>();
/** 카드 신호(agent_report 등)가 온 뒤에만 스냅샷을 훑는다(매 스냅샷 전수 스캔 방지). */
let cardsDirty = false;
/** 첫 스냅샷은 **보내지 않고 씨앗만 담는다** — 붙자마자 과거 카드가 쏟아지면 안 된다. */
let seeded = false;

/** `/log` 가 잘라 갈 원문 버퍼. 키 = agentId. 값은 최근 CHAT_LOG_BUFFER_LINES 줄. */
const logBuffer = new Map<string, string[]>();

/** 봇이 폰에서 쓸 말 — 앱 UI 언어를 따라간다(모달만 번역되고 카드가 한 언어면 소용이 없다). */
function S(): ChatStrings {
  return chatStrings(lastSnapshot?.uiLocale);
}

// ─── 영속 ────────────────────────────────────────────────────────────────────

function persistPath(): string {
  return join(app.getPath('userData'), CHAT_BRIDGE_FILE);
}

/**
 * `<file>.tmp` 에 쓰고 fsync 후 rename — §3.2.1-1 원자적 쓰기와 같은 절차.
 *
 * 이 파일에는 **봇 토큰**이 들어 있다. 그래서 두 가지를 함께 지킨다:
 *   ① 쓰는 도중 죽어도 기존 파일이 반파되지 않는다(토큰과 peer 목록이 통째로 날아가지 않게).
 *   ② `mode 0600` — mac/linux 에서 기본 0644 로 떨어지면 같은 기기의 다른 계정이 토큰을 읽는다.
 */
function writeSecretFileSync(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeFileSync(fd, data, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
}

function loadPersisted(): PersistedChat {
  const p = persistPath();
  if (!existsSync(p)) return defaultPersisted();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaultPersisted();
    const obj = parsed as Record<string, unknown>;
    const base = defaultPersisted();
    const rawChannels = (obj['channels'] ?? {}) as Record<string, unknown>;
    for (const kind of KINDS) {
      const raw = rawChannels[kind] as Record<string, unknown> | undefined;
      base.channels[kind] = {
        enabled: raw?.['enabled'] === true,
        token: typeof raw?.['token'] === 'string' && raw['token'] ? String(raw['token']) : null,
      };
    }
    if (Array.isArray(obj['peers'])) {
      base.peers = (obj['peers'] as unknown[])
        .map((p2) => normalizePeer(p2))
        .filter((p2): p2 is ChatPeer => p2 !== null)
        .slice(0, CHAT_PEER_MAX);
    }
    if (obj['verbosity'] === 'full' || obj['verbosity'] === 'cards') base.verbosity = obj['verbosity'];
    return base;
  } catch (err) {
    console.warn(`[chat-bridge] failed to read ${p}: ${String(err)}`);
    return defaultPersisted();
  }
}

function normalizePeer(raw: unknown): ChatPeer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  const chatId = o['chatId'];
  if ((kind !== 'telegram' && kind !== 'discord') || typeof chatId !== 'string' || !chatId) return null;
  const peer: ChatPeer = {
    kind,
    chatId,
    label: typeof o['label'] === 'string' ? o['label'] : chatId,
    pairedAt: typeof o['pairedAt'] === 'number' ? o['pairedAt'] : Date.now(),
    lastSeenAt: typeof o['lastSeenAt'] === 'number' ? o['lastSeenAt'] : 0,
    // DM 전용 규칙이 생기기 전에 저장된 peer 는 이 값이 없다 — 끊지 않고 `false` 로 읽어
    // UI 가 "이 대화는 방 전체가 볼 수 있다"고 말하게 한다(§4 ④).
    direct: o['direct'] === true,
  };
  // 겨눔 세 칸은 함께 읽고 함께 저장한다 — 하나만 왕복하면 앱을 껐다 켰을 때 화면이 말하는
  // 대상과 명령이 가는 대상이 갈린다(영속 왕복 누락이 조용히 드러나는 자리다).
  if (typeof o['targetProject'] === 'string') peer.targetProject = o['targetProject'];
  if (typeof o['targetAgentId'] === 'string') peer.targetAgentId = o['targetAgentId'];
  if (typeof o['targetSubAgentId'] === 'string') peer.targetSubAgentId = o['targetSubAgentId'];
  return peer;
}

function savePersisted(): void {
  try {
    writeSecretFileSync(persistPath(), JSON.stringify(persisted, null, 2) + '\n');
  } catch (err) {
    console.warn(`[chat-bridge] failed to persist: ${String(err)}`);
    // 반쯤 쓴 tmp 가 남으면 다음 쓰기가 그것을 덮어쓰지만, 디스크에 쓰레기를 남기지 않는다.
    try { unlinkSync(`${persistPath()}.tmp`); } catch { /* 없으면 그만 */ }
  }
}

// ─── 상태 ────────────────────────────────────────────────────────────────────

function channelState(kind: ChatChannelKind): ChatChannelState {
  const rt = runtime[kind];
  const cfg = persisted.channels[kind];
  const live = rt.ticket && rt.ticket.expiresAt > Date.now() ? rt.ticket : null;
  const link = live ? drivers[kind].buildPairLink(live.token) : null;
  return {
    kind,
    enabled: cfg.enabled,
    hasToken: cfg.token !== null,
    status: rt.status,
    error: rt.error,
    botName: rt.botName,
    botUsername: rt.botUsername,
    appId: rt.appId,
    peerCount: persisted.peers.filter((p) => p.kind === kind).length,
    pairTicket: live && link
      ? { kind, url: link.url, command: link.command, expiresAt: live.expiresAt, usedCount: live.usedCount }
      : null,
  };
}

export function getChatBridgeState(): ChatBridgeState {
  return {
    channels: KINDS.map(channelState),
    peers: persisted.peers.map((p) => ({ ...p })),
    verbosity: persisted.verbosity,
    pairLocked: anyBanned(),
  };
}

function pushState(): void {
  const state = getChatBridgeState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vibisual:chat:status', state);
  }
}

function anyBanned(): boolean {
  const now = Date.now();
  for (const a of pairAttempts.values()) if (a.bannedUntil > now) return true;
  return false;
}

// ─── 상행 — 기존 REST 재디스패치 (새 엔드포인트 ❌) ───────────────────────────

/**
 * in-process Express 를 직접 부른다. `mobileAccess.dispatchToExpress` 와 **같은 방식**이며,
 * 소켓을 거치지 않으므로 loopback 화이트리스트·토큰과 무관하다(우리는 서버의 안쪽이다).
 */
async function callApi(method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  if (!expressAppRef) return { status: 503, json: null };
  const injected = await inject(expressAppRef as unknown as DispatchFunc, {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  let json: unknown = null;
  try { json = JSON.parse(injected.body) as unknown; } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
  return { status: injected.statusCode, json };
}

// ─── 하행 — 브로드캐스트 팬아웃 ───────────────────────────────────────────────

/**
 * `setBroadcastSink` 콜백이 renderer·모바일 팬아웃과 함께 부른다.
 * 페어링된 대화가 하나도 없으면 **아무 일도 하지 않는다**(꺼져 있을 때 비용 0).
 */
export function chatBroadcast(msg: WSMessage): void {
  if (persisted.peers.length === 0) return;
  try {
    switch (msg.type) {
      case 'graph_snapshot':
        onSnapshot(msg.payload as GraphSnapshot);
        break;
      case 'permission_request':
        onPermissionRequest(msg.payload as PermissionRequest);
        break;
      case 'ask_user_question':
        onAskQuestion(msg.payload as AskUserQuestionRequest);
        break;
      case 'agent_report':
      case 'agent_questions':
      case 'agent_review':
        // 본체는 다음 graph_snapshot 에 온다(§4 v2.52 규약) — 그때 한 번만 훑는다.
        cardsDirty = true;
        break;
      case 'sub_agent_stream':
        onStreamEvent(msg.payload as SubAgentStreamEvent);
        break;
      case 'sub_agent_stream_batch':
        for (const ev of (msg.payload as SubAgentStreamEvent[] | undefined) ?? []) onStreamEvent(ev);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn(`[chat-bridge] broadcast handling failed: ${String(err)}`);
  }
}

function onSnapshot(snapshot: GraphSnapshot | undefined): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  lastSnapshot = snapshot;
  const s = S();

  // 목표는 별도 WS 종류가 아니라 스냅샷에 실려 온다 — 카드 신호와 무관하게 매번 훑되,
  // **지문이 바뀐 것만** 내보낸다(그 판정이 없으면 진행률이 곧 스팸이 된다).
  const freshGoals = collectGoalUpdates(snapshot);

  if (cardsDirty || !seeded) {
    const fresh: ChatCard[] = [];
    const collect = <T extends { id: string; agentId: string }>(
      map: Record<string, T[]> | undefined,
      build: (item: T, label?: string) => ChatCard,
    ): void => {
      for (const list of Object.values(map ?? {})) {
        for (const item of list) {
          if (seenCardIds.has(item.id)) continue;
          seenCardIds.add(item.id);
          if (seeded) fresh.push(build(item, agentLabel(item.agentId)));
        }
      }
    };

    collect<AgentReport>(snapshot.agentReports, (r, label) => reportCard(r, s, label));
    collect<AgentQuestions>(snapshot.agentQuestions, (q, label) => questionsCard(q, s, label));
    collect<AgentReview>(snapshot.agentReviews, (r, label) => reviewCard(r, s, label));

    cardsDirty = false;
    if (!seeded) { seeded = true; return; } // 첫 스냅샷은 씨앗만 — 과거 카드를 쏟지 않는다.

    // 키 개수에도 상한을 둔다(값 길이만 묶으면 오래 켜 둔 앱에서 계속 자란다).
    if (seenCardIds.size > 4000) {
      seenCardIds.clear();
      seeded = false; // 다음 스냅샷에서 다시 씨앗을 담는다(그 사이 카드는 한 번 건너뛴다).
    }
    for (const card of fresh) broadcastCard(card);
  }

  // 목표 카드는 그 목표를 **겨누고 있는** 대화에만 간다(모두에게 보내면 남의 진행률이 섞인다).
  for (const { goal, card } of freshGoals) {
    for (const peer of persisted.peers) {
      if (peer.targetAgentId === goal.agentId) sendTo(peer, card);
    }
  }
}

/** 지문이 바뀐 목표만 골라 카드로 만든다. 첫 스냅샷에서는 씨앗만 담고 아무것도 내보내지 않는다. */
function collectGoalUpdates(snapshot: GraphSnapshot): { goal: SessionGoal; card: ChatCard }[] {
  const s = S();
  const out: { goal: SessionGoal; card: ChatCard }[] = [];
  const goals = Object.values(snapshot.sessionGoals ?? {}) as SessionGoal[];
  const alive = new Set<string>();
  for (const goal of goals) {
    if (!goal?.subAgentId) continue;
    alive.add(goal.subAgentId);
    const sig = goalSignature(goal);
    if (goalSeen.get(goal.subAgentId) === sig) continue;
    const first = !goalSeen.has(goal.subAgentId);
    goalSeen.set(goal.subAgentId, sig);
    // 씨앗(앱을 켜자마자 있던 목표)과 이미 끝난 목표는 굳이 밀지 않는다.
    if (first && !seeded) continue;
    if (goal.status !== 'active') continue;
    out.push({ goal, card: goalCard(goal, s, agentLabel(goal.agentId)) });
  }
  // 사라진 목표의 지문은 들고 있을 이유가 없다(키 개수 상한 자리).
  for (const key of [...goalSeen.keys()]) if (!alive.has(key)) goalSeen.delete(key);
  return out;
}

function onPermissionRequest(req: PermissionRequest | undefined, onlyKind?: ChatChannelKind): void {
  if (!req?.requestId) return;
  const allowId = `p:${req.requestId}:a`;
  const denyId = `p:${req.requestId}:d`;
  const expiresAt = Math.min(req.expiresAt, Date.now() + CHAT_ACTION_TTL_MS);
  const s = S();
  pendingActions.set(allowId, { kind: 'permission', requestId: req.requestId, decision: 'allow', expiresAt });
  pendingActions.set(denyId, { kind: 'permission', requestId: req.requestId, decision: 'deny', expiresAt });
  trimExpiring(pendingActions, Date.now());
  broadcastCard(permissionCard(req, [
    { actionId: allowId, label: s.btnAllow, style: 'primary' },
    { actionId: denyId, label: s.btnDeny, style: 'danger' },
  ], s), onlyKind);
}

function onAskQuestion(req: AskUserQuestionRequest | undefined): void {
  if (!req?.requestId) return;
  const first = req.items[0];
  if (!first) return;
  const expiresAt = Math.min(req.expiresAt, Date.now() + CHAT_ACTION_TTL_MS);
  const actions = first.options.slice(0, 5).map((opt, i) => {
    const actionId = `q:${req.requestId}:${String(i)}`;
    pendingActions.set(actionId, { kind: 'ask', requestId: req.requestId, label: opt.label, expiresAt });
    return { actionId, label: clip(opt.label, 40) };
  });
  trimExpiring(pendingActions, Date.now());
  broadcastCard(askQuestionCard(req, actions, S()));
}

function onStreamEvent(event: SubAgentStreamEvent | undefined): void {
  if (!event?.parentAgentId) return;
  // ① `/log` 가 잘라 갈 원문 버퍼(정책과 무관 — 나가지 않고 여기 머문다).
  if (event.eventType === 'text' || event.eventType === 'thinking' || event.eventType === 'tool_use') {
    const line = event.eventType === 'tool_use'
      ? `· ${event.toolName ?? 'tool'}`
      : clip(event.content, 400);
    if (line) {
      const buf = logBuffer.get(event.parentAgentId) ?? [];
      buf.push(line);
      if (buf.length > CHAT_LOG_BUFFER_LINES) buf.splice(0, buf.length - CHAT_LOG_BUFFER_LINES);
      logBuffer.set(event.parentAgentId, buf);
      // 줄 수만 묶으면 **키(에이전트) 개수**가 자란다 — 죽은 에이전트 버퍼는 여기서 흘려보낸다.
      trimLogBuffers(logBuffer);
    }
  }
  // ② 전송은 `full` 에서만.
  //    최종 판정은 `sendTo` 의 `canSend` 한 곳이지만, 여기서 **값싼 선판정**을 먼저 한다 —
  //    스트림은 초당 여러 번 도는 뜨거운 경로라, 기본값(`cards`)에서 어차피 버릴 카드를
  //    매번 만들고 `agentLabel` 로 에이전트 배열을 훑는 것은 그 자체가 비용이다.
  if (persisted.verbosity !== 'full') return;
  const card = streamCard(event, S(), agentLabel(event.parentAgentId));
  if (card) broadcastCard(card);
}

/**
 * **카드가 한 대화로 나가는 유일한 문.**
 *
 * 전송량 정책과 **채널 on/off** 를 함께 본다(`policy.canSend`). 예전에는 여기서 on/off 를
 * 보지 않아, 사용자가 모달에서 [끄기] 를 눌러도 그 세션 동안 카드가 계속 나갔다 —
 * 드라이버 `stop()` 은 수신만 끊고 `sendCard` 는 REST 라 토큰만 있으면 그대로 갔기 때문이다.
 */
function sendTo(peer: { kind: ChatChannelKind; chatId: string }, card: ChatCard): void {
  if (!canSend({
    kind: card.kind,
    verbosity: persisted.verbosity,
    channelEnabled: persisted.channels[peer.kind].enabled,
  })) return;
  void drivers[peer.kind].sendCard(peer.chatId, card);
}

/** 정책 문을 지나 페어링된 모든 대화로(또는 한 채널로만 — 재연결 재전송이 그 자리다). */
function broadcastCard(card: ChatCard, onlyKind?: ChatChannelKind): void {
  for (const peer of persisted.peers) {
    if (onlyKind && peer.kind !== onlyKind) continue;
    sendTo(peer, card);
  }
}

/** 한 대화에만. 명령의 답처럼 물어본 사람에게만 돌려줄 때 쓴다. */
function replyTo(peer: { kind: ChatChannelKind; chatId: string }, card: ChatCard): void {
  sendTo(peer, card);
}

/**
 * 브리지가 다시 붙었다 — 그 사이 쌓인 권한 요청을 다시 민다(§4 ⑧).
 *
 * 이것이 없으면 네트워크가 잠깐 끊긴 사이 온 권한 요청은 폰에서 **영영 못 본다**. 60초 자동
 * 결정이 그대로 흘러가 이 축의 존재 이유가 정확히 무력화되는 자리다. 만료된 것은 broker 가
 * 이미 빼 두었으므로 목록에 오지 않는다(자동 소거).
 */
async function resendPendingPermissions(kind: ChatChannelKind): Promise<void> {
  if (!persisted.channels[kind].enabled) return;
  if (!persisted.peers.some((p) => p.kind === kind)) return;
  try {
    const res = await callApi('GET', '/api/permission-pending');
    const pending = (res.json as { pending?: PermissionRequest[] } | null)?.pending;
    if (!Array.isArray(pending) || pending.length === 0) return;
    const now = Date.now();
    for (const req of pending) {
      if (!req?.requestId || req.expiresAt <= now) continue;
      onPermissionRequest(req, kind);
    }
    console.log(`[chat-bridge] ${kind} resent ${String(pending.length)} pending permission(s)`);
  } catch (err) {
    console.warn(`[chat-bridge] pending resend failed: ${String(err)}`);
  }
}

// ─── 스냅샷 조회 (별도 레일 ❌ — 팬아웃으로 받은 것만 본다) ────────────────────

function agentLabel(agentId: string): string | undefined {
  const inSnapshot = lastSnapshot?.agents.find((a) => a.id === agentId)?.label;
  if (inSnapshot) return inSnapshot;
  // 범위 밖(안 열어 둔 탭)의 에이전트는 팬아웃 스냅샷에 없다 — 그래도 그 이름으로 답해야 한다.
  return commandableAgents().find((t) => t.agentId === agentId)?.label;
}

// ─── 3단계 선택 (프로젝트 → 커스텀 에이전트 → 세션) ──────────────────────────
//
// 종전에는 `/agents` 한 장이 **모든 프로젝트의** 에이전트를 스무 개까지 섞어서 보여 줬다.
// 프로젝트가 여럿이면 그 목록은 같은 이름의 에이전트가 나란히 선 채 어느 쪽인지 말하지 않고,
// 스무 개를 넘기면 뒤는 아예 보이지 않는다. 게다가 세션(= IDE 탭)을 고를 수 없어서 폰에서 보낸
// 말은 언제나 서버가 정한 정규 세션 하나로만 갔다 — PC 앞에서는 탭을 골라 말하는데 밖에서는
// 그 축이 없었다. 그래서 좁혀 들어가는 세 칸으로 나눈다.
//
// 목록의 원천이 팬아웃 스냅샷이 아니라 `listChatCommandTargets()` 인 이유는 파일 머리 주석 참조.

/**
 * 목록 조회 캐시(`CHAT_TARGETS_TTL_MS`).
 *
 * `listChatCommandTargets()` 는 **범위 미적용 전량 스냅샷**을 만든다 — 고를 목록이 집 PC 의 탭
 * 상태로 달라지지 않으려면 그래야 한다. 그런데 `agentLabel()` 의 폴백이 이 목록을 보므로,
 * 캐시가 없으면 `full` 전송량에서 **스트림 이벤트마다** 전량 스냅샷을 한 번씩 만들게 된다
 * (초당 여러 번 도는 뜨거운 경로다). 사람의 클릭 간격은 이 창보다 훨씬 길어 고르는 흐름에서는
 * 사실상 늘 최신이다.
 */
let targetsCache: { at: number; list: ChatCommandTarget[] } | null = null;

/** 명령을 받을 수 있는 에이전트 전량 — 훅 버블은 읽기 전용이라 목록에도 올리지 않는다. */
function commandableAgents(): ChatCommandTarget[] {
  const now = Date.now();
  if (targetsCache && now - targetsCache.at < CHAT_TARGETS_TTL_MS) return targetsCache.list;
  try {
    const list = listChatCommandTargets();
    targetsCache = { at: now, list };
    return list;
  } catch (err) {
    // 목록을 못 만들었다고 브리지가 죽으면 안 된다(표시 경로다) — 직전 목록, 없으면 빈 목록.
    console.warn(`[chat-bridge] target list failed: ${String(err)}`);
    return targetsCache?.list ?? [];
  }
}

function findAgent(agentId: string): ChatCommandTarget | undefined {
  return commandableAgents().find((a) => a.agentId === agentId);
}

/** 이름이 있는 프로젝트만, 표시 순서를 고정해서(같은 목록이 눌릴 때마다 같은 순서여야 한다). */
function projectNames(list: readonly ChatCommandTarget[]): string[] {
  const names = new Set<string>();
  for (const t of list) if (t.project) names.add(t.project);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function agentsInProject(list: readonly ChatCommandTarget[], project: string): ChatCommandTarget[] {
  return list.filter((t) => t.project === project);
}

/** 목록이 상한을 넘으면 뒤를 접고 그 사실을 한 줄로 알린다(조용히 자르면 없는 것이 된다). */
function pickActions(items: readonly { id: string; label: string }[], prefix: string): {
  actions: ChatAction[]; overflow: number;
} {
  const shown = items.slice(0, CHAT_PICK_MAX);
  return {
    actions: shown.map((it) => ({ actionId: pickActionId(prefix, it.id), label: clip(it.label, CHAT_PICK_LABEL_MAX) })),
    overflow: Math.max(0, items.length - shown.length),
  };
}

/** ① 프로젝트 고르기. */
function pickProjectsCard(peer: ChatPeer, list: readonly ChatCommandTarget[], s: ChatStrings): ChatCard {
  const names = projectNames(list);
  if (names.length === 0) return textCard(s.titleNoAgents, [s.noAgents]);
  const counts = new Map(names.map((n) => [n, agentsInProject(list, n).length]));
  const { actions, overflow } = pickActions(
    names.map((n) => ({ id: n, label: `${n} (${String(counts.get(n) ?? 0)})` })),
    'pj',
  );
  const lines = [peer.targetProject ? fmt(s.currentProject, { project: peer.targetProject }) : s.pickProjectHint];
  if (overflow > 0) lines.push(fmt(s.pickMore, { count: overflow }));
  return { kind: 'text', title: s.titlePickProject, lines, actions };
}

/** ② 그 프로젝트의 커스텀 에이전트 고르기. */
function pickAgentsCard(peer: ChatPeer, list: readonly ChatCommandTarget[], project: string, s: ChatStrings): ChatCard {
  const mine = agentsInProject(list, project);
  if (mine.length === 0) return textCard(s.titleNoAgents, [fmt(s.noAgentsInProject, { project })]);
  const { actions, overflow } = pickActions(
    mine.map((t) => ({
      id: t.agentId,
      label: t.queued > 0 ? `${t.label} (+${String(t.queued)})` : t.label,
    })),
    'a',
  );
  const lines = [fmt(s.currentProject, { project })];
  lines.push(peer.targetAgentId
    ? fmt(s.currentTarget, { label: agentLabel(peer.targetAgentId) ?? peer.targetAgentId })
    : s.noTarget);
  if (overflow > 0) lines.push(fmt(s.pickMore, { count: overflow }));
  return { kind: 'text', title: s.titlePickAgent, lines, actions };
}

/** 세션 한 칸의 표시 이름 — 상태와 마지막 명령이 "어느 대화였는지"를 말한다. */
function sessionLabel(sub: ChatCommandSession, s: ChatStrings): string {
  const mark = sub.blocked ? s.sessionBlocked
    : sub.status === 'active' ? s.sessionActive
    : sub.status === 'error' ? s.sessionError
    : sub.dormant ? s.sessionDormant
    : s.sessionIdle;
  return sub.lastCommand ? `${sub.label} ${mark} — ${clip(sub.lastCommand, 24)}` : `${sub.label} ${mark}`;
}

/** ③ 그 에이전트의 세션 고르기. 세션이 없어도 카드는 뜬다 — "새 대화" 한 칸이 늘 있다. */
function pickSessionsCard(peer: ChatPeer, target: ChatCommandTarget, s: ChatStrings): ChatCard {
  const { actions, overflow } = pickActions(
    target.sessions.map((sub) => ({ id: sub.id, label: sessionLabel(sub, s) })),
    'sn',
  );
  // 서버에 맡기는 칸은 목록과 무관하게 **항상** 있다(세션이 하나도 없는 새 에이전트의 유일한 길).
  actions.push({ actionId: `sn:${CHAT_PICK_AUTO_SESSION}`, label: s.btnAutoSession, style: 'primary' });
  const lines = [fmt(s.currentTarget, { label: target.label })];
  lines.push(target.sessions.length > 0 ? s.pickSessionHint : s.noSessions);
  const current = peer.targetSubAgentId
    ? target.sessions.find((sub) => sub.id === peer.targetSubAgentId)
    : undefined;
  lines.push(current ? fmt(s.currentSession, { label: current.label }) : s.currentSessionAuto);
  if (overflow > 0) lines.push(fmt(s.pickMore, { count: overflow }));
  return { kind: 'text', title: s.titlePickSession, lines, actions };
}

/**
 * 지금 이 대화가 서 있는 칸에서 **다음에 골라야 할 카드**를 만든다.
 *
 * 세 칸을 따로 부르는 대신 이 한 곳이 "어디까지 골랐나"를 보고 정한다 — 그래서 `/projects`·
 * `/agents`·`/sessions` 가 서로 다른 진입점이어도 사용자는 늘 이어지는 한 흐름을 본다.
 * 프로젝트가 하나뿐이면 **자동으로 채운다**(칸이 하나인 선택은 선택이 아니다).
 */
function nextPickCard(peer: ChatPeer, s: ChatStrings, from: 'projects' | 'agents' | 'sessions'): ChatCard {
  const list = commandableAgents();
  if (list.length === 0) return textCard(s.titleNoAgents, [s.noAgents]);

  const names = projectNames(list);
  if (from === 'projects' && names.length > 1) return pickProjectsCard(peer, list, s);

  let project = peer.targetProject;
  if (!project || !names.includes(project)) {
    if (names.length === 1) {
      project = names[0];
      peer.targetProject = project;
      savePersisted();
    } else {
      return pickProjectsCard(peer, list, s);
    }
  }
  if (from !== 'sessions') return pickAgentsCard(peer, list, project ?? '', s);

  const target = peer.targetAgentId ? list.find((t) => t.agentId === peer.targetAgentId) : undefined;
  if (!target) return pickAgentsCard(peer, list, project ?? '', s);
  return pickSessionsCard(peer, target, s);
}

// ─── 페어링 ──────────────────────────────────────────────────────────────────

function isBanned(key: string): boolean {
  const a = pairAttempts.get(key);
  return a !== undefined && a.bannedUntil > Date.now();
}

function recordPairFailure(key: string): void {
  const now = Date.now();
  const a = pairAttempts.get(key) ?? { count: 0, bannedUntil: 0 };
  a.count += 1;
  if (a.count >= CHAT_PAIR_MAX_ATTEMPTS) {
    a.bannedUntil = now + CHAT_PAIR_BAN_MS;
    a.count = 0;
  }
  pairAttempts.set(key, a);
  trimPairAttempts(pairAttempts, now);
  pushState();
}

/**
 * 화이트리스트 밖 발신자에게 안내 한 장 — **발신자별 쿨다운 아래에서만**.
 *
 * 침묵이 원칙이지만(§4 ⑤) 여기까지 침묵하면 사용자는 봇이 고장난 줄 안다. 다만 상한이
 * 없으면 그 친절이 곧 무제한 답장이 되어 봇의 존재가 노출되고 메신저 rate limit 이 소진된다.
 */
function noticeUnpaired(kind: ChatChannelKind, chatId: string, card: ChatCard): void {
  const key = peerKey(kind, chatId);
  if (isBanned(key)) return; // 밴 중에는 안내조차 없다.
  if (!takeNoticeSlot(noticeSeen, key, Date.now())) return;
  sendTo({ kind, chatId }, card);
}

/** 상수시간 비교 — 길이가 다르면 그 자체가 불일치다. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function handlePair(kind: ChatChannelKind, chatId: string, label: string, token: string, direct: boolean): void {
  const key = peerKey(kind, chatId);
  if (isBanned(key)) return; // 밴 중에는 응답조차 하지 않는다.
  const s = S();

  // **1:1 DM 에서만 받는다**(§4 ④). 길드 채널/그룹에서 묶으면 peer 키가 사람이 아니라
  // 그 방 전체를 뜻하게 되는데, 목록에는 명령을 친 한 사람 이름만 떠서 화면이 범위를
  // 잘못 말한다. 토큰이 맞는지는 **보지도 않는다** — 먼저 자리가 틀렸다.
  if (!canPair(direct)) {
    noticeUnpaired(kind, chatId, textCard(s.titleDmOnly, [s.pairDmOnly1, s.pairDmOnly2]));
    return;
  }

  const rt = runtime[kind];
  const live = rt.ticket && rt.ticket.expiresAt > Date.now() ? rt.ticket : null;
  if (!live) {
    // 살아 있는 티켓이 없다 = 지금은 연결을 받지 않는다. 이건 비밀이 아니고, 알려 주지 않으면
    // 사용자는 "만료됐다"를 알 길이 없다(§4 v3.87 이 QR 만료 안내를 붙인 것과 같은 이유).
    noticeUnpaired(kind, chatId, textCard(s.titleNotPairing, [s.pairNotOpen1, s.pairNotOpen2]));
    return;
  }
  if (!tokenMatches(token, live.token)) {
    recordPairFailure(key); // 틀린 토큰에는 아무 말도 하지 않는다(맞고 틀림을 알려 주지 않는다).
    return;
  }

  const existing = persisted.peers.find((p) => p.kind === kind && p.chatId === chatId);
  if (!existing) {
    persisted.peers.push({ kind, chatId, label, pairedAt: Date.now(), lastSeenAt: Date.now(), direct: true });
    while (persisted.peers.length > CHAT_PEER_MAX) persisted.peers.shift();
  } else {
    existing.label = label;
    existing.lastSeenAt = Date.now();
    existing.direct = true;
  }
  live.usedCount += 1;
  pairAttempts.delete(key);
  noticeSeen.delete(key);
  savePersisted();
  pushState();
  console.log(`[chat-bridge] paired ${kind} chat (${label})`);
  replyTo({ kind, chatId }, textCard(s.titlePaired, helpLines(true, s)));
}

// ─── 들어온 것 처리 ──────────────────────────────────────────────────────────

function findPeer(kind: ChatChannelKind, chatId: string): ChatPeer | undefined {
  return persisted.peers.find((p) => p.kind === kind && p.chatId === chatId);
}

function onInbound(kind: ChatChannelKind, msg: ChatInbound): void {
  const peer = findPeer(kind, msg.chatId);

  if (msg.type === 'action') {
    if (!peer) return; // 화이트리스트 밖 — 조용히 무시.
    peer.lastSeenAt = Date.now();
    void handleAction(peer, msg.actionId, msg.ackToken);
    return;
  }

  const cmd = parseChatCommand(msg.text);
  if (!cmd) return;

  // 페어링만이 화이트리스트 밖에서 도달할 수 있는 유일한 경로다.
  if (cmd.type === 'pair') { handlePair(kind, msg.chatId, msg.label, cmd.token, msg.direct); return; }

  if (!peer) {
    // 텔레그램은 봇을 처음 열면 `/start` 가 자동으로 온다 — 여기서까지 침묵하면 사용자는
    // 봇이 고장난 줄 안다. 그 한 경우에만 "아직 연결되지 않았다"를 알려 주고(쿨다운 아래),
    // 그 밖의 어떤 입력에도 반응하지 않는다(존재·상태를 흘리지 않는다).
    if (cmd.type === 'help') {
      const s = S();
      noticeUnpaired(kind, msg.chatId, textCard('Vibisual', helpLines(false, s)));
    }
    return;
  }

  peer.lastSeenAt = Date.now();
  void handleCommand(peer, cmd);
}

async function handleAction(peer: ChatPeer, actionId: string, ackToken: string): Promise<void> {
  const pending = pendingActions.get(actionId);
  const driver = drivers[peer.kind];
  const s = S();
  if (!pending || pending.expiresAt < Date.now()) {
    pendingActions.delete(actionId);
    await driver.ackAction(ackToken, s.ackExpired);
    return;
  }

  if (pending.kind === 'permission') {
    const res = await callApi('POST', '/api/permission-decide', {
      requestId: pending.requestId,
      decision: pending.decision,
      reason: 'remote',
    });
    // 같은 요청의 다른 버튼도 함께 거둔다(한 번 결정되면 나머지는 의미가 없다).
    for (const [id, p] of pendingActions) if (p.requestId === pending.requestId) pendingActions.delete(id);
    const ok = res.status === 200;
    await driver.ackAction(ackToken, ok
      ? (pending.decision === 'allow' ? s.ackAllowed : s.ackDenied)
      : s.ackTooLate);
    return;
  }

  const res = await callApi('POST', '/api/ask-user-question/decide', {
    requestId: pending.requestId,
    answers: [{ selectedLabels: pending.label ? [pending.label] : [] }],
  });
  for (const [id, p] of pendingActions) if (p.requestId === pending.requestId) pendingActions.delete(id);
  await driver.ackAction(ackToken, res.status === 200
    ? fmt(s.ackAnswered, { label: pending.label ?? '' })
    : s.ackTooLate);
}

async function handleCommand(peer: ChatPeer, cmd: ReturnType<typeof parseChatCommand>): Promise<void> {
  if (!cmd) return;
  const s = S();
  switch (cmd.type) {
    case 'help':
      replyTo(peer, textCard(s.titleHelp, helpLines(true, s)));
      return;

    case 'unpair': {
      persisted.peers = persisted.peers.filter((p) => !(p.kind === peer.kind && p.chatId === peer.chatId));
      savePersisted();
      pushState();
      replyTo(peer, textCard(s.titleUnpaired, [s.unpairDone]));
      return;
    }

    // 세 진입점이 같은 흐름의 서로 다른 칸이다 — 어디로 들어와도 `nextPickCard` 가 이어 준다.
    // 선택 버튼은 결정이 아니라 **대상 지정**이라 pendingActions 에 넣지 않는다 —
    // 결정 레지스트리는 만료·중복 해소가 걸린 자리라 성격이 다른 것을 섞으면 둘 다 흐려진다.
    case 'projects':
      replyTo(peer, nextPickCard(peer, s, 'projects'));
      return;

    case 'agents':
      replyTo(peer, nextPickCard(peer, s, 'agents'));
      return;

    case 'sessions':
      replyTo(peer, nextPickCard(peer, s, 'sessions'));
      return;

    case 'status': {
      replyTo(peer, statusCard(peer, s));
      return;
    }

    case 'log': {
      const agentId = peer.targetAgentId;
      if (!agentId) { replyTo(peer, needTargetCard(s)); return; }
      const buf = logBuffer.get(agentId) ?? [];
      const lines = buf.slice(-cmd.lines);
      replyTo(peer, textCard(
        fmt(s.titleLog, { count: lines.length }),
        lines.length > 0 ? lines : [s.logEmpty],
        agentLabel(agentId),
      ));
      return;
    }

    case 'stop': {
      const agentId = peer.targetAgentId;
      if (!agentId) { replyTo(peer, needTargetCard(s)); return; }
      const res = await callApi('POST', `/api/subagents/${encodeURIComponent(agentId)}/stop-all`);
      replyTo(peer, textCard(s.titleStop, [res.status === 200 ? s.stopRequested : s.stopFailed], agentLabel(agentId)));
      return;
    }

    case 'prompt': {
      const agentId = peer.targetAgentId;
      if (!agentId) { replyTo(peer, needTargetCard(s)); return; }
      const agent = findAgent(agentId);
      if (!agent?.sessionId) {
        // 고른 뒤 사라진 에이전트 — 겨눔을 걷어 다음 평문이 같은 곳으로 또 가지 않게 한다.
        clearTarget(peer, 'agent');
        replyTo(peer, textCard(s.titleCannotSend, [s.sendNoAgent]));
        return;
      }
      // 고른 세션이 그 사이 사라졌으면 **말없이 다른 세션으로 보내지 않는다** — 폰에서 보낸 말이
      // 엉뚱한 대화에 붙는 것이 이 축에서 가장 나쁜 실패다. 겨눔을 걷고 서버가 정하게 둔다.
      let subAgentId = peer.targetSubAgentId;
      let dropped: string | null = null;
      if (subAgentId && !agent.sessions.some((sub) => sub.id === subAgentId)) {
        dropped = subAgentId;
        subAgentId = undefined;
        clearTarget(peer, 'session');
      }
      const res = await callApi('POST', `/api/commands/${encodeURIComponent(agent.sessionId)}`, {
        text: cmd.text,
        ...(subAgentId ? { subAgentId } : {}),
      });
      if (res.status === 200) {
        const session = subAgentId ? agent.sessions.find((sub) => sub.id === subAgentId) : undefined;
        const lines = [clip(cmd.text, 200)];
        lines.push(session ? fmt(s.sentToSession, { label: session.label }) : s.sentToAutoSession);
        if (dropped) lines.push(s.sessionGoneFellBack);
        replyTo(peer, textCard(s.titleSent, lines, agent.label));
      } else if (res.status === 403) {
        replyTo(peer, textCard(s.titleCannotSend, [s.sendReadOnly]));
      } else {
        replyTo(peer, textCard(s.titleSendFailed, [fmt(s.sendServerError, { status: res.status })]));
      }
      return;
    }

    default:
      return;
  }
}

function needTargetCard(s: ChatStrings): ChatCard {
  return textCard(s.titleNeedTarget, [s.needTarget]);
}

/**
 * 겨눔을 그 칸부터 **아래로 함께** 걷는다.
 *
 * 프로젝트를 바꿨는데 에이전트 겨눔이 남아 있으면 화면은 새 프로젝트를 말하면서 명령은 옛
 * 에이전트로 간다 — 사용자가 범위를 오해하는 것이 아니라 **상태가 스스로 어긋난** 자리다.
 */
function clearTarget(peer: ChatPeer, from: 'project' | 'agent' | 'session'): void {
  if (from === 'project') { delete peer.targetProject; delete peer.targetAgentId; delete peer.targetSubAgentId; }
  else if (from === 'agent') { delete peer.targetAgentId; delete peer.targetSubAgentId; }
  else delete peer.targetSubAgentId;
  savePersisted();
}

/**
 * `/status` — §4 v4.46 세션 목표를 그대로 읽는다(진행률을 따로 계산하지 않는다).
 *
 * 목표가 없을 때 종전에는 "목표 없음" 한 줄로 끝났는데, `sessionGoals` 는 §9 슬라이스 스코프의
 * `ideLane` 그룹이라 **IDE 레인을 안 열어 두면 아예 오지 않는다** — 그러면 도는 세션이 있어도
 * 폰에는 늘 "없음"만 뜬다. 그래서 목표가 없으면 범위와 무관한 값(세션 상태·대기 수)으로 답한다.
 */
function statusCard(peer: ChatPeer, s: ChatStrings): ChatCard {
  const agentId = peer.targetAgentId;
  if (!agentId) return needTargetCard(s);
  const label = agentLabel(agentId);
  const target = findAgent(agentId);
  const goals = Object.values(lastSnapshot?.sessionGoals ?? {}) as SessionGoal[];
  const mine = goals.filter((g) => g.agentId === agentId && g.status === 'active'
    && (!peer.targetSubAgentId || g.subAgentId === peer.targetSubAgentId));
  const lines: string[] = [];
  if (target) {
    const current = peer.targetSubAgentId
      ? target.sessions.find((sub) => sub.id === peer.targetSubAgentId)
      : undefined;
    lines.push(current ? fmt(s.currentSession, { label: current.label }) : s.currentSessionAuto);
    if (current) lines.push(sessionLabel(current, s));
    if (target.queued > 0) lines.push(fmt(s.goalQueued, { count: target.queued }));
  }
  for (const goal of mine.slice(0, 2)) {
    lines.push(clip(goal.text));
    const steps = goal.steps ?? [];
    const done = steps.filter((st) => st.status === 'done').length;
    lines.push(steps.length > 0
      ? fmt(s.goalSteps, { done, total: steps.length, percent: goal.percent })
      : fmt(s.goalPercent, { percent: goal.percent }));
    if (goal.note) lines.push(clip(goal.note, 160));
  }
  if (lines.length === 0) lines.push(s.goalNone);
  return textCard(s.titleStatus, lines, label);
}

/** 선택 버튼의 접두사 — 이 셋만 대상 지정으로 가로챈다(그 밖은 결정 레지스트리의 것). */
const PICK_PREFIXES = ['pj', 'a', 'sn'] as const;

/** 이 `actionId` 가 3단계 선택 버튼인가(결정 버튼과 섞이지 않게 하는 유일한 판정). */
function isPickAction(actionId: string): boolean {
  return PICK_PREFIXES.some((prefix) => actionId.startsWith(`${prefix}:`));
}

/**
 * 3단계 선택 버튼 — 결정이 아니라 대상 지정이라 pendingActions 를 쓰지 않는다.
 *
 * 고를 때마다 **다음 칸을 바로 띄운다**. 한 번 누를 때마다 다시 명령을 쳐야 하면 세 칸이
 * 세 번의 왕복이 되고, 그건 폰에서 쓰라고 만든 축에서 가장 비싼 비용이다.
 */
function handleSelect(peer: ChatPeer, actionId: string): string | null {
  if (!isPickAction(actionId)) return null;
  const s = S();
  const list = commandableAgents();

  // ① 프로젝트
  const project = resolvePick(actionId, 'pj', projectNames(list));
  if (project !== null) {
    clearTarget(peer, 'project');
    peer.targetProject = project;
    savePersisted();
    replyTo(peer, pickAgentsCard(peer, list, project, s));
    return '';
  }

  // ② 에이전트 — 고른 에이전트의 프로젝트로 첫 칸도 함께 맞춘다(둘이 어긋나지 않게).
  const agentId = resolvePick(actionId, 'a', list.map((t) => t.agentId));
  if (agentId !== null) {
    const target = list.find((t) => t.agentId === agentId);
    if (!target) return s.sendNoAgent;
    clearTarget(peer, 'agent');
    if (target.project) peer.targetProject = target.project;
    peer.targetAgentId = agentId;
    savePersisted();
    replyTo(peer, pickSessionsCard(peer, target, s));
    return '';
  }

  // ③ 세션 — 겨누는 에이전트의 세션만 후보다(다른 에이전트의 세션 id 가 눌려도 안 걸린다).
  const target = peer.targetAgentId ? list.find((t) => t.agentId === peer.targetAgentId) : undefined;
  if (actionId === `sn:${CHAT_PICK_AUTO_SESSION}`) {
    if (!target) return s.sendNoAgent;
    clearTarget(peer, 'session');
    replyTo(peer, textCard(s.titleTargetSet, [s.targetSetAuto], target.label));
    return '';
  }
  const subId = target ? resolvePick(actionId, 'sn', target.sessions.map((sub) => sub.id)) : null;
  if (subId !== null && target) {
    peer.targetSubAgentId = subId;
    savePersisted();
    const session = target.sessions.find((sub) => sub.id === subId);
    replyTo(peer, textCard(s.titleTargetSet, [
      fmt(s.targetSetSession, { label: session?.label ?? subId }),
      s.targetSet,
    ], target.label));
    return '';
  }

  // 고른 사이에 사라졌다 — 조용히 삼키면 사용자는 왜 안 되는지 알 길이 없다.
  return s.sendNoAgent;
}

// ─── 드라이버 배선 ───────────────────────────────────────────────────────────

function contextFor(kind: ChatChannelKind) {
  return {
    onInbound: (msg: ChatInbound): void => {
      // 대상 지정 버튼만 먼저 가로챈다(결정 레지스트리를 오염시키지 않기 위해).
      if (msg.type === 'action' && isPickAction(msg.actionId)) {
        const peer = findPeer(kind, msg.chatId);
        if (peer) {
          const ack = handleSelect(peer, msg.actionId);
          if (ack !== null) {
            // 빈 문자열이면 드라이버가 알아서 "본문 없는 확인" 으로 회신한다
            // (디스코드는 빈 content 를 400 으로 거부하므로 type 6 으로 간다).
            void drivers[kind].ackAction(msg.ackToken, ack);
            return;
          }
        }
      }
      onInbound(kind, msg);
    },
    onStatus: (patch: {
      status: ChatChannelState['status']; error?: ChatChannelError;
      botName?: string | null; botUsername?: string | null; appId?: string | null;
    }): void => {
      const rt = runtime[kind];
      const wasOnline = rt.status === 'online';
      const before = `${rt.status}|${String(rt.error)}|${String(rt.botName)}`;
      rt.status = patch.status;
      if (patch.error !== undefined) rt.error = patch.error;
      if (patch.botName !== undefined) rt.botName = patch.botName;
      if (patch.botUsername !== undefined) rt.botUsername = patch.botUsername;
      if (patch.appId !== undefined) rt.appId = patch.appId;
      if (before !== `${rt.status}|${String(rt.error)}|${String(rt.botName)}`) pushState();
      // **끊겼다 붙은 그 순간**이 재전송의 자리다(§4 ⑧). 이미 online 이던 상태에서 온
      // 같은 상태 보고(폴링 한 바퀴마다 온다)로는 다시 보내지 않는다.
      if (!wasOnline && rt.status === 'online') void resendPendingPermissions(kind);
    },
    log: (line: string): void => { console.log(`[chat-bridge] ${line}`); },
  };
}

async function startChannel(kind: ChatChannelKind): Promise<void> {
  const cfg = persisted.channels[kind];
  if (!cfg.enabled || !cfg.token) return;
  await drivers[kind].start(cfg.token, contextFor(kind));
}

async function stopChannel(kind: ChatChannelKind): Promise<void> {
  await drivers[kind].stop();
  const rt = runtime[kind];
  rt.status = 'off';
  rt.error = null;
  clearTicket(kind);
}

// ─── 페어링 티켓 ─────────────────────────────────────────────────────────────

function clearTicket(kind: ChatChannelKind): void {
  const rt = runtime[kind];
  if (rt.ticketTimer) { clearTimeout(rt.ticketTimer); rt.ticketTimer = null; }
  rt.ticket = null;
}

/** 3분짜리 딥링크 티켓 발급. 화면에 살아 있는 QR 은 채널당 항상 한 장이다. */
export function issueChatPairTicket(kind: ChatChannelKind): ChatBridgeState {
  const rt = runtime[kind];
  if (rt.status === 'online') {
    clearTicket(kind);
    rt.ticket = {
      token: randomBytes(CHAT_PAIR_TOKEN_BYTES).toString('hex'),
      expiresAt: Date.now() + CHAT_PAIR_TICKET_TTL_MS,
      usedCount: 0,
    };
    rt.ticketTimer = setTimeout(() => {
      clearTicket(kind);
      console.log(`[chat-bridge] ${kind} pairing ticket expired`);
      pushState();
    }, CHAT_PAIR_TICKET_TTL_MS);
    // 티켓을 새로 내면 그동안의 실패 누적·안내 쿨다운도 푼다(소유자가 다시 시작하는 자리다).
    for (const key of [...pairAttempts.keys()]) if (key.startsWith(`${kind}:`)) pairAttempts.delete(key);
    for (const key of [...noticeSeen.keys()]) if (key.startsWith(`${kind}:`)) noticeSeen.delete(key);
    console.log(`[chat-bridge] ${kind} pairing ticket issued (valid ${String(Math.round(CHAT_PAIR_TICKET_TTL_MS / 1000))}s)`);
    pushState();
  }
  return getChatBridgeState();
}

export function revokeChatPairTicket(kind: ChatChannelKind): ChatBridgeState {
  if (runtime[kind].ticket !== null) {
    clearTicket(kind);
    console.log(`[chat-bridge] ${kind} pairing ticket revoked`);
    pushState();
  }
  return getChatBridgeState();
}

// ─── 바깥에서 부르는 문 (IPC) ────────────────────────────────────────────────

/** 토큰 저장 전 검증 — 봇 이름을 돌려줘 사용자가 성공을 **눈으로** 확인하게 한다. */
export async function verifyChatToken(kind: ChatChannelKind, token: string): Promise<{ ok: boolean; botName?: string; error?: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, error: 'token' };
  // 드라이버 `verify` 는 인스턴스 상태를 건드리지 않는다 — 돌고 있는 채널이 있어도 안전하다.
  const result = await drivers[kind].verify(trimmed);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, botName: result.botName };
}

/** 토큰 저장(+검증). 저장에 성공하면 켜져 있던 채널은 새 토큰으로 다시 붙는다. */
export async function setChatToken(kind: ChatChannelKind, token: string): Promise<ChatBridgeState> {
  const trimmed = token.trim();
  const verified = trimmed ? await drivers[kind].verify(trimmed) : null;
  const rt = runtime[kind];
  if (!trimmed) {
    persisted.channels[kind].token = null;
    persisted.channels[kind].enabled = false;
    savePersisted();
    await stopChannel(kind);
    rt.botName = null; rt.botUsername = null; rt.appId = null;
    pushState();
    return getChatBridgeState();
  }
  if (!verified?.ok) {
    rt.status = 'error';
    rt.error = verified ? verified.error : 'network';
    pushState();
    return getChatBridgeState();
  }
  persisted.channels[kind].token = trimmed;
  savePersisted();
  rt.botName = verified.botName;
  rt.botUsername = verified.botUsername;
  rt.appId = verified.appId;
  rt.error = null;
  if (persisted.channels[kind].enabled) await startChannel(kind);
  pushState();
  return getChatBridgeState();
}

export async function enableChatChannel(kind: ChatChannelKind): Promise<ChatBridgeState> {
  if (!persisted.channels[kind].token) {
    runtime[kind].status = 'error';
    runtime[kind].error = 'token';
    pushState();
    return getChatBridgeState();
  }
  persisted.channels[kind].enabled = true;
  savePersisted();
  await startChannel(kind);
  pushState();
  return getChatBridgeState();
}

export async function disableChatChannel(kind: ChatChannelKind): Promise<ChatBridgeState> {
  // 저장이 **먼저**다 — `enabled:false` 가 곧 `sendTo` 의 차단이라, 여기서 순서가 뒤집히면
  // 드라이버를 멈추는 동안 들어온 카드가 아직 켜진 것으로 읽혀 그대로 나간다.
  persisted.channels[kind].enabled = false;
  savePersisted();
  await stopChannel(kind);
  pushState();
  return getChatBridgeState();
}

/** 페어링 하나 끊기(데스크톱에서). 상대 대화에는 알리지 않는다 — 소유자의 결정이다. */
export function unpairChat(kind: ChatChannelKind, chatId: string): ChatBridgeState {
  persisted.peers = persisted.peers.filter((p) => !(p.kind === kind && p.chatId === chatId));
  savePersisted();
  pushState();
  return getChatBridgeState();
}

export function setChatVerbosity(verbosity: ChatVerbosity): ChatBridgeState {
  persisted.verbosity = verbosity === 'full' ? 'full' : 'cards';
  savePersisted();
  pushState();
  return getChatBridgeState();
}

// ─── 라이프사이클 ────────────────────────────────────────────────────────────

/** 부팅 시 1회. 켜 둔 채널이 있으면 그때 붙는다(꺼져 있으면 네트워크를 건드리지 않는다). */
export function initChatBridge(expressApp: import('express').Express): void {
  expressAppRef = expressApp;
  persisted = loadPersisted();
  for (const kind of KINDS) {
    if (persisted.channels[kind].enabled && persisted.channels[kind].token) {
      void startChannel(kind);
    }
  }
  if (persisted.peers.length > 0) {
    console.log(`[chat-bridge] ${String(persisted.peers.length)} paired chat(s) restored`);
  }
}

/** before-quit — 아웃바운드 연결·타이머 정리. */
export async function stopChatBridge(): Promise<void> {
  targetsCache = null;
  for (const kind of KINDS) await stopChannel(kind);
}
