// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 시작 진입점이 본체를 읽기 **전** 구간의 오류 기록.
// 본체(`index.ts`)는 스플래시 뒤에 읽혀, 그 앞 구간(스플래시 만들기·본체 읽기)의 오류는 본체 진단기(`createMainDiagnostics`)가 못 받는다.
// 그 구간만 crash.log 에 남기고, 본체가 진단기를 걸면 물러난다(같은 오류가 두 번 적히지 않게).

import { appendCrashLine } from './crashLog';

let installed = false;
let retired = false;

function record(kind: string, error: unknown): void {
  if (retired) return;
  const err = error instanceof Error ? error : new Error(String(error));
  appendCrashLine('main', 'error', `[boot] ${kind}: ${err.message}`, err.stack);
  console.error(`[main] [boot] ${kind}:`, err);
}

const onUncaught = (error: unknown): void => record('uncaughtException', error);
const onRejection = (error: unknown): void => record('unhandledRejection', error);

export function installBootErrorLog(): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
}

/** 본체가 자기 진단기를 건 직후에 부른다. */
export function retireBootErrorLog(): void {
  if (retired) return;
  retired = true;
  process.removeListener('uncaughtException', onUncaught);
  process.removeListener('unhandledRejection', onRejection);
}
