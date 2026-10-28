/**
 * §9 세션 축 — IDE 를 열 때 안 그리는 세션 스트림을 받아 오지 않는지 소스 계약으로 고정한다(effect 라 DOM 없이 못 돌린다).
 * 실측: 세션 44개 버블 7.43MB · 11,892건 — tail 읽기+파싱 56ms·`JSON.stringify` 22ms 가 Electron 메인에서 돌아 창이 멈춘다. 세션 탭에선 99% 가 버려진다.
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
