import type { ClaudeAuthStatus, CodexAuthStatus } from '@vibisual/shared';

/**
 * §5.25 (E) — 계정 칸에서 제공사 사이트로 나가는 링크(결제·요금제·키는 앱이 못 바꾸고 자격증명도 안 읽는다).
 * 목적지는 로그인 방식이 정한다(구독 / API 과금 / `bedrock`·`vertex`, 코덱스 계정 / 키). 엉뚱한 곳은 없느니만 못해 이 순수 함수가 판정하고 시험으로 고정한다.
 * 여는 길은 기존 `window.open` → `shell.openExternal` 그대로(§3.7).
 */

/** 공개 페이지만 쓴다(문서에 없는 엔드포인트·남의 토큰 ❌). 2026-09-20 확인: `claude.ai/settings/profile`→`/settings/account`, `console.anthropic.com`→`platform.claude.com`. */
const CLAUDE_AI = 'https://claude.ai/settings';
const CLAUDE_PLATFORM = 'https://platform.claude.com';
const CHATGPT = 'https://chatgpt.com';
const OPENAI_PLATFORM = 'https://platform.openai.com';

/** 전체 키를 적는다 — 조각을 붙인 키는 검색에 안 걸려 번역을 지워도 죽은 줄 모른다. */
const LABEL = {
  account: 'panel.options.account.portal.account',
  billing: 'panel.options.account.portal.billing',
  usage: 'panel.options.account.portal.usage',
  apiKeys: 'panel.options.account.portal.apiKeys',
  console: 'panel.options.account.portal.console',
  codexWeb: 'panel.options.account.portal.codexWeb',
} as const;

/** 버튼 한 개. */
export interface AccountPortalLink {
  /** React 키 + 테스트가 집는 이름. 같은 칸 안에서 겹치지 않는다. */
  id: string;
  /** i18n 전체 키(`LABEL`). */
  labelKey: string;
  url: string;
  /** 어디로 나가는지. 고유명사라 번역하지 않는다(툴팁). */
  site: string;
}

const link = (id: string, labelKey: string, url: string, site: string): AccountPortalLink =>
  ({ id, labelKey, url, site });

/** CLI 가 말한 값을 견주기 좋게 다듬는다. 경로가 아니라 CLI 토큰이라 소문자로 접어도 안전하다. */
function token(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** `local`(All Model)은 비어 있다 — 계정도 청구도 없어 버튼이 거짓말이 된다. */
export function accountPortalLinks(
  engine: 'claude' | 'codex' | 'local',
  auth: ClaudeAuthStatus | CodexAuthStatus | null | undefined,
): AccountPortalLink[] {
  if (engine === 'claude') return claudePortals(auth as ClaudeAuthStatus | null | undefined);
  if (engine === 'codex') return codexPortals(auth as CodexAuthStatus | null | undefined);
  return [];
}

function claudePortals(auth: ClaudeAuthStatus | null | undefined): AccountPortalLink[] {
  // 클라우드 재판매 경로는 청구서가 그 클라우드에서 나온다 — Anthropic 쪽으로 보내면 그 사용자는
  // 자기 결제 수단이 없는 화면에 도착한다.
  const provider = token(auth?.apiProvider);
  if (provider === 'bedrock') {
    return [
      link('console', LABEL.console, 'https://console.aws.amazon.com/bedrock/home', 'AWS'),
      link('billing', LABEL.billing, 'https://console.aws.amazon.com/billing/home', 'AWS'),
    ];
  }
  if (provider === 'vertex') {
    return [
      link('console', LABEL.console, 'https://console.cloud.google.com/vertex-ai', 'Google Cloud'),
      link('billing', LABEL.billing, 'https://console.cloud.google.com/billing', 'Google Cloud'),
    ];
  }

  // API 과금으로 쓰는 사람에게 claude.ai 구독 화면은 남의 집이다 — 거기엔 그 사람의 청구가 없다.
  const method = token(auth?.authMethod);
  if (method === 'console' || method === 'apikey') {
    return [
      link('billing', LABEL.billing, `${CLAUDE_PLATFORM}/settings/billing`, 'platform.claude.com'),
      link('usage', LABEL.usage, `${CLAUDE_PLATFORM}/usage`, 'platform.claude.com'),
      link('apiKeys', LABEL.apiKeys, `${CLAUDE_PLATFORM}/settings/keys`, 'platform.claude.com'),
    ];
  }

  const links = [
    link('account', LABEL.account, `${CLAUDE_AI}/account`, 'claude.ai'),
    link('billing', LABEL.billing, `${CLAUDE_AI}/billing`, 'claude.ai'),
    link('usage', LABEL.usage, `${CLAUDE_AI}/usage`, 'claude.ai'),
  ];
  // 방식을 모를 때(로그아웃·판정 실패)는 흔한 쪽인 구독을 먼저 놓되 개발자 콘솔을 한 칸 덧붙인다 —
  // 고르는 것은 사용자다(§5.25 (C) "고른 것은 기본값이지 자물쇠가 아니다").
  if (!method) links.push(link('console', LABEL.console, `${CLAUDE_PLATFORM}/`, 'platform.claude.com'));
  return links;
}

function codexPortals(auth: CodexAuthStatus | null | undefined): AccountPortalLink[] {
  const method = token(auth?.authMethod);
  if (method === 'apikey') {
    return [
      link('billing', LABEL.billing, `${OPENAI_PLATFORM}/settings/organization/billing/overview`, 'platform.openai.com'),
      link('usage', LABEL.usage, `${OPENAI_PLATFORM}/settings/organization/usage`, 'platform.openai.com'),
      link('apiKeys', LABEL.apiKeys, `${OPENAI_PLATFORM}/api-keys`, 'platform.openai.com'),
    ];
  }

  const links = [
    link('account', LABEL.account, `${CHATGPT}/#settings/Account`, 'chatgpt.com'),
    link('billing', LABEL.billing, `${CHATGPT}/#pricing`, 'chatgpt.com'),
    link('codexWeb', LABEL.codexWeb, `${CHATGPT}/codex`, 'chatgpt.com'),
  ];
  if (!method) links.push(link('console', LABEL.console, `${OPENAI_PLATFORM}/`, 'platform.openai.com'));
  return links;
}
