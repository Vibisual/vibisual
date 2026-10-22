/**
 * §5.23 「더블클릭」 · §7.11 — 이 주소는 **로컬 프리뷰**인가, **인터넷 페이지**인가.
 *
 * 로컬 프리뷰(루프백·사설 대역)는 우리 iframe 프록시를 지나 다리 스크립트(요소 집기·Alt)를 받는다.
 * 인터넷 페이지는 그 프록시가 받지 않는다(SSRF 가드 — 403). 그렇다고 본체 렌더러의 iframe 에 직접
 * 실으면 샌드박스 없는 프로세스에서 남의 페이지가 돈다 — 그래서 격리 웹뷰로 띄운다(§5.23).
 *
 * 규칙은 서버 `iframeProxy.ts` 의 `isAllowedProxyHost` 와 **같아야 한다.** 어긋나면 한쪽이 프록시로
 * 보낸 주소를 다른 쪽이 403 으로 돌려보내거나, 로컬 화면이 다리 없이 뜬다. 서버 시험
 * (`localPreviewHost.test.ts`)이 두 판정을 같은 표로 대조한다.
 *
 * 순수 함수다 — Node(`net`)·DOM 에 닿지 않아 클라·main·서버가 같은 답을 낸다. 호스트 이름은 WHATWG
 * `URL` 이 정규화한 값(`hostname`)을 받는다고 본다. 그래야 `0x7f.1`·`2130706433` 같은 표기가 이미
 * `127.0.0.1` 로 풀려 있고, 아래 IPv4 판정이 앞자리 0 같은 별칭을 따로 다루지 않아도 된다.
 */

/** 정규화된 십진 점 표기 한 칸(앞자리 0 없음 · 0~255). */
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
/** IPv4 를 품은 IPv6(`::ffff:a.b.c.d`). WHATWG 는 이것을 16진(`::ffff:7f00:1`)으로 적으므로 대개 여기 걸리지 않는다. */
const IPV4_MAPPED = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** 루프백·사설 IPv4 인가 — 공인·`0.0.0.0`·링크로컬(169.254/16, 클라우드 메타데이터) 은 아니다. */
function isPrivateIPv4(ip: string): boolean {
  const m = IPV4.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return true; // 127.0.0.0/8 루프백
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * 호스트가 **로컬 프리뷰 프록시가 받는 곳**인가 — `localhost` · `::1` · 루프백·사설 IPv4.
 * 그 밖의 이름(공인 도메인)은 전부 아니다 — 이름은 DNS 가 무엇으로든 풀 수 있어 사설로 보지 않는다.
 */
export function isLocalPreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost') return true;
  if (h === '::1') return true;
  if (IPV4.test(h)) return isPrivateIPv4(h);
  if (h.includes(':')) {
    const mapped = IPV4_MAPPED.exec(h);
    return mapped?.[1] ? isPrivateIPv4(mapped[1]) : false;
  }
  return false;
}

/** http(s) 주소인가. 못 읽는 주소·다른 스킴은 아니다. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * **인터넷 페이지**인가 — http(s) 이고 호스트가 로컬 프리뷰가 아니다.
 * 못 읽는 주소는 false 다(모르는 것을 인터넷 페이지로 넘겨짚지 않는다 — 그 주소는 종전 길을 탄다).
 */
export function isRemoteWebUrl(raw: string): boolean {
  if (!isHttpUrl(raw)) return false;
  return !isLocalPreviewHost(new URL(raw).hostname);
}
