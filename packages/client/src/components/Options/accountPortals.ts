import type { ClaudeAuthStatus, CodexAuthStatus } from '@vibisual/shared';

/**
 * §5.25 (E) — 계정 칸에서 **제공사 사이트로 나가는 링크**를 고른다.
 *
 * 결제·요금제·API 키는 우리가 만질 수 없는 것들이다. CLI 도 그 값을 바꾸지 못하고, "자격증명은
 * 읽지도 쓰지도 않는다"는 이 항목의 규율상 앱 안에서 대신 처리할 길도 없다 — 그러면 사용자는
 * 그 일을 하러 갈 때마다 앱을 떠나 주소를 스스로 찾아야 한다. 그 한 걸음을 계정 칸이 대신 놓는다.
 *
 * **어디로 보낼지는 로그인 방식이 정한다.** 같은 클로드라도 구독(`claude.ai`)과 API 과금
 * (`console`·`apiKey`)은 결제하는 곳이 다르고, `apiProvider` 가 `bedrock`·`vertex` 면 청구는
 * 아예 AWS·Google Cloud 쪽이다. 코덱스도 ChatGPT 계정과 OpenAI 플랫폼 키가 갈린다. **엉뚱한
 * 곳으로 보내는 버튼은 없느니만 못하므로** 판정은 순수 함수인 여기 한 곳이 갖고 테스트로 고정한다.
 *
 * 여는 길은 만들지 않는다 — 부르는 쪽이 앱에 하나뿐인 `window.open(url,'_blank')` →
 * main `setWindowOpenHandler` → `shell.openExternal` 을 그대로 쓴다(§3.7 · 앱 안에서 남의
 * 로그인 세션이 걸린 페이지를 열지 않는다).
 */

/**
 * 주소는 **공개 페이지**만 쓴다(문서에 없는 엔드포인트·남의 토큰 ❌ — 법적 안전선).
 * 2026-09-20 에 실제로 눌러 확인했다: `claude.ai/settings/profile` 은 `/settings/account` 로,
 * `console.anthropic.com/*` 는 `platform.claude.com/*` 로 옮겨 갔다(둘 다 301/307).
 */
const CLAUDE_AI = 'https://claude.ai/settings';
const CLAUDE_PLATFORM = 'https://platform.claude.com';
const CHATGPT = 'https://chatgpt.com';
const OPENAI_PLATFORM = 'https://platform.openai.com';

/**
 * 버튼 글자. **전체 키를 적어 둔다** — 조각을 붙여 만든 키는 검색으로 찾히지 않아, 번역을 지운
 * 사람이 그 자리가 죽은 줄 모른다.
 */
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

/**
 * 계정 칸 하나가 띄울 바깥 링크들.
 *
 * `local`(All Model)은 **비어 있다** — 로컬 모델은 계정도 청구도 없다(`providers.localUsage` 가
 * 이미 그렇게 말한다). 없는 자리에 버튼을 놓으면 그 버튼이 거짓말이 된다.
 */
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
