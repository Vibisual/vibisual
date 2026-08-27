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
} from '@vibisual/shared';
import { resolveServingUrl, isUrlServing, setVibisualOwnPorts, isVibisualOwnPort } from './processChecker.js';

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
