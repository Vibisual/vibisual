/**
 * §5.11 v4.28 — 활성 목록 해석 고정.
 *
 * (v4.54 부터 SSOT 는 프로젝트별 `UserDefaults.enabledPluginsByProject` 이고, 아래 "프로젝트별 활성" 이
 * 그 층을 따로 고정한다. 이 앞부분은 그 아래에 깔린 **배열 → 집합** 해석 자체를 본다.)
 *
 * 저장된 배열은 켜짐/꺼짐의 SSOT 다. 그 배열을 집합으로 바꾸는 이 한 함수를
 * 창(켠 개수 표시) · 호스트(무엇을 그릴지) · 서버 관문(409 여부)이 **모두** 통과하므로, 여기가 흔들리면
 * 세 곳이 한꺼번에 어긋난다. 그런데 지금까지 테스트가 하나도 없었다.
 *
 * 특히 **등록부에 없는 id** 를 어떻게 다루는지가 중요하다. 저장된 목록에는 이제 없는 카드의 id 가 남을 수
 * 있고(이름 변경 · 제거 · 새 판에서 켠 뒤 되돌아감), 거르지 않으면 "111개 중 112개 켬" 같은 값이 나온다.
 */
import { describe, it, expect } from 'vitest';
import {
  PLUGIN_MANIFESTS,
  resolveEnabledPlugins,
  isPluginEnabled,
  resolveEnabledPluginsFor,
  isPluginEnabledFor,
  selectProjectEnabledList,
  withProjectEnabled,
  resolveProjectKey,
} from './registry.js';

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

/**
 * §5.11 v4.54 — 켬/끔은 **프로젝트별**이다.
 *
 * 여기서 고정하는 것은 세 가지다. ① 프로젝트가 서로 안 샌다 ② 아직 손대지 않은 프로젝트는 구 전역
 * 목록을 시드로 받는다(판올림에 켠 것이 사라지지 않게) ③ 한 프로젝트를 저장해도 다른 프로젝트 칸이
 * 살아 있다. ③ 은 §4 `agent-config` PUT 강등 사고와 같은 계열이라 함수 단계에서 막아 둔다.
 */
describe('프로젝트별 활성', () => {
  const A = '/w/alpha';
  const B = '/w/beta';

  it('프로젝트마다 따로 켠다 — A 에서 켠 것이 B 에 나타나지 않는다', () => {
    const source = { enabledPluginsByProject: { [A]: [someId], [B]: [] } };
    expect(isPluginEnabledFor(someId, source, A)).toBe(true);
    expect(isPluginEnabledFor(someId, source, B)).toBe(false);
  });

  it('아직 손대지 않은 프로젝트는 구 전역 목록을 시드로 받는다', () => {
    const source = { enabledPlugins: [someId], enabledPluginsByProject: { [B]: [] } };
    expect(isPluginEnabledFor(someId, source, A)).toBe(true);   // A 는 칸이 없다 → 시드
    expect(isPluginEnabledFor(someId, source, B)).toBe(false);  // B 는 칸이 있다 → 시드 무시
  });

  it('빈 배열 칸은 "이 프로젝트에서 전부 끔" — 시드로 되살아나지 않는다', () => {
    const source = { enabledPlugins: [someId, otherId], enabledPluginsByProject: { [A]: [] } };
    expect(resolveEnabledPluginsFor(source, A).size).toBe(0);
  });

  it('프로젝트를 모르면 시드만 본다 — 어디에도 안 매인 켬/끔을 새로 만들지 않는다', () => {
    const source = { enabledPlugins: [someId], enabledPluginsByProject: { [A]: [] } };
    expect(selectProjectEnabledList(source, null)).toEqual([someId]);
  });

  it('저장은 그 프로젝트 칸만 바꾼다 — 다른 프로젝트가 날아가지 않는다', () => {
    const source = { enabledPluginsByProject: { [A]: [someId], [B]: [otherId] } };
    const next = withProjectEnabled(source, A, []);
    expect(next[A]).toEqual([]);
    expect(next[B]).toEqual([otherId]);
  });

  it('설정이 통째로 없어도 첫 저장이 된다', () => {
    expect(withProjectEnabled(undefined, A, [someId])).toEqual({ [A]: [someId] });
  });

  it('대소문자·역슬래시만 다른 경로는 같은 칸이다 — Windows 에서 한 프로젝트가 둘로 갈리면 안 된다', () => {
    const source = { enabledPluginsByProject: { 'D:/Work/Alpha': [someId] } };
    expect(isPluginEnabledFor(someId, source, 'd:\\work\\alpha')).toBe(true);
    // 저장도 기존 칸을 갱신한다 — 새 칸을 만들면 읽는 쪽과 쓰는 쪽이 갈린다.
    expect(resolveProjectKey(source, 'd:\\work\\alpha')).toBe('D:/Work/Alpha');
    expect(Object.keys(withProjectEnabled(source, 'd:\\work\\alpha', []))).toEqual(['D:/Work/Alpha']);
  });

  it('등록부에 없는 id 는 프로젝트별 경로에서도 걸러낸다', () => {
    const source = { enabledPluginsByProject: { [A]: [someId, 'never-existed'] } };
    expect([...resolveEnabledPluginsFor(source, A)]).toEqual([someId]);
  });
});
