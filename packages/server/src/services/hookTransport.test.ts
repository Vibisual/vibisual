/**
 * §3.6 — 훅 **전송 경로**(HTTP 훅 승격 / command 폴백)와 훅 엔트리 옵션(`args`·`if`) 테스트.
 *
 * 회귀 방지 대상 넷:
 *  1) HTTP 승격 조건 — 판올림·`allowedHttpHookUrls` 중 하나라도 어긋나면 **반드시** command 로
 *     떨어져야 한다. 못 도는 HTTP 훅을 깔면 이벤트가 0건이 되고 화면에서는 앱이 죽은 것으로 보인다.
 *  2) `args` exec 형식 — 경로에 공백이 있어도 셸 파서를 타지 않는다(멀티플랫폼 규칙).
 *  3) `if` 필터 — 기억 카드 주입이 `Edit`/`Write` 에만 붙어야 한다. 없으면 **모든 도구 호출마다**
 *     Node 프로세스가 한 번씩 뜬다(종전 동작).
 *  4) `SessionEnd` 상한 — 기본 예산 1.5초짜리 이벤트에 10초를 걸면 우리 서버가 멎었을 때
 *     사용자의 `/clear`·`/resume` 이 그만큼 멈춘다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

const {
  ensureClaudeHooksInstalled,
  buildVibisualBlocks,
  resolveTransport,
  versionAtLeast,
  httpHookUrlAllowed,
  hookEventUrl,
  HOOK_EVENTS,
  HANDLER_EVENTS,
  BRAIN_NOTE_TOOLS,
  HTTP_HOOK_MIN_CLI_VERSION,
} = await import('./hookInstaller.js');

const PORT = 51360;
const TOKEN = 'test-token';
/** 공백이 든 경로 — 셸을 타면 여기서 깨진다(mac 의 Application Support 가 실제 사례). */
const HANDLER = 'C:/Program Files/Vibisual/out/hooks/handler.mjs';

interface Entry {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  if?: string;
  timeout?: number;
  async?: boolean;
}

function entriesOf(event: (typeof HOOK_EVENTS)[number], transport: 'http' | 'command'): Entry[] {
  const blocks = buildVibisualBlocks(event, PORT, HANDLER, TOKEN, transport);
  return blocks.flatMap((b) => b.hooks) as unknown as Entry[];
}

// ─────────────────────────────────────────────────────────────
describe('§3.6 — 판올림 비교', () => {
  it('같거나 높으면 통과, 낮으면 막는다', () => {
    expect(versionAtLeast('2.1.251', '2.1.251')).toBe(true);
    expect(versionAtLeast('2.1.252', '2.1.251')).toBe(true);
    expect(versionAtLeast('2.2.0', '2.1.251')).toBe(true);
    expect(versionAtLeast('3.0.0', '2.1.251')).toBe(true);
    expect(versionAtLeast('2.1.250', '2.1.251')).toBe(false);
    expect(versionAtLeast('2.0.999', '2.1.251')).toBe(false);
  });

  it('모르는 값은 승격하지 않는다(추측 금지)', () => {
    expect(versionAtLeast(null, '2.1.251')).toBe(false);
    expect(versionAtLeast(undefined, '2.1.251')).toBe(false);
    expect(versionAtLeast('', '2.1.251')).toBe(false);
    expect(versionAtLeast('unknown', '2.1.251')).toBe(false);
    expect(versionAtLeast('2', '2.1.251')).toBe(false);
  });

  it('프리릴리스 꼬리표는 떼고 본다', () => {
    expect(versionAtLeast('2.1.251-nightly.3', '2.1.251')).toBe(true);
    expect(versionAtLeast('2.1.250-nightly.3', '2.1.251')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.6 — allowedHttpHookUrls 허용목록', () => {
  const url = hookEventUrl(PORT);

  it('목록 자체가 없으면 CLI 기본(제한 없음)을 따른다', () => {
    expect(httpHookUrlAllowed(undefined, url)).toBe(true);
    expect(httpHookUrlAllowed(null, url)).toBe(true);
  });

  it('와일드카드만 살리고 정규식 메타는 글자 그대로 본다', () => {
    expect(httpHookUrlAllowed(['http://127.0.0.1:*/api/hook-event'], url)).toBe(true);
    expect(httpHookUrlAllowed(['http://127.0.0.1:51360/api/hook-event'], url)).toBe(true);
    expect(httpHookUrlAllowed(['http://127.0.0.1:*'], url)).toBe(true);
    // 점(.)이 아무 글자로 새면 안 된다 — 남의 호스트가 통과한다.
    expect(httpHookUrlAllowed(['http://127x0y0z1:51360/api/hook-event'], url)).toBe(false);
  });

  it('우리 주소가 없는 목록은 막는다', () => {
    expect(httpHookUrlAllowed(['https://example.com/*'], url)).toBe(false);
    expect(httpHookUrlAllowed([], url)).toBe(false);
  });

  it('형식이 이상하면 CLI 가 판단하게 둔다', () => {
    expect(httpHookUrlAllowed('nonsense', url)).toBe(true);
    expect(httpHookUrlAllowed(42, url)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.6 — 전송 경로 판정', () => {
  const url = hookEventUrl(PORT);

  it('command 를 원하면 판올림을 보지도 않는다', () => {
    expect(resolveTransport('command', { cliVersion: '9.9.9', url })).toEqual({ transport: 'command' });
  });

  it('판올림을 모르면 승격하지 않고 사유를 남긴다', () => {
    const r = resolveTransport('http', { cliVersion: null, url });
    expect(r.transport).toBe('command');
    expect(r.reason).toContain('unknown');
  });

  it('판올림이 낮으면 떨어진다', () => {
    const r = resolveTransport('http', { cliVersion: '2.1.100', url });
    expect(r.transport).toBe('command');
    expect(r.reason).toContain(HTTP_HOOK_MIN_CLI_VERSION);
  });

  it('허용목록이 우리 주소를 막으면 떨어진다', () => {
    const r = resolveTransport('http', {
      cliVersion: HTTP_HOOK_MIN_CLI_VERSION,
      allowedHttpHookUrls: ['https://example.com/*'],
      url,
    });
    expect(r.transport).toBe('command');
    expect(r.reason).toContain('allowedHttpHookUrls');
  });

  it('둘 다 통과하면 http', () => {
    const r = resolveTransport('http', {
      cliVersion: HTTP_HOOK_MIN_CLI_VERSION,
      allowedHttpHookUrls: ['http://127.0.0.1:*'],
      url,
    });
    expect(r).toEqual({ transport: 'http' });
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.6 — 훅 엔트리 모양', () => {
  it('handler 엔트리는 exec 형식(args)이라 공백 든 경로가 안전하다', () => {
    const [entry] = entriesOf('PreToolUse', 'http');
    expect(entry?.type).toBe('command');
    expect(entry?.args?.[0]).toBe(HANDLER);
    expect(entry?.args).toEqual([HANDLER, '--server', `http://127.0.0.1:${PORT}`, '--token', TOKEN]);
    // 경로가 command 문자열에 이어 붙으면 셸 파서를 타게 된다 — 그 회귀를 막는다.
    expect(entry?.command).not.toContain(HANDLER);
  });

  it('동기 판정이 필요한 훅은 전송 경로와 무관하게 항상 자식 프로세스다', () => {
    for (const ev of ['PreToolUse', 'UserPromptSubmit', 'Stop'] as const) {
      for (const t of ['http', 'command'] as const) {
        const [entry] = entriesOf(ev, t);
        expect(entry?.type, `${ev}/${t}`).toBe('command');
        expect(entry?.async, `${ev}/${t}`).toBeUndefined();
      }
    }
  });

  it('PreToolUse 승인 게이트만 사용자에게 상태 문구를 보여 준다', () => {
    const raw = buildVibisualBlocks('PreToolUse', PORT, HANDLER, TOKEN, 'http');
    expect(JSON.stringify(raw)).toContain('waiting for your approval');
  });

  it('순수 전달 이벤트는 http 에서 프로세스를 아예 띄우지 않는다', () => {
    for (const ev of HOOK_EVENTS) {
      if (HANDLER_EVENTS.has(ev)) continue;
      const entries = entriesOf(ev, 'http');
      expect(entries, `${ev}`).toHaveLength(1);
      expect(entries[0]?.type, `${ev}`).toBe('http');
      expect(entries[0]?.url, `${ev}`).toBe(hookEventUrl(PORT));
    }
  });

  it('http 엔트리는 토큰을 헤더로, 귀속 정보를 env 치환으로 싣는다', () => {
    const [entry] = entriesOf('FileChanged', 'http');
    expect(entry?.headers?.['x-vibisual-hook-token']).toBe(TOKEN);
    expect(entry?.headers?.['x-vibisual-owner-agent-id']).toBe('$VIBISUAL_OWNER_AGENT_ID');
    expect(entry?.allowedEnvVars).toEqual(
      expect.arrayContaining(['VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_OWNER_TERM_ID', 'VIBISUAL_USAGE_PROBE']),
    );
  });

  it('command 폴백에서는 순수 전달 훅이 async 로 붙어 턴을 붙잡지 않는다', () => {
    const [entry] = entriesOf('MessageDisplay', 'command');
    expect(entry?.type).toBe('command');
    expect(entry?.async).toBe(true);
  });

  it('SessionEnd 는 종료 예산(1.5초)에 맞춰 상한이 짧다', () => {
    for (const t of ['http', 'command'] as const) {
      const [entry] = entriesOf('SessionEnd', t);
      expect(entry?.timeout, t).toBe(2);
    }
    // 다른 전달 훅은 종전 상한 그대로.
    expect(entriesOf('FileChanged', 'http')[0]?.timeout).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.6 / §5.10 — PostToolUse if 필터(헛스폰 제거)', () => {
  it('http 경로: 기억 카드 주입은 Edit/Write 에만, 추적은 HTTP 한 장', () => {
    const entries = entriesOf('PostToolUse', 'http');
    const commands = entries.filter((e) => e.type === 'command');
    const https = entries.filter((e) => e.type === 'http');

    expect(commands).toHaveLength(BRAIN_NOTE_TOOLS.length);
    expect(commands.map((e) => e.if)).toEqual([...BRAIN_NOTE_TOOLS]);
    expect(https).toHaveLength(1);
    expect(https[0]?.if).toBeUndefined();
  });

  it('기억 카드 전용 엔트리는 추적을 중복으로 보내지 않는다', () => {
    const commands = entriesOf('PostToolUse', 'http').filter((e) => e.type === 'command');
    for (const e of commands) {
      expect(e.args).toContain('--brain-notes-only');
    }
  });

  it('command 폴백에서는 종전대로 한 장이 두 일을 겸한다(필터 없음)', () => {
    const entries = entriesOf('PostToolUse', 'command');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('command');
    expect(entries[0]?.if).toBeUndefined();
    expect(entries[0]?.args).not.toContain('--brain-notes-only');
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.6 — 설치 결과(승격·폴백)', () => {
  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hooktrans-'));
    process.env.__VIBI_FAKE_HOME__ = fakeHome;
  });
  afterEach(() => {
    delete process.env.__VIBI_FAKE_HOME__;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function readHooks(): Record<string, { hooks: Entry[] }[]> {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf-8'),
    ) as { hooks: Record<string, { hooks: Entry[] }[]> };
    return parsed.hooks;
  }

  it('옵션이 없으면 부팅 최초 설치답게 command 로 깔린다', () => {
    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    expect(r.transport).toBe('command');
    expect(readHooks()['FileChanged']?.[0]?.hooks[0]?.type).toBe('command');
  });

  it('판올림을 확인한 뒤 같은 인자로 다시 부르면 http 로 승격된다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, {
      transport: 'http',
      cliVersion: HTTP_HOOK_MIN_CLI_VERSION,
    });

    expect(r.transport).toBe('http');
    expect(r.installed).toBe(true);
    expect(r.transportFallbackReason).toBeUndefined();
    expect(readHooks()['FileChanged']?.[0]?.hooks[0]?.type).toBe('http');
    // 동기 훅은 승격 뒤에도 자식 프로세스 그대로.
    expect(readHooks()['PreToolUse']?.[0]?.hooks[0]?.type).toBe('command');
  });

  it('사용자가 허용목록으로 막아 두면 조용히 command 로 깔린다', () => {
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.claude', 'settings.json'),
      JSON.stringify({ allowedHttpHookUrls: ['https://example.com/*'] }, null, 2),
      'utf-8',
    );

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, {
      transport: 'http',
      cliVersion: HTTP_HOOK_MIN_CLI_VERSION,
    });

    expect(r.transport).toBe('command');
    expect(r.transportFallbackReason).toContain('allowedHttpHookUrls');
    expect(r.error).toBeUndefined();
    // 사용자 설정은 그대로 남아야 한다.
    const parsed = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf-8'),
    ) as { allowedHttpHookUrls: string[] };
    expect(parsed.allowedHttpHookUrls).toEqual(['https://example.com/*']);
  });

  it('같은 전송 경로로 두 번 부르면 두 번째는 손대지 않는다', () => {
    const opts = { transport: 'http' as const, cliVersion: HTTP_HOOK_MIN_CLI_VERSION };
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, opts);
    const second = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, opts);
    expect(second.alreadyPresent).toBe(true);
    expect(second.installed).toBe(false);
  });

  it('승격했다가 되돌려도 블록이 겹쳐 쌓이지 않는다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, { transport: 'http', cliVersion: HTTP_HOOK_MIN_CLI_VERSION });
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    for (const ev of HOOK_EVENTS) {
      expect(readHooks()[ev], ev).toHaveLength(1);
    }
  });
});
