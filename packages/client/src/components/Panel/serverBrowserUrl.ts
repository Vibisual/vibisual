/**
 * §7.11 / §3.5 — 외부 브라우저로 열 주소 = 그 포트의 iframe 위성 주소(같은 셸 우선). 한 포트 두 주인(옆 vite `[::1]`, 우리 `::`)이면 `localhost` 는 남의 서버다.
 * 위성이 없으면 `localhost`(패키지 렌더러는 `file://` 라 `window.location.hostname` 이 비어 있다).
 */
import type { BubbleData } from '@vibisual/shared';

function portOf(url: string): number | null {
  try {
    const u = new URL(url);
    return Number(u.port || (u.protocol === 'https:' ? '443' : '80'));
  } catch {
    return null;
  }
}

export function serverBrowserUrl(
  entry: { port?: number | undefined; shellId?: string | undefined },
  nodes: Iterable<BubbleData | undefined>,
): string | null {
  if (!entry.port) return null;
  let portMatch: string | null = null;
  for (const n of nodes) {
    if (!n || n.bubbleType !== 'iframe' || !n.url || portOf(n.url) !== entry.port) continue;
    if (entry.shellId && n.shellId === entry.shellId) return n.url;
    portMatch ??= n.url;
  }
  return portMatch ?? `http://localhost:${entry.port}`;
}
