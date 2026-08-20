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
