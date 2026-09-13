/**
 * §5.25 (D)(E)(G) — 코덱스 판정 순수 함수 고정 시험(로그인 상태 · 버전 · 홈 · 모델 캐시).
 *
 * 이 네 판정은 **화면이 어떤 관문을 띄울지**를 결정한다. 특히 로그인 판정은 한 방향으로만
 * 틀려야 한다 — "모름"을 "로그아웃"으로 적으면 멀쩡히 일하던 사용자 앞에 로그인 창이 뜬다.
 */
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCodexLoginStatus } from './codexAuthService.js';
import { parseCodexVersion, codexHomeIn } from './codexCli.js';
import { parseCodexModelsCache } from './codexModelService.js';

const NOW = 1_757_000_000_000;

describe('parseCodexLoginStatus — 로그인 상태', () => {
  it('로그인 문구는 true 로 읽고 방식을 좁힌다', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT', 0, NOW)).toEqual({
      loggedIn: true,
      authMethod: 'chatgpt',
      checkedAt: NOW,
    });
    expect(parseCodexLoginStatus('Logged in using an API key', 0, NOW)).toEqual({
      loggedIn: true,
      authMethod: 'apiKey',
      checkedAt: NOW,
    });
  });

  it('계정이 함께 오면 표시용으로 싣는다(없어도 정상)', () => {
    const s = parseCodexLoginStatus('Logged in using ChatGPT (someone@example.com)', 0, NOW);
    expect(s?.loggedIn).toBe(true);
    expect(s?.account).toBe('someone@example.com');
  });

  it('방식을 말해 주지 않아도 로그인은 로그인이다', () => {
    const s = parseCodexLoginStatus('Logged in.', 0, NOW);
    expect(s?.loggedIn).toBe(true);
    expect(s?.authMethod).toBeUndefined();
  });

  it('로그아웃 문구는 false 로 읽는다', () => {
    for (const raw of [
      'Not logged in',
      'No credentials found',
      'Please run `codex login` first',
      'run `codex login` to authenticate',
    ]) {
      expect(parseCodexLoginStatus(raw, 1, NOW)).toEqual({ loggedIn: false, checkedAt: NOW });
    }
  });

  it('못 알아본 출력은 null(모름)이다 — 로그아웃으로 단정하지 않는다', () => {
    // 이 한 줄이 이 파일의 요점이다: CLI 가 문구를 바꾼 날, 로그인 창이 멀쩡한 사용자를 막으면 안 된다.
    expect(parseCodexLoginStatus('', 0, NOW)).toBeNull();
    expect(parseCodexLoginStatus('   ', 0, NOW)).toBeNull();
    expect(parseCodexLoginStatus('Auth state: OK', 0, NOW)).toBeNull();
    expect(parseCodexLoginStatus('error: connection refused', 1, NOW)).toBeNull();
  });

  it('대소문자를 가리지 않는다', () => {
    expect(parseCodexLoginStatus('LOGGED IN USING CHATGPT', 0, NOW)?.loggedIn).toBe(true);
    expect(parseCodexLoginStatus('NOT LOGGED IN', 1, NOW)?.loggedIn).toBe(false);
  });
});

describe('parseCodexVersion — 형식을 못박지 않는다', () => {
  it('실측 출력에서 버전을 뗀다', () => {
    expect(parseCodexVersion('codex-cli 0.152.1')).toBe('0.152.1');
  });

  it('배너가 붙거나 이름이 바뀌어도 살아남는다', () => {
    expect(parseCodexVersion('OpenAI Codex\nversion 1.0.0\n')).toBe('1.0.0');
    expect(parseCodexVersion('codex 2.3.4-beta.1')).toBe('2.3.4-beta.1');
  });

  it('숫자 셋이 없으면 undefined — 지어내지 않는다', () => {
    expect(parseCodexVersion('')).toBeUndefined();
    expect(parseCodexVersion('command not found: codex')).toBeUndefined();
    expect(parseCodexVersion('v1.2')).toBeUndefined();
  });
});

describe('codexHomeIn — 세 OS 가 같고, 오버라이드를 존중한다', () => {
  it('기본은 홈 아래 .codex — OS별 설정 폴더를 쓰지 않는다', () => {
    // 코덱스는 %APPDATA%/Application Support/.config 를 쓰지 않는다. 여기에 플랫폼 분기를
    //   넣으면 그 순간 세 OS 중 둘이 틀린다.
    expect(codexHomeIn({}, '/home/u')).toBe(path.join('/home/u', '.codex'));
    expect(codexHomeIn({}, 'C:\\Users\\u')).toBe(path.join('C:\\Users\\u', '.codex')); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('CODEX_HOME 이 있으면 그것을 쓴다', () => {
    expect(codexHomeIn({ CODEX_HOME: '/custom/codex' }, '/home/u')).toBe('/custom/codex');
  });

  it('빈 CODEX_HOME 은 없는 것으로 본다', () => {
    expect(codexHomeIn({ CODEX_HOME: '   ' }, '/home/u')).toBe(path.join('/home/u', '.codex'));
  });
});

describe('parseCodexModelsCache — 모델 표를 우리가 들지 않는다', () => {
  it('slug·표시이름·추론 단계를 읽는다', () => {
    const raw = JSON.stringify({
      models: [
        {
          slug: 'gpt-5.1-codex',
          display_name: 'GPT-5.1 Codex',
          description: '코딩용',
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }],
          default_reasoning_level: 'medium',
        },
      ],
    });
    expect(parseCodexModelsCache(raw)).toEqual([
      {
        slug: 'gpt-5.1-codex',
        displayName: 'GPT-5.1 Codex',
        description: '코딩용',
        reasoningLevels: ['low', 'medium', 'high'],
        defaultReasoningLevel: 'medium',
      },
    ]);
  });

  it('추론 단계가 문자열 배열로 와도 받는다', () => {
    const raw = JSON.stringify({ models: [{ slug: 'm', supported_reasoning_levels: ['low', 'high'] }] });
    expect(parseCodexModelsCache(raw)[0]?.reasoningLevels).toEqual(['low', 'high']);
  });

  it('표시이름이 없으면 slug 를 쓴다', () => {
    expect(parseCodexModelsCache(JSON.stringify({ models: [{ slug: 'bare' }] }))[0]).toEqual({
      slug: 'bare',
      displayName: 'bare',
      reasoningLevels: [],
    });
  });

  it('slug 가 없는 항목은 버린다 — 고를 수 없는 모델을 목록에 두지 않는다', () => {
    const raw = JSON.stringify({ models: [{ display_name: '이름만' }, { slug: 'ok' }, 'nope', null] });
    expect(parseCodexModelsCache(raw).map((m) => m.slug)).toEqual(['ok']);
  });

  it('읽을 수 없으면 빈 배열 — 없는 모델을 채워 넣지 않는다', () => {
    expect(parseCodexModelsCache('')).toEqual([]);
    expect(parseCodexModelsCache('{ broken')).toEqual([]);
    expect(parseCodexModelsCache('{}')).toEqual([]);
    expect(parseCodexModelsCache(JSON.stringify({ models: 'nope' }))).toEqual([]);
  });
});
