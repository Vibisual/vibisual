import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../i18n/locales/en.json';
import { CreditPages, type CreditPageKey } from './CreditPages.js';

// §4 API 크레딧 — 지갑마다 페이지, 금액·한도·잔액은 Console 이 정한다. 고정: 페이지마다 자기 지갑만 · 머리 칸 넷이 같은 꼴 ·
// 비즈니스 맨 위는 Console 지출 그대로 · 앱 한도 입력·잠금 칸 없음 · 거절엔 [다시 시도] · 클라우드는 이 PC 청구처.

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('../../stores/graphStore.js', () => {
  const useGraphStore = (select: (state: Record<string, unknown>) => unknown) => select(mocks.state);
  useGraphStore.getState = () => ({ applyApiCredits: () => undefined });
  return { useGraphStore };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en' },
  t: (key: string, values: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], en);
    return String(value ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(values[name] ?? ''));
  },
}) }));

const SETTINGS = { enabled: true, mode: 'subscription-first', autoContinue: true };
const MONTH = Date.UTC(2026, 9, 1);
const ac = en.panel.usage.apiCredit;

const render = (page: CreditPageKey, variant: 'popup' | 'options' = 'options'): string =>
  renderToStaticMarkup(createElement(CreditPages, { variant, initialPage: page }));

const credits = (patch: Record<string, unknown>): void => {
  mocks.state.apiCredits = { ...(mocks.state.apiCredits as object), ...patch };
};

beforeEach(() => {
  mocks.state = {
    claudeAuth: { loggedIn: true, checkedAt: 1, apiProvider: 'firstParty' },
    claudeUsage: { limits: [], extraCredits: { enabled: true, usedCredits: 5, monthlyLimit: 20, currency: 'USD' }, fetchedAt: 1000 },
    apiCredits: {
      settings: SETTINGS, hasKey: false, encryptionAvailable: true, route: 'subscription', reason: 'no-key',
      liveRuns: 0, subscriptionExhausted: false,
      console: { status: 'no-key', refreshing: false, monthStart: MONTH },
    },
  };
});

describe('CreditPages — 지갑마다 한 페이지', () => {
  it('옵션 입구는 개인·비즈니스·클라우드 셋, 구독 한도는 팝업에만', () => {
    const html = render('business');
    for (const tab of ['Personal credits', 'Business credits', 'Cloud credits']) expect(html).toContain(tab);
    expect(html).not.toContain('Plan limits');
  });

  it('개인 페이지는 claude.ai 추가 사용량만 그린다 — Console 크레딧 설정은 없다', () => {
    const html = render('personal');
    expect(html).toContain('$15.00');
    expect(html).toContain(en.panel.usage.creditPages.personal.what);
    expect(html).not.toContain(ac.key);
  });

  it('클라우드 페이지 — 이 PC 의 Claude Code 가 어디로 청구하는지', () => {
    expect(render('cloud')).toContain(en.panel.usage.creditPages.cloud.provider.anthropic);
    mocks.state.claudeAuth = { loggedIn: true, checkedAt: 1, apiProvider: 'bedrock' };
    const bedrock = render('cloud');
    expect(bedrock).toContain(en.panel.usage.creditPages.cloud.provider.bedrock);
    expect(bedrock).toContain(en.panel.usage.creditPages.cloud.activeNote);
  });

  it('머리 칸 넷이 페이지마다 같은 꼴로 선다', () => {
    for (const page of ['personal', 'business', 'cloud'] as const) {
      const html = render(page);
      expect(html).toContain(en.panel.usage.creditPages.billedLabel);
      expect(html).toContain(en.panel.usage.creditPages.manageLabel);
      expect(html).toContain(en.panel.usage.creditPages.vibisualLabel);
    }
  });
});

describe('비즈니스 페이지 — Console 이번 달 지출 그대로', () => {
  it('관리자 키가 없으면 그 키가 왜 필요한지·어디서 만드는지·조직 설정을 말한다', () => {
    const html = render('business');
    expect(html).toContain(ac.console.needKeyTitle);
    expect(html).toContain(ac.console.createAdminKey);
    expect(html).toContain(ac.console.setupOrg);
    expect(html).toContain(ac.console.limitsNote);
    expect(html).toContain(ac.console.viewSpendLimits);
    expect(html).toContain('platform.claude.com/settings/spend-limits');
    expect(html).not.toContain('$15.00');
  });

  it('읽은 지출을 그대로 크게 보이고, 조직 이름을 단다 — 키 넣는 칸은 걷힌다', () => {
    credits({
      adminKey: { hint: '…AD01', scheme: 'os', readable: true, verified: 'ok' },
      console: { status: 'ok', refreshing: false, monthStart: MONTH, spendUsd: 75.5, fetchedAt: Date.UTC(2026, 9, 27, 3), orgName: 'My Console Org' },
    });
    const html = render('business');
    expect(html).toContain('$75.50');
    expect(html).toContain('My Console Org');
    expect(html).toContain(ac.console.refresh);
    expect(html).not.toContain(ac.console.needKeyTitle);
    expect(html).toContain(ac.console.limitsNote);
  });

  it('Console 지출 한도 화면과 같은 꼴 — 「금액 used」와 다음 달 1일(UTC) 초기화, 한도 화면 링크', () => {
    credits({
      adminKey: { hint: '…AD01', scheme: 'os', readable: true, verified: 'ok' },
      console: { status: 'ok', refreshing: false, monthStart: MONTH, spendUsd: 129.31, fetchedAt: 1 },
    });
    const html = render('business');
    expect(html).toContain('$129.31');
    expect(html).toContain(`>${ac.console.used}<`);
    expect(html).toContain(ac.console.resetsOn.replace('{{date}}', 'November 1, 2026'));
    expect(html).toContain(ac.console.viewSpendLimits);
  });

  it('지출을 아직 못 읽었으면 초기화 줄도 없다 — 금액 없이 날짜만 서지 않는다', () => {
    credits({
      adminKey: { hint: '…AD01', scheme: 'os', readable: true, verified: 'unknown' },
      console: { status: 'pending', refreshing: true, monthStart: MONTH },
    });
    const html = render('business');
    expect(html).toContain(ac.console.pending);
    expect(html).not.toContain('November 1, 2026');
  });

  it('읽기가 실패하면 사유와 Anthropic 원문을, 마지막 값이 있으면 그것도 말한다', () => {
    credits({
      adminKey: { hint: '…AD01', scheme: 'os', readable: true, verified: 'unknown' },
      console: {
        status: 'error', refreshing: false, monthStart: MONTH, spendUsd: 50, fetchedAt: 1,
        error: { kind: 'not-found', status: 404, message: 'The Admin API is unavailable for individual accounts.' },
      },
    });
    const html = render('business');
    expect(html).toContain(ac.console.error['not-found']);
    expect(html).toContain('The Admin API is unavailable for individual accounts.');
    expect(html).toContain(ac.console.lastValue);
    expect(html).toContain('$50.00');
  });

  it('앱이 쥐던 한도 입력·여유·사용액 막대·잠금·초기화 칸은 없다', () => {
    credits({
      hasKey: true, keyHint: '…TEST', keyScheme: 'os', keyVerified: 'ok', keyReadable: true,
      adminKey: { hint: '…AD01', scheme: 'os', readable: true, verified: 'ok' },
      console: { status: 'ok', refreshing: false, monthStart: MONTH, spendUsd: 75.5, fetchedAt: 1 },
    });
    const html = render('business');
    for (const gone of ['Spending cap', 'Safety margin', 'Spent by Vibisual', 'Reset spent amount', 'Unlock', 'you entered']) {
      expect(html).not.toContain(gone);
    }
  });

  it('Anthropic 이 크레딧을 거절했으면 그 사유·원문·다시 시도할 때와 [다시 시도]를 보인다', () => {
    credits({
      hasKey: true, keyHint: '…TEST', keyScheme: 'os', keyVerified: 'ok', keyReadable: true, reason: 'blocked',
      block: { reason: 'balance-empty', at: 1, until: Date.UTC(2026, 9, 27, 4), detail: 'Your credit balance is too low to access the Anthropic API.' },
    });
    const html = render('business');
    expect(html).toContain(ac.block['balance-empty']);
    expect(html).toContain('Your credit balance is too low to access the Anthropic API.');
    expect(html).toContain(ac.blockRetry);
    expect(html).toContain(ac.reason.blocked);
    expect(html).toContain(ac.status.blocked);
  });
});
