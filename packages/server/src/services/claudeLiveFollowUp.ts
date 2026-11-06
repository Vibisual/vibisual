import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

/** `messageId` = the stream-json `uuid` to write; the caller keeps it to match Claude's transcript later (§5.5 #17-18 ⑬). */
export interface ClaudeLiveFollowUpInput { id: string; text: string; attachments?: readonly string[]; messageId?: string }

interface Delivery {
  uuid: string;
  sessionId: string;
  promise: Promise<boolean>;
  resolve: (accepted: boolean) => void;
  reject: (error: Error) => void;
  /** Bounds only the wait for receipt (and the post-result wait); a received input waits for its step boundary. */
  timer: ReturnType<typeof setTimeout> | undefined;
  settled: boolean;
  received: boolean;
  onReceived?: () => void;
}

const RECEIPT_TIMEOUT = 'Claude follow-up acknowledgement timed out; delivery is unknown';

/**
 * Claude streaming input: `next` waits for tool calls without interrupting; UUID replay confirms receipt, not compliance.
 * §5.5 #17-18 ⑫ — receipt is two-stage: `command_lifecycle` `queued` is written at once, while the replay and
 * `started` only come when Claude dequeues it at the next step boundary (measured on CLI 2.1.318).
 * https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage
 * https://code.claude.com/docs/en/cli-reference
 */
export class ClaudeLiveFollowUpChannel {
  private readonly deliveries = new Map<string, Delivery>();
  private readonly byUuid = new Map<string, Delivery>();
  private readonly activeDeliveries = new Set<Delivery>();
  private closed = false;
  private finalizing = false;
  private resultVersion = 0;

  constructor(private readonly child: ChildProcess, private readonly timeoutMs = 30_000, readonly displayReplays = false) {
    child.once('error', () => this.cancel('Claude process failed before follow-up acknowledgement'));
    child.once('exit', () => this.cancel('Claude process exited before follow-up acknowledgement'));
    child.once('close', () => this.cancel('Claude process closed before follow-up acknowledgement'));
    child.stdin?.on('error', () => this.cancel('Claude input failed before follow-up acknowledgement'));
  }

  get hasDeliveries(): boolean { return this.activeDeliveries.size > 0; }
  get canSend(): boolean { return !this.closed && !this.finalizing; }

  beginTurn(): void {
    this.deliveries.clear();
    this.byUuid.clear();
    this.activeDeliveries.clear();
    this.finalizing = false;
    ++this.resultVersion;
  }

  noteModelActivity(): void {
    this.finalizing = false;
    // Any answer after a held result invalidates that provisional completion.
    ++this.resultVersion;
  }

  /** `onReceived` fires once Claude has queued the input; the promise settles when it is dequeued into the work. */
  send(input: ClaudeLiveFollowUpInput, sessionId: string, onReceived?: () => void): Promise<boolean> {
    const existing = this.deliveries.get(input.id);
    if (existing) return existing.promise;
    const stdin = this.child.stdin;
    if (!this.canSend || !stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable
      || this.child.exitCode != null || this.child.signalCode != null) return Promise.resolve(false);
    const uuid = input.messageId ?? randomUUID();
    let resolve!: Delivery['resolve'];
    let reject!: Delivery['reject'];
    const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    const delivery: Delivery = {
      uuid, sessionId, promise, resolve, reject, timer: undefined, settled: false, received: false, ...(onReceived ? { onReceived } : {}),
    };
    this.bound(delivery, RECEIPT_TIMEOUT);
    this.deliveries.set(input.id, delivery);
    this.byUuid.set(uuid, delivery);
    this.activeDeliveries.add(delivery);
    const text = input.text + (input.attachments?.length ? `\n\n${input.attachments.join('\n')}` : '');
    try {
      stdin.write(JSON.stringify({
        type: 'user', uuid, session_id: sessionId, parent_tool_use_id: null,
        priority: 'next', origin: { kind: 'human' },
        message: { role: 'user', content: [{ type: 'text', text }] },
      }) + '\n', 'utf8', (error?: Error | null) => {
        if (error) this.reject(delivery, 'Claude input write failed; follow-up delivery is unknown');
      });
    } catch {
      // A throwing custom stream may have written bytes before throwing. Never replay.
      this.reject(delivery, 'Claude input write failed; follow-up delivery is unknown');
    }
    return promise;
  }

  /** Only our own main-session replay or command lifecycle line is internal transport bookkeeping. */
  acknowledge(message: Record<string, unknown>): boolean {
    if (message.type === 'command_lifecycle') return this.noteLifecycle(message);
    if (message.type !== 'user' || message.isReplay !== true || message.parent_tool_use_id != null
      || typeof message.uuid !== 'string') return false;
    const delivery = this.byUuid.get(message.uuid);
    if (!delivery) return false;
    if (typeof message.session_id === 'string' && message.session_id !== delivery.sessionId) return false;
    this.accept(delivery);
    return true;
  }

  private noteLifecycle(message: Record<string, unknown>): boolean {
    if (typeof message.command_uuid !== 'string') return false;
    const delivery = this.byUuid.get(message.command_uuid);
    if (!delivery) return false;
    if (typeof message.session_id === 'string' && message.session_id !== delivery.sessionId) return false;
    if (message.state === 'queued') this.receive(delivery);
    else if (message.state === 'started' || message.state === 'completed') this.accept(delivery);
    // Other states settle through replay, interruption, process exit or the post-result bound.
    return true;
  }

  /**
   * A result may precede the replay or leave accepted messages in Claude's queue.
   * Hold that result until acknowledgements settle; a later result supersedes it.
   * `origin: human` makes queued_turn_count include our submitted messages.
   */
  deferResult(message: Record<string, unknown>, finalize: () => void): boolean {
    if (!this.hasDeliveries) return false;
    this.finalizing = true;
    const version = ++this.resultVersion;
    const ids = new Set([
      ...(typeof message.user_message_uuid === 'string' ? [message.user_message_uuid] : []),
      ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids.filter((id): id is string => typeof id === 'string') : []),
    ]);
    for (const id of ids) {
      const delivery = this.byUuid.get(id);
      if (delivery) this.accept(delivery);
    }
    // An outstanding queued message belongs to the same app command even when
    // Claude starts another native turn to process it after this result.
    if (typeof message.queued_turn_count === 'number' && message.queued_turn_count > 0) return true;
    const pending = [...this.activeDeliveries].filter((delivery) => !delivery.settled);
    if (pending.length > 0) {
      // No queued work is reported, so a received input that never started must not hold finalization forever.
      for (const delivery of pending) {
        if (!delivery.timer) this.bound(delivery, 'Claude ended the turn without starting a received follow-up; delivery is unknown');
      }
      void Promise.allSettled(pending.map((delivery) => delivery.promise)).then((results) => {
        // A replay after this result means the result predates receipt. Wait for
        // Claude's subsequent result; otherwise this could dispatch a new app turn.
        if (results.some((result) => result.status === 'fulfilled' && result.value)) return;
        this.afterDeliveries(() => { if (!this.closed && version === this.resultVersion) finalize(); });
      });
      return true;
    }
    this.afterDeliveries(() => { if (!this.closed && version === this.resultVersion) finalize(); });
    return true;
  }

  /** Run after the caller of send() has recorded confirmed/uncertain delivery. */
  afterDeliveries(finalize: () => void): void {
    void Promise.allSettled([...this.activeDeliveries].map((delivery) => delivery.promise))
      .then(() => { setImmediate(finalize); });
  }

  cancel(reason: string): void {
    this.closed = true;
    this.cancelPending(reason);
  }

  cancelPending(reason: string): void {
    ++this.resultVersion;
    for (const delivery of this.activeDeliveries) this.reject(delivery, reason);
  }

  private bound(delivery: Delivery, reason: string): void {
    delivery.timer = setTimeout(() => this.reject(delivery, reason), this.timeoutMs);
    delivery.timer.unref?.();
  }

  private receive(delivery: Delivery): void {
    if (delivery.settled || delivery.received) return;
    delivery.received = true;
    clearTimeout(delivery.timer);
    delivery.timer = undefined;
    delivery.onReceived?.();
  }

  private accept(delivery: Delivery): void {
    if (delivery.settled) return;
    delivery.settled = true;
    clearTimeout(delivery.timer);
    delivery.resolve(true);
  }

  private reject(delivery: Delivery, reason: string): void {
    if (delivery.settled) return;
    delivery.settled = true;
    clearTimeout(delivery.timer);
    delivery.reject(new Error(reason));
  }
}
