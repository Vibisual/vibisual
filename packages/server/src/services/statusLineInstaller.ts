import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageCollectorStatus } from '@vibisual/shared';

/**
 * §4 v3.60 — 사용량 수집기(statusLine) 인스톨러.
 *
 * Claude Code 가 플랜 한도 사용률을 외부에 노출하는 **유일한 공식 경로**가 statusLine 의
 * stdin JSON(`rate_limits.five_hour.used_percentage` / `.resets_at` / `.seven_day.*`)이다.
 * JSONL 트랜스크립트에는 없고(전수 확인), CLI 서브커맨드도 없다. 그래서 §4 v1.50 이
 * "외부 statusline 스크립트가 푸시" 로 열어둔 `POST /api/rate-limits` 를 실제로 채우려면
 * `~/.claude/settings.json` 의 `statusLine` 에 우리 핸들러를 걸어야 한다.
 *
 * §3.6 훅 인스톨러와 다른 점 — **자동 설치 ❌, 사용자 opt-in**(§4 v1.50 원문 존중).
 * 부팅 시에는 이미 설치돼 있을 때만 포트·토큰을 갱신(`refreshStatusLineIfInstalled`)하고,
 * 신규 설치는 오직 사용자가 사용량 팝업에서 켤 때(`installStatusLine`)만 일어난다.
 *
 * 사용자 statusLine 보존: `statusLine` 은 훅과 달리 배열이 아니라 **객체 1개**라 그냥 덮으면
 * 사용자 설정이 사라진다. 설치 시 원본 객체를 `_vibisualPrevStatusLine` 에 통째로 보관하고
 * 핸들러가 그 명령을 같은 stdin 으로 대신 실행해 출력을 그대로 흘린다(passthrough).
 * 해제하면 원본 객체를 그 자리에 되돌린다.
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

function isManaged(entry: unknown): entry is StatusLineEntry {
  return !!entry && typeof entry === 'object' && (entry as StatusLineEntry)[MARKER] === true;
}

/**
 * §4 v4.89 — 서브에이전트 행 수집기(`subagentStatusLine`).
 *
 * 이 설정은 새로고침 틱마다 **보이는 모든 서브에이전트 행**을 stdin JSON(`tasks[]`)으로 준다 —
 * 행마다 `status`·`model`·`effort`·`tokenCount`·`contextWindowSize`·`cwd` 가 들어 있다. 우리에겐
 * 서브에이전트 토큰 사용량이 들어오는 **유일한 실시간 경로**다(JSONL 은 턴이 끝나야 채워진다).
 *
 * **화면은 건드리지 않는다.** stdout 으로 `{"id":…,"content":…}` 를 내면 그 행을 우리가 덮어쓰게
 * 되는데, Claude Code 의 기본 렌더가 이미 충분하고 우리가 바꿀 이유가 없다. 아무것도 출력하지
 * 않으면 전 행이 기본 렌더로 남는다 — 즉 이 배선은 **순수 계측 ingress** 다.
 */
function buildSubagentStatusLineCommand(port: number, handlerPath: string, token: string): string {
  const fwd = handlerPath.replace(/\\/g, '/');
  return `node "${fwd}" --subagent-statusline --server "http://127.0.0.1:${port}" --token "${token}"`;
}

/**
 * `subagentStatusLine` 을 statusLine 과 **같은 opt-in 에 묶어** 설치·해제한다.
 * 사용자 설정 보존 규칙도 동일(`_vibisualPrevStatusLine` 에 원본 보관 → 해제 시 복원).
 * @returns 실제로 바뀌었으면 true.
 */
function applySubagentStatusLine(
  settings: ClaudeSettings,
  port: number,
  handlerPath: string,
  token: string,
): boolean {
  const current = settings.subagentStatusLine;
  const preserved = isManaged(current) ? current[PREV_KEY] : current;

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
  if (!isManaged(current)) return false;

  const preserved = current[PREV_KEY];
  if (preserved && typeof preserved === 'object') {
    settings.subagentStatusLine = preserved as StatusLineEntry;
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
  const managed = isManaged(entry);
  const prev = managed ? (entry as StatusLineEntry)[PREV_KEY] : undefined;
  const prevCommand =
    prev && typeof prev === 'object' && typeof (prev as StatusLineEntry).command === 'string'
      ? (prev as StatusLineEntry).command
      : undefined;
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

/**
 * 사용자 opt-in 설치. 기존 사용자 statusLine 이 있으면 `_vibisualPrevStatusLine` 으로 보존
 * (핸들러가 passthrough 실행) — 화면 출력은 그대로 유지된다.
 */
export function installStatusLine(port: number, handlerPath: string, token: string): UsageCollectorStatus {
  const { raw, settings, error } = readSettings();
  if (error) return toStatus(settings, error);

  try {
    const current = settings.statusLine;
    // 재설치(포트/토큰 갱신)면 이미 보관 중인 원본을 그대로 이어받는다.
    const preserved = isManaged(current) ? current[PREV_KEY] : current;

    const next: StatusLineEntry = {
      type: 'command',
      command: buildStatusLineCommand(port, handlerPath, token),
      [MARKER]: true,
      ...(preserved ? { [PREV_KEY]: preserved } : {}),
    };

    const mainChanged = JSON.stringify(current ?? null) !== JSON.stringify(next);
    if (mainChanged) settings.statusLine = next;

    // §4 v4.89 — 서브에이전트 행 수집기도 같은 opt-in 에 묶어 함께 건다.
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

    if (!isManaged(current)) {
      if (subChanged) writeSettings(settings, raw);
      return toStatus(settings);
    }

    const preserved = current[PREV_KEY];
    if (preserved && typeof preserved === 'object') {
      settings.statusLine = preserved as StatusLineEntry;
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
