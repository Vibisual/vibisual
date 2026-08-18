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
  // 서브에이전트 종료. 설치해 두어야 서버가 부모 Stop 과 서브 Stop 을 구분해 부모 버블 조기 완료를 막는다.
  'SubagentStop',
  // ── §3.6 v4.89 신규 7종 ──
  // API 오류로 턴이 끝난 경우. 등록하지 않으면 그 세션이 영영 active 로 남는다(Stop 계열이 아닌
  // 이벤트는 전부 markActive 로 떨어지므로) — "대답 없이 Completed" 계열 증상의 훅 쪽 대응.
  'StopFailure',
  // 도구 실패. tool_name 을 달고 오므로 사후(Post)로 명시하지 않으면 사전 이벤트로 오인된다.
  'PostToolUseFailure',
  // 서브에이전트 스폰 순간. 대차대조는 PreToolUse(Task|Agent) 가 이미 맡으므로 신호로만 쓴다.
  'SubagentStart',
  // 승인 대기·거부 표시(실제 판정은 §5.3 #12-1 동기 PreToolUse 게이트가 계속 담당).
  'PermissionRequest',
  'PermissionDenied',
  // 압축 완료 — PreCompact 가 켠 표시를 내린다.
  'PostCompact',
  // 어떤 CLAUDE.md·rules 가 실제로 로드됐는지(§3.6-1 집행 계측).
  'InstructionsLoaded',
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
  /** 표식 없는 옛 Vibisual 블록을 몇 장 걷어냈는지(§3.6 중복 누적 차단). */
  prunedLegacy: number;
  /** 보존 상한을 넘어 지운 백업 파일 수(§3.6 "부팅마다 새 백업 ❌"). */
  prunedBackups: number;
  error?: Error;
}

/** §3.6 — `settings.json.bak-vibisual-*` 보존 개수. 넘치면 오래된 것부터 지운다. */
const MAX_BACKUPS = 5;

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

/**
 * §3.6 — 표식(`_vibisualManaged`)이 없던 시절에 깔린 **우리 옛 블록**인지 판정.
 *
 * 인스톨러는 표식 붙은 1장만 찾아 갱신하므로, 표식이 없던 판본이 깔아 둔 블록은
 * 이벤트마다 그대로 남아 설치·판올림마다 한 장씩 쌓인다(실측: 이벤트당 8장 = 툴
 * 1회 호출에 handler.mjs 프로세스 8개). 우리 서명(`handler.mjs` + loopback
 * `--server http://127.0.0.1:`)이 **둘 다** 보이는 블록만 걷어내므로 남의 훅은
 * 건드리지 않는다.
 */
function isLegacyVibisualBlock(block: HookMatcherBlock): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block[MARKER] === true) return false;
  if (!Array.isArray(block.hooks)) return false;
  return block.hooks.some((h) => {
    const cmd = h && typeof h === 'object' ? h.command : undefined;
    if (typeof cmd !== 'string') return false;
    return cmd.includes('handler.mjs') && cmd.includes('--server "http://127.0.0.1:');
  });
}

/** §3.6 — 백업을 최신 `MAX_BACKUPS` 개만 남기고 정리. 실패해도 설치는 계속한다. */
function pruneBackups(settingsDir: string, settingsPath: string): number {
  try {
    const prefix = `${path.basename(settingsPath)}.bak-vibisual-`;
    const entries = fs
      .readdirSync(settingsDir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const full = path.join(settingsDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    let removed = 0;
    for (const stale of entries.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(stale.full);
        removed += 1;
      } catch {
        // 개별 삭제 실패는 무시 — 백업 정리는 설치 성공을 막지 않는다.
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export function ensureClaudeHooksInstalled(port: number, handlerPath: string, token: string): HookInstallResult {
  const home = os.homedir();
  const settingsDir = path.join(home, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  const result: HookInstallResult = {
    installed: false,
    alreadyPresent: false,
    settingsPath,
    prunedLegacy: 0,
    prunedBackups: 0,
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
      const blocks: HookMatcherBlock[] = Array.isArray(existing) ? existing : [];

      // 표식 없는 우리 옛 블록 먼저 걷어낸다 — 안 그러면 판올림마다 한 장씩 쌓인다.
      const arr = blocks.filter((b) => !isLegacyVibisualBlock(b));
      const pruned = blocks.length - arr.length;
      if (pruned > 0) {
        result.prunedLegacy += pruned;
        modified = true;
      }

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
      // 손댈 게 없어도 쌓인 백업은 정리한다(§3.6 — 무한 누적 방지).
      result.prunedBackups = pruneBackups(settingsDir, settingsPath);
      result.alreadyPresent = true;
      return result;
    }

    if (raw !== null) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${settingsPath}.bak-vibisual-${ts}`;
      fs.writeFileSync(backupPath, raw, 'utf-8');
      result.backupPath = backupPath;
      result.prunedBackups = pruneBackups(settingsDir, settingsPath);
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
