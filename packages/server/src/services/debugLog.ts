/**
 * debugLog.ts — 버블 생명주기 진단 로그(수동 열람용).
 *
 * 커스텀 버블 소실·유령 버블처럼 재현이 어려운 사고의 **영속 타임라인**을 남기는 것이 목적이다.
 * 읽는 코드는 없고(진단 UI·REST 노출 ❌) 사람이 사고 후 직접 열어 본다.
 *
 * 용량 규약 (v4.67):
 *  - **회전** — 파일이 `MAX_LOG_BYTES` 를 넘으면 `.1` 로 밀어내고 새로 시작한다(백업 1세대).
 *    crashLog.ts 와 동일 정책. 종전엔 상한이 없어 한 파일이 590MB 까지 자랐다.
 *  - **정상상태 침묵** — 폴링처럼 매 주기 도는 호출부는 "직전과 달라졌을 때만" 기록한다
 *    (`readAliveSessionIds.diff` 선례). 진단 가치는 변화 지점에 있지 반복에 있지 않다.
 *  - **위치** — §3.5 상 이 로그는 프로젝트 데이터가 아니라 앱 진단이므로 `userData/logs` 소속이다.
 *    종전엔 `process.cwd()` 상대라 패키지 앱에서 실행 위치마다 다른 곳(AppData/Local 등)에
 *    갈라져 쌓였다. desktop main 이 부팅 시 `setDebugLogDir()` 로 고정한다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 회전 임계치 — crashLog.ts 와 같은 정책(2MB, 백업 1세대). */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const LOG_FILENAME = 'bubble-lifecycle.txt';

/** 기본 경로: 순수 서버 개발 실행 시의 저장소 상대 위치(desktop 이 주입하기 전 폴백). */
let logDir = path.resolve(process.cwd(), '../../.vibisual/logs');
let initialized = false;

/**
 * 로그 디렉토리 주입 — desktop main 이 부팅 시 `userData/logs` 로 고정한다.
 * 주입 전에는 cwd 상대 기본값을 쓴다(서버 단독 실행 호환).
 */
export function setDebugLogDir(dir: string): void {
  if (!dir || dir === logDir) return;
  logDir = dir;
  initialized = false; // 새 위치에 SERVER START 배너를 다시 남긴다.
}

function logFile(): string {
  return path.join(logDir, LOG_FILENAME);
}

/** 파일이 임계치를 넘었으면 `<file>.1` 로 밀어낸다(백업 1세대만 유지). */
function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return;
    // renameSync 는 대상이 있으면 덮어쓴다 — 백업은 항상 1개.
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* 파일 없음(ENOENT) 등 — 무시 */
  }
}

function ensureInit(): void {
  if (initialized) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile(), `\n\n===== SERVER START ${new Date().toISOString()} =====\n`);
    initialized = true;
  } catch {
    initialized = true;
  }
}

export function dbg(tag: string, data?: unknown): void {
  ensureInit();
  const ts = new Date().toISOString();
  const line = data === undefined
    ? `[${ts}] ${tag}\n`
    : `[${ts}] ${tag} ${JSON.stringify(data, (_k, v) => v instanceof Set ? [...v] : v)}\n`;
  try {
    const file = logFile();
    rotateIfNeeded(file);
    fs.appendFileSync(file, line);
  } catch { /* ignore */ }
}

// ─── 정상상태 침묵 헬퍼 ───
// 폴링·훅처럼 매 주기 도는 호출부용. 같은 key 에 대해 signature 가 직전과 같으면 기록하지 않는다.
// 진단 가치는 "무엇이 달라졌나"에 있으므로 변화 지점만 남기면 타임라인은 그대로 재구성된다.

/** key → 마지막으로 기록한 signature. 세션 수만큼만 자라고, 상한 초과 시 통째로 비운다. */
const lastSignature = new Map<string, string>();
const SIGNATURE_MAP_MAX = 500;

/**
 * `signature` 가 같은 `key` 의 직전 기록과 다를 때만 `dbg` 를 호출한다.
 * @returns 실제로 기록했으면 true.
 */
export function dbgOnChange(key: string, signature: string, tag: string, data?: unknown): boolean {
  if (lastSignature.get(key) === signature) return false;
  if (lastSignature.size >= SIGNATURE_MAP_MAX) lastSignature.clear();
  lastSignature.set(key, signature);
  dbg(tag, data);
  return true;
}
