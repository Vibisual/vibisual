import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = '_vibisualManaged';

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'Stop',
] as const;

type HookEvent = (typeof HOOK_EVENTS)[number];

interface HookCommandEntry {
  type: 'command';
  command: string;
}

interface HookMatcherBlock {
  hooks: HookCommandEntry[];
  [MARKER]?: boolean;
  matcher?: string;
}

interface ClaudeSettings {
  hooks?: Partial<Record<HookEvent, HookMatcherBlock[]>>;
  [k: string]: unknown;
}

export interface HookInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  backupPath?: string;
  settingsPath: string;
  error?: Error;
}

/**
 * §3.6 / §3.7 v2.9 — hook 명령은 `node <handler.mjs> --server <loopbackUrl>`.
 * handler.mjs 가 (a) PreToolUse 는 동기적으로 `/api/permission-check` 호출 →
 * 결정 JSON 을 stdout 으로 반환(§5.3 #12-1 권한 승인 팝업 트리거), (b) 모든
 * 이벤트는 `/api/hook-event` 로 fire-and-forget 포워드(시각화). 경로는
 * forward-slash 정규화(Windows cmd 도 정상 해석) + 공백 대비 양쪽 따옴표.
 *
 * 이전 v2.8 까지의 `curl … /api/hook-event` 단일 fire-and-forget 은 권한 모달
 * 경로가 통째 빠져 있어(§5.3 #12-1 회귀) — 통합 앱에서 가변 도구가 "requires
 * approval" 로 자동거부되던 원인. v2.9 회귀 픽스.
 */
function buildHookCommand(port: number, handlerPath: string, token: string): string {
  const fwd = handlerPath.replace(/\\/g, '/');
  return `node "${fwd}" --server "http://127.0.0.1:${port}" --token "${token}"`;
}

function buildVibisualBlock(port: number, handlerPath: string, token: string): HookMatcherBlock {
  return {
    [MARKER]: true,
    hooks: [{ type: 'command', command: buildHookCommand(port, handlerPath, token) }],
  };
}

function blocksEqual(a: HookMatcherBlock, b: HookMatcherBlock): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ensureClaudeHooksInstalled(port: number, handlerPath: string, token: string): HookInstallResult {
  const home = os.homedir();
  const settingsDir = path.join(home, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  const result: HookInstallResult = {
    installed: false,
    alreadyPresent: false,
    settingsPath,
  };

  try {
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    let raw: string | null = null;
    let settings: ClaudeSettings = {};

    if (fs.existsSync(settingsPath)) {
      raw = fs.readFileSync(settingsPath, 'utf-8');
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as ClaudeSettings;
        }
      } catch (parseErr) {
        result.error = new Error(
          `~/.claude/settings.json JSON 파싱 실패 — 인스톨러가 파일에 손대지 않음. 사용자가 직접 점검 필요: ${(parseErr as Error).message}`,
        );
        return result;
      }
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }

    const expected = buildVibisualBlock(port, handlerPath, token);
    let modified = false;

    for (const event of HOOK_EVENTS) {
      const existing = settings.hooks[event];
      const arr: HookMatcherBlock[] = Array.isArray(existing) ? existing : [];
      const idx = arr.findIndex((b: HookMatcherBlock) => b && typeof b === 'object' && b[MARKER] === true);
      if (idx === -1) {
        arr.push(expected);
        modified = true;
      } else if (!blocksEqual(arr[idx] as HookMatcherBlock, expected)) {
        arr[idx] = expected;
        modified = true;
      }
      settings.hooks[event] = arr;
    }

    if (!modified) {
      result.alreadyPresent = true;
      return result;
    }

    if (raw !== null) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${settingsPath}.bak-vibisual-${ts}`;
      fs.writeFileSync(backupPath, raw, 'utf-8');
      result.backupPath = backupPath;
    }

    const tmpPath = `${settingsPath}.tmp-vibisual-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, settingsPath);

    result.installed = true;
    return result;
  } catch (err) {
    result.error = err as Error;
    return result;
  }
}
