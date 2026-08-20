import { describe, expect, it } from 'vitest';

import { pruneClosingProjects, CLOSING_TAB_GRACE_MS } from './graphStore.js';

/**
 * §5.4 #14 v1.34 — 프로젝트 탭 × 는 **누른 그 자리에서** 닫힌다.
 *
 * 탭바는 `closingProjectPaths` 에 든 탭을 그리지 않는다. 그래서 이 표시를 언제 걷느냐가 곧
 * "탭이 언제 돌아오느냐" 다 — 너무 일찍 걷으면 서버 truth 가 오기 전에 닫은 탭이 도로 보이고,
 * 안 걷으면 실재하는 탭이 영영 안 보이는 상태로 갇힌다. 그 두 사고를 여기서 못 박는다.
 */

const P = 'C:/work/alpha';
const Q = 'C:/work/beta';

describe('pruneClosingProjects — 닫는 중 표시 정리', () => {
  it('서버 목록에서 사라졌으면 표시를 걷는다(닫기 성공 — 이후엔 서버 truth 가 곧 화면)', () => {
    const now = Date.now();
    const next = pruneClosingProjects({ 'c:/work/alpha': now }, [Q], now);
    expect(next).toEqual({});
  });

  it('아직 실려 오는 동안에는 표시를 유지한다(왕복 중 깜빡임 방지)', () => {
    const now = Date.now();
    const closing = { 'c:/work/alpha': now };
    const next = pruneClosingProjects(closing, [P, Q], now + 100);
    expect(next).toEqual(closing);
    // 바뀐 게 없으면 **원래 참조** 그대로 — 스냅샷마다 새 객체를 만들면 구독이 헛돈다.
    expect(next).toBe(closing);
  });

  it('유예가 지나도 계속 실려 오면 표시를 걷어 탭을 되돌린다(닫기가 안 먹은 경우)', () => {
    const now = Date.now();
    const next = pruneClosingProjects({ 'c:/work/alpha': now }, [P], now + CLOSING_TAB_GRACE_MS + 1);
    expect(next).toEqual({});
  });

  it('경로 표기가 달라도(역슬래시·대문자·끝 슬래시) 같은 프로젝트로 본다', () => {
    const now = Date.now();
    const closing = { 'c:/work/alpha': now };
    expect(pruneClosingProjects(closing, ['C:\\work\\Alpha\\'], now + 100)).toBe(closing);
  });

  it('표시가 없으면 아무것도 하지 않는다', () => {
    const empty = {};
    expect(pruneClosingProjects(empty, [P])).toBe(empty);
  });
});
