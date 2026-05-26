import { diagnosticService } from './services/diagnosticService.js';
import { serverLogService } from './services/serverLogService.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * message + meta 를 단일 문자열로 합성하고, meta 가 Error 면 stack 도 분리 추출.
 * §4 v1.98 진단 로그와 §7.7 v1.99 서버 코어 로그가 같은 본문을 쓰도록 공유한다.
 */
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

  // §7.7 v1.99 — 모든 레벨을 서버 코어 로그 스트림에 적재(ServerLogPopup 뷰).
  serverLogService.record(level, text);

  // §4 v1.98 — error/warn 만 진단 서비스에 함께 적재(DebugPanel 에러 뷰어).
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
