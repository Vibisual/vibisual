/**
 * §5.3 #12-1 — 앱이 꺼져 있으면(루프백 포트가 닫힘) 훅 도우미는 통과 답을 내고 **곧바로 끝난다.**
 *
 * 2026-10-15 실측(Claude Code 2.1.300): 권한 문의·질문 카드 문의의 65초 타이머가 실패 경로에서 걷히지 않아,
 * 답(`{"continue":true}`)은 48ms 에 나가는데 프로세스는 65초 뒤에야 끝났다. CLI 는 훅 프로세스가 끝나야 도구를
 * 돌리므로, 앱을 꺼 둔 동안 이 PC 의 모든 Claude Code 세션이 도구 호출마다 그만큼(실측 68.9초) 멈췄다.
 * 훅이 남은 채 앱이 꺼진 것은 평범한 상황이라(앱을 닫았을 뿐이다) 이 시험이 그 자리를 지킨다.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const handlerPath = fileURLToPath(new URL('../../../../hooks/handler.mjs', import.meta.url));

/** 곧바로 끝났다고 볼 상한 — 연결 거부는 수십 ms 면 오지만 느린 CI 를 위해 넉넉히 둔다(옛 판은 65초). */
const QUICK_EXIT_MS = 15_000;

/** 잠깐 열었다 닫은 포트 — 연결이 거부되는 루프백 주소(앱이 꺼진 자리). */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** 이 시험이 도는 셸의 VIBISUAL_* 를 걷어 낸 환경 — 진짜 앱으로 새지 않고, 외부 세션처럼 보이게. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('VIBISUAL_')) continue;
    env[key] = value;
  }
  return env;
}

function runTimed(input: string, port: number): Promise<{ stdout: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [handlerPath, '--server', `http://127.0.0.1:${port}`, '--token', 'tok'], {
      env: cleanEnv(),
      stdio: 'pipe',
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => undefined);
    child.on('close', () => resolve({ stdout, ms: Date.now() - startedAt }));
    child.stdin.end(input);
  });
}

const preToolUse = (toolName: string, toolInput: Record<string, unknown>): string => JSON.stringify({
  session_id: 'sess-offline', cwd: '/work', hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput,
});

describe('handler.mjs — 앱이 꺼져 있으면 통과 답을 내고 곧바로 끝난다', () => {
  it('PreToolUse 권한 문의', async () => {
    const port = await closedPort();
    const { stdout, ms } = await runTimed(preToolUse('Read', { file_path: '/work/a.txt' }), port);
    expect(JSON.parse(stdout.split('\n')[0]!)).toEqual({ continue: true });
    expect(ms).toBeLessThan(QUICK_EXIT_MS);
  }, 30_000);

  it('AskUserQuestion 카드 문의', async () => {
    const port = await closedPort();
    const { stdout, ms } = await runTimed(preToolUse('AskUserQuestion', { questions: [] }), port);
    expect(JSON.parse(stdout.split('\n')[0]!)).toEqual({ continue: true });
    expect(ms).toBeLessThan(QUICK_EXIT_MS);
  }, 30_000);
});
