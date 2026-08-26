/**
 * §5.10 v2 (H) — **두뇌 활성화 판정 키.**
 *
 * 서버는 활성화를 프로젝트 **루트 절대경로**로 적고(`UserDefaults.brainByProject`),
 * 클라의 `activeProject` 는 **표시명**이다. 이 둘을 섞으면 서버가 적어 둔
 * `enabled`·`promptedAt` 을 화면이 영영 못 찾는다 — 실제로 "지금은 그만"으로 거절한
 * 첫 실행 안내 배너가 열 때마다 다시 떴고, 켜도 두뇌 버블이 안 떴다.
 *
 * 그래서 판정 키를 만드는 자리는 `selectActiveBrainProjectPath` 한 곳이고, 그 결과가
 * 실제로 `shouldPromptBrainActivation` 을 잠재우는지까지 여기서 못 박는다.
 */
import { describe, expect, it } from 'vitest';
import { shouldPromptBrainActivation } from '@vibisual/shared';

import { selectActiveBrainProjectPath } from './graphStore.js';

const NAME = 'vibisual';
const PATH = 'C:/work/projects/vibisual';

type SelectorState = Parameters<typeof selectActiveBrainProjectPath>[0];

function state(over: Partial<SelectorState> = {}): SelectorState {
  return {
    activeProject: NAME,
    projects: { [NAME]: { path: PATH } } as unknown as SelectorState['projects'],
    stubProjects: {},
    ...over,
  };
}

describe('§5.10 v2 (H) — 두뇌 활성화 판정 키', () => {
  it('표시명이 아니라 프로젝트 루트 절대경로를 돌려준다', () => {
    expect(selectActiveBrainProjectPath(state())).toBe(PATH);
  });

  it('아직 하이드레이트 전인 stub 프로젝트도 경로를 준다', () => {
    expect(
      selectActiveBrainProjectPath(
        state({
          projects: {},
          stubProjects: { [NAME]: { project: { path: PATH } } } as unknown as SelectorState['stubProjects'],
        }),
      ),
    ).toBe(PATH);
  });

  it('열린 프로젝트가 없으면 null 이다', () => {
    expect(selectActiveBrainProjectPath(state({ activeProject: null }))).toBeNull();
  });

  it('이 키로 조회해야 거절 기록이 읽힌다 — 표시명으로는 배너가 다시 뜬다', () => {
    const byProject = { [PATH]: { enabled: false, promptedAt: 1_787_705_137_974 } };
    const key = selectActiveBrainProjectPath(state());

    expect(shouldPromptBrainActivation(byProject, key, 276)).toBe(false);
    // 회귀 지점: 표시명으로 조회하면 같은 기록을 못 찾아 매번 다시 묻는다.
    expect(shouldPromptBrainActivation(byProject, NAME, 276)).toBe(true);
  });

  it('경로를 아직 못 구했으면 묻지 않는다 — 배너가 번쩍이지 않게', () => {
    const byProject = { [PATH]: { enabled: false, promptedAt: 1 } };
    const key = selectActiveBrainProjectPath(state({ projects: {}, stubProjects: {} }));

    expect(key).toBeNull();
    expect(shouldPromptBrainActivation(byProject, key, 276)).toBe(false);
  });
});
