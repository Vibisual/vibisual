import { diagnosticService } from './services/diagnosticService.js';
import { serverLogService } from './services/serverLogService.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatTimestamp(): string {
  return new Date().toISOString();
}

/** message + meta 를 한 문자열로 합치고 meta 가 Error 면 stack 을 따로 뽑는다. §4 진단 로그와 §7.7 서버 코어 로그가 같은 본문을 쓴다. */
function composeMessage(message: string, meta?: unknown): { text: string; stack?: string } {
  if (meta === undefined) return { text: message };
  if (meta instanceof Error) {
    return { text: `${message}: ${meta.message}`, ...(meta.stack ? { stack: meta.stack } : {}) };
  }
  if (typeof meta === 'string') return { text: `${message} ${meta}` };
  try {
    return { text: `${message} ${JSON.stringify(meta)}` };
  } catch {
    return { text: message }; // 순환 참조 등 — message 만 사용
  }
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    console.log(`${prefix} ${message}`, meta);
  } else {
    console.log(`${prefix} ${message}`);
  }

  const { text, stack } = composeMessage(message, meta);

  // §7.7 — 모든 레벨을 서버 코어 로그 스트림에 적재(ServerLogPopup 뷰).
  serverLogService.record(level, text);

  // §4 — error/warn 만 진단 서비스에도 적재(DebugPanel 에러 뷰어).
  if (level === 'error' || level === 'warn') {
    diagnosticService.record({ source: 'server', level, message: text, ...(stack ? { stack } : {}) });
  }
}

export const logger = {
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta),
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
};
