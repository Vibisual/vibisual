import { describe, it, expect } from 'vitest';
import type { ClaudeAuthStatus, CodexAuthStatus } from '@vibisual/shared';
import { accountPortalLinks, type AccountPortalLink } from './accountPortals.js';
import en from '../../i18n/locales/en.json';

/**
 * §5.25 (E) — **계정 칸의 바깥 링크가 제 집으로 가는가.**
 *
 * 이 축이 조용히 죽는 모양은 하나다: 버튼은 멀쩡히 떠 있고 눌리는데, 도착한 화면에 그 사람의
 * 청구가 없다(구독 사용자를 개발자 콘솔로, API 키 사용자를 claude.ai 로, Bedrock 사용자를
 * Anthropic 으로 보내는 식). 화면·타입·빌드는 전부 통과하므로 여기서 잡는다.
 */

const claude = (over: Partial<ClaudeAuthStatus> = {}): ClaudeAuthStatus =>
  ({ loggedIn: true, checkedAt: 0, ...over });
const codex = (over: Partial<CodexAuthStatus> = {}): CodexAuthStatus =>
  ({ loggedIn: true, checkedAt: 0, ...over });

const hosts = (links: AccountPortalLink[]): string[] => links.map((l) => new URL(l.url).host);
const ids = (links: AccountPortalLink[]): string[] => links.map((l) => l.id);

/** i18n 전체 키가 en 사전에 실제로 있는가 — 없으면 버튼에 키 문자열이 그대로 뜬다. */
function hasKey(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' && node.trim() !== '';
}

const ALL_CASES: AccountPortalLink[][] = [
  accountPortalLinks('claude', undefined),
  accountPortalLinks('claude', claude({ authMethod: 'claude.ai' })),
  accountPortalLinks('claude', claude({ authMethod: 'console' })),
  accountPortalLinks('claude', claude({ authMethod: 'apiKey' })),
  accountPortalLinks('claude', claude({ authMethod: 'apiKey', apiProvider: 'bedrock' })),
  accountPortalLinks('claude', claude({ authMethod: 'apiKey', apiProvider: 'vertex' })),
  accountPortalLinks('codex', undefined),
  accountPortalLinks('codex', codex({ authMethod: 'chatgpt' })),
  accountPortalLinks('codex', codex({ authMethod: 'apiKey' })),
];

describe('클로드 계정 칸의 바깥 링크', () => {
  it('구독(claude.ai)이면 claude.ai 설정으로만 보낸다', () => {
    const links = accountPortalLinks('claude', claude({ authMethod: 'claude.ai' }));
    expect(new Set(hosts(links))).toEqual(new Set(['claude.ai']));
    expect(ids(links)).toEqual(['account', 'billing', 'usage']);
  });

  it('API 과금(console·apiKey)이면 개발자 플랫폼으로 보낸다 — 구독 화면에는 그 사람의 청구가 없다', () => {
    for (const method of ['console', 'apiKey', 'APIKEY']) {
      const links = accountPortalLinks('claude', claude({ authMethod: method }));
      expect(new Set(hosts(links)), method).toEqual(new Set(['platform.claude.com']));
      expect(ids(links), method).toEqual(['billing', 'usage', 'apiKeys']);
    }
  });

  it('Bedrock·Vertex 는 그 클라우드 콘솔로 보낸다 — 청구서가 거기서 나온다', () => {
    expect(hosts(accountPortalLinks('claude', claude({ apiProvider: 'bedrock' }))))
      .toEqual(['console.aws.amazon.com', 'console.aws.amazon.com']);
    expect(hosts(accountPortalLinks('claude', claude({ apiProvider: 'vertex' }))))
      .toEqual(['console.cloud.google.com', 'console.cloud.google.com']);
  });

  it('방식을 모르면(로그아웃·판정 실패) 구독 쪽 + 개발자 콘솔 한 칸', () => {
    const links = accountPortalLinks('claude', undefined);
    expect(ids(links)).toEqual(['account', 'billing', 'usage', 'console']);
    expect(hosts(links).at(-1)).toBe('platform.claude.com');

    // 판정 실패(error)도 "로그아웃"이 아니라 "모름"이다 — 같은 묶음이 나와야 한다.
    expect(ids(accountPortalLinks('claude', claude({ loggedIn: false, error: 'cli-missing' }))))
      .toEqual(ids(links));
  });
});

describe('코덱스 계정 칸의 바깥 링크', () => {
  it('ChatGPT 계정이면 chatgpt.com 으로 보낸다', () => {
    const links = accountPortalLinks('codex', codex({ authMethod: 'chatgpt' }));
    expect(new Set(hosts(links))).toEqual(new Set(['chatgpt.com']));
    expect(ids(links)).toEqual(['account', 'billing', 'codexWeb']);
  });

  it('API 키면 OpenAI 플랫폼으로 보낸다', () => {
    const links = accountPortalLinks('codex', codex({ authMethod: 'apiKey' }));
    expect(new Set(hosts(links))).toEqual(new Set(['platform.openai.com']));
    expect(ids(links)).toEqual(['billing', 'usage', 'apiKeys']);
  });

  it('방식을 모르면 ChatGPT 쪽 + 개발자 플랫폼 한 칸', () => {
    expect(ids(accountPortalLinks('codex', undefined)))
      .toEqual(['account', 'billing', 'codexWeb', 'console']);
  });
});

describe('All Model 칸', () => {
  it('링크가 없다 — 계정도 청구도 없는 엔진이라 버튼이 서면 그 버튼이 거짓말이 된다', () => {
    expect(accountPortalLinks('local', undefined)).toEqual([]);
  });
});

describe('모든 묶음이 지키는 것', () => {
  it('주소는 전부 https 이고 한 칸 안에서 id 가 겹치지 않는다', () => {
    for (const links of ALL_CASES) {
      for (const l of links) expect(new URL(l.url).protocol, l.url).toBe('https:');
      expect(new Set(ids(links)).size, ids(links).join(',')).toBe(links.length);
    }
  });

  it('버튼 글자가 전부 사전에 있다 — 없으면 화면에 i18n 키가 그대로 뜬다', () => {
    const missing = [...new Set(ALL_CASES.flat().map((l) => l.labelKey))].filter((k) => !hasKey(k));
    expect(missing).toEqual([]);
  });
});
