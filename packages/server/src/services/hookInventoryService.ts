/**
 * §5.5 #17-32 — "지금 이 세션이 도는 동안 실제로 실행되는 훅" 인벤토리 + 켜고 끄기.
 *
 * #17-31(MCP)이 세운 규율을 그대로 따른다: **새 설정 포맷을 발명하지 않고** Claude Code 가
 * 실제로 읽는 파일을 매번 다시 읽어 목록을 세운다. 디스크가 SSOT 라 상태를 들지 않는다 —
 * 캐시·broadcast·checkpoint 미관여.
 *
 * 읽는 곳(Claude Code 자신의 설정 우선순위와 같은 넷):
 *   - `~/.claude/settings.json`                  → 글로벌(user) — 모든 프로젝트에서 돈다
 *   - `<루트>/.claude/settings.json`             → 프로젝트(레포에 커밋되는 공유 자산)
 *   - `<루트>/.claude/settings.local.json`       → 로컬(내 컴퓨터에서만)
 *   - managed-settings.json                      → 관리자 정책(읽기 전용)
 *
 * 끄기(④): Claude Code 에는 훅을 끄는 손잡이가 **없다**(플래그도 하위명령도 없다). 그래서
 * 파일에서 지우는 대신 **그 명령 객체를 같은 블록 안 `_vibisualDisabled` 로 옮겨 담는다** —
 *   · `hooks` 배열에서 빠졌으니 Claude Code 는 그 명령을 실행하지 않는다,
 *   · 원문이 바로 옆에 그대로 남아 있어 되돌리기가 손실 없는 이동 한 번이다,
 *   · 우리 흔적이 **블록 안**에만 산다(이미 `_vibisualManaged` 표식이 증명된 그 자리).
 * 사용자 파일을 지우는 방향의 오차를 만들지 않는 것이 이 모듈의 유일한 규율이다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { HookEntry, HookInventory, HookScope } from '@vibisual/shared';

import { logger } from '../logger.js';

import { parseJsonc } from './runConfigScanner.js';
import { atomicWriteFileSync } from './statePersistence.js';

/** 설정 파일 상한 — 이보다 크면 우리가 아는 그 파일이 아니다(읽지 않는다). */
const SETTINGS_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** 인스톨러가 자기 블록에 찍는 표식(`hookInstaller.ts`). 이 줄은 끌 수 없다 — 앱의 눈이다. */
const VIBISUAL_MARKER = '_vibisualManaged';

/** 꺼 둔 명령이 잠들어 있는 자리. 같은 블록 안에 산다(④). */
const DISABLED_KEY = '_vibisualDisabled';

/** 한 훅 명령의 원문(설정에 적힌 그대로 — 모르는 필드는 건드리지 않는다). */
interface RawHookCommand {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
  [k: string]: unknown;
}

/** `hooks.<이벤트>` 배열의 한 칸. */
interface RawHookBlock {
  matcher?: unknown;
  hooks?: unknown;
  [k: string]: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > SETTINGS_FILE_MAX_BYTES) return null;
    // 주석이 달린 설정 파일을 통째로 "없음" 으로 만들지 않는다(#17-20 ② 의 관용 파서 재사용).
    const parsed = parseJsonc(fs.readFileSync(file, 'utf8'));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/** 관리자(managed) 설정 — 플랫폼별 고정 위치. 없으면 없는 대로 둔다. */
function managedSettingsPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['PROGRAMDATA'] ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
  }
  if (process.platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  return '/etc/claude-code/managed-settings.json';
}

/** 읽을 파일들 — 넓은 범위에서 좁은 범위로. 화면의 묶음 순서이기도 하다. */
function settingsFiles(projectPath: string): { scope: HookScope; file: string }[] {
  return [
    { scope: 'user', file: path.join(os.homedir(), '.claude', 'settings.json') },
    { scope: 'project', file: path.join(projectPath, '.claude', 'settings.json') },
    { scope: 'local', file: path.join(projectPath, '.claude', 'settings.local.json') },
    { scope: 'managed', file: managedSettingsPath() },
  ];
}

/**
 * 명령 원문 → 짧고 안정된 지문. 목록 키에 인덱스를 쓰지 않기 위한 것이다(파일이 바뀌면
 * 인덱스는 다른 훅을 가리키지만 지문은 그렇지 않다). 충돌해도 손해가 없는 표시용이라
 * 암호학적 해시가 아니라 32비트 FNV-1a 로 충분하다.
 */
export function hashHookCommand(command: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < command.length; i += 1) {
    h ^= command.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function entryId(scope: HookScope, event: string, matcher: string, command: string): string {
  return `${scope}:${event}:${matcher}:${hashHookCommand(command)}`;
}

/** 명령 객체 하나를 화면 한 줄로. 켜짐/꺼짐은 그 객체가 어느 배열에 들어 있었는지가 정한다. */
function toEntry(
  raw: RawHookCommand,
  event: string,
  matcher: string,
  scope: HookScope,
  sourceFile: string,
  enabled: boolean,
  isVibisual: boolean,
): HookEntry | null {
  const command = typeof raw.command === 'string' ? raw.command : '';
  // 명령이 없는 칸은 화면에 세울 것이 없다(무엇이 도는지가 이 목록의 전부다).
  if (command.trim().length === 0) return null;

  // 우리 블록과 관리자 정책은 여기서 끄지 않는다 — 이유를 적고 토글을 감춘다.
  const lockReason = isVibisual
    ? ('vibisual' as const)
    : scope === 'managed'
      ? ('managed' as const)
      : null;

  return {
    id: entryId(scope, event, matcher, command),
    event,
    matcher,
    command,
    ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}),
    scope,
    sourceFile,
    enabled,
    toggleable: lockReason === null,
    ...(lockReason ? { lockReason } : {}),
  };
}

/**
 * 이 프로젝트(=이 세션)에 적용되는 훅 전부. 매 호출마다 디스크를 다시 읽는다
 * (화면의 새로고침이 곧 이 호출이다 — 앱 밖에서 훅을 추가한 직후에도 눌러서 보이게).
 */
export function scanHookInventory(projectPath: string): HookInventory {
  const hooks: HookEntry[] = [];
  const scanned: string[] = [];

  for (const { scope, file } of settingsFiles(projectPath)) {
    const root = readJsonObject(file);
    if (!root) continue;
    scanned.push(file);

    const hooksRec = asRecord(root['hooks']);
    if (!hooksRec) continue;

    for (const [event, blocksRaw] of Object.entries(hooksRec)) {
      if (!Array.isArray(blocksRaw)) continue;

      for (const blockRaw of blocksRaw) {
        const block = asRecord(blockRaw) as RawHookBlock | null;
        if (!block) continue;

        const matcher = typeof block.matcher === 'string' ? block.matcher : '';
        const isVibisual = block[VIBISUAL_MARKER] === true;

        // ① 켜져 있는 명령 — Claude Code 가 실제로 실행하는 그 배열.
        if (Array.isArray(block.hooks)) {
          for (const cmdRaw of block.hooks) {
            const cmd = asRecord(cmdRaw) as RawHookCommand | null;
            if (!cmd) continue;
            const entry = toEntry(cmd, event, matcher, scope, file, true, isVibisual);
            if (entry) hooks.push(entry);
          }
        }

        // ② 우리가 꺼 둔 명령 — 같은 블록 안에 잠들어 있다(④). 목록에서 사라지면
        //    사용자는 자기 훅이 지워진 줄 안다.
        if (Array.isArray(block[DISABLED_KEY])) {
          for (const cmdRaw of block[DISABLED_KEY] as unknown[]) {
            const cmd = asRecord(cmdRaw) as RawHookCommand | null;
            if (!cmd) continue;
            const entry = toEntry(cmd, event, matcher, scope, file, false, isVibisual);
            if (entry) hooks.push(entry);
          }
        }
      }
    }
  }

  return { projectPath, hooks, scanned, scannedAt: Date.now() };
}

/**
 * 켜기/끄기 — 그 명령 객체를 `hooks` ↔ `_vibisualDisabled` 사이로 **옮긴다**(④).
 *
 * 지우지 않으므로 되돌리기가 항상 가능하고, 파일이 파싱되지 않으면 **쓰지 않는다** —
 * 남의 설정 파일을 망가뜨리는 것보다 토글이 안 되는 편이 낫다(#17-31 ④ 와 같은 판단).
 * 대조는 인덱스가 아니라 (이벤트 · matcher · 명령 원문) 세 값이라 파일이 그새 바뀌어도
 * 엉뚱한 줄을 건드리지 않는다.
 */
export function setHookEnabled(
  projectPath: string,
  scope: HookScope,
  event: string,
  matcher: string,
  command: string,
  enabled: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (scope === 'managed') {
    return { ok: false, reason: 'managed policy hooks are read-only' };
  }

  const target = settingsFiles(projectPath).find((f) => f.scope === scope);
  if (!target) return { ok: false, reason: 'unknown scope' };

  const root = readJsonObject(target.file);
  if (!root) return { ok: false, reason: 'cannot read settings file' };

  const hooksRec = asRecord(root['hooks']);
  if (!hooksRec) return { ok: false, reason: 'no hooks in settings file' };

  const blocks = hooksRec[event];
  if (!Array.isArray(blocks)) return { ok: false, reason: 'event not found' };

  let moved = false;

  for (const blockRaw of blocks) {
    const block = asRecord(blockRaw) as RawHookBlock | null;
    if (!block) continue;
    if ((typeof block.matcher === 'string' ? block.matcher : '') !== matcher) continue;
    // 우리 자신의 블록은 끄지 않는다 — 이걸 끄면 이 앱이 눈을 감는다.
    if (block[VIBISUAL_MARKER] === true) continue;

    const from = enabled ? DISABLED_KEY : 'hooks';
    const to = enabled ? 'hooks' : DISABLED_KEY;

    const fromArr = Array.isArray(block[from]) ? [...(block[from] as unknown[])] : [];
    const idx = fromArr.findIndex((c) => {
      const rec = asRecord(c);
      return rec !== null && rec['command'] === command;
    });
    if (idx === -1) continue;

    const [cmd] = fromArr.splice(idx, 1);
    const toArr = Array.isArray(block[to]) ? [...(block[to] as unknown[])] : [];
    toArr.push(cmd);
    block[to] = toArr;

    // 되살릴 것이 없으면 우리 키는 지운다(흔적을 남기지 않는다). `hooks` 는 스키마상 늘
    // 있어야 하므로 비어도 배열로 남긴다 — "이 블록엔 켜진 명령이 없다" 는 뜻이다.
    if (from === DISABLED_KEY && fromArr.length === 0) delete block[DISABLED_KEY];
    else block[from] = fromArr;

    moved = true;
    break;
  }

  if (!moved) return { ok: false, reason: 'hook not found' };

  try {
    atomicWriteFileSync(target.file, `${JSON.stringify(root, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    logger.warn(`[hook-inventory] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'write failed' };
  }
}
