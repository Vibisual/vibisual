import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageCollectorStatus } from '@vibisual/shared';

/**
 * §4 — 사용량 수집기(statusLine) 인스톨러. 플랜 한도 사용률(`rate_limits.*`)의 유일한 공식 경로가 statusLine stdin 이라
 * `~/.claude/settings.json` 의 `statusLine` 에 우리 핸들러를 건다(`POST /api/rate-limits`).
 * 자동 설치 ❌ opt-in — 부팅 땐 설치돼 있을 때만 포트·토큰 갱신, 새 설치는 팝업에서만. 사용자 원본은 `_vibisualPrevStatusLine` 에 보관해 passthrough 하고 해제 때 되돌린다.
 * 마커는 CLI 가 settings.json 을 다시 쓰면 사라지므로 "우리 것"은 명령 내용(`isOurEntry`)으로 판정한다.
 */

const MARKER = '_vibisualManaged';
const PREV_KEY = '_vibisualPrevStatusLine';

interface StatusLineEntry {
  type?: string;
  command?: string;
  padding?: number;
  [MARKER]?: boolean;
  [PREV_KEY]?: unknown;
  [k: string]: unknown;
}

interface ClaudeSettings {
  statusLine?: StatusLineEntry;
  subagentStatusLine?: StatusLineEntry;
  [k: string]: unknown;
}

function settingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/** statusLine 명령 — `node "<handler>" --statusline --server <url> --token <hex>`. */
function buildStatusLineCommand(port: number, handlerPath: string, token: string): string {
  const fwd = handlerPath.replace(/\\/g, '/');
  return `node "${fwd}" --statusline --server "http://127.0.0.1:${port}" --token "${token}"`;
}

/**
 * 마커가 아니라 명령 내용으로 우리 것을 가린다 — CLI 가 settings.json 을 다시 쓰면(테마 변경 등) 미지 필드인 마커가 사라진다(실측).
 * 마커만 믿으면 부팅 갱신을 건너뛰고, 다시 켤 때 우리 명령이 원본으로 보관돼 자기 자신을 passthrough 하는 무한 재귀가 된다.
 */
function isOurCommand(command: unknown, mode: '--statusline' | '--subagent-statusline'): boolean {
  if (typeof command !== 'string') return false;
  if (!command.includes('handler.mjs')) return false;
  return new RegExp(`(^|\\s)${mode}(\\s|$)`).test(command);
}

/** 마커 또는 명령 내용으로 "우리 항목" 판정. 마커 유실(위 주석) 이후에도 살아남는다. */
function isOurEntry(entry: unknown, mode: '--statusline' | '--subagent-statusline'): entry is StatusLineEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as StatusLineEntry;
  return e[MARKER] === true || isOurCommand(e.command, mode);
}

/** 보관할 사용자 원본 — 우리 항목이면 `_vibisualPrevStatusLine` 로 계속 파고든다(여러 겹 감쌈도 풀린다). 우리 것뿐이면 undefined. */
function resolvePreserved(entry: unknown, mode: '--statusline' | '--subagent-statusline'): StatusLineEntry | undefined {
  let cur: unknown = entry;
  for (let depth = 0; depth < 8; depth++) {
    if (!cur || typeof cur !== 'object') return undefined;
    if (!isOurEntry(cur, mode)) return cur as StatusLineEntry;
    cur = (cur as StatusLineEntry)[PREV_KEY];
  }
  return undefined;
}

/**
 * §4 — 서브에이전트 행 수집기. 틱마다 보이는 행 전부(`tasks[]`: status·model·tokenCount·contextWindowSize 등)를 stdin 으로 받는
 * 유일한 실시간 토큰 경로다(JSONL 은 턴 끝에 채워진다). stdout 은 비워 둔다 — 쓰면 그 행 렌더를 덮는다(순수 계측).
 */
function buildSubagentStatusLineCommand(port: number, handlerPath: string, token: string): string {
  const fwd = handlerPath.replace(/\\/g, '/');
  return `node "${fwd}" --subagent-statusline --server "http://127.0.0.1:${port}" --token "${token}"`;
}

/**
 * `subagentStatusLine` 도 같은 opt-in·보관·복원 규칙으로 설치·해제한다.
 * @returns 실제로 바뀌었으면 true.
 */
function applySubagentStatusLine(
  settings: ClaudeSettings,
  port: number,
  handlerPath: string,
  token: string,
): boolean {
  const current = settings.subagentStatusLine;
  const preserved = resolvePreserved(current, '--subagent-statusline');

  const next: StatusLineEntry = {
    type: 'command',
    command: buildSubagentStatusLineCommand(port, handlerPath, token),
    [MARKER]: true,
    ...(preserved ? { [PREV_KEY]: preserved } : {}),
  };

  if (JSON.stringify(current ?? null) === JSON.stringify(next)) return false;
  settings.subagentStatusLine = next;
  return true;
}

/** 해제 — 보관해둔 사용자 값이 있으면 되돌리고, 없으면 키를 지운다. @returns 바뀌었으면 true. */
function removeSubagentStatusLine(settings: ClaudeSettings): boolean {
  const current = settings.subagentStatusLine;
  if (!isOurEntry(current, '--subagent-statusline')) return false;

  const preserved = resolvePreserved(current, '--subagent-statusline');
  if (preserved) {
    settings.subagentStatusLine = preserved;
  } else {
    delete settings.subagentStatusLine;
  }
  return true;
}

interface ReadResult {
  raw: string | null;
  settings: ClaudeSettings;
  error?: string;
}

function readSettings(): ReadResult {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { raw: null, settings: {} };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { raw, settings: parsed as ClaudeSettings };
    }
    return { raw, settings: {} };
  } catch (err) {
    return {
      raw: null,
      settings: {},
      error: `~/.claude/settings.json JSON parse failed — left untouched: ${(err as Error).message}`,
    };
  }
}

/** §3.6 과 동일 — 변경 직전 1회 백업 + tmp → rename 원자 교체. */
function writeSettings(settings: ClaudeSettings, raw: string | null): void {
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (raw !== null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(`${p}.bak-vibisual-${ts}`, raw, 'utf-8');
  }
  const tmpPath = `${p}.tmp-vibisual-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, p);
}

function toStatus(settings: ClaudeSettings, error?: string): UsageCollectorStatus {
  const entry = settings.statusLine;
  const managed = isOurEntry(entry, '--statusline');
  // 보관된 원본 중 **우리 명령이 아닌 것** 만 passthrough 로 친다(자기 감쌈은 여기서 걸러진다).
  const prev = managed ? resolvePreserved(entry, '--statusline') : undefined;
  const prevCommand = typeof prev?.command === 'string' ? prev.command : undefined;
  return {
    installed: managed,
    // 관리 중이면 "감싼 사용자 명령이 있는가", 아니면 "사용자 statusLine 이 이미 있는가".
    foreign: managed ? prevCommand !== undefined : !!entry,
    ...(prevCommand ? { passthroughCommand: prevCommand } : {}),
    settingsPath: settingsPath(),
    ...(error ? { error } : {}),
  };
}

/** 현재 설치 상태만 조회 (파일 수정 ❌). */
export function readUsageCollectorStatus(): UsageCollectorStatus {
  const { settings, error } = readSettings();
  return toStatus(settings, error);
}

/** opt-in 설치 — 기존 statusLine 은 `_vibisualPrevStatusLine` 으로 보존해 passthrough 한다(화면 그대로). */
export function installStatusLine(port: number, handlerPath: string, token: string): UsageCollectorStatus {
  const { raw, settings, error } = readSettings();
  if (error) return toStatus(settings, error);

  try {
    const current = settings.statusLine;
    // 재설치(포트/토큰 갱신)면 이미 보관 중인 원본을 그대로 이어받는다.
    // 마커가 지워진 뒤 다시 켜는 경우 `current` 는 **우리 명령**이므로 그대로 보관하면
    // 자기 자신을 passthrough 로 띄우게 된다 — `resolvePreserved` 가 그 자리를 막는다.
    const preserved = resolvePreserved(current, '--statusline');

    const next: StatusLineEntry = {
      type: 'command',
      command: buildStatusLineCommand(port, handlerPath, token),
      [MARKER]: true,
      ...(preserved ? { [PREV_KEY]: preserved } : {}),
    };

    const mainChanged = JSON.stringify(current ?? null) !== JSON.stringify(next);
    if (mainChanged) settings.statusLine = next;

    // §4 — 서브에이전트 행 수집기도 같은 opt-in 에 묶어 함께 건다.
    const subChanged = applySubagentStatusLine(settings, port, handlerPath, token);

    if (!mainChanged && !subChanged) return toStatus(settings);

    writeSettings(settings, raw);
    return toStatus(settings);
  } catch (err) {
    return toStatus(settings, (err as Error).message);
  }
}

/** 해제 — 보관해둔 사용자 statusLine 이 있으면 그 자리에 되돌리고, 없으면 키 자체를 지운다. */
export function uninstallStatusLine(): UsageCollectorStatus {
  const { raw, settings, error } = readSettings();
  if (error) return toStatus(settings, error);

  try {
    const current = settings.statusLine;
    // 서브에이전트 쪽만 남아 있는 경우(옛 판본에서 넘어옴)도 함께 걷어내야 하므로 먼저 시도한다.
    const subChanged = removeSubagentStatusLine(settings);

    if (!isOurEntry(current, '--statusline')) {
      if (subChanged) writeSettings(settings, raw);
      return toStatus(settings);
    }

    const preserved = resolvePreserved(current, '--statusline');
    if (preserved) {
      settings.statusLine = preserved;
    } else {
      delete settings.statusLine;
    }
    writeSettings(settings, raw);
    return toStatus(settings);
  } catch (err) {
    return toStatus(settings, (err as Error).message);
  }
}

/**
 * 부팅 시 호출 — **이미 설치돼 있을 때만** 명령을 현재 포트·토큰으로 갱신한다.
 * 설치돼 있지 않으면 아무것도 하지 않는다(자동 설치 금지 — opt-in 원칙).
 */
export function refreshStatusLineIfInstalled(port: number, handlerPath: string, token: string): UsageCollectorStatus {
  const status = readUsageCollectorStatus();
  if (!status.installed || status.error) return status;
  return installStatusLine(port, handlerPath, token);
}
