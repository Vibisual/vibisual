import { describe, it, expect } from 'vitest';
import { reorderOpenProjects, projectOrderFollows } from '@vibisual/shared';

/**
 * §5.4 #14-2 (C-1) — 프로젝트 탭 순서(`shared/src/projectTabOrder.ts`) 회귀 고정. 순서 정본은 `AppState.openProjects` 배열이고,
 * 서버는 클라가 보낸 순서를 목록 치환 없이 얹는다. ① 순서만 바뀐다(열려 있지 않은 경로가 끼면 닫은 탭이 되살아난다)
 * ② 보내지 않은 항목(별창 탭·새로 열린 프로젝트)은 제자리 ③ 경로 접기는 OS 가 정한다(linux 에서 접으면 케이스만 다른 두 프로젝트가 한 칸을 다툰다).
 * shared 에 러너가 없어 server 에 둔다.
 */

const A = 'C:/work/alpha';
const B = 'C:/work/beta';
const C = 'C:/work/gamma';
const D = 'C:/work/delta';

describe('reorderOpenProjects — 순서만 바꾼다', () => {
  it('놓은 순서대로 선다', () => {
    expect(reorderOpenProjects([A, B, C], [C, A, B], 'win32')).toEqual([C, A, B]);
  });

  it('보내지 않은 항목은 제자리, 보낸 것은 자기들이 앉아 있던 자리 안에서만 바뀐다', () => {
    // B 는 별창으로 빠져 줄에 없었다(또는 그 사이 새로 열렸다) — 그 자리를 지킨다.
    expect(reorderOpenProjects([A, B, C, D], [D, C, A], 'win32')).toEqual([D, B, C, A]);
  });

  it('열려 있지 않은 경로는 버린다 — 목록이 늘지 않는다', () => {
    const out = reorderOpenProjects([A, B], [B, 'C:/work/closed', A], 'win32');
    expect(out).toEqual([B, A]);
    expect(out).toHaveLength(2);
  });

  it('값은 서버 목록의 원문(원본 케이스)을 쓴다 — 클라가 보낸 케이스로 바꿔 적지 않는다', () => {
    expect(reorderOpenProjects(['C:/Work/Alpha', 'C:/Work/Beta'], ['c:/work/beta', 'c:/work/alpha'], 'win32'))
      .toEqual(['C:/Work/Beta', 'C:/Work/Alpha']);
  });

  it('같은 프로젝트가 두 번 오면 앞의 것이 이긴다', () => {
    expect(reorderOpenProjects([A, B, C], [C, A, C, B], 'win32')).toEqual([C, A, B]);
  });

  it('하나 이하만 맞으면 바꿀 앞뒤가 없다', () => {
    expect(reorderOpenProjects([A, B, C], [C], 'win32')).toEqual([A, B, C]);
    expect(reorderOpenProjects([A, B, C], [], 'win32')).toEqual([A, B, C]);
  });

  it('입력을 고치지 않는다', () => {
    const open = [A, B, C];
    reorderOpenProjects(open, [C, B, A], 'win32');
    expect(open).toEqual([A, B, C]);
  });

  it('역슬래시·끝 슬래시가 섞여 와도 같은 프로젝트로 맞춘다', () => {
    expect(reorderOpenProjects([A, B], ['C:\\work\\beta\\', 'C:\\work\\alpha'], 'win32')).toEqual([B, A]);
  });
});

describe('reorderOpenProjects — 경로 케이스는 OS 가 정한다', () => {
  it('win32·darwin 은 케이스를 접어 맞춘다', () => {
    const open = ['/Users/me/App', '/Users/me/Web']; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const order = ['/users/me/web', '/users/me/app'];
    expect(reorderOpenProjects(open, order, 'win32')).toEqual(['/Users/me/Web', '/Users/me/App']); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(reorderOpenProjects(open, order, 'darwin')).toEqual(['/Users/me/Web', '/Users/me/App']); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('linux 는 접지 않는다 — 케이스만 다른 두 프로젝트를 한 칸으로 뭉개지 않는다', () => {
    const open = ['/home/me/Feature-X', '/home/me/feature-x', '/home/me/web']; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(reorderOpenProjects(open, ['/home/me/web', '/home/me/feature-x', '/home/me/Feature-X'], 'linux')) // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      .toEqual(['/home/me/web', '/home/me/feature-x', '/home/me/Feature-X']); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    // 케이스가 다른 경로는 linux 에서 다른 프로젝트다 — 맞지 않으니 언급하지 않은 것과 같다.
    expect(reorderOpenProjects(['/home/me/App', '/home/me/Web'], ['/home/me/web', '/home/me/app'], 'linux')) // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      .toEqual(['/home/me/App', '/home/me/Web']); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });
});

describe('projectOrderFollows — 이미 그 앞뒤인가', () => {
  it('얹어도 바뀌지 않으면 참', () => {
    expect(projectOrderFollows([A, B, C], [A, C], 'win32')).toBe(true);
    expect(projectOrderFollows([A, B, C], [A, B, C], 'win32')).toBe(true);
  });

  it('앞뒤가 다르면 거짓', () => {
    expect(projectOrderFollows([A, B, C], [C, A], 'win32')).toBe(false);
  });

  it('서버 목록에 없는 경로는 따질 대상이 아니다', () => {
    expect(projectOrderFollows([A, B], [A, 'C:/work/closed', B], 'win32')).toBe(true);
  });
});
