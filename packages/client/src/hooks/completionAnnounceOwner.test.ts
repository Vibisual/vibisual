import { describe, it, expect } from 'vitest';

/**
 * §5.5 #17-11 ⑦ 개정 — **완료음·완료 알림을 내는 창은 하나뿐**이라는 규약의 집행.
 *
 * `useWebSocket` 은 다섯 셸(App·지휘통제실·별창·오버레이·비디오 스튜디오)이 저마다 마운트한다.
 * 발화가 그 훅 안에 있으므로, 게이트가 없으면 창을 두 개 띄운 사용자는 **같은 종료를 창 수만큼**
 * 듣는다. `claimCompletionChime` 의 localStorage 클레임은 대부분을 접지만 창마다 렌더러
 * 프로세스가 갈리면 읽기→쓰기 사이에 둘 다 통과한다 — 확률에 기대지 않는다.
 *
 * 앞으로 셸이 늘어도 자동으로 이 규칙 안에 들어온다: 기본값이 침묵이고, 알리는 창은 여기 고정된
 * 한 곳뿐이다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에 Node 타입이 없다
 * (`canvasControlsContract.test.ts` 와 같은 방식).
 */

const sources = {
  ...import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

/** glob 키(이 파일=`src/hooks/` 기준 상대 경로)를 src 기준 경로로 편다. */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `hooks/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function collectSources(): { path: string; text: string }[] {
  return Object.entries(sources)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const CALL = /useWebSocket\s*\(/;
const ANNOUNCES = /useWebSocket\s*\([^)]*announceCompletions\s*:\s*true/s;

describe('완료 알림 발화 창 단일화', () => {
  it('useWebSocket 을 마운트하는 셸은 여럿이다 (게이트가 필요한 이유)', () => {
    const callers = collectSources().filter(
      ({ path, text }) => path !== 'hooks/useWebSocket.ts' && CALL.test(text),
    );
    expect(callers.length).toBeGreaterThan(1);
  });

  it('완료 알림을 켜는 창은 메인 App 하나뿐이다', () => {
    const announcing = collectSources()
      .filter(({ path, text }) => path !== 'hooks/useWebSocket.ts' && ANNOUNCES.test(text))
      .map(({ path }) => path);
    expect(announcing).toEqual(['App.tsx']);
  });

  it('기본값은 침묵이다 — 새 셸이 늘어도 소리가 따라 늘지 않는다', () => {
    const hook = collectSources().find(({ path }) => path === 'hooks/useWebSocket.ts');
    expect(hook).toBeDefined();
    expect(hook!.text).toMatch(/announceCompletions\s*=\s*options\?\.announceCompletions\s*\?\?\s*false/);
  });

  it('완료 판정·발화는 그 게이트 안에서만 일어난다', () => {
    const hook = collectSources().find(({ path }) => path === 'hooks/useWebSocket.ts')!;
    const gateAt = hook.text.indexOf('if (announceCompletions) {');
    expect(gateAt).toBeGreaterThan(-1);
    for (const marker of ['detectCustomAgentCompletions(', 'playCompletionChime(', 'showBrowserNotification(']) {
      const at = hook.text.indexOf(marker, gateAt);
      // 게이트 뒤에 있고, 그 사이에 게이트를 닫는 다른 최상위 발화가 끼지 않는다.
      expect(at, `${marker} 는 게이트 안에 있어야 한다`).toBeGreaterThan(gateAt);
      expect(hook.text.indexOf(marker)).toBe(at);
    }
  });
});
