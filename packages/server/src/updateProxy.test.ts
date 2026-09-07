/**
 * 업데이트 피드 프록시(`infra/update-proxy/src/worker.js`)의 동작 고정.
 *
 * ## 왜 서버 패키지에서 도나
 *
 * 이 코드는 Cloudflare 위에서 돌지만 **평범한 ES 모듈**이고, 쓰는 바깥 세계는 셋뿐이다
 * (`fetch` · KV 바인딩 · Cache API). 셋 다 여기서 대신 세워 줄 수 있으므로, 배포해 봐야만
 * 아는 코드로 두지 않는다 — 배포는 사람 손이라 한 번 잘못 나가면 다음 손질까지 그대로 산다.
 *
 * ## 무엇을 지키나
 *
 * 이 파일이 지키는 것은 성능이 아니라 **약속**이다. `PRIVACY.md` 가 "IP 를 저장하지 않는다 ·
 * 어제와 오늘을 이을 수 없다 · 소금이 없으면 아무것도 안 쓴다"고 적어 두었고, 그 세 줄이
 * 코드에서 참인지 확인하는 곳이 여기다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const WORKER = pathToFileURL(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../infra/update-proxy/src/worker.js',
  ),
).href;

type Meta = Record<string, string>;
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** KV 바인딩 대역. `list()` 가 **값 없이 metadata 만** 준다는 실제 성질을 그대로 흉내 낸다. */
function makeKV() {
  const store = new Map<string, { value: string; metadata?: Meta; ttl?: number }>();
  return {
    store,
    async put(key: string, value: string, opts?: { expirationTtl?: number; metadata?: Meta }) {
      store.set(key, { value, metadata: opts?.metadata, ttl: opts?.expirationTtl });
    },
    async list({ prefix }: { prefix: string; cursor?: string }) {
      const keys = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

/** Cache API 대역 — 엣지 캐시가 있는 것과 없는 것을 갈라 시험한다. */
function makeCaches() {
  const entries = new Map<string, Response>();
  return {
    entries,
    default: {
      async match(req: Request) {
        const hit = entries.get(req.url);
        return hit ? hit.clone() : undefined;
      },
      async put(req: Request, res: Response) {
        entries.set(req.url, res);
      },
    },
  };
}

const ORIGIN = 'https://update.vibisual.pro';

describe('업데이트 피드 프록시 (Cloudflare Worker)', () => {
  let worker: { fetch(req: Request, env: unknown, ctx: Ctx): Promise<Response> };
  let kv: ReturnType<typeof makeKV>;
  let cacheStub: ReturnType<typeof makeCaches>;
  let pending: Promise<unknown>[];
  let ctx: Ctx;

  const env = () => ({ HASH_SALT: 'salt-for-test', VISITS: kv });
  const settle = async () => {
    await Promise.all(pending);
    pending = [];
  };
  const call = (p: string, init?: RequestInit, e: unknown = env()) =>
    worker.fetch(new Request(`${ORIGIN}${p}`, init), e, ctx);

  beforeEach(async () => {
    kv = makeKV();
    cacheStub = makeCaches();
    pending = [];
    ctx = {
      waitUntil: (p) => {
        pending.push(p);
      },
    };
    vi.stubGlobal('caches', cacheStub);
    // 상류(GitHub)는 항상 성공하는 것으로 둔다. 실패는 개별 시험에서 덮어쓴다.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('version: 0.1.22\n', { status: 200 })),
    );
    worker = (await import(/* @vite-ignore */ WORKER)).default;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 피드 ────────────────────────────────────────────────────────────────
  it('피드를 넘겨주고, 그 요청 하나를 설치 하나로 센다', async () => {
    const res = await call('/latest.yml');
    await settle();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('version: 0.1.22');
    const keys = [...kv.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^u:\d{4}-\d{2}-\d{2}:[0-9a-f]{16}$/);
  });

  it('피드 파일 이름으로 OS 를 갈라 metadata 에 넣는다 — 값이 아니라 metadata 여야 집계가 산다', async () => {
    for (const [file, platform] of [
      ['latest.yml', 'win'],
      ['latest-mac.yml', 'mac'],
      ['latest-linux.yml', 'linux'],
    ] as const) {
      kv = makeKV();
      vi.stubGlobal('caches', makeCaches());
      await call(`/${file}`);
      await settle();
      expect([...kv.store.values()][0]?.metadata).toEqual({ platform });
    }
  });

  it('같은 방문자를 하루에 두 번 세지 않는다 — KV 쓰기 한도가 걸려 있다', async () => {
    await call('/latest.yml');
    await settle();
    await call('/latest.yml');
    await settle();
    expect(kv.store.size).toBe(1);
  });

  it('HEAD 는 본문 없이 200 — electron-updater 도달 확인이 이 경로로 온다', async () => {
    const res = await call('/latest.yml', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('상류가 죽으면 502 로 알린다 — 빈 피드를 200 으로 주면 앱이 "최신"으로 오해한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    const res = await call('/latest.yml');
    expect(res.status).toBe(502);
  });

  // ── 자산 ────────────────────────────────────────────────────────────────
  it('설치본은 GitHub 으로 302 — 파일이 우리 대역폭을 지나지 않는다', async () => {
    const res = await call('/Vibisual-0.1.22-setup.exe');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://github.com/Vibisual/vibisual/releases/download/v0.1.22/Vibisual-0.1.22-setup.exe',
    );
  });

  it('이름에 판올림이 없으면 latest 로 떨어진다', async () => {
    const res = await call('/Vibisual.AppImage');
    expect(res.headers.get('location')).toBe(
      'https://github.com/Vibisual/vibisual/releases/latest/download/Vibisual.AppImage',
    );
  });

  it('아무 경로나 GitHub 으로 흘리지 않는다', async () => {
    expect((await call('/etc/passwd')).status).toBe(404);
    expect((await call('/nested/path.exe')).status).toBe(404);
  });

  // ── 사이트 비콘 ─────────────────────────────────────────────────────────
  it('sendBeacon 의 POST 를 받는다 — 메서드 검사보다 앞에 있어야 한다', async () => {
    const res = await call('/px?e=view', { method: 'POST' });
    await settle();
    expect(res.status).toBe(204);
    expect([...kv.store.keys()][0]).toMatch(/^p:\d{4}-\d{2}-\d{2}:view:[0-9a-f]{16}$/);
  });

  it('내려받기 누름은 누를 때마다 센다(조회는 하루 1회)', async () => {
    await call('/px?e=download', { method: 'POST' });
    await settle();
    await call('/px?e=download', { method: 'POST' });
    await settle();
    await call('/px?e=view', { method: 'POST' });
    await settle();
    await call('/px?e=view', { method: 'POST' });
    await settle();
    const keys = [...kv.store.keys()];
    expect(keys.filter((k) => k.includes(':download:'))).toHaveLength(2);
    expect(keys.filter((k) => k.includes(':view:'))).toHaveLength(1);
  });

  it('모르는 이벤트 이름은 아무것도 남기지 않는다', async () => {
    const res = await call('/px?e=%3Cscript%3E', { method: 'POST' });
    await settle();
    expect(res.status).toBe(204);
    expect(kv.store.size).toBe(0);
  });

  it('피드에는 POST 를 받지 않는다', async () => {
    expect((await call('/latest.yml', { method: 'POST' })).status).toBe(405);
  });

  // ── 개인정보 약속 ───────────────────────────────────────────────────────
  it('IP·User-Agent 를 어디에도 남기지 않는다 — 남는 것은 접힌 16자뿐', async () => {
    await call('/latest.yml', {
      headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Vibisual/0.1.22' },
    });
    await settle();
    const dump = JSON.stringify([...kv.store.entries()]);
    expect(dump).not.toContain('203.0.113.9');
    expect(dump).not.toContain('Vibisual/0.1.22');
  });

  it('소금이 다르면 같은 사람도 다른 표식이 된다 — 소금에 날짜가 들어가 어제와 못 잇는다', async () => {
    const headers = { 'cf-connecting-ip': '203.0.113.9' };
    await call('/latest.yml', { headers });
    await settle();
    const first = [...kv.store.keys()][0];

    kv = makeKV();
    vi.stubGlobal('caches', makeCaches());
    await call('/latest.yml', { headers }, { HASH_SALT: '다른-소금', VISITS: kv });
    await settle();
    const second = [...kv.store.keys()][0];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.split(':')[2]).not.toBe(second?.split(':')[2]);
  });

  it('소금이 없으면 계수 없이 넘겨주기만 한다 — 끄는 길이 실제로 있다', async () => {
    const res = await call('/latest.yml', undefined, { VISITS: kv });
    await settle();
    expect(res.status).toBe(200);
    expect(kv.store.size).toBe(0);
  });

  // ── 집계 ────────────────────────────────────────────────────────────────
  it('집계는 숫자만 내보낸다 — 개별 표식은 나가지 않는다', async () => {
    await call('/latest.yml', { headers: { 'cf-connecting-ip': '1.1.1.1' } });
    await settle();
    kv.store.set(`u:${new Date().toISOString().slice(0, 10)}:deadbeefdeadbeef`, {
      value: '1',
      metadata: { platform: 'mac' },
    });

    const res = await call('/stats');
    const body = (await res.json()) as {
      days: { active: number; byPlatform: Record<string, number> }[];
    };
    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(30);
    expect(body.days[0]?.active).toBe(2);
    expect(body.days[0]?.byPlatform).toEqual({ win: 1, mac: 1, linux: 0 });
    expect(JSON.stringify(body)).not.toContain('deadbeefdeadbeef');
  });

  it('집계를 엣지에 캐시한다 — 안 하면 이 주소를 아는 누구든 KV 읽기 한도를 태운다', async () => {
    await call('/stats');
    await settle();
    const listSpy = vi.spyOn(kv, 'list');
    const res = await call('/stats');
    expect(res.status).toBe(200);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('저장고가 없으면 503 — 0 을 지어내지 않는다', async () => {
    const res = await call('/stats', undefined, { HASH_SALT: 's' });
    expect(res.status).toBe(503);
  });
});
