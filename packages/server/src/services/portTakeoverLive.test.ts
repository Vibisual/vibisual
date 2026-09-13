import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Socket } from 'node:net';
import { takeoverPortCommand } from './portTakeover.js';

/**
 * §7.11 포트 인계 — **실제 프로세스**를 하나 띄워 놓고 그 기동 명령을 되찾아 온다.
 *
 * 파서 단위 테스트(`portTakeover.test.ts`)는 출력 모양만 고정한다. 이 테스트는 그 위 한 층 —
 * "포트 → PID → 명령줄" 사슬이 **이 OS 에서 실제로 이어지는가"를 본다. 이 사슬이 끊기면
 * 에이전트가 켠 서버의 Start 버튼은 다시 회색이 되고, 사용자는 v3.85 로 되돌아간 것을 느낀다.
 *
 * 자식은 `detached` 로 띄운다 — 우리 프로세스의 자식이라도 pid 는 다르므로 자기보호 가드
 * (`pid !== process.pid`)에 걸리지 않는다.
 */
const children: ChildProcess[] = [];

afterEach(() => {
  for (const c of children.splice(0)) { try { c.kill(); } catch { /* 이미 죽음 */ } }
});

/** 지정 포트를 LISTEN 하는 최소 서버를 별도 프로세스로 띄운다. */
async function spawnServer(port: number): Promise<void> {
  const script = `require('http').createServer((q,s)=>{s.end('ok')}).listen(${port},'127.0.0.1')`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
  children.push(child);
  // listen 까지 대기 — 포트가 열려야 조회가 성립한다.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = new Socket();
      s.setTimeout(300);
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => { s.destroy(); resolve(false); });
      s.once('timeout', () => { s.destroy(); resolve(false); });
      s.connect(port, '127.0.0.1');
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on ${port} never listened`);
}

describe('§7.11 포트 인계 — 실제 프로세스에서 되찾기', () => {
  it('띄워 둔 서버의 포트만 알아도 그 기동 명령을 읽어 온다', async () => {
    const port = 39871;
    await spawnServer(port);

    const taken = await takeoverPortCommand(port);
    expect(taken).not.toBeNull();
    // 우리가 실제로 실행한 것은 node 실행본이다 — 그 흔적이 명령줄에 남아 있어야 respawn 이 성립한다.
    expect(taken?.command.toLowerCase()).toContain('node');
    expect(taken?.command).toContain(String(port));
    expect(taken?.pid).toBeGreaterThan(0);
  }, 30000);

  it('아무도 없는 포트는 인계하지 않는다 (엉뚱한 프로세스를 잡지 않는다)', async () => {
    expect(await takeoverPortCommand(39872)).toBeNull();
  }, 20000);
});
