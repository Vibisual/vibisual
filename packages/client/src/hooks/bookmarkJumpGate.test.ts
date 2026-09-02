import { describe, expect, it } from 'vitest';

import { resolveJumpTarget } from './useBookmarks.js';
import type { Bookmark } from './useBookmarks.js';

/**
 * §5.4 #30 (C) 출처 생존 게이트 — 숫자키 점프가 "지금 갈 수 있는 자리"인지 먼저 본다.
 *
 * 게이트가 없을 때 `session` 점프는 `openIDEOverlay` 로 **열려 있던 도킹 슬롯의 agentId 를 사라진
 * 에이전트로 갈아끼워**, IDE 는 안 그려지는데 도크 폭만 남는 빈 칸을 만들었다(사용자 보고).
 * stub(미hydrate) 프로젝트만 예외 — 노드가 애초에 스냅샷에 없으므로 게이트를 걸면 영영 못 간다.
 */

const session: Bookmark = {
  kind: 'session',
  projectName: 'alpha',
  agentId: 'agent-1',
  sessionId: 'sub-1',
  label: 'Custom Agent 237',
};
const bubble: Bookmark = {
  kind: 'bubble',
  projectName: 'alpha',
  folderId: null,
  nodeId: 'node-1',
  label: 'Bubble',
};

const loaded = { alpha: {} };

describe('resolveJumpTarget', () => {
  it('세션 북마크 — 에이전트가 살아 있으면 이동', () => {
    expect(resolveJumpTarget(session, { projects: loaded, stubProjects: {}, nodeMap: { 'agent-1': {} } }))
      .toEqual({ ok: true, stub: false });
  });

  it('세션 북마크 — 에이전트가 사라졌으면 이동 ❌ (빈 도크의 원인)', () => {
    expect(resolveJumpTarget(session, { projects: loaded, stubProjects: {}, nodeMap: {} }))
      .toEqual({ ok: false, reason: 'missing-target' });
  });

  it('버블 북마크 — 노드가 사라졌으면 이동 ❌', () => {
    expect(resolveJumpTarget(bubble, { projects: loaded, stubProjects: {}, nodeMap: {} }))
      .toEqual({ ok: false, reason: 'missing-target' });
  });

  it('버블 북마크 — 노드가 살아 있으면 이동', () => {
    expect(resolveJumpTarget(bubble, { projects: loaded, stubProjects: {}, nodeMap: { 'node-1': {} } }))
      .toEqual({ ok: true, stub: false });
  });

  it('등록되지 않은 프로젝트면 이동 ❌', () => {
    expect(resolveJumpTarget(session, { projects: {}, stubProjects: {}, nodeMap: { 'agent-1': {} } }))
      .toEqual({ ok: false, reason: 'unknown-project' });
  });

  it('stub 프로젝트는 노드가 없어도 이동(탭 전환까지) — 게이트 예외', () => {
    expect(resolveJumpTarget(session, { projects: {}, stubProjects: { alpha: {} }, nodeMap: {} }))
      .toEqual({ ok: true, stub: true });
    expect(resolveJumpTarget(bubble, { projects: {}, stubProjects: { alpha: {} }, nodeMap: {} }))
      .toEqual({ ok: true, stub: true });
  });
});

/**
 * §9 폴더 스코프 — 서버가 "그리는 폴더 + 한 칸 앞"만 실으면서 생긴 **두 번째 게이트 예외**.
 *
 * 다른 폴더 안의 버블은 사라져서가 아니라 아직 안 와서 `nodeMap` 에 없다. 그 자리를 "없어진
 * 대상" 으로 읽으면 다른 폴더로는 영영 점프하지 못한다 — stub 예외와 같은 이유·같은 처리.
 */
describe('resolveJumpTarget — 폴더 스코프 예외', () => {
  const inFolder: Bookmark = {
    kind: 'bubble',
    projectName: 'alpha',
    folderId: 'folder-a',
    nodeId: 'node-deep',
    label: 'Deep',
  };

  it('범위 밖 폴더의 버블은 아직 안 온 것으로 보고 이동시킨다', () => {
    expect(resolveJumpTarget(inFolder, {
      projects: loaded,
      stubProjects: {},
      nodeMap: {},                       // 그 폴더가 안 실려 노드가 없다
      snapshotFolderScope: ['folder-b'], // 지금 실린 것은 다른 폴더
    })).toEqual({ ok: true, stub: false });
  });

  it('범위 **안**인데 노드가 없으면 진짜 사라진 것이다 — 게이트가 그대로 잡는다', () => {
    expect(resolveJumpTarget(inFolder, {
      projects: loaded,
      stubProjects: {},
      nodeMap: {},
      snapshotFolderScope: ['folder-a'], // 그 폴더는 실려 왔는데 노드가 없다
    })).toEqual({ ok: false, reason: 'missing-target' });
  });

  it('폴더 범위 미적용(전량)이면 예외가 열리지 않는다 — 구버전 서버에서 게이트가 무력해지면 안 된다', () => {
    expect(resolveJumpTarget(inFolder, {
      projects: loaded,
      stubProjects: {},
      nodeMap: {},
      snapshotFolderScope: null,
    })).toEqual({ ok: false, reason: 'missing-target' });
    // 필드 자체가 없는 호출부(구버전 코드 경로)도 같다.
    expect(resolveJumpTarget(inFolder, { projects: loaded, stubProjects: {}, nodeMap: {} }))
      .toEqual({ ok: false, reason: 'missing-target' });
  });

  it('메인 캔버스 버블(folderId=null)에는 예외가 없다 — 최상위는 범위와 무관하게 항상 온다', () => {
    expect(resolveJumpTarget(bubble, {
      projects: loaded,
      stubProjects: {},
      nodeMap: {},
      snapshotFolderScope: [],
    })).toEqual({ ok: false, reason: 'missing-target' });
  });

  it('세션 북마크에는 예외가 없다 — 에이전트는 폴더 범위와 무관하게 항상 실린다', () => {
    expect(resolveJumpTarget(session, {
      projects: loaded,
      stubProjects: {},
      nodeMap: {},
      snapshotFolderScope: [],
    })).toEqual({ ok: false, reason: 'missing-target' });
  });
});
