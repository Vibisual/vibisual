/** §7.11 / §3.5 — 외부 브라우저 주소는 iframe 위성 주소(`127.0.0.1`)다(한 포트 두 주인이면 `localhost` 는 옆 vite `[::1]` 로 간다). */
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
