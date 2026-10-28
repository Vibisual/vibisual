/**
 * §4 API 크레딧 — `apiCreditService`: 지출은 `cost_report` 를 그대로 보인다(메모리만, 앱 장부 ❌) · 금액으로 막지 않고 Anthropic 거절만 기억해 구독으로 돌린다
 * ([다시 시도]·시도 시각이면 다시 묻는다) · 두 키는 감싼 채로만 디스크에, 화면 값에는 어떤 모양으로도 안 실린다 · 옛 장부·한도 칸은 버린다.
 * ⚠ `VIBISUAL_HOME` 을 임시 폴더로 돌리고 모듈을 시험마다 새로 읽는다(실제 app-state.json 보호). `fetch` 는 갈아 끼운다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env['VIBISUAL_HOME'];
let home = '';

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-apicredit-home-')));
  process.env['VIBISUAL_HOME'] = home;
  fs.mkdirSync(path.join(home, '.vibisual'), { recursive: true });
  fs.writeFileSync(path.join(home, '.vibisual', 'app-state.json'), JSON.stringify({ openProjects: [], updatedAt: 1 }), 'utf-8');
  vi.resetModules();
  // 키를 저장하면 확인(`GET /v1/models`)이 비동기로 돈다 — 진짜 Anthropic 에 가짜 키로 묻지 않게 늘 막아 둔다.
  stubAnthropic(defaultRoute);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (prevHome === undefined) delete process.env['VIBISUAL_HOME'];
  else process.env['VIBISUAL_HOME'] = prevHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
});

const KEY = 'sk-ant-api03-TESTKEY-abcdefghijklmnop-WXYZ'; // privacy-ok — 가짜 키
const ADMIN = 'sk-ant-admin01-TESTADMIN-abcdefghijk-AD01'; // privacy-ok — 가짜 키

/** 원문이 디스크에 보이지 않는지 확인할 수 있게 뒤집어 감싸는 가짜 금고. */
const fakeCipher = {
  available: () => true,
  strong: () => true,
  encrypt: (plain: string) => `enc:${Buffer.from([...plain].reverse().join('')).toString('base64')}`,
  decrypt: (data: string) => [...Buffer.from(data.slice(4), 'base64').toString()].reverse().join(''),
};

async function load() {
  const mod = await import('./apiCreditService.js');
  const appState = await import('./appState.js');
  mod.apiCreditService.setCipher(fakeCipher);
  return { svc: mod.apiCreditService, appState };
}

type Route = (url: URL, headers: Record<string, string>) => { status: number; body: unknown };

/** Anthropic API 를 흉내 낸다 — 부른 주소·헤더를 남긴다. */
function stubAnthropic(route: Route): { calls: { url: URL; headers: Record<string, string> }[] } {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(input));
    const headers = init?.headers ?? {};
    calls.push({ url, headers });
    const out = route(url, headers);
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  }));
  return { calls };
}

/** 기본 응답 — 키 확인은 통과, 조직 이름은 'Org', 이번 달 지출은 0. */
function defaultRoute(url: URL): { status: number; body: unknown } {
  if (url.pathname.endsWith('/v1/models')) return { status: 200, body: { data: [] } };
  if (url.pathname.endsWith('/organizations/me')) return { status: 200, body: { id: 'org', name: 'Org', type: 'organization' } };
  return { status: 200, body: { data: [], has_more: false, next_page: null } };
}

const costPage = (cents: string[], extra: Record<string, unknown> = {}) => ({
  data: cents.map((amount, i) => ({
    starting_at: `2026-10-${String(20 + i).padStart(2, '0')}T00:00:00Z`,
    ending_at: `2026-10-${String(21 + i).padStart(2, '0')}T00:00:00Z`,
    results: [{ amount, currency: 'USD' }],
  })),
  has_more: false,
  next_page: null,
  ...extra,
});

describe('apiCreditService — 키 보관', () => {
  it('두 키는 감싼 채로 디스크에 앉고, 화면 값·AppState 응답에는 실리지 않는다', async () => {
    const { svc, appState } = await load();
    expect(svc.setKey(KEY).problem).toBeUndefined();
    expect(svc.setAdminKey(ADMIN).problem).toBeUndefined();
    // 저장이 건 확인·읽기를 이 시험 안에서 끝낸다(같은 읽기를 함께 기다린다).
    await svc.verifyKey();
    await svc.refreshConsole({ force: true });
    const raw = fs.readFileSync(path.join(home, '.vibisual', 'app-state.json'), 'utf-8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(ADMIN);
    const state = JSON.stringify(svc.getState());
    expect(state).not.toContain(KEY);
    expect(state).not.toContain(ADMIN);
    expect(svc.getState().keyHint).toBe('…WXYZ');
    expect(svc.getState().adminKey?.hint).toBe('…AD01');
    expect(svc.keyForSpawn()).toBe(KEY);
    // 스냅샷·GET /api/app-state 가 지나는 문은 크레딧 칸을 통째로 뺀다.
    expect(JSON.stringify(appState.publicAppState(appState.loadAppState()))).not.toContain('apiCredits');
  });

  it('처음 넣은 실행용 키는 스위치를 켠다 — 사용자가 직접 끈 적이 있으면 그대로 둔다', async () => {
    const { svc } = await load();
    svc.setKey(KEY);
    expect(svc.settings().enabled).toBe(true);
    svc.updateSettings({ enabled: false });
    svc.clearKey();
    svc.setKey(KEY);
    expect(svc.settings().enabled).toBe(false);
  });

  it('실행용 칸은 관리자 키를, 지출 칸은 OAuth 토큰을 돌려보낸다', async () => {
    const { svc } = await load();
    expect(svc.setKey(ADMIN).problem).toBe('admin-key');
    expect(svc.setAdminKey('sk-ant-oat01-xyz').problem).toBe('oauth-token');
    expect(svc.getState().hasKey).toBe(false);
    expect(svc.getState().adminKey).toBeUndefined();
  });

  it('옛 판의 장부·한도 칸은 읽을 때 버린다 — 켬과 키는 남고, 화면에 장부가 없다', async () => {
    fs.writeFileSync(path.join(home, '.vibisual', 'app-state.json'), JSON.stringify({
      openProjects: [],
      updatedAt: 1,
      apiCredits: {
        settings: { enabled: true, capUsd: 400, safetyMarginUsd: 0.5 },
        ledger: { spentUsd: 123.45, since: 1, runs: 20, lock: { reason: 'cap-reached', at: 1 } },
        key: { scheme: 'plain', data: KEY, hint: '…WXYZ', savedAt: 1, verified: 'ok' },
      },
    }), 'utf-8');
    const { svc } = await load();
    const state = svc.getState() as unknown as Record<string, unknown>;
    expect(svc.settings()).toEqual({ enabled: true, mode: 'subscription-first', autoContinue: true });
    expect(state['ledger']).toBeUndefined();
    expect(state['block']).toBeUndefined();
    expect(svc.keyForSpawn()).toBe(KEY);
    svc.updateSettings({ autoContinue: true });
    const raw = fs.readFileSync(path.join(home, '.vibisual', 'app-state.json'), 'utf-8');
    expect(raw).not.toContain('spentUsd');
    expect(raw).not.toContain('capUsd');
  });
});

describe('apiCreditService — Console 이번 달 지출(공식 cost_report)', () => {
  it('관리자 키로 이번 달(UTC)을 읽어 그대로 보이고, 조직 이름을 함께 단다', async () => {
    const { calls } = stubAnthropic((url) => url.pathname.endsWith('/organizations/me')
      ? { status: 200, body: { id: 'org', name: 'My Console Org', type: 'organization' } }
      : { status: 200, body: costPage(['6000.5', '1499.5']) });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    const c = svc.getState().console;
    expect(c.status).toBe('ok');
    expect(c.spendUsd).toBe(75);
    expect(c.orgName).toBe('My Console Org');
    expect(svc.getState().adminKey?.verified).toBe('ok');
    const report = calls.find((x) => x.url.pathname.endsWith('/cost_report'))!;
    expect(report.headers['x-api-key']).toBe(ADMIN);
    expect(report.url.searchParams.get('bucket_width')).toBe('1d');
    expect(report.url.searchParams.get('starting_at')).toMatch(/^\d{4}-\d{2}-01T00:00:00Z$/);
  });

  it('다음 쪽이 있으면 따라가 합한다', async () => {
    stubAnthropic((url) => {
      if (url.pathname.endsWith('/organizations/me')) return { status: 200, body: { name: 'Org' } };
      return url.searchParams.get('page') === 'page_2'
        ? { status: 200, body: costPage(['100']) }
        : { status: 200, body: costPage(['900'], { has_more: true, next_page: 'page_2' }) };
    });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    expect(svc.getState().console.spendUsd).toBe(10);
  });

  it('거절되면 Anthropic 원문과 사유를 보이고, 같은 달의 마지막 값은 남긴다', async () => {
    let mode: 'ok' | 'denied' = 'ok';
    stubAnthropic((url) => {
      if (url.pathname.endsWith('/organizations/me')) return { status: 200, body: { name: 'Org' } };
      return mode === 'ok'
        ? { status: 200, body: costPage(['5000']) }
        : { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
    });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    expect(svc.getState().console.spendUsd).toBe(50);
    mode = 'denied';
    vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ['Date'] });
    await svc.refreshConsole({ force: true });
    const c = svc.getState().console;
    expect(c.status).toBe('error');
    expect(c.error).toEqual({ kind: 'auth', status: 401, message: 'invalid x-api-key' });
    expect(c.spendUsd).toBe(50);
    expect(svc.getState().adminKey?.verified).toBe('rejected');
  });

  it('페이지를 열 때의 읽기는 1분 안에 다시 묻지 않는다', async () => {
    const { calls } = stubAnthropic((url) => url.pathname.endsWith('/organizations/me')
      ? { status: 200, body: { name: 'Org' } }
      : { status: 200, body: costPage(['1']) });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    const before = calls.length;
    await svc.refreshConsole({ maxAgeMs: 60_000 });
    expect(calls.length).toBe(before);
  });

  it('관리자 키가 없으면 묻지 않고 그 사실을 말한다', async () => {
    const { calls } = stubAnthropic(() => ({ status: 200, body: costPage([]) }));
    const { svc } = await load();
    await svc.refreshConsole({ force: true });
    expect(calls).toHaveLength(0);
    expect(svc.getState().console.status).toBe('no-key');
  });
});

describe('apiCreditService — 앱은 막지 않고 Anthropic 의 거절만 따른다', () => {
  it('잔액 부족 거절 → 새 실행은 구독 → [다시 시도]를 누르면 다시 크레딧', async () => {
    const { svc } = await load();
    svc.setKey(KEY);
    svc.updateSettings({ enabled: true, mode: 'credits-first' });
    expect(svc.decide().route).toBe('credits');
    const run = svc.beginRun('sub-a', 'cmd-a');
    expect(svc.getState().liveRuns).toBe(1);
    svc.noteRunLine(run, { type: 'result', is_error: true, result: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' });
    expect(svc.endRun(run)?.refusal?.reason).toBe('balance-empty');
    expect(svc.getState().liveRuns).toBe(0);
    expect(svc.getState().block?.reason).toBe('balance-empty');
    expect(svc.decide()).toEqual({ route: 'subscription', reason: 'blocked' });
    svc.clearBlock();
    expect(svc.decide().route).toBe('credits');
  });

  it('지출 한도 거절은 문구의 재개 시각까지 — 그때가 지나면 저절로 다시 크레딧', async () => {
    const { svc } = await load();
    svc.setKey(KEY);
    svc.updateSettings({ enabled: true, mode: 'credits-first' });
    const run = svc.beginRun('sub-a', 'cmd-a');
    const regain = Date.now() + 3 * 86_400_000;
    const day = new Date(regain).toISOString().slice(0, 10);
    svc.noteFailureText(run, `API Error: 429 {"error":{"type":"rate_limit_error","message":"You have reached your API usage limits: ... You will regain access on ${day} at 00:00 UTC.","details":{"error_code":"enforced_spend_limit_reached"}}}`);
    svc.endRun(run);
    const until = svc.getState().block?.until;
    expect(svc.getState().block?.reason).toBe('spend-limit');
    expect(until).toBe(Date.parse(`${day}T00:00:00Z`));
    expect(svc.decide(until! - 1).reason).toBe('blocked');
    expect(svc.decide(until!).route).toBe('credits');
    expect(svc.getState(until!).block).toBeUndefined();
  });

  it('거절 기억은 앱을 다시 켜도 남는다(같은 거절을 한 번 더 겪지 않게)', async () => {
    const first = await load();
    first.svc.setKey(KEY);
    first.svc.updateSettings({ enabled: true, mode: 'credits-first' });
    const run = first.svc.beginRun('sub-a', 'cmd-a');
    first.svc.noteFailureText(run, 'Credit balance too low · Add funds: https://platform.claude.com/settings/billing');
    first.svc.endRun(run);
    vi.resetModules();
    const second = await load();
    expect(second.svc.getState().block?.reason).toBe('balance-empty');
    expect(second.svc.decide().reason).toBe('blocked');
  });

  it('모르는 실패는 막지 않는다 · 새 키는 옛 키에 대한 거절을 걷는다', async () => {
    const { svc } = await load();
    svc.setKey(KEY);
    svc.updateSettings({ enabled: true, mode: 'credits-first' });
    const run = svc.beginRun('sub-a', 'cmd-a');
    svc.noteRunLine(run, { type: 'result', is_error: true, result: 'Overloaded' });
    expect(svc.endRun(run)?.refusal).toBeUndefined();
    expect(svc.decide().route).toBe('credits');
    const run2 = svc.beginRun('sub-a', 'cmd-b');
    svc.noteFailureText(run2, 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
    svc.endRun(run2);
    expect(svc.decide().reason).toBe('blocked');
    svc.setKey('sk-ant-api03-ANOTHERKEY-abcdefghijk-ZZZZ'); // privacy-ok — 가짜 키
    expect(svc.getState().block).toBeUndefined();
  });

  it('금액 칸은 설정으로 받지 않는다(옛 화면이 보내도 버린다)', async () => {
    const { svc } = await load();
    svc.updateSettings({ enabled: true, capUsd: 400, safetyMarginUsd: 1 } as Record<string, unknown>);
    expect(svc.settings()).toEqual({ enabled: true, mode: 'subscription-first', autoContinue: true });
  });
});
