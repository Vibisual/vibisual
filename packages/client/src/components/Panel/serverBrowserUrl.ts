/**
 * §7.11 / §3.5 — 서버 목록 항목을 외부 브라우저로 열 주소.
 *
 * 종전에는 늘 `http://localhost:<포트>` 였다. 한 포트에 주인이 둘이면(옆 프로젝트 vite 가 `[::1]`, 우리
 * 서버가 `::`) `localhost` 는 옆 프로젝트 서버에 닿는다 — 이 프로젝트의 서버 목록에서 눌렀는데 남의
 * 화면이 열린다. 그 포트의 iframe 위성 주소는 서버가 "우리 서버에 닿는 주소"로 가려 둔 것이므로 그것을
 * 쓴다(같은 셸의 위성 우선). 위성이 없으면 종전대로 `localhost` — 패키지 앱 렌더러는 `file://` 라
 * `window.location.hostname` 이 비어 있어 호스트를 거기서 빌릴 수 없다.
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
