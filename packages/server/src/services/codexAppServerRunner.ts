import { spawn, type ChildProcess } from 'node:child_process';
import { AGENT_CARD_ENV_AUTH, AGENT_CARD_ENV_TOKEN, CODEX_TURN_IDLE_CHECK_MS, CODEX_TURN_IDLE_NOTICE_MS } from '@vibisual/shared';
import type { CodexTurnArgs } from './codexRunner.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { processGuard } from './processGuard.js';
import { composeCodexTurnInput } from './codexTurnInput.js';
import { createCodexAppServerEventMapper } from './codexAppServerEvents.js';
import { CodexAppServerRpc, CodexAppServerRpcError, rpcRecord } from './codexAppServerRpc.js';
import { createCodexPendingCallLedger } from './codexPendingCalls.js';

const NATIVE_TRANSPORT = {
  requestTimeoutMs: 30_000,
  shutdownMs: 5_000,
  stopSettleTimeoutMs: 3_000,
  exitDrainMs: 2_000,
  maxLineChars: 16 * 1024 * 1024,
  clientInfo: { name: 'vibisual', title: 'Vibisual', version: '1' },
} as const;

export interface CodexAppServerTurnArgs extends CodexTurnArgs {
  binPath: string;
  /** Already validated, trusted CLI config overrides; no exec-only flags. */
  configArgs: string[];
  /** App-only instructions. Effective native developer instructions are read and retained. */
  developerInstructions?: string;
}

export interface CodexAppServerOptions {
  platform?: NodeJS.Platform;
  requestTimeoutMs?: number;
  shutdownMs?: number;
  stopSettleTimeoutMs?: number;
  exitDrainMs?: number;
  idleCheckMs?: number;
  idleNoticeMs?: number;
  killTree?: (pid: number | undefined) => void;
}

interface NativeTurn {
  child: ChildProcess;
  stop: () => void;
  steer: (input: { text: string; images?: string[] }) => Promise<boolean>;
  noteActivity: () => void;
}

const running = new Map<string, NativeTurn>();

export function isCodexAppServerTurnRunning(subAgentId: string): boolean { return running.has(subAgentId); }

export function stopCodexAppServerTurn(subAgentId: string): boolean {
  const turn = running.get(subAgentId);
  if (!turn) return false;
  turn.stop();
  return true;
}

export function noteCodexAppServerActivity(subAgentId: string): void { running.get(subAgentId)?.noteActivity(); }

/** False is a definite non-delivery; ambiguous acknowledgement failures reject instead. */
export async function steerCodexAppServerTurn(
  subAgentId: string, input: { text: string; images?: string[] },
): Promise<boolean> {
  const turn = running.get(subAgentId);
  return turn ? turn.steer(input) : false;
}

export function runCodexAppServerTurn(args: CodexAppServerTurnArgs, options: CodexAppServerOptions = {}): void {
  if (running.has(args.subAgentId)) { args.onDone('Codex app-server turn is already running', ''); return; }
  const control = /^\/(compact|clear)(?:\s+([\s\S]*))?$/i.exec(args.prompt.trim());
  const controlKind = control?.[1]?.toLowerCase();
  if (control?.[2]?.trim()) {
    args.onDone(`Native Codex /${controlKind} does not accept additional instructions through this protocol`, '');
    return;
  }
  // thread/start without a user turn is not persisted by Codex. Publishing its
  // id here would make the next thread/resume fail with "no rollout found".
  if (controlKind === 'clear') { args.onThreadReset?.(); args.onDone(undefined, ''); return; }
  if (controlKind === 'compact' && !args.resumeThreadId) { args.onDone(undefined, ''); return; }
  const platform = options.platform ?? process.platform;
  const kill = options.killTree ?? ((pid: number | undefined): void => killTree(pid, platform));
  const invocation = buildCliInvocation(args.binPath, ['app-server', ...args.configArgs], platform);
  let child: ChildProcess;
  try {
    child = spawn(invocation.file, invocation.args, {
      cwd: args.cwd, shell: invocation.shell, windowsHide: true, stdio: 'pipe',
      env: augmentedEnv({ ...process.env, ...args.env,
        ...(args.env?.[AGENT_CARD_ENV_TOKEN] ? { [AGENT_CARD_ENV_AUTH]: args.env[AGENT_CARD_ENV_TOKEN] } : {}),
        ...(args.ownerAgentId ? { VIBISUAL_OWNER_AGENT_ID: args.ownerAgentId } : {}),
        ...(args.ownerTermId ? { VIBISUAL_OWNER_TERM_ID: args.ownerTermId } : {}),
        ...(args.edgeConfig ? { VIBISUAL_CODEX_EDGE_IDS: JSON.stringify(args.edgeConfig.edgeIds) } : {}),
        VIBISUAL_CODEX_COMMAND_ID: args.commandId ?? '', VIBISUAL_SUBAGENT_ID: args.subAgentId,
      }),
      ...processGroupSpawnOptions(platform),
    });
  } catch (error) { args.onDone(`Codex app-server spawn failed: ${String(error)}`, ''); return; }
  processGuard.guardChild(child, args.ownerAgentId
    ? { parentAgentId: args.ownerAgentId, subAgentId: args.subAgentId } : null, 'codex', { reapOnExit: false });

  let settled = false;
  let stopped = false;
  let exited = false;
  let threadId = args.resumeThreadId;
  let turnId: string | undefined;
  let finalText = '';
  let lastActivityAt = Date.now();
  let idleNoticed = false;
  let lastReportedActivityAt = 0;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let exitDrainTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSteers = 0;
  let pendingCompletion: { error?: string; force?: boolean } | undefined;
  const idleCheckMs = options.idleCheckMs ?? CODEX_TURN_IDLE_CHECK_MS;
  const mapper = createCodexAppServerEventMapper(platform);
  const pendingCalls = createCodexPendingCallLedger();

  const closeStreams = (): void => {
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
  };
  const shutdown = (force: boolean): void => {
    if (exited) { closeStreams(); return; }
    if (force) kill(child.pid);
    try { child.stdin?.end(); } catch { /* Bounded cleanup owns the remaining process. */ }
    shutdownTimer = setTimeout(() => {
      if (!exited) kill(child.pid);
      closeStreams();
    }, options.shutdownMs ?? NATIVE_TRANSPORT.shutdownMs);
    shutdownTimer.unref?.();
  };
  const finish = (error?: string, force = false): void => {
    if (settled) return;
    if (pendingSteers > 0) {
      pendingCompletion = { ...(error ? { error } : {}), force };
      // Reject outstanding RPCs on a broken connection, but let the steering caller
      // observe that ambiguous result before the command owner receives onDone.
      if (force || exited) rpc.dispose();
      return;
    }
    settled = true;
    clearInterval(idleTimer); clearTimeout(stopTimer); clearTimeout(exitDrainTimer);
    if (running.get(args.subAgentId) === turn) running.delete(args.subAgentId);
    rpc.dispose();
    shutdown(force);
    for (const event of pendingCalls.flush(stopped ? 'stopped by user' : error ? 'turn failed' : 'turn closed')) args.onEvent(event);
    args.onDone(stopped ? undefined : error, finalText);
  };
  const complete = (error?: string): void => {
    if (pendingSteers > 0) { pendingCompletion = { ...(error ? { error } : {}) }; return; }
    finish(error);
  };
  const noteActivity = (): void => {
    if (settled) return;
    lastActivityAt = Date.now(); idleNoticed = false;
    if (lastActivityAt - lastReportedActivityAt >= idleCheckMs) {
      lastReportedActivityAt = lastActivityAt;
      args.onActivity?.(lastActivityAt);
    }
  };
  const onNotification = (method: string, params: unknown): void => {
    if (settled || pendingCompletion) return;
    const record = rpcRecord(params);
    if (typeof record?.threadId === 'string' && record.threadId !== threadId) return;
    if (method === 'turn/started') {
      const started = rpcRecord(record?.turn);
      if (turnId && typeof started?.id === 'string' && started.id !== turnId) return;
      if (typeof started?.id === 'string') turnId = started.id;
    }
    if (typeof record?.turnId === 'string' && turnId && record.turnId !== turnId) return;
    if (method === 'turn/completed' && turnId) {
      const completed = rpcRecord(record?.turn);
      if (typeof completed?.id === 'string' && completed.id !== turnId) return;
    }
    const mapped = mapper.map(method, params);
    if (!mapped) return;
    if (mapped.finalText !== undefined) finalText = mapped.finalText;
    if (mapped.usage) args.onUsage(mapped.usage);
    if (mapped.fileWrites?.length) args.onFileWrites(mapped.fileWrites);
    for (const event of mapped.events) { pendingCalls.note(event); args.onEvent(event); }
    if (mapped.progress) args.onProgress?.(mapped.progress);
    if (mapped.turnEnded) complete(mapped.error);
  };
  const onRequest = (id: string | number, method: string): void => {
    if (settled) return;
    if (method === 'item/tool/requestUserInput') {
      try {
        rpc.rejectRequest(id, 'Native interactive input is unavailable. Ask through the existing Vibisual question card or user channel.');
        args.onEvent({ eventType: 'system', content: 'Codex의 대화형 입력 요청은 질문 카드 또는 사용자 대화로 이어갑니다.' });
      } catch (error) { finish(error instanceof Error ? error.message : String(error), true); }
      return;
    }
    // The configured hooks handle supported approvals. A remaining request has no
    // connected UI responder and must never be approved or left waiting silently.
    try {
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval')
        rpc.respond(id, { decision: 'cancel' });
      else if (method === 'item/permissions/requestApproval') rpc.respond(id, { permissions: {}, scope: 'turn' });
      else rpc.rejectRequest(id, 'This interactive request is not connected to the Vibisual responder');
    } catch { /* The connection failure is reported together with the unavailable responder. */ }
    finish(`Codex app-server requires an unavailable interactive responder: ${method}`, true);
  };
  const rpc = new CodexAppServerRpc(child, {
    requestTimeoutMs: options.requestTimeoutMs ?? NATIVE_TRANSPORT.requestTimeoutMs,
    maxLineChars: NATIVE_TRANSPORT.maxLineChars, onActivity: noteActivity, onNotification, onRequest,
    onFailure: error => finish(error.message, true),
  });
  const turn: NativeTurn = {
    child, noteActivity,
    stop: (): void => {
      if (settled || stopped) return;
      stopped = true;
      stopTimer = setTimeout(() => finish(undefined, true), options.stopSettleTimeoutMs ?? NATIVE_TRANSPORT.stopSettleTimeoutMs);
      stopTimer.unref?.();
      if (threadId && turnId) void rpc.request('turn/interrupt', { threadId, turnId })
        .catch(() => { if (!settled) finish(undefined, true); });
      else finish(undefined, true);
    },
    steer: async (input): Promise<boolean> => {
      if (settled || stopped || controlKind || !threadId || !turnId || pendingCompletion) return false;
      pendingSteers++;
      try {
        const userInput = composeCodexTurnInput({ userText: input.text, images: input.images, appContext: '' });
        await rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: userInput.input });
        return true;
      } catch (error) {
        if (error instanceof CodexAppServerRpcError) return false;
        throw error;
      } finally {
        pendingSteers--;
        if (pendingCompletion && pendingSteers === 0) {
          // A timer runs after the caller's await continuation and its command ledger update.
          setImmediate(() => finish(pendingCompletion?.error, pendingCompletion?.force));
        }
      }
    },
  };
  running.set(args.subAgentId, turn);
  // Silence is not proof of failure. Compaction and long native tools may be quiet.
  const idleTimer = setInterval(() => {
    const idleMs = Date.now() - lastActivityAt;
    if (!settled && !stopped && !idleNoticed && idleMs >= (options.idleNoticeMs ?? CODEX_TURN_IDLE_NOTICE_MS)) {
      idleNoticed = true; args.onIdle?.({ idleMs, stalled: false });
    }
  }, idleCheckMs);
  idleTimer.unref?.();
  child.on('error', error => finish(`Codex app-server process failed: ${error.message}`, true));
  child.on('exit', code => {
    exited = true; clearTimeout(shutdownTimer);
    if (settled) { closeStreams(); return; }
    // Node emits exit before stdout is necessarily drained. Preserve the last
    // turn/completed packet; close is definitive, with a bound for inherited pipes.
    exitDrainTimer = setTimeout(() => finish(`Codex app-server exited before turn completion (${String(code)})`),
      options.exitDrainMs ?? NATIVE_TRANSPORT.exitDrainMs);
    exitDrainTimer.unref?.();
  });
  child.on('close', code => {
    exited = true; clearTimeout(shutdownTimer);
    if (!settled) finish(`Codex app-server closed before turn completion (${String(code)})`);
    closeStreams();
  });

  void (async (): Promise<void> => {
    try {
      await rpc.request('initialize', { clientInfo: NATIVE_TRANSPORT.clientInfo, capabilities: { experimentalApi: true } });
      if (settled) return;
      rpc.notify('initialized');
      const effective = rpcRecord(await rpc.request('config/read', { cwd: args.cwd, includeLayers: false }));
      if (settled) return;
      const config = rpcRecord(effective?.config);
      if (!config) throw new Error('Codex app-server returned no effective configuration');
      const input = composeCodexTurnInput({
        userText: args.prompt, images: args.images, appContext: args.developerInstructions ?? '',
        nativeDeveloperInstructions: config?.developer_instructions,
      });
      const thread = rpcRecord(await rpc.request(threadId ? 'thread/resume' : 'thread/start', {
        ...(threadId ? { threadId, excludeTurns: true } : {}), cwd: args.cwd,
        ...(args.model ? { model: args.model } : {}),
        ...(input.developerInstructions === undefined ? {} : { developerInstructions: input.developerInstructions }),
      }));
      if (settled) return;
      const descriptor = rpcRecord(thread?.thread);
      if (typeof descriptor?.id !== 'string' || !descriptor.id) throw new Error('Codex app-server returned no thread identity');
      if (threadId && descriptor.id !== threadId) throw new Error('Codex app-server resumed a different thread');
      threadId = descriptor.id;
      args.onThread(threadId);
      if (controlKind === 'compact') {
        // The acknowledgement is not completion. Native turn/item notifications
        // retain compaction progress and its eventual terminal result.
        await rpc.request('thread/compact/start', { threadId });
        return;
      }
      const started = rpcRecord(await rpc.request('turn/start', {
        threadId, input: input.input,
        ...(args.reasoningEffort ? { effort: args.reasoningEffort } : {}),
        ...(args.commandId ? { clientUserMessageId: args.commandId } : {}),
      }));
      if (settled) return;
      const descriptorTurn = rpcRecord(started?.turn);
      if (typeof descriptorTurn?.id !== 'string' || !descriptorTurn.id) throw new Error('Codex app-server returned no turn identity');
      turnId = descriptorTurn.id;
    } catch (error) {
      if (!settled) finish(error instanceof Error ? error.message : String(error), true);
    }
  })();
}
