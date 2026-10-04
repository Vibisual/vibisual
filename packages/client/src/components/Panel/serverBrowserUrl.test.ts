/**
 * §7.11 / §3.5 — 서버 목록에서 외부 브라우저로 여는 주소도 "우리 서버에 닿는 주소"여야 한다.
 *
 * 한 포트에 주인이 둘이면 `localhost` 는 옆 프로젝트 vite(`[::1]`)에 닿는다. 서버가 가려 둔 iframe 위성 주소
 * (`127.0.0.1`)를 쓰지 않으면, 이 프로젝트의 서버 목록에서 눌렀는데 남의 화면이 열린다.
 */
import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { serverBrowserUrl } from './serverBrowserUrl.js';

function iframe(id: string, url: string, extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id, label: 'localhost:8080', bubbleType: 'iframe', path: `__special__iframe__s__${id}`,
    status: 'active', activity: 1, lastActivity: 0, url, ...extra,
  };
}

describe('serverBrowserUrl', () => {
  it('그 포트의 위성이 127.0.0.1 로 옮겨져 있으면 그 주소로 연다', () => {
    expect(serverBrowserUrl({ port: 8080 }, [iframe('special-1', 'http://127.0.0.1:8080/')])).toBe('http://127.0.0.1:8080/');
  });

  it('같은 셸의 위성을 먼저 고른다', () => {
    const nodes = [
      iframe('special-1', 'http://localhost:8080/', { shellId: 'other' }),
      iframe('special-2', 'http://127.0.0.1:8080/', { shellId: 'shell-a' }),
    ];
    expect(serverBrowserUrl({ port: 8080, shellId: 'shell-a' }, nodes)).toBe('http://127.0.0.1:8080/');
  });

  it('다른 포트·iframe 이 아닌 노드·주소 없는 위성은 보지 않는다 — 없으면 종전대로 localhost', () => {
    const nodes = [
      iframe('special-1', 'http://127.0.0.1:5173/'),
      iframe('special-2', 'http://127.0.0.1:8080/', { bubbleType: 'file' }),
      iframe('special-3', ''),
      undefined,
    ];
    expect(serverBrowserUrl({ port: 8080 }, nodes)).toBe('http://localhost:8080');
  });

  it('포트가 없으면 열 주소가 없다', () => {
    expect(serverBrowserUrl({}, [])).toBeNull();
  });
});
