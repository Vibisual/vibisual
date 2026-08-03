/**
 * §5.11 v4.27 — 플러그인 서버 관문(`requirePluginEnabled`) 검증.
 *
 * 이 미들웨어가 플러그인의 **온/오프 경계 그 자체**다. 서버 라우트는 부팅 시 전부 마운트되고, 껐는지 켰는지는
 * 오직 이 관문이 판단한다. 여기가 잘못되면 **꺼 둔 플러그인의 서버 기능이 계속 응답한다** — 사용자는
 * 창에서 껐다고 믿고 있는데.
 *
 * 그런데 지금까지 이 관문은 **한 번도 실행된 적이 없다.** 등록된 111종이 전부 `clientOnly` 라
 * `PLUGIN_SERVER_MODULES` 가 비어 있고, 그래서 마운트 반복문이 한 바퀴도 돌지 않기 때문이다.
 * 즉 첫 서버 기여 플러그인이 들어오는 순간 처음 실행되는 코드다 — 그때 처음 검증하면 늦다.
 *
 * 활성 판정 SSOT 는 `UserDefaults.enabledPlugins` 이므로, 그 값만 갈아 끼우며 관문의 행동을 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';

const enabledPlugins = { value: undefined as string[] | undefined };

vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ enabledPlugins: enabledPlugins.value }) },
}));
vi.mock('../logger.js', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

const { requirePluginEnabled } = await import('./pluginHost.js');

/** 응답을 기록하는 최소 스텁 — express 를 띄우지 않고 미들웨어만 직접 부른다. */
function fakeRes(): Response & { statusCode: number | null; body: unknown } {
  const res = {
    statusCode: null as number | null,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number | null; body: unknown };
}

const run = (id: string): { res: ReturnType<typeof fakeRes>; passed: boolean } => {
  const res = fakeRes();
  let passed = false;
  requirePluginEnabled(id)({} as Request, res, () => { passed = true; });
  return { res, passed };
};

beforeEach(() => { enabledPlugins.value = undefined; });

describe('플러그인 서버 관문', () => {
  it('꺼져 있으면 409 로 끊고 다음으로 넘기지 않는다', () => {
    enabledPlugins.value = [];
    const { res, passed } = run('lethal-trifecta');
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ ok: false, pluginId: 'lethal-trifecta' });
  });

  it('켜져 있으면 통과시킨다', () => {
    enabledPlugins.value = ['lethal-trifecta'];
    const { res, passed } = run('lethal-trifecta');
    expect(passed).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('설정이 아직 없으면 막는다 — 기본값은 전부 비활성이다', () => {
    enabledPlugins.value = undefined;
    expect(run('lethal-trifecta').passed).toBe(false);
  });

  it('다른 플러그인을 켠 것으로 열리지 않는다', () => {
    enabledPlugins.value = ['kill-switch'];
    expect(run('lethal-trifecta').passed).toBe(false);
    expect(run('kill-switch').passed).toBe(true);
  });

  it('판정은 매 요청마다 다시 한다 — 껐다 켠 것이 재시작 없이 즉시 유효해야 한다', () => {
    const guard = requirePluginEnabled('kill-switch');
    const call = (): boolean => {
      let passed = false;
      guard({} as Request, fakeRes(), () => { passed = true; });
      return passed;
    };
    enabledPlugins.value = [];
    expect(call()).toBe(false);
    enabledPlugins.value = ['kill-switch'];   // 창에서 켠 순간
    expect(call()).toBe(true);
    enabledPlugins.value = [];                // 다시 끈 순간
    expect(call()).toBe(false);
  });
});

/**
 * 관문이 아무리 정확해도 **코어가 라우터를 안 부르면** 아무 일도 안 일어난다. 그리고 그 사고는 조용하다 —
 * 빌드도 타입체크도 통과하고, 지금은 서버 기여가 0 이라 눈에 띄는 증상조차 없다. 배선의 존재만 확인한다.
 */
describe('플러그인 라우트 배선', () => {
  it('코어가 mountPluginRoutes(app) 를 부른다', () => {
    const core = path.resolve(__dirname, '../index.ts');
    expect(fs.existsSync(core)).toBe(true);
    expect(fs.readFileSync(core, 'utf8')).toContain('mountPluginRoutes(app)');
  });
});
