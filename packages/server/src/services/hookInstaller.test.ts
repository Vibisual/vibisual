/**
 * §3.6 훅 인스톨러 — 중복 누적 차단 + 백업 회전 테스트.
 *
 * 회귀 방지 대상: 인스톨러가 표식(`_vibisualManaged`) 붙은 1장만 찾아 갱신하던 탓에,
 * 표식이 없던 판본이 깔아 둔 블록이 이벤트마다 그대로 남아 설치·판올림마다 한 장씩
 * 쌓였다(실측 ~/.claude/settings.json 이벤트당 8장 = 툴 1회 호출에 handler.mjs
 * 프로세스 8개, 백업 파일 88개). 남의 훅은 절대 건드리지 않는 것이 같은 무게의 조건이라
 * "줄었다" 뿐 아니라 "남길 것은 그대로 남았다"까지 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

// os.homedir() 만 임시 폴더로 돌린다 — 실제 ~/.claude 를 건드리지 않기 위함.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

const { ensureClaudeHooksInstalled } = await import('./hookInstaller.js');

const PORT = 51360;
const TOKEN = 'test-token';
const HANDLER = 'C:/Programs/Vibisual/out/hooks/handler.mjs';

/** 표식 없던 판본이 깔던 블록 모양. */
function legacyBlock(port = PORT) {
  return {
    hooks: [
      { type: 'command', command: `node "${HANDLER}" --server "http://127.0.0.1:${port}" --token "old"` },
    ],
  };
}

/** 남의 훅 — 절대 지우면 안 되는 블록. */
function foreignBlock() {
  return { hooks: [{ type: 'command', command: 'python C:/tools/my_own_hook.py' }] };
}

function settingsPath() {
  return path.join(fakeHome, '.claude', 'settings.json');
}

function writeSettings(obj: unknown) {
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2), 'utf-8');
}

/** 해당 이벤트의 블록 배열 — 없으면 빈 배열(테스트에서 optional 체이닝을 없애기 위함). */
function blocksOf(event: string): Record<string, unknown>[] {
  const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) as {
    hooks?: Record<string, Record<string, unknown>[] | undefined>;
  };
  return parsed.hooks?.[event] ?? [];
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hookinstall-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
});

afterEach(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────
describe('표식 없는 옛 블록 청소', () => {
  it('이벤트당 옛 블록 7장이 쌓여 있어도 정상 블록 1장만 남긴다', () => {
    writeSettings({
      hooks: {
        PreToolUse: Array.from({ length: 7 }, () => legacyBlock()),
        PostToolUse: Array.from({ length: 7 }, () => legacyBlock()),
      },
    });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.error).toBeUndefined();
    expect(r.installed).toBe(true);
    expect(r.prunedLegacy).toBe(14);

    expect(blocksOf('PreToolUse')).toHaveLength(1);
    expect(blocksOf('PostToolUse')).toHaveLength(1);
    expect(blocksOf('PreToolUse')[0]?.['_vibisualManaged']).toBe(true);
  });

  it('남의 훅은 그대로 남긴다', () => {
    writeSettings({ hooks: { PreToolUse: [foreignBlock(), legacyBlock(), foreignBlock()] } });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(1);
    const arr = blocksOf('PreToolUse');
    // 남의 훅 2장 + 우리 정상 블록 1장
    expect(arr).toHaveLength(3);
    expect(JSON.stringify(arr)).toContain('my_own_hook.py');
  });

  it('두 번 연속 실행해도 블록이 늘지 않는다(누적 차단)', () => {
    writeSettings({ hooks: {} });

    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const first = blocksOf('PreToolUse').length;
    const second = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(second.alreadyPresent).toBe(true);
    expect(second.prunedLegacy).toBe(0);
    expect(blocksOf('PreToolUse')).toHaveLength(first);
  });

  it('표식 붙은 블록은 포트가 달라져도 지우지 않고 갱신한다', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          { _vibisualManaged: true, hooks: [{ type: 'command', command: `node "${HANDLER}" --server "http://127.0.0.1:1111" --token "old"` }] },
        ],
      },
    });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(0);
    const arr = blocksOf('PreToolUse');
    expect(arr).toHaveLength(1);
    expect(JSON.stringify(arr[0])).toContain(`127.0.0.1:${PORT}`);
  });
});

// ─────────────────────────────────────────────────────────────
describe('백업 회전', () => {
  it('오래된 백업은 최신 5개만 남기고 지운다', () => {
    writeSettings({ hooks: {} });
    const dir = path.join(fakeHome, '.claude');
    for (let i = 0; i < 12; i += 1) {
      const f = path.join(dir, `settings.json.bak-vibisual-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z`);
      fs.writeFileSync(f, '{}', 'utf-8');
      fs.utimesSync(f, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
    }

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    const left = fs.readdirSync(dir).filter((f) => f.includes('.bak-vibisual-'));
    expect(left).toHaveLength(5);
    // 이번 실행이 남긴 백업 1개 + 기존 중 최신 4개
    expect(r.prunedBackups).toBe(8);
  });

  it('바뀔 게 없는 실행에서도 쌓인 백업은 정리한다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const dir = path.join(fakeHome, '.claude');
    for (let i = 0; i < 9; i += 1) {
      fs.writeFileSync(path.join(dir, `settings.json.bak-vibisual-x${i}`), '{}', 'utf-8');
    }

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.alreadyPresent).toBe(true);
    expect(r.prunedBackups).toBeGreaterThan(0);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.bak-vibisual-'))).toHaveLength(5);
  });
});
