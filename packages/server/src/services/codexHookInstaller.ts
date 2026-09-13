import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_HOOKS_FILENAME, CODEX_HOOK_EVENTS } from '@vibisual/shared';
import type { CodexHookState } from '@vibisual/shared';
import { resolveBinary } from './binLocator.js';
import { codexHome } from './codexCli.js';
import { logger } from '../logger.js';

/**
 * §5.25 (I) — 코덱스 훅 인스톨러.
 *
 * 앱 밖에서 사용자가 돌린 코덱스 세션(터미널·에디터 확장·데스크톱 앱)을 캔버스에 올리는 유일한
 * 경로다. 코덱스 훅의 stdin 필드가 클로드와 **이름까지 같아서**(`session_id`·`cwd`·
 * `hook_event_name`·`tool_name`·`tool_input`…) 우리 `handler.mjs` 를 그대로 재사용한다 —
 * 새 수신기도, 새 전달 형식도 만들지 않는다.
 *
 * **기본 꺼짐이다.** 앱을 깔았다고 남의 전역 설정에 우리 훅이 말없이 들어가면 안 되므로,
 * 설치는 사용자가 켤 때만 REST 로 돈다(`ensureClaudeHooksInstalled` 가 부팅 시 도는 것과 다르다).
 *
 * **우리 것만 건드린다.** 판정 근거는 명령 문자열에 든 우리 서명(handler 경로 + `--token`)이다.
 * 코덱스 훅 스키마에 없는 표식 필드를 넣으면 `--strict-config` 를 쓰는 사용자에게서 깨질 수 있어,
 * 클로드 인스톨러가 옛 블록을 걷어낼 때 쓰는 것과 같은 "서명으로 식별" 방식을 택했다.
 */

interface CodexHookCommand {
  type: 'command';
  command: string;
  timeout?: number;
  statusMessage?: string;
}

interface CodexHookMatcherBlock {
  matcher?: string;
  hooks: CodexHookCommand[];
}

interface CodexHooksFile {
  description?: string;
  hooks?: Record<string, CodexHookMatcherBlock[]>;
  [key: string]: unknown;
}

/** 순수 전달 훅의 제한 시간(초). 길면 사용자의 코덱스 턴이 우리 때문에 느려진다. */
const FORWARD_TIMEOUT_SEC = 10;

/** 보존할 백업 개수. 넘치면 오래된 것부터 지운다(클로드 인스톨러와 같은 규약). */
const BACKUP_KEEP = 5;

/** 훅 파일 절대 경로. */
export function codexHooksPath(): string {
  return path.join(codexHome(), CODEX_HOOKS_FILENAME);
}

/**
 * 우리 훅 명령 한 줄.
 *
 * 코덱스의 command 엔트리는 **한 문자열**이라(클로드처럼 `args` 배열이 아니다) 경로에 공백이
 * 있으면 반드시 감싸야 한다 — `C:\Program Files\...` 에서 명령이 두 동강 나는 사고를 막는다.
 */
export function buildCodexHookCommand(nodeBin: string, handlerPath: string, port: number, token: string): string {
  const quote = (v: string): string => (/[\s&|<>^]/.test(v) ? `"${v}"` : v);
  return [
    quote(nodeBin),
    quote(handlerPath),
    '--server',
    `http://127.0.0.1:${port}`,
    '--token',
    token,
  ].join(' ');
}

/** 이 명령이 우리 것인가 — handler 경로와 토큰 플래그가 **둘 다** 보일 때만. */
export function isOurCodexHookCommand(command: string, handlerPath: string): boolean {
  if (!command) return false;
  const normalized = command.replace(/\\/g, '/');
  const handler = handlerPath.replace(/\\/g, '/');
  return normalized.includes(handler) && normalized.includes('--token');
}

/** 우리가 설치할 훅 묶음. 이벤트 목록은 상수 한 곳(`CODEX_HOOK_EVENTS`)이 소유한다. */
export function buildCodexHookBlocks(
  nodeBin: string,
  handlerPath: string,
  port: number,
  token: string,
): Record<string, CodexHookMatcherBlock[]> {
  const command = buildCodexHookCommand(nodeBin, handlerPath, port, token);
  const out: Record<string, CodexHookMatcherBlock[]> = {};
  for (const event of CODEX_HOOK_EVENTS) {
    out[event] = [{ hooks: [{ type: 'command', command, timeout: FORWARD_TIMEOUT_SEC }] }];
  }
  return out;
}

function readHooksFile(file: string): { parsed: CodexHooksFile; existed: boolean } {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return { parsed: parsed as CodexHooksFile, existed: true };
    return { parsed: {}, existed: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { parsed: {}, existed: false };
    // 파싱 실패는 **손대지 않는다** — 남의 파일을 우리가 덮어써 날리는 것이 가장 나쁜 결과다.
    throw err;
  }
}

function backupHooksFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${file}.bak-vibisual-${stamp}`;
  try {
    fs.copyFileSync(file, backup);
  } catch (err) {
    logger.warn(`[codexHooks] backup failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // 오래된 백업 정리.
  try {
    const dir = path.dirname(file);
    const base = `${path.basename(file)}.bak-vibisual-`;
    const backups = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(base))
      .sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) {
      try {
        fs.unlinkSync(path.join(dir, stale));
      } catch {
        /* 지우지 못해도 설치는 계속한다 */
      }
    }
  } catch {
    /* 목록을 못 읽어도 설치는 계속한다 */
  }
}

/** 우리 항목을 걷어낸 사본. 남의 훅은 그대로 둔다. */
function stripOurBlocks(
  hooks: Record<string, CodexHookMatcherBlock[]>,
  handlerPath: string,
): Record<string, CodexHookMatcherBlock[]> {
  const out: Record<string, CodexHookMatcherBlock[]> = {};
  for (const [event, blocks] of Object.entries(hooks)) {
    if (!Array.isArray(blocks)) continue;
    const kept: CodexHookMatcherBlock[] = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || !Array.isArray(block.hooks)) continue;
      const entries = block.hooks.filter((h) => !isOurCodexHookCommand(h?.command ?? '', handlerPath));
      // 우리 것만 있던 블록은 통째로 사라진다(빈 블록을 남기면 코덱스가 빈 훅을 읽는다).
      if (entries.length > 0) kept.push({ ...block, hooks: entries });
    }
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

function currentState(handlerPath: string | null): CodexHookState {
  const file = codexHooksPath();
  const now = Date.now();
  let parsed: CodexHooksFile;
  try {
    parsed = readHooksFile(file).parsed;
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: now,
      error: `hooks file unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const hooks = parsed.hooks ?? {};
  const events: string[] = [];
  if (handlerPath) {
    for (const [event, blocks] of Object.entries(hooks)) {
      if (!Array.isArray(blocks)) continue;
      const mine = blocks.some(
        (b) => Array.isArray(b?.hooks) && b.hooks.some((h) => isOurCodexHookCommand(h?.command ?? '', handlerPath)),
      );
      if (mine) events.push(event);
    }
  }
  return { installed: events.length > 0, hooksPath: file, events, checkedAt: now };
}

/** 지금 설치 상태. handler 경로를 모르면 "설치 안 됨"으로 본다(판정 근거가 없으므로). */
export function getCodexHookState(handlerPath: string | null): CodexHookState {
  return currentState(handlerPath);
}

/**
 * 훅 설치. 이미 있으면 우리 항목만 최신 명령으로 갈아 끼운다(포트가 바뀌면 옛 항목은 죽은 주소다).
 *
 * 코덱스는 처음 보는 훅을 **사용자가 신뢰하기 전까지 돌리지 않는다**(§5.25 (I)). 우리는 그 절차를
 * 우회하지 않으므로, 설치 성공은 "파일에 적었다"까지이고 화면이 그 다음 한 걸음을 안내한다.
 */
export function installCodexHooks(handlerPath: string, port: number, token: string): CodexHookState {
  const file = codexHooksPath();
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: Date.now(),
      error: `cannot create codex home: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: CodexHooksFile;
  try {
    parsed = readHooksFile(file).parsed;
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: Date.now(),
      error: `hooks file unreadable — left untouched: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  backupHooksFile(file);

  const nodeBin = resolveBinary('node') ?? 'node';
  const existing = stripOurBlocks(parsed.hooks ?? {}, handlerPath);
  const ours = buildCodexHookBlocks(nodeBin, handlerPath, port, token);
  const merged: Record<string, CodexHookMatcherBlock[]> = { ...existing };
  for (const [event, blocks] of Object.entries(ours)) {
    merged[event] = [...(existing[event] ?? []), ...blocks];
  }

  const next: CodexHooksFile = { ...parsed, hooks: merged };
  try {
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: Date.now(),
      error: `write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  logger.info(`[codexHooks] installed ${Object.keys(ours).length} event(s) into ${file}`);
  return currentState(handlerPath);
}

/** 훅 제거 — 우리 항목만 걷어낸다. 남의 훅과 파일 자체는 남긴다. */
export function uninstallCodexHooks(handlerPath: string): CodexHookState {
  const file = codexHooksPath();
  let parsed: CodexHooksFile;
  try {
    const read = readHooksFile(file);
    if (!read.existed) return currentState(handlerPath);
    parsed = read.parsed;
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: Date.now(),
      error: `hooks file unreadable — left untouched: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  backupHooksFile(file);
  const stripped = stripOurBlocks(parsed.hooks ?? {}, handlerPath);
  const next: CodexHooksFile = { ...parsed, hooks: stripped };
  try {
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    return {
      installed: false,
      hooksPath: file,
      events: [],
      checkedAt: Date.now(),
      error: `write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  logger.info(`[codexHooks] uninstalled from ${file}`);
  return currentState(handlerPath);
}
