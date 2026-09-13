/**
 * §9 **세션 축** — IDE 를 열 때 안 그리는 세션을 전선에 올리지 않는다.
 *
 * 사용자 보고(2026-09-10): "이 IDE 창이 열릴 때 뭔가 무겁지? 바로 보이는 게 아니라 뭔가 끊기고
 * 눌러도 반응 없고 말야. … 이거 아주 심각한 버그로 인식한다고."
 *
 * 원인은 IDE 를 열 때 그 에이전트의 **모든 세션 스트림**을 무조건 받아 온 것이다. 화면이 실제로
 * 읽는 것은 ① 세션 탭이면 그 세션 하나(깊은 복원이 따로 상한 전체로 받는다) ② 메인 탭이면 전
 * 세션 합본 — 즉 ①에서는 받아 온 것의 99% 가 한 글자도 안 그려지고 버려졌다.
 *
 * 실측(살아 있는 `.vibisual/save/sub-streams`): 세션 44개짜리 버블 하나가 **7.43MB · 11,892 이벤트**
 * (세션 66개짜리는 11.01MB · 16,127건). 값을 치르는 넷 중 둘이 **Electron 메인 프로세스**라
 * 그대로 창의 멈춤이 된다 — 디스크 tail 읽기+파싱 56ms · `JSON.stringify` 22ms · 렌더러
 * `JSON.parse` 15ms · 44개 세션 버퍼 교체 뒤 스토어 통지(막 마운트된 IDE 트리 전체 재렌더).
 *
 * 이 배선은 `AgentIDEOverlay` 안의 effect 라 DOM 없이 실행해 볼 수 없다(클라 테스트에는 jsdom 이
 * 없다 — `vitest.config.ts`). 그래서 되돌아가면 결함이 그대로 되살아나는 **소스 계약**을 고정한다.
 */

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

describe('§9 세션 축 — 전 세션 벌크는 메인 탭에서만', () => {
  const overlay = (): string => source('AgentIDEOverlay.tsx');

  it('메인 탭 판정은 세 조건을 모두 본다 — 버블을 알고 · 훅 버블이고 · 세션 탭이 아니다', () => {
    // `agent` 를 함께 보는 이유: 스냅샷이 아직 안 닿은 찰나에는 `isCustom` 이 기본값 `false` 라
    //   커스텀 버블이 훅 버블로 읽힌다(그러면 열 때마다 벌크가 도로 나간다).
    expect(overlay()).toMatch(
      /const mainTabDrawn\s*=\s*!!agent\s*&&\s*!isCustom\s*&&\s*activeSessionId === null;/,
    );
  });

  it('전 세션 벌크 조회는 그 판정으로 막힌 effect 안에서만 자동으로 나간다', () => {
    const src = overlay();
    const at = src.indexOf('const mainTabDrawn');
    expect(at, '메인 탭 판정을 못 찾음').toBeGreaterThan(-1);
    const block = src.slice(at, at + 400);
    expect(block).toMatch(/if\s*\(\s*!mainTabDrawn\s*\)\s*return;/);
    expect(block).toMatch(/fetchAllStreams\(\);/);
  });

  it('열릴 때 무조건 도는 옛 자동 로드가 남아 있지 않다', () => {
    // 종전 코드: `useEffect(() => { refreshStreams(); }, [refreshStreams]);`
    //   — 세션 탭이든 메인 탭이든 가리지 않고 전 세션을 받아 왔다.
    expect(overlay()).not.toMatch(/useEffect\(\(\)\s*=>\s*\{\s*refreshStreams\(\);\s*\}/);
  });

  it('버블 상태 최신화는 스트림 조회와 분리돼 열릴 때마다 돈다', () => {
    // hydrate 는 이미 hydrated 면 서버가 `already-hydrated` 로 끊어 사실상 무비용이다 —
    // 벌크와 한 몸이면 벌크를 막는 순간 이것까지 함께 멈춘다.
    const src = overlay();
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*hydrateOwnerProject\(\);\s*\}/);
    expect(src).toMatch(/const hydrateOwnerProject = useCallback\(/);
  });

  it('되살리기 손잡이(⟳)는 여전히 전부 다시 받는다', () => {
    const src = overlay();
    const at = src.indexOf('const refreshStreams = useCallback(');
    expect(at, '새로고침 손잡이를 못 찾음').toBeGreaterThan(-1);
    const block = src.slice(at, at + 220);
    expect(block).toMatch(/hydrateOwnerProject\(\);/);
    expect(block).toMatch(/fetchAllStreams\(\);/);
  });
});

describe('§9 구독은 맵이 아니라 자기 키까지 — 추종 훅', () => {
  const follow = (): string => source('useEditorFollow.ts');

  it('`subAgentStreams` 맵 통째를 구독하지 않는다', () => {
    // 종전 코드: `const streams = useGraphStore((s) => s.subAgentStreams);`
    //   그 맵은 스트림 한 줄마다 새 참조라, 어느 버블이 말하든 열려 있는 IDE 창 전부의
    //   추종 효과가 50ms 마다 다시 돌며 각자 400건을 재주사했다.
    expect(follow()).not.toMatch(/useGraphStore\(\(s\)\s*=>\s*s\.subAgentStreams\)/);
  });

  it('보는 세션만 원시값 하나로 구독한다 — 그 세션에 줄이 안 흐르면 깨어나지 않는다', () => {
    const src = follow();
    expect(src).toMatch(/const streamsVersion = useGraphStore\(/);
    // 합계 길이 + 가장 늦은 시각 — 새 줄이 들어오면 둘 다 움직인다(하나만으로는 교체 적재를 놓친다).
    expect(src).toMatch(/return `\$\{total\}:\$\{newest\}`;/);
    expect(src).toMatch(/streamsVersion, watchedIds,/);
  });

  it('버퍼 본문은 깨어난 시점의 최신값을 읽는다', () => {
    expect(follow()).toMatch(/useGraphStore\.getState\(\)\.subAgentStreams;/);
  });
});
