/**
 * §5.11 v4.28 — 활성 목록 해석 고정.
 *
 * `UserDefaults.enabledPlugins` 는 켜짐/꺼짐의 SSOT 다. 그 배열을 집합으로 바꾸는 이 한 함수를
 * 창(켠 개수 표시) · 호스트(무엇을 그릴지) · 서버 관문(409 여부)이 **모두** 통과하므로, 여기가 흔들리면
 * 세 곳이 한꺼번에 어긋난다. 그런데 지금까지 테스트가 하나도 없었다.
 *
 * 특히 **등록부에 없는 id** 를 어떻게 다루는지가 중요하다. 저장된 목록에는 이제 없는 카드의 id 가 남을 수
 * 있고(이름 변경 · 제거 · 새 판에서 켠 뒤 되돌아감), 거르지 않으면 "111개 중 112개 켬" 같은 값이 나온다.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_MANIFESTS, resolveEnabledPlugins, isPluginEnabled } from './registry.js';

const someId = PLUGIN_MANIFESTS[0]?.id ?? '';
const otherId = PLUGIN_MANIFESTS[1]?.id ?? '';

describe('활성 목록 해석', () => {
  it('창을 한 번도 안 열었으면(undefined) 기본 활성만 켠다 — 지금은 전부 비활성이라 빈 집합', () => {
    expect([...resolveEnabledPlugins(undefined)]).toEqual([]);
  });

  it('빈 배열은 "전부 끔"이지 "설정 없음"이 아니다', () => {
    expect(resolveEnabledPlugins([]).size).toBe(0);
  });

  it('등록된 id 는 그대로 켠다', () => {
    const set = resolveEnabledPlugins([someId, otherId]);
    expect(set.has(someId)).toBe(true);
    expect(set.has(otherId)).toBe(true);
  });

  it('등록부에 없는 id 는 걸러낸다 — 안 그러면 켠 개수가 등록 수를 넘는다', () => {
    const set = resolveEnabledPlugins([someId, 'removed-long-ago', 'never-existed']);
    expect([...set]).toEqual([someId]);
    expect(set.size).toBeLessThanOrEqual(PLUGIN_MANIFESTS.length);
  });

  it('같은 id 가 여러 번 들어 있어도 한 번으로 센다', () => {
    expect(resolveEnabledPlugins([someId, someId, someId]).size).toBe(1);
  });

  it('isPluginEnabled 는 같은 판정을 쓴다 — 서버 관문과 화면이 갈리면 안 된다', () => {
    expect(isPluginEnabled(someId, [someId])).toBe(true);
    expect(isPluginEnabled(someId, [])).toBe(false);
    expect(isPluginEnabled('never-existed', ['never-existed'])).toBe(false);
  });

  it('켠 개수는 어떤 입력에도 등록 수를 넘지 않는다', () => {
    const noisy = [...PLUGIN_MANIFESTS.map((m) => m.id), 'ghost-1', 'ghost-2', someId];
    expect(resolveEnabledPlugins(noisy).size).toBe(PLUGIN_MANIFESTS.length);
  });
});
