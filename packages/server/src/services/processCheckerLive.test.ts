import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import net, { Socket } from 'node:net';
import { findPortListeners, killByPortDetailed, listenerPids, reachableListeners } from './processChecker.js';

/**
 * §7.11 / §3.5 — **한 포트 두 주인**을 실제 프로세스 둘로 재현한다(2026-10-01 사고).
 *
 * 파서 시험(`processChecker.test.ts`)은 출력 모양만 고정한다. 여기서는 그 위 한 층 —
 * "포트 → (pid, 주소) → 그 주소가 닿는 리스너 → 그것만 죽이기" 사슬이 **이 OS 에서 실제로 이어지는가**를 본다.
 * 실측에서 한 프로젝트의 서버와 옆 프로젝트의 vite 가 같은 8080 을 서로 다른 주소로 쥐고 있었고,
 * 종전 Windows 조회(`netstat -p TCP` = IPv4 표만)는 [::1] 쪽을 아예 못 봤다.
 *
 * 자식은 셸 없이(`process.execPath -e`) 띄운다 — 자식 pid 가 곧 리스너 pid 라 단정할 수 있다.
 * IPv6 루프백이 없는 기기(일부 컨테이너)는 건너뛴다 — 거기서는 이 사고가 날 수 없다.
 */
const children: ChildProcess[] = [];

afterEach(() => {
  for (const c of children.splice(0)) { try { c.kill(); } catch { /* 이미 죽음 */ } }
});

/** 잠깐 묶었다 푼다 — 그 주소·포트를 지금 쓸 수 있는지(0 = OS 가 고른 포트). 못 묶으면 null. */
function bindOnce(port: number, host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => { resolve(null); });
    srv.listen(port, host, () => {
      const addr = srv.address();
      const got = typeof addr === 'object' && addr !== null ? addr.port : null;
      srv.close(() => { resolve(got); });
    });
  });
}

/** 127.0.0.1 과 [::1] 양쪽에서 비어 있는 포트. IPv6 루프백이 없으면 null. */
async function freeDualStackPort(): Promise<number | null> {
  if ((await bindOnce(0, '::1')) === null) return null;
  for (let i = 0; i < 8; i += 1) {
    const port = await bindOnce(0, '127.0.0.1');
    if (port === null) return null;
    if ((await bindOnce(port, '::1')) !== null) return port;
  }
  return null;
}

function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    s.setTimeout(300);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

async function waitUntil(pred: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** `host:port` 에만 묶인 최소 서버를 별도 프로세스로 띄운다. */
async function spawnServerOn(port: number, host: string): Promise<ChildProcess> {
  const script = `require('http').createServer((q,s)=>{s.end('ok')}).listen(${port},'${host}')`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
  children.push(child);
  if (!(await waitUntil(() => canConnect(port, host), 8000))) throw new Error(`server on ${host}:${port} never listened`);
  return child;
}

describe('§7.11 한 포트 두 주인 — 실제 프로세스 둘', () => {
  it('두 리스너를 주소와 함께 보고, 호스트를 지정한 kill 은 그 주소의 서버만 내린다', async (ctx) => {
    const port = await freeDualStackPort();
    if (port === null) { ctx.skip(); return; }

    const v4 = await spawnServerOn(port, '127.0.0.1');
    const v6 = await spawnServerOn(port, '::1');

    // ① 둘 다 보인다 — 주소와 함께.
    const found = await findPortListeners(port);
    expect(found.anyToolWorked).toBe(true);
    expect(found.listeners).toEqual(expect.arrayContaining([
      { pid: v4.pid, address: '127.0.0.1' },
      { pid: v6.pid, address: '::1' },
    ]));

    // ② 호스트마다 닿는 리스너가 갈린다.
    expect(listenerPids(reachableListeners(found.listeners, '127.0.0.1'))).toEqual([v4.pid]);
    expect(listenerPids(reachableListeners(found.listeners, '::1'))).toEqual([v6.pid]);
    expect(listenerPids(reachableListeners(found.listeners, 'localhost'))).toEqual([v6.pid]);

    // ③ 127.0.0.1 로 부르는 서버만 내린다 — [::1] 의 옆 서버는 산다.
    const r = await killByPortDetailed(port, { host: '127.0.0.1' });
    expect(r).toMatchObject({ killed: true, outcome: 'killed', pids: [v4.pid] });
    expect(await waitUntil(async () => !(await canConnect(port, '127.0.0.1')), 8000)).toBe(true);
    expect(await canConnect(port, '::1')).toBe(true);

    // ④ 그 주소의 서버가 이미 없으면 아무것도 죽이지 않는다 — 남은 리스너는 남의 것이다.
    const again = await killByPortDetailed(port, { host: '127.0.0.1' });
    expect(again).toMatchObject({ killed: false, outcome: 'not-listening', pids: [] });
    expect(await canConnect(port, '::1')).toBe(true);
  }, 60000);
});
