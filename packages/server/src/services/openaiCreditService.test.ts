/**
 * §4 OpenAI 비즈니스 크레딧 — 코덱스 판 `openaiCreditService` 와 그 판정: 지출은 공식 Costs API(달러) 그대로 · 키는 Claude 판과 다른 칸에
 * 감싼 채로만 · OpenAI 거절만 기억해 구독으로 · 코덱스 턴에 싣는 덮어쓰기와 env(세 OS) · 코덱스 한도 표 변환 · 다른 제공자면 닫힘.
 * ⚠ `VIBISUAL_HOME` 을 임시 폴더로 돌리고 모듈을 시험마다 새로 읽는다(실제 app-state.json 보호). `fetch` 는 갈아 끼운다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OPENAI_CREDIT_KEY_ENV,
  OPENAI_CREDIT_PROVIDER_ID,
  checkOpenAiAdminKeyShape,
  checkOpenAiKeyShape,
  codexCustomModelProvider,
  codexWindowsAsLimits,
  decideCreditRoute,
  detectOpenAiRefusal,
  isSubscriptionExhausted,
  openaiCostsUrl,
  openaiCreditConfigArgs,
  parseOpenAiCosts,
  API_CREDIT_DEFAULTS,
} from '@vibisual/shared';
import { scanCodexConfigToml } from './codexConfigService.js';
import { codexAppServerConfigArgs } from './codexRunner.js';

const prevHome = process.env['VIBISUAL_HOME'];
let home = '';

const KEY = 'sk-proj-TESTKEY-abcdefghijklmnop-WXYZ'; // privacy-ok — 가짜 키
const ADMIN = 'sk-admin-TESTADMIN-abcdefghijk-AD01'; // privacy-ok — 가짜 키
const ANTHROPIC = 'sk-ant-api03-TESTKEY-abcdefghijklmnop-ANTH'; // privacy-ok — 가짜 키

const fakeCipher = {
  available: () => true,
  strong: () => true,
  encrypt: (plain: string) => `enc:${Buffer.from([...plain].reverse().join('')).toString('base64')}`,
  decrypt: (data: string) => [...Buffer.from(data.slice(4), 'base64').toString()].reverse().join(''),
};

type Route = (url: URL, headers: Record<string, string>) => { status: number; body: unknown };

function stubOpenAi(route: Route): { calls: { url: URL; headers: Record<string, string> }[] } {
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

const costsPage = (values: number[], extra: Record<string, unknown> = {}) => ({
  object: 'page',
  data: values.map((value, i) => ({
    object: 'bucket',
    start_time: 1_793_491_200 + i * 86_400,
    end_time: 1_793_577_600 + i * 86_400,
    results: [{ object: 'organization.costs.result', amount: { value, currency: 'usd' }, line_item: null, project_id: null }],
  })),
  has_more: false,
  next_page: null,
  ...extra,
});

function defaultRoute(url: URL): { status: number; body: unknown } {
  if (url.pathname.endsWith('/v1/models')) return { status: 200, body: { data: [] } };
  return { status: 200, body: costsPage([]) };
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-openaicredit-home-')));
  process.env['VIBISUAL_HOME'] = home;
  fs.mkdirSync(path.join(home, '.vibisual'), { recursive: true });
  fs.writeFileSync(path.join(home, '.vibisual', 'app-state.json'), JSON.stringify({ openProjects: [], updatedAt: 1 }), 'utf-8');
  vi.resetModules();
  stubOpenAi(defaultRoute);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (prevHome === undefined) delete process.env['VIBISUAL_HOME'];
  else process.env['VIBISUAL_HOME'] = prevHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function load() {
  const mod = await import('./apiCreditService.js');
  const appState = await import('./appState.js');
  mod.setApiCreditCipher(fakeCipher);
  return { svc: mod.openaiCreditService, claude: mod.apiCreditService, appState };
}

describe('openaiCreditService — 키 보관', () => {
  it('두 키는 Claude 판과 다른 칸에 감싼 채로 앉고, 화면 값·공개 AppState 에는 실리지 않는다', async () => {
    const { svc, claude, appState } = await load();
    expect(svc.setKey(KEY).problem).toBeUndefined();
    expect(svc.setAdminKey(ADMIN).problem).toBeUndefined();
    await svc.verifyKey();
    await svc.refreshConsole({ force: true });
    const raw = fs.readFileSync(path.join(home, '.vibisual', 'app-state.json'), 'utf-8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(ADMIN);
    const saved = JSON.parse(raw) as Record<string, unknown>;
    expect(saved['openaiCredits']).toBeDefined();
    expect(saved['apiCredits']).toBeUndefined();
    expect(claude.getState().hasKey).toBe(false);
    expect(JSON.stringify(svc.getState())).not.toContain(KEY);
    expect(svc.keyForSpawn()).toBe(KEY);
    expect(svc.settings().enabled).toBe(true);
    expect(JSON.stringify(appState.publicAppState(appState.loadAppState()))).not.toContain('openaiCredits');
  });

  it('실행용 칸은 관리자 키·Anthropic 키를, 지출 칸은 관리자 키가 아닌 값을 돌려보낸다', async () => {
    const { svc } = await load();
    expect(svc.setKey(ADMIN).problem).toBe('admin-key');
    expect(svc.setKey(ANTHROPIC).problem).toBe('not-openai');
    expect(svc.setAdminKey(KEY).problem).toBe('not-admin-key');
    expect(svc.getState().hasKey).toBe(false);
    expect(svc.getState().adminKey).toBeUndefined();
  });

  it('키 확인은 Bearer 로 공개 /v1/models 를 묻는다 — 401 이면 거절로 기억해 구독으로', async () => {
    const { calls } = stubOpenAi((url) => url.pathname.endsWith('/v1/models')
      ? { status: 401, body: { error: { message: 'Incorrect API key provided' } } }
      : { status: 200, body: costsPage([]) });
    const { svc } = await load();
    svc.setKey(KEY);
    expect(await svc.verifyKey()).toBe('rejected');
    const models = calls.find((c) => c.url.pathname.endsWith('/v1/models'))!;
    expect(models.url.host).toBe('api.openai.com');
    expect(models.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(svc.getState().block?.reason).toBe('key-invalid');
    expect(svc.decide().route).toBe('subscription');
  });
});

describe('openaiCreditService — Platform 이번 달 지출(공식 Costs API)', () => {
  it('관리자 키로 이번 달(UTC)을 읽어 달러 그대로 합하고, 조직 이름은 묻지 않는다', async () => {
    const { calls } = stubOpenAi((url) => url.pathname.endsWith('/organization/costs')
      ? { status: 200, body: costsPage([12.5, 0.25]) }
      : { status: 200, body: { data: [] } });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    const c = svc.getState().console;
    expect(c.status).toBe('ok');
    expect(c.spendUsd).toBe(12.75);
    expect(c.orgName).toBeUndefined();
    const costs = calls.find((x) => x.url.pathname.endsWith('/organization/costs'))!;
    expect(costs.headers['authorization']).toBe(`Bearer ${ADMIN}`);
    expect(costs.url.searchParams.get('bucket_width')).toBe('1d');
    const start = Number(costs.url.searchParams.get('start_time'));
    expect(new Date(start * 1000).getUTCDate()).toBe(1);
    expect(calls.every((x) => !x.url.pathname.includes('/organizations/me'))).toBe(true);
  });

  it('다음 쪽 커서를 따라가 합하고, 실패하면 마지막 값을 남긴 채 사유를 단다', async () => {
    let fail = false;
    stubOpenAi((url) => {
      if (fail) return { status: 403, body: { error: { message: 'Admin key required' } } };
      return url.searchParams.get('page') === 'p2'
        ? { status: 200, body: costsPage([1]) }
        : { status: 200, body: costsPage([2], { has_more: true, next_page: 'p2' }) };
    });
    const { svc } = await load();
    svc.setAdminKey(ADMIN);
    await svc.refreshConsole({ force: true });
    expect(svc.getState().console.spendUsd).toBe(3);
    fail = true;
    vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ['Date'] });
    try {
      await svc.refreshConsole({ force: true });
    } finally {
      vi.useRealTimers();
    }
    const c = svc.getState().console;
    expect(c.status).toBe('error');
    expect(c.error).toMatchObject({ kind: 'forbidden', status: 403, message: 'Admin key required' });
    expect(c.spendUsd).toBe(3);
  });
});

describe('openaiCreditService — 경로와 OpenAI 거절', () => {
  it('구독이 막히면 크레딧, 잔액·한도 거절이면 1시간 동안 구독으로 — 다른 제공자로 설정된 PC 는 닫힌다', async () => {
    const { svc } = await load();
    svc.setKey(KEY);
    let limits = codexWindowsAsLimits([{ id: 'codex:primary', label: 'codex', usedPercent: 100, windowDurationMins: 300, resetsAt: Date.now() + 3_600_000 }]);
    svc.setSubscriptionSource(() => ({ limits, fetchedAt: Date.now() }));
    expect(svc.decide()).toEqual({ route: 'credits', reason: 'subscription-exhausted' });

    const runId = svc.beginRun('sub-1', 'cmd-1');
    svc.noteFailureText(runId, 'Quota exceeded. Check your plan and billing details.');
    expect(svc.endRun(runId)?.refusal?.reason).toBe('balance-empty');
    expect(svc.decide()).toEqual({ route: 'subscription', reason: 'blocked' });
    svc.clearBlock();

    limits = [];
    expect(svc.decide().reason).toBe('subscription-ok');
    svc.setProviderSource(() => 'azure');
    expect(svc.decide()).toEqual({ route: 'subscription', reason: 'cloud-provider' });
    expect(svc.getState().customProvider).toBe('azure');
    expect(svc.getState().cloudProvider).toBeUndefined();
  });
});

describe('OpenAI 판 판정(shared)', () => {
  it('Costs 주소는 유닉스 초·1일 버킷·커서', () => {
    const url = new URL(openaiCostsUrl(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1), 'cur'));
    expect(url.origin + url.pathname).toBe('https://api.openai.com/v1/organization/costs');
    expect(url.searchParams.get('start_time')).toBe(String(Date.UTC(2026, 10, 1) / 1000));
    expect(url.searchParams.get('end_time')).toBe(String(Date.UTC(2026, 11, 1) / 1000));
    expect(url.searchParams.get('bucket_width')).toBe('1d');
    expect(url.searchParams.get('page')).toBe('cur');
  });

  it('Costs 합은 USD 만, 모양이 다르면 null', () => {
    expect(parseOpenAiCosts({ data: [{ results: [{ amount: { value: 1.5, currency: 'usd' } }, { amount: { value: 9, currency: 'eur' } }] }] }))
      .toEqual({ usd: 1.5, hasMore: false });
    expect(parseOpenAiCosts({ data: [], next_page: 'n' })).toEqual({ usd: 0, hasMore: true, nextPage: 'n' });
    expect(parseOpenAiCosts({ object: 'error' })).toBeNull();
  });

  it('키 모양', () => {
    expect(checkOpenAiKeyShape(KEY)).toBeNull();
    expect(checkOpenAiKeyShape('sk-svcacct-abcdef1234567890')).toBeNull();
    expect(checkOpenAiKeyShape(' ')).toBe('empty');
    expect(checkOpenAiKeyShape('sk-proj abc')).toBe('whitespace');
    expect(checkOpenAiKeyShape(ANTHROPIC)).toBe('not-openai');
    expect(checkOpenAiKeyShape(ADMIN)).toBe('admin-key');
    expect(checkOpenAiAdminKeyShape(ADMIN)).toBeNull();
    expect(checkOpenAiAdminKeyShape(KEY)).toBe('not-admin-key');
  });

  it('거절 문구 — 잔액·한도는 1시간 뒤, 키 거부는 키를 바꿀 때까지, 모르는 실패는 null', () => {
    const now = 1_000_000;
    expect(detectOpenAiRefusal('{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}', now))
      .toMatchObject({ reason: 'balance-empty', until: now + 3_600_000, detail: 'You exceeded your current quota' });
    expect(detectOpenAiRefusal('unexpected status 401 Unauthorized: Incorrect API key provided', now))
      .toMatchObject({ reason: 'key-invalid' });
    expect(detectOpenAiRefusal('stream disconnected before completion', now)).toBeNull();
  });

  it('코덱스 한도 표 — codex 묶음만, 주간 창은 주간으로, 100% 면 소진', () => {
    const now = Date.now();
    const limits = codexWindowsAsLimits([
      { id: 'codex:primary', label: 'codex', usedPercent: 40, windowDurationMins: 300, resetsAt: now + 1000 },
      { id: 'codex:secondary', label: 'codex', usedPercent: 100, windowDurationMins: 10_080, resetsAt: now + 5000 },
      { id: 'codex_other:primary', label: 'other', usedPercent: 100, windowDurationMins: 300 },
    ]);
    expect(limits.map((l) => l.kind)).toEqual(['session', 'weekly_all']);
    expect(isSubscriptionExhausted({ limits, fetchedAt: now }, now)).toEqual({ exhausted: true, resetsAt: now + 5000 });
  });

  it('다른 제공자 판정 — 프로젝트 겹은 보지 않고, openai 는 닫지 않는다', () => {
    const layer = (source: 'project' | 'user' | 'profile', modelProvider?: string) => ({ source, path: 'x', values: modelProvider ? { modelProvider } : {} });
    expect(codexCustomModelProvider({ layers: [layer('project', 'ollama'), layer('user')] })).toBeNull();
    expect(codexCustomModelProvider({ layers: [layer('profile', 'azure'), layer('user', 'openai')] })).toBe('azure');
    expect(codexCustomModelProvider({ layers: [layer('user', 'openai')] })).toBeNull();
    expect(scanCodexConfigToml('model_provider = "azure"\n[profiles.p]\nmodel_provider = "ollama"\n').values.modelProvider).toBe('azure');
    expect(decideCreditRoute({ settings: { ...API_CREDIT_DEFAULTS, enabled: true }, hasKey: true, subscriptionExhausted: true, cloudProvider: 'azure' }, 0).reason)
      .toBe('cloud-provider');
  });

  it('코덱스 턴 덮어쓰기는 예약되지 않은 제공자 하나이고 app-server 로 그대로 넘어간다', () => {
    const args = openaiCreditConfigArgs();
    expect(args).toContain(`model_provider="${OPENAI_CREDIT_PROVIDER_ID}"`);
    expect(args).toContain(`model_providers.${OPENAI_CREDIT_PROVIDER_ID}.env_key="${OPENAI_CREDIT_KEY_ENV}"`);
    expect(args).toContain(`model_providers.${OPENAI_CREDIT_PROVIDER_ID}.base_url="https://api.openai.com/v1"`);
    expect(args).toContain(`model_providers.${OPENAI_CREDIT_PROVIDER_ID}.wire_api="responses"`);
    expect(OPENAI_CREDIT_PROVIDER_ID).not.toMatch(/^(openai|ollama|lmstudio|amazon-bedrock|gcp)$/);
    expect(codexAppServerConfigArgs(['exec', '-C', '/w', ...args])).toEqual(args);
  });
});

describe('codexCreditEnv — 스폰 env 의 키 이름(세 OS)', () => {
  it('크레딧이면 그 이름 하나에 우리 키만, 구독이면 걷고, 꺼져 있으면 손대지 않는다', async () => {
    const { codexCreditEnv } = await import('./codexCreditRoute.js');
    const env = { PATH: 'x', [OPENAI_CREDIT_KEY_ENV]: 'stale', vibisual_openai_api_key: 'lower' };
    expect(codexCreditEnv(env, undefined, 'win32')).toBe(env);
    expect(codexCreditEnv(env, { route: 'subscription' }, 'win32')).toEqual({ PATH: 'x' });
    expect(codexCreditEnv(env, { route: 'credits', key: KEY }, 'win32')).toEqual({ PATH: 'x', [OPENAI_CREDIT_KEY_ENV]: KEY });
    for (const platform of ['darwin', 'linux'] as const) {
      expect(codexCreditEnv(env, { route: 'subscription' }, platform)).toEqual({ PATH: 'x', vibisual_openai_api_key: 'lower' });
      expect(codexCreditEnv(env, { route: 'credits', key: KEY }, platform))
        .toEqual({ PATH: 'x', vibisual_openai_api_key: 'lower', [OPENAI_CREDIT_KEY_ENV]: KEY });
    }
  });
});
