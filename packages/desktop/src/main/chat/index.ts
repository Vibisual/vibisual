import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { inject, type DispatchFunc } from 'light-my-request';
import {
  CHAT_ACTION_TTL_MS, CHAT_BRIDGE_FILE, CHAT_LOG_BUFFER_LINES, CHAT_PAIR_BAN_MS,
  CHAT_PAIR_MAX_ATTEMPTS, CHAT_PAIR_TICKET_TTL_MS, CHAT_PAIR_TOKEN_BYTES, CHAT_PEER_MAX,
  DEFAULT_CHAT_VERBOSITY,
} from '@vibisual/shared';
import type {
  AgentQuestions, AgentReport, AgentReview, AskUserQuestionRequest, BubbleData,
  ChatBridgeState, ChatCard, ChatChannelError, ChatChannelKind, ChatChannelState, ChatPeer,
  ChatVerbosity, GraphSnapshot, PermissionRequest, SessionGoal, SubAgentStreamEvent, WSMessage,
} from '@vibisual/shared';
import { DiscordChannel } from './discord';
import { TelegramChannel } from './telegram';
import { helpLines, parseChatCommand } from './commands';
import {
  askQuestionCard, clip, goalCard, permissionCard, questionsCard,
  reportCard, reviewCard, streamCard, textCard,
} from './cards';
import {
  canPair, canSend, goalSignature, peerKey, takeNoticeSlot,
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
  if (typeof o['targetAgentId'] === 'string') peer.targetAgentId = o['targetAgentId'];
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
  return lastSnapshot?.agents.find((a) => a.id === agentId)?.label;
}

/** 명령을 받을 수 있는 에이전트만 — 훅 버블은 읽기 전용이라 목록에도 올리지 않는다. */
function commandableAgents(): BubbleData[] {
  return (lastSnapshot?.agents ?? []).filter((a) => a.customCreated === true && typeof a.path === 'string' && a.path);
}

function findAgent(agentId: string): BubbleData | undefined {
  return commandableAgents().find((a) => a.id === agentId);
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

    case 'agents': {
      const agents = commandableAgents();
      if (agents.length === 0) {
        replyTo(peer, textCard(s.titleNoAgents, [s.noAgents]));
        return;
      }
      const actions = agents.slice(0, 20).map((a) => ({
        actionId: `a:${a.id}`,
        label: clip(a.label ?? a.id, 40),
      }));
      // 선택 버튼은 결정이 아니라 **대상 지정**이라 pendingActions 에 넣지 않는다 —
      // 결정 레지스트리는 만료·중복 해소가 걸린 자리라 성격이 다른 것을 섞으면 둘 다 흐려진다.
      replyTo(peer, {
        kind: 'text',
        title: s.titlePickAgent,
        lines: [peer.targetAgentId
          ? fmt(s.currentTarget, { label: agentLabel(peer.targetAgentId) ?? peer.targetAgentId })
          : s.noTarget],
        actions,
      });
      return;
    }

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
      if (!agent?.path) {
        replyTo(peer, textCard(s.titleCannotSend, [s.sendNoAgent]));
        return;
      }
      const res = await callApi('POST', `/api/commands/${encodeURIComponent(agent.path)}`, { text: cmd.text });
      if (res.status === 200) {
        replyTo(peer, textCard(s.titleSent, [clip(cmd.text, 200)], agent.label));
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

/** `/status` — §4 v4.46 세션 목표를 그대로 읽는다(진행률을 따로 계산하지 않는다). */
function statusCard(peer: ChatPeer, s: ChatStrings): ChatCard {
  const agentId = peer.targetAgentId;
  if (!agentId) return needTargetCard(s);
  const label = agentLabel(agentId);
  const goals = Object.values(lastSnapshot?.sessionGoals ?? {}) as SessionGoal[];
  const mine = goals.filter((g) => g.agentId === agentId && g.status === 'active');
  if (mine.length === 0) {
    const queued = (lastSnapshot?.commandQueues?.[agentId] ?? []).length;
    return textCard(s.titleStatus, [queued > 0 ? fmt(s.goalQueued, { count: queued }) : s.goalNone], label);
  }
  const lines: string[] = [];
  for (const goal of mine.slice(0, 2)) {
    lines.push(clip(goal.text));
    const steps = goal.steps ?? [];
    const done = steps.filter((st) => st.status === 'done').length;
    lines.push(steps.length > 0
      ? fmt(s.goalSteps, { done, total: steps.length, percent: goal.percent })
      : fmt(s.goalPercent, { percent: goal.percent }));
    if (goal.note) lines.push(clip(goal.note, 160));
  }
  return textCard(s.titleStatus, lines, label);
}

/** `/agents` 의 선택 버튼 — 결정이 아니라 대상 지정이라 pendingActions 를 쓰지 않는다. */
function handleSelect(peer: ChatPeer, actionId: string): string | null {
  if (!actionId.startsWith('a:')) return null;
  const s = S();
  const agentId = actionId.slice(2);
  const agent = findAgent(agentId);
  // 고른 사이에 사라졌다 — 조용히 삼키면 사용자는 왜 안 되는지 알 길이 없다.
  if (!agent) return s.sendNoAgent;
  peer.targetAgentId = agentId;
  savePersisted();
  replyTo(peer, textCard(s.titleTargetSet, [s.targetSet], agent.label));
  return '';
}

// ─── 드라이버 배선 ───────────────────────────────────────────────────────────

function contextFor(kind: ChatChannelKind) {
  return {
    onInbound: (msg: ChatInbound): void => {
      // 대상 지정 버튼만 먼저 가로챈다(결정 레지스트리를 오염시키지 않기 위해).
      if (msg.type === 'action' && msg.actionId.startsWith('a:')) {
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
  for (const kind of KINDS) await stopChannel(kind);
}
