// 진단 에러 캡처 (renderer) — SCENARIO.md §4 v1.98.
//
// renderer 의 JS 에러(window error / unhandledrejection / console.error·warn)를 잡아
// 서버로 `client_error` WS 메시지로 보낸다. 서버 diagnosticService 가 단일 SSOT 라
// 여기서 모은 건 GraphSnapshot.diagnosticLog 로 되돌아와 DebugPanel 에 표시된다.
//
// WS 가 끊겨 있으면 큐잉했다가 재연결(setDiagnosticsSender) 시 flush.

interface ClientErrorPayload {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
}

type Sender = (msg: { type: 'client_error'; payload: ClientErrorPayload }) => void;

const QUEUE_MAX = 100;
const queue: ClientErrorPayload[] = [];
let sender: Sender | null = null;
let reporting = false;

/** useWebSocket 이 연결 시 sender 를 주입(끊기면 null). 주입 즉시 큐를 flush. */
export function setDiagnosticsSender(next: Sender | null): void {
  sender = next;
  if (!next) return;
  while (queue.length > 0) {
    const payload = queue.shift();
    if (payload) next({ type: 'client_error', payload });
  }
}

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function report(level: 'error' | 'warn', message: string, stack?: string): void {
  if (reporting) return; // 재진입 차단 (sender 경로가 다시 console.error 를 부르는 경우)
  reporting = true;
  try {
    const trimmed = message.slice(0, 4000).trim();
    if (!trimmed) return;
    const payload: ClientErrorPayload = { level, message: trimmed };
    if (stack) payload.stack = stack.slice(0, 8000);
    if (sender) {
      sender({ type: 'client_error', payload });
    } else {
      queue.push(payload);
      if (queue.length > QUEUE_MAX) queue.shift();
    }
  } finally {
    reporting = false;
  }
}

let installed = false;

/** main.tsx 에서 1회 호출 — window 에러 핸들러 + console.error/warn 래핑 설치. */
export function installRendererDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    const err = e.error as Error | undefined;
    report('error', err?.message ?? e.message ?? 'Unknown error', err?.stack);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    if (reason instanceof Error) report('error', `Unhandled rejection: ${reason.message}`, reason.stack);
    else report('error', `Unhandled rejection: ${stringifyArg(reason)}`);
  });

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      const stack = (args.find((a) => a instanceof Error) as Error | undefined)?.stack;
      report(level, args.map(stringifyArg).join(' '), stack);
    };
  }
}
