import { app, crashReporter } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Vibisual desktop — 크래시/치명 오류 파일 영속화 (SCENARIO.md §4 v1.98 확장).
//
// 문제: 기존 진단 로그(diagnosticService)는 메모리 ring buffer 라 "영속화 ❌" — 앱이
// 팅기면(uncaughtException / unhandledRejection / renderer·GPU 프로세스 사망) 그 순간의
// 에러가 프로세스와 함께 증발해, 설치본 크래시 원인을 사후에 전혀 복구할 수 없었다.
//
// 해법: 두 갈래로 디스크에 남긴다.
//   (1) crash.log — main/renderer/child 프로세스의 치명 오류 라인을 userData/logs 아래
//       회전식 텍스트 파일에 **동기 append**. 크래시 컨텍스트라 flush 를 보장해야 하므로
//       비동기 쓰기(fs.appendFile)가 아니라 appendFileSync 를 쓴다.
//   (2) crashReporter(Crashpad) — 네이티브 크래시(segfault·GPU 드라이버·네이티브 OOM)는
//       JS 핸들러가 못 잡으므로 minidump(.dmp)를 userData/Crashpad 에 수집(로컬 전용,
//       업로드 ❌).
//
// §3.5 경계: 이건 프로젝트 데이터가 아니라 앱 진단이라 app.getPath('userData') 에 둔다.

/** 로그 파일 회전 임계치 — 넘으면 crash.log → crash.log.1 로 밀고 새로 시작. */
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * 로그 디렉토리 경로. app.getPath('userData') 는 app ready 전에도 대체로 동작하지만,
 * 초기 크래시(ready 전)에서 throw 할 수 있어 방어적으로 감싼다.
 */
function logDir(): string {
  let base: string;
  try {
    base = app.getPath('userData');
  } catch {
    // ready 전 극초기 실패 — temp 로 폴백(그래도 흔적은 남긴다).
    base = app.getPath('temp');
  }
  return join(base, 'logs');
}

function logFile(): string {
  return join(logDir(), 'crash.log');
}

/** 파일이 임계치를 넘었으면 crash.log.1 로 밀어낸다(백업 1개 유지). */
function rotateIfNeeded(file: string): void {
  try {
    const size = statSync(file).size;
    if (size < MAX_LOG_BYTES) return;
    const rotated = `${file}.1`;
    // renameSync 는 대상이 있으면 덮어쓴다(백업 1개만 유지).
    renameSync(file, rotated);
  } catch {
    /* 파일이 아직 없음(ENOENT) 등 — 무시 */
  }
}

function nowIso(): string {
  // Date 는 이 컨텍스트에서 사용 가능(desktop main 은 워크플로 스크립트 아님).
  return new Date().toISOString();
}

/**
 * crash.log 에 한 라인(+선택 스택)을 동기 append. 실패해도 절대 throw 하지 않는다
 * (로거가 크래시를 유발하면 본말전도).
 */
export function appendCrashLine(
  source: 'main' | 'renderer' | 'gpu' | 'child' | 'app',
  level: 'error' | 'fatal' | 'info',
  message: string,
  stack?: string,
): void {
  try {
    const dir = logDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = logFile();
    rotateIfNeeded(file);
    const head = `[${nowIso()}] [${source}/${level}] ${message}\n`;
    const body = stack ? `${stack}\n` : '';
    appendFileSync(file, head + body, 'utf8');
  } catch {
    /* 디스크 오류 등 — 로깅 실패는 조용히 삼킨다 */
  }
}

/**
 * 부팅 배너. 매 실행 시작에 한 줄 남겨, 다음에 crash.log 를 볼 때 "이 세션이 정상 종료
 * 마커(clean exit) 없이 다음 배너로 넘어갔으면 그 사이에 팅긴 것" 을 판별할 수 있게 한다.
 */
export function logAppStart(): void {
  let version = 'unknown';
  try {
    version = app.getVersion();
  } catch {
    /* ignore */
  }
  appendCrashLine('app', 'info', `=== app start v${version} (pid ${process.pid}) ===`);
}

/** 정상 종료 마커. before-quit 정리 경로에서 호출 — 크래시와 정상 종료를 구분하는 신호. */
export function logCleanExit(): void {
  appendCrashLine('app', 'info', '=== clean exit ===');
}

/**
 * Crashpad minidump 수집 시작. app ready 전, BrowserWindow 생성 전에 호출해야 renderer/GPU
 * 크래시까지 포착한다. 로컬 수집 전용(업로드 서버 없음) — .dmp 는 userData/Crashpad 에 쌓인다.
 */
export function startCrashReporter(): void {
  try {
    crashReporter.start({
      productName: 'Vibisual',
      companyName: 'Vibisual',
      submitURL: '', // 업로드 안 함 — 로컬 minidump 수집만
      uploadToServer: false,
      compress: true,
    });
  } catch (err) {
    appendCrashLine('app', 'error', `crashReporter.start failed: ${String(err)}`);
  }
}
