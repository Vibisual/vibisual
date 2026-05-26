/**
 * Iframe Proxy — cross-origin 페이지를 same-origin으로 로드하여
 * Inspector의 contentDocument 접근을 가능하게 한다.
 *
 * 동작: GET /iframe-proxy/<host:port>/path → http://<host:port>/path 로 프록시
 * HTML 응답에는 <base> 태그 + fetch/XHR 패치 스크립트를 주입한다.
 */
import net from 'node:net';
import type { Request, Response } from 'express';
import { IFRAME_PROXY_PATH } from '@vibisual/shared';
import { logger } from '../logger.js';

/**
 * 보안 — SSRF 가드. 이 프록시는 **로컬 dev 서버 프리뷰** 전용이므로
 * loopback/사설 대역만 허용한다. 공인 IP·링크로컬(169.254/16, 클라우드
 * 메타데이터 169.254.169.254 포함)·임의 호스트명은 전부 차단.
 * (차단 안 하면: 사용자가 연 임의 웹페이지가 cross-origin 으로
 *  /iframe-proxy/169.254.169.254/... 를 호출해 메타데이터·내부 포트 유출.)
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const o = parts.map((p) => Number(p));
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o as [number, number, number, number];
  if (a === 127) return true;                       // 127.0.0.0/8 loopback
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  return false; // 공인·0.0.0.0·169.254 링크로컬(메타데이터) 전부 거부
}

function isAllowedProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost') return true;
  if (h === '::1') return true;
  if (net.isIPv4(h)) return isPrivateIPv4(h);
  if (net.isIPv6(h)) {
    const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
    return false; // ::1 은 위에서 처리, 그 외 IPv6 거부
  }
  return false; // localhost 외 호스트명 거부 (DNS 리바인딩 SSRF 차단)
}

/** upstream 으로 전달을 허용하는 요청 헤더 (allowlist — cookie/authorization 등 절대 미전달) */
const ALLOWED_REQ_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'range']);

/** 주입할 <base> + fetch/XHR 패치 스크립트 생성 */
function buildInjection(proxyBase: string): string {
  return [
    `<base href="${proxyBase}/">`,
    '<script>',
    '(function(){',
    `  var p="${proxyBase}";`,
    '  var _f=window.fetch;',
    '  window.fetch=function(u,o){',
    '    if(typeof u==="string"&&u.startsWith("/")&&!u.startsWith(p))u=p+u;',
    '    return _f.call(this,u,o);',
    '  };',
    '  var _o=XMLHttpRequest.prototype.open;',
    '  XMLHttpRequest.prototype.open=function(m,u){',
    '    if(typeof u==="string"&&u.startsWith("/")&&!u.startsWith(p))arguments[1]=p+u;',
    '    return _o.apply(this,arguments);',
    '  };',
    '})();',
    '</script>',
  ].join('');
}

/**
 * HTML 내 root-relative URL(`src="/..."`, `href="/..."`)을 프록시 경로로 재작성.
 * `<base>`는 root-relative에 영향 없으므로 직접 치환해야 스크립트/링크가 로드된다.
 * 또한 `<meta http-equiv="Content-Security-Policy">` 태그를 제거 (iframe 프리뷰에선 원본 CSP가 방해).
 */
function rewriteHtml(html: string, proxyBase: string): string {
  // 1) meta CSP 제거 — 원본 앱의 Electron용 CSP가 프리뷰에서 스크립트/WS 차단
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  // 2) 속성값이 "/" 또는 '/'로 시작하는 src/href/action을 프록시 경로로 치환
  //    `//` (protocol-relative), `/iframe-proxy/` (이미 처리됨) 는 제외
  const attrRe = /\b(src|href|action)=(["'])(\/[^"'\/][^"']*)\2/g;
  html = html.replace(attrRe, (m, attr: string, quote: string, url: string) => {
    if (url.startsWith(proxyBase)) return m;
    return `${attr}=${quote}${proxyBase}${url}${quote}`;
  });

  // 3) <style> 블록 및 인라인 style의 url(/...) → 프록시 경로로 치환
  const cssUrlRe = /url\(\s*(["']?)(\/[^"')\/][^"')]*)\1\s*\)/g;
  html = html.replace(cssUrlRe, (m, quote: string, url: string) => {
    if (url.startsWith(proxyBase)) return m;
    return `url(${quote}${proxyBase}${url}${quote})`;
  });

  return html;
}

/** Express 핸들러 — app.use(IFRAME_PROXY_PATH, iframeProxyHandler) */
export async function iframeProxyHandler(req: Request, res: Response): Promise<void> {
  // req.url = "/<host:port>/remaining/path?query"
  const slashIdx = req.url.indexOf('/', 1);
  const target = slashIdx === -1 ? req.url.substring(1) : req.url.substring(1, slashIdx);
  const pathAndQuery = slashIdx === -1 ? '/' : req.url.substring(slashIdx);

  if (!target) {
    res.status(400).send('Missing proxy target (usage: /iframe-proxy/<host:port>/path)');
    return;
  }

  // 보안: URL 파서로 host 를 정규화해 검증 (`user@host`, 대괄호 IPv6, `#` 트릭 차단).
  let parsed: URL;
  try {
    parsed = new URL(`http://${target}${pathAndQuery}`);
  } catch {
    res.status(400).send('Invalid proxy target');
    return;
  }
  if (parsed.username || parsed.password) {
    res.status(400).send('Credentials in proxy target are not allowed');
    return;
  }
  if (!isAllowedProxyHost(parsed.hostname)) {
    logger.warn(`[iframeProxy] BLOCKED target=${target} host=${parsed.hostname} (loopback/사설 대역만 허용)`);
    res.status(403).send('Proxy target not allowed — loopback/private hosts only');
    return;
  }

  const targetUrl = parsed.toString();

  try {
    // 요청 헤더는 allowlist 만 전달 (cookie/authorization 등 ambient 자격증명을
    // upstream 으로 흘리지 않음). 조건부 요청 헤더도 자동 제외 — 304 본문은
    // 재작성 불가라 브라우저가 재작성 전 캐시를 쓰게 되므로.
    const fwdHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!ALLOWED_REQ_HEADERS.has(k.toLowerCase())) continue;
      if (typeof v === 'string') fwdHeaders[k] = v;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body as BodyInit,
      // 보안: redirect:manual — upstream 이 169.254.169.254 등으로 3xx 리다이렉트해도
      // 서버가 따라가지 않음. Location 은 다시 프록시 경로로 재작성해 브라우저가
      // 재요청하도록 → 다음 요청에서 host 재검증.
      redirect: 'manual',
    });

    // 3xx 리다이렉트: Location 을 프록시 경로로 재작성해 브라우저로 전달
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get('location');
      if (loc) {
        let rewritten: string;
        if (/^https?:\/\//i.test(loc)) {
          try {
            const lu = new URL(loc);
            rewritten = `${IFRAME_PROXY_PATH}/${lu.host}${lu.pathname}${lu.search}`;
          } catch {
            rewritten = `${IFRAME_PROXY_PATH}/${target}/`;
          }
        } else if (loc.startsWith('/')) {
          rewritten = `${IFRAME_PROXY_PATH}/${target}${loc}`;
        } else {
          rewritten = loc;
        }
        res.setHeader('location', rewritten);
      }
      res.status(upstream.status).end();
      return;
    }

    // 응답 헤더 복사 (iframe 차단 헤더 + 캐시/검증 헤더 제거)
    // 캐시 관련 헤더를 모두 제거하는 이유: 프록시에서 본문을 재작성하므로
    // 브라우저가 동일 URL의 재작성 전 버전을 캐시하면 import가 깨진다.
    const skipHeaders = new Set([
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'transfer-encoding',
      'content-encoding',
      'content-length', // 주입으로 길이 바뀔 수 있으므로 제거
      'etag',
      'last-modified',
      'cache-control',
    ]);
    for (const [key, value] of upstream.headers) {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    // Express의 자동 ETag 생성 비활성화 (브라우저가 304로 캐시 재사용하는 걸 막음)
    res.removeHeader('ETag');
    res.status(upstream.status);

    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let html = await upstream.text();
      const proxyBase = `${IFRAME_PROXY_PATH}/${target}`;

      // root-relative URL 재작성 + meta CSP 제거
      html = rewriteHtml(html, proxyBase);

      const injection = buildInjection(proxyBase);
      // <head> 태그 뒤에 주입 (없으면 문서 최상단에)
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, (m) => m + injection);
      } else {
        html = injection + html;
      }
      res.send(html);
    } else if (contentType.includes('text/css')) {
      // CSS 내부 url(/...) 도 프록시 경로로 재작성
      let css = await upstream.text();
      const proxyBase = `${IFRAME_PROXY_PATH}/${target}`;
      const cssUrlRe = /url\(\s*(["']?)(\/[^"')\/][^"')]*)\1\s*\)/g;
      css = css.replace(cssUrlRe, (m, quote: string, url: string) => {
        if (url.startsWith(proxyBase)) return m;
        return `url(${quote}${proxyBase}${url}${quote})`;
      });
      res.send(css);
    } else if (contentType.includes('javascript')) {
      // JS 모듈 내 Vite 전용 root-relative 경로를 프록시 경로로 재작성
      // (정적/동적 import, sourceMappingURL 등)
      let js = await upstream.text();
      const proxyBase = `${IFRAME_PROXY_PATH}/${target}`;
      // Vite가 사용하는 특수 prefix — 앱 코드 문자열에서 우연히 나올 일이 거의 없음
      const vitePaths = ['/@vite/', '/@fs/', '/@id/', '/@react-refresh', '/node_modules/', '/src/', '/assets/', '/public/'];
      for (const p of vitePaths) {
        // "/@vite/..." → "/iframe-proxy/HOST/@vite/..."
        const re = new RegExp(`(["'\`])${p.replace(/[/@]/g, '\\$&')}`, 'g');
        js = js.replace(re, `$1${proxyBase}${p}`);
      }
      // sourceMappingURL=/... (주석)
      js = js.replace(/sourceMappingURL=(\/[^\s*]+)/g, (m, url: string) => {
        if (url.startsWith(proxyBase)) return m;
        return `sourceMappingURL=${proxyBase}${url}`;
      });
      res.send(js);
    } else {
      // 비-HTML: 바이너리 패스스루
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    }
  } catch (err: unknown) {
    logger.error(`[iframeProxy] ${req.method} ${targetUrl} failed:`, err);
    res.status(502).send(`Proxy error: ${String(err)}`);
  }
}
