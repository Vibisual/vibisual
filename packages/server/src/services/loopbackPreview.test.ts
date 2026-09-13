/**
 * §7.11 — "눌러서 프리뷰" + Bash 감지 폴백이 함께 딛는 두 규칙을 고정한다.
 *
 * (1) **어느 이름으로 부르든 같은 서버다** — `localhost` / `127.0.0.1` / `[::1]`.
 *     한 이름만 묻고 접으면 IPv6 전용 서버(Windows 의 Vite 가 그렇다)가 죽은 것으로 판정된다.
 * (2) **텍스트에 찍힌 주소를 그대로 줍는다** — 포트 숫자만 뽑아 root URL 을 합성하면 경로를 잃는다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import {
  isLoopbackHostname,
  isLoopbackPreviewUrl,
  loopbackUrlVariants,
  extractLoopbackUrls,
  isDocumentContentType,
  serverRootUrl,
  previewUrlForServer,
} from '@vibisual/shared';
import { resolveServingUrl, resolvePreviewUrl, isUrlServing, setVibisualOwnPorts, isVibisualOwnPort } from './processChecker.js';

describe('isLoopbackHostname', () => {
  it('별칭·대역 전체를 루프백으로 본다', () => {
    for (const h of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]', '0.0.0.0']) {
      expect(isLoopbackHostname(h), h).toBe(true);
    }
  });

  it('남의 기계는 루프백이 아니다', () => {
    for (const h of ['example.com', '192.168.0.10', '10.0.0.1', 'localhost.evil.com', '1270.0.0.1']) {
      expect(isLoopbackHostname(h), h).toBe(false);
    }
  });
});

describe('isLoopbackPreviewUrl', () => {
  it('http(s) 루프백만 프리뷰 후보다', () => {
    expect(isLoopbackPreviewUrl('http://localhost:8080/index.html')).toBe(true);
    expect(isLoopbackPreviewUrl('https://127.0.0.1:5173')).toBe(true);
    expect(isLoopbackPreviewUrl('http://localhost')).toBe(true); // 포트 생략 = 80
    expect(isLoopbackPreviewUrl('file:///C:/tmp/a.html')).toBe(false);
    expect(isLoopbackPreviewUrl('https://github.com/x')).toBe(false);
    expect(isLoopbackPreviewUrl('그냥 문장')).toBe(false);
  });
});

describe('loopbackUrlVariants', () => {
  it('경로·쿼리를 보존한 채 별칭을 만든다', () => {
    const v = loopbackUrlVariants('http://127.0.0.1:8080/game?seed=1');
    expect(v[0]).toBe('http://127.0.0.1:8080/game?seed=1'); // 원본이 먼저
    expect(v).toContain('http://localhost:8080/game?seed=1');
    expect(v).toContain('http://[::1]:8080/game?seed=1');
  });

  it('0.0.0.0 은 접속용 주소가 아니라 원본을 앞에 두지 않는다', () => {
    const v = loopbackUrlVariants('http://0.0.0.0:3000/');
    expect(v.some((u) => u.includes('0.0.0.0'))).toBe(false);
    expect(v[0]).toBe('http://localhost:3000/');
  });

  it('루프백이 아니면 빈 배열 — 남의 주소로 별칭을 만들지 않는다', () => {
    expect(loopbackUrlVariants('https://example.com/')).toEqual([]);
  });
});

describe('extractLoopbackUrls', () => {
  it('문장 안에 박힌 주소에서 뒤 구두점을 떼고 줍는다', () => {
    expect(extractLoopbackUrls('게임은 http://localhost:8080 에서 돕니다.')).toEqual(['http://localhost:8080']);
    expect(extractLoopbackUrls('열어 뒀습니다(http://127.0.0.1:5173/app.html).'))
      .toEqual(['http://127.0.0.1:5173/app.html']);
  });

  it('경로를 잃지 않는다 — 포트만 뽑는 옛 감지와 갈리는 지점', () => {
    expect(extractLoopbackUrls('  ➜  Local:   http://localhost:8080/mirror.html'))
      .toEqual(['http://localhost:8080/mirror.html']);
  });

  it('바깥 주소는 줍지 않는다', () => {
    expect(extractLoopbackUrls('docs: https://vitejs.dev/guide/ and https://example.com:8080/')).toEqual([]);
  });

  it('중복을 접고 상한을 지킨다', () => {
    const text = 'http://localhost:1/ http://localhost:1/ http://localhost:2/ http://localhost:3/';
    expect(extractLoopbackUrls(text)).toEqual(['http://localhost:1/', 'http://localhost:2/', 'http://localhost:3/']);
    expect(extractLoopbackUrls(text, 2)).toHaveLength(2);
  });
});

describe('setVibisualOwnPorts / isVibisualOwnPort', () => {
  afterEach(() => { setVibisualOwnPorts([]); });

  it('우리 포트는 감지 대상에서 제외된다 — 에이전트가 카드 엔드포인트를 계속 치기 때문', () => {
    setVibisualOwnPorts([51360, 4800, null, undefined, 0]);
    expect(isVibisualOwnPort(51360)).toBe(true);
    expect(isVibisualOwnPort(4800)).toBe(true);
    expect(isVibisualOwnPort(8080)).toBe(false);
    expect(isVibisualOwnPort(0)).toBe(false);
  });
});

describe('resolveServingUrl — IPv6 전용 서버', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.close(() => { r(); }); })));
  });

  function listenOn(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
      s.once('error', reject);
      s.listen(0, host, () => {
        servers.push(s);
        const addr = s.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no port'));
      });
    });
  }

  it('127.0.0.1 로 물어도 ::1 에만 뜬 서버를 찾아낸다(그 자리가 옛 게이트가 접던 곳)', async () => {
    const port = await listenOn('::1');
    const asked = `http://127.0.0.1:${String(port)}/`;
    // 옛 게이트: 물어본 이름 그대로 한 번만 → 실패.
    expect(await isUrlServing(asked)).toBe(false);
    // 새 게이트: 별칭을 차례로 → 접속되는 주소를 돌려준다.
    const resolved = await resolveServingUrl(asked);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/(localhost|\[::1\])/);
  });

  it('원본이 이미 접속되면 그 주소를 그대로 쓴다 — 사용자가 누른 주소를 바꾸지 않는다', async () => {
    const port = await listenOn('127.0.0.1');
    const asked = `http://127.0.0.1:${String(port)}/`;
    expect(await resolveServingUrl(asked)).toBe(asked);
  });

  it('아무 이름으로도 안 붙으면 null — 죽은 주소로 프리뷰를 만들지 않는다', async () => {
    // listen 하지 않은 포트(서버를 열었다 바로 닫아 확보).
    const port = await listenOn('127.0.0.1');
    await new Promise<void>((r) => { servers.pop()?.close(() => { r(); }); });
    expect(await resolveServingUrl(`http://127.0.0.1:${String(port)}/`)).toBeNull();
  });
});

/**
 * §7.11 — **프리뷰로 열 주소** 판정. 사용자 보고: "iframe 버블인데 계속
 * `http://127.0.0.1:3456/api/backtest/state` 로 연결돼 이상한 곳으로 빠진다."
 * 감지 폴백이 `curl` 명령에 박힌 API 경로를 통째로 주워 프리뷰 주소로 굳힌 자리다.
 */
describe('previewUrlForServer — 주운 주소를 그대로 열지 않는다', () => {
  it('응답이 문서(html)면 경로를 살린다 — `/game.html` 은 보려던 그 페이지다', () => {
    expect(previewUrlForServer('http://localhost:8080/game.html', 'text/html; charset=utf-8'))
      .toBe('http://localhost:8080/game.html');
    expect(previewUrlForServer('http://localhost:8080/app', 'application/xhtml+xml'))
      .toBe('http://localhost:8080/app');
  });

  it('응답이 문서가 아니면 그 서버의 정문으로 접는다 — API 는 사람이 볼 화면이 아니다', () => {
    expect(previewUrlForServer('http://127.0.0.1:3456/api/backtest/state', 'application/json; charset=utf-8'))
      .toBe('http://127.0.0.1:3456/');
    expect(previewUrlForServer('http://localhost:5173/logo.png', 'image/png'))
      .toBe('http://localhost:5173/');
    expect(previewUrlForServer('http://localhost:5173/readme', 'text/plain'))
      .toBe('http://localhost:5173/');
  });

  it('경로가 없으면 이미 정문이라 손대지 않는다(응답 종류와 무관)', () => {
    expect(previewUrlForServer('http://localhost:3000/', 'application/json')).toBe('http://localhost:3000/');
    expect(previewUrlForServer('http://localhost:3000', 'application/json')).toBe('http://localhost:3000');
    expect(previewUrlForServer('http://localhost:3000/?tab=2', 'text/html')).toBe('http://localhost:3000/?tab=2');
  });

  it('Content-Type 이 아예 없으면 확장자만 본다 — 모르는 것은 건드리지 않는다', () => {
    // 헤더를 안 보내는 서버: 경로를 잃는 쪽이 더 나쁘므로 종전대로 살린다.
    expect(previewUrlForServer('http://localhost:8080/game.html')).toBe('http://localhost:8080/game.html');
    expect(previewUrlForServer('http://localhost:8080/dashboard')).toBe('http://localhost:8080/dashboard');
    // 확장자만으로 확실히 페이지가 아닌 것은 접는다.
    expect(previewUrlForServer('http://localhost:8080/state.json')).toBe('http://localhost:8080/');
    expect(previewUrlForServer('http://localhost:8080/assets/app.CSS')).toBe('http://localhost:8080/');
  });

  it('http(s) 가 아니거나 파싱 불가면 원본 그대로', () => {
    expect(previewUrlForServer('file:///C:/tmp/a.html', 'text/html')).toBe('file:///C:/tmp/a.html');
    expect(previewUrlForServer('그냥 문장')).toBe('그냥 문장');
  });

  it('isDocumentContentType / serverRootUrl', () => {
    expect(isDocumentContentType('text/html')).toBe(true);
    expect(isDocumentContentType('TEXT/HTML; charset=utf-8')).toBe(true);
    expect(isDocumentContentType('application/json')).toBe(false);
    expect(isDocumentContentType(undefined)).toBe(false);
    expect(serverRootUrl('http://127.0.0.1:3456/api/x?y=1')).toBe('http://127.0.0.1:3456/');
    expect(serverRootUrl('그냥 문장')).toBeNull();
  });
});

describe('resolvePreviewUrl — 정문이 실제로 응답할 때만 옮긴다', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.close(() => { r(); }); })));
  });

  /** 라우트별 (status, content-type, body) 를 그대로 흉내내는 서버. */
  function listenWith(routes: Record<string, { status: number; type?: string }>): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        const route = routes[(req.url ?? '/').split('?')[0] ?? '/'];
        if (!route) { res.writeHead(404); res.end('nope'); return; }
        res.writeHead(route.status, route.type ? { 'Content-Type': route.type } : undefined);
        res.end('body');
      });
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        servers.push(s);
        const addr = s.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no port'));
      });
    });
  }

  it('JSON API 주소는 정문으로 바뀐다(그 서버의 화면이 열린다)', async () => {
    const port = await listenWith({
      '/': { status: 200, type: 'text/html' },
      '/api/backtest/state': { status: 200, type: 'application/json' },
    });
    expect(await resolvePreviewUrl(`http://127.0.0.1:${String(port)}/api/backtest/state`))
      .toBe(`http://127.0.0.1:${String(port)}/`);
  });

  it('정문이 죽어 있으면 확인된 원래 주소를 지킨다 — 안 열리는 주소로 바꾸지 않는다', async () => {
    const port = await listenWith({
      '/data.json': { status: 200, type: 'application/json' },
      // '/' 없음 → 404
    });
    const asked = `http://127.0.0.1:${String(port)}/data.json`;
    expect(await resolvePreviewUrl(asked)).toBe(asked);
  });

  it('문서 경로는 그대로 열린다', async () => {
    const port = await listenWith({
      '/': { status: 200, type: 'text/html' },
      '/game.html': { status: 200, type: 'text/html' },
    });
    const asked = `http://127.0.0.1:${String(port)}/game.html`;
    expect(await resolvePreviewUrl(asked)).toBe(asked);
  });

  it('아무 것도 응답하지 않으면 null', async () => {
    const port = await listenWith({});
    await new Promise<void>((r) => { servers.pop()?.close(() => { r(); }); });
    expect(await resolvePreviewUrl(`http://127.0.0.1:${String(port)}/api/x`)).toBeNull();
  });
});
