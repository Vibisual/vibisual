/**
 * §4 (판올림 번호 발급 대기) — **접속 주소가 무엇인지** 를 판정하는 유일한 자리.
 *
 * 모바일 웹 접속(§4 v3.16)은 `os.networkInterfaces()` 의 내부가 아닌 IPv4 를 **전부 그대로**
 * 나열했다. 그래서 Tailscale 이 만든 가상 랜카드의 `100.77.x.x`(RFC 6598 CGNAT 대역)가 진짜
 * 유선 랜 `192.168.x.x` 와 **글자 한 줄 차이도 없이** 나란히 떴고, WSL·Docker 처럼 폰에서는
 * 절대 안 열리는 주소까지 같은 자리에 섞였다 — 사용자 보고 "이 주소 맞아? 뭔가 이상한 거
 * 아냐?"의 정체다. 목록이 주소만 말하고 **정체를 말하지 않으면** 무엇을 찍어야 하는지 알 수
 * 없고, 잘못 찍으면 "안 되는데요"로 끝난다.
 *
 * 이 모듈은 (주소, 어댑터 이름) 한 쌍을 받아 **종류 + 제품 이름**을 돌려준다. 화면 문구는
 * 클라이언트가 종류로 고르므로 여기에 사람 말은 한 글자도 없다.
 *
 * **플랫폼 분기가 없다** — 어댑터 이름은 OS 마다 전혀 다르지만(`이더넷` · `en0` · `wlan0`,
 * `Tailscale` · `utun3` · `tailscale0`) 판정은 세 OS 의 이름을 **한 사전에 모아** 맞추는 것이라
 * `process.platform` 을 읽지 않는다. 그래서 Windows 개발기에서도 세 OS 의 이름을 그대로
 * 단위 테스트할 수 있다(멀티플랫폼 규칙 6축 중 4축 — 홈·OS기능 성격의 자리).
 *
 * shared 라 브라우저에서도 로드된다 — `node:` 모듈·`process` 를 읽지 않는 순수 함수만 둔다
 * (`pathCase.ts`·`loopbackUrl.ts` 머리말과 같은 규약).
 */

import { MOBILE_VPN_ADAPTERS, MOBILE_VIRTUAL_ADAPTERS } from './constants.js';

/**
 * 접속 주소 한 줄의 정체. 화면은 이 값 하나로 설명 문구·아이콘·묶음을 고른다.
 *
 * - `lan`       — 같은 공유기에 붙은 사설 주소. 폰이 같은 와이파이면 그냥 열린다.
 * - `vpn`       — Tailscale·ZeroTier 같은 가상 사설망. 폰도 **같은 망에 들어와 있어야** 열린다.
 * - `external`  — 공유기를 열어 인터넷에서 닿는 주소(https). 밖에서도 열린다.
 * - `virtual`   — WSL·Docker·가상머신이 만든 랜카드. 이 PC 안에서만 뜻이 있어 **폰에서는 안 된다**.
 * - `linkLocal` — `169.254.x.x`. 주소를 못 받았을 때 OS 가 임시로 붙이는 것이라 **안 된다**.
 * - `other`     — 사전에 없는 주소. 될 수도 있으므로 지우지 않고 그대로 둔다.
 */
export type MobileAddressKind = 'lan' | 'vpn' | 'external' | 'virtual' | 'linkLocal' | 'other';

/** 목록에 세우는 순서 — 앞일수록 "지금 될 가능성이 높다". 추천 주소도 이 순서로 고른다. */
export const MOBILE_ADDRESS_KIND_ORDER: readonly MobileAddressKind[] = [
  'lan',
  'vpn',
  'external',
  'other',
  'virtual',
  'linkLocal',
];

/**
 * QR 에 담을 때의 순서 — **외부 IP 가 맨 앞**이다.
 *
 * 주소 목록과 순서가 다른 이유: 목록은 사람이 폰에 **직접 쳐 넣는** 것이라 "지금 될 가능성이
 * 높은 것"이 먼저여야 하지만, QR 은 **폰이 어디 있든 카메라로 찍는** 것이다. 집 와이파이를
 * 벗어난 폰에게 `192.168.x.x` 는 아무 뜻이 없고, 그때 유일하게 남는 길이 외부 IP 다.
 * 첫 칸이 곧 기본 선택(`qrTargetIndex = 0`)이므로 이 순서가 "찍었을 때 무엇이 열리는가"를 정한다.
 *
 * 되는 것과 안 되는 것의 경계(`virtual`·`linkLocal` 이 뒤)는 목록과 똑같이 지킨다.
 */
export const MOBILE_QR_KIND_ORDER: readonly MobileAddressKind[] = [
  'external',
  'lan',
  'vpn',
  'other',
  'virtual',
  'linkLocal',
];

/** 폰에서 열릴 수 있는 주소인가 — `virtual`·`linkLocal` 은 구조적으로 불가하므로 접어 둔다. */
export function isMobileAddressReachable(kind: MobileAddressKind): boolean {
  return kind !== 'virtual' && kind !== 'linkLocal';
}

/** 정체가 붙은 접속 주소 한 줄. `MobileAccessState.addresses` 와 QR 티켓 대상이 같은 모양을 쓴다. */
export interface MobileAddressEntry {
  /** 폰 브라우저에서 열 전체 URL(QR 티켓에서는 토큰이 붙은 딥링크). */
  url: string;
  /** 순수 IPv4 주소 — 칩·복사 버튼이 주소만 필요할 때 쓴다. */
  address: string;
  /** OS 가 준 어댑터 이름 그대로(`이더넷` · `en0` · `tailscale0`). 인터넷 주소면 빈 문자열. */
  adapter: string;
  /** 이 주소의 정체. */
  kind: MobileAddressKind;
  /** 사전에서 알아본 제품 이름(`Tailscale` · `Docker`). 모르면 null — 화면은 종류만 말한다. */
  product: string | null;
  /** 지금 가장 확실히 되는 주소 하나에만 true. 목록 전체에서 최대 1개. */
  recommended: boolean;
}

/** 리스너가 모아 넘기는 원재료 — 판정 전의 (주소, 어댑터, URL) 한 쌍. */
export interface MobileAddressInput {
  url: string;
  address: string;
  /** 어댑터 이름. 공인 IP 처럼 어댑터가 없는 주소는 빈 문자열. */
  adapter: string;
  /** 인터넷(공인 IP) 주소면 true — 랜카드가 아니라 공유기 개방으로 생긴 주소다. */
  external?: boolean;
}

/** 어댑터 이름을 사전에 맞춰 본다. 맞으면 제품 이름(모르는 제품이면 `''`), 아니면 null. */
function lookupAdapter(
  adapter: string,
  table: readonly { readonly test: RegExp; readonly label: string }[],
): string | null {
  const name = adapter.trim().toLowerCase();
  if (name === '') return null;
  for (const row of table) {
    if (row.test.test(name)) return row.label;
  }
  return null;
}

/** `a.b.c.d` 를 옥텟 배열로. IPv4 가 아니면 null(IPv6·호스트명은 이 판정의 대상이 아니다). */
function octets(address: string): [number, number, number, number] | null {
  const parts = address.trim().split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  const [a, b, c, d] = nums;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

/** RFC 6598 CGNAT(`100.64.0.0/10`) — Tailscale 이 쓰는 그 대역. 인터넷으로는 라우팅되지 않는다. */
export function isCgnatAddress(address: string): boolean {
  const o = octets(address);
  return o !== null && o[0] === 100 && o[1] >= 64 && o[1] <= 127;
}

/** RFC 1918 사설 대역(`10/8` · `172.16/12` · `192.168/16`) — 집·사무실 공유기가 나눠 주는 주소. */
export function isPrivateLanAddress(address: string): boolean {
  const o = octets(address);
  if (o === null) return false;
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  return o[0] === 192 && o[1] === 168;
}

/** `169.254.0.0/16` — DHCP 를 못 받았을 때 OS 가 스스로 붙이는 주소. 밖에서는 닿지 않는다. */
export function isLinkLocalAddress(address: string): boolean {
  const o = octets(address);
  return o !== null && o[0] === 169 && o[1] === 254;
}

/**
 * (주소, 어댑터 이름) 한 쌍의 정체를 판정한다.
 *
 * 순서가 곧 우선순위다.
 * ① `169.254` 는 **무엇이 붙어 있든 안 되는 주소**라 가장 먼저 걸러 낸다.
 * ② CGNAT 대역은 가상 사설망의 가장 강한 신호다 — 어댑터 이름이 `utun3` 처럼 정체를 안
 *    말해도 종류는 확정된다(제품 이름은 이름 사전이 알아볼 때만 붙인다).
 * ③ 그다음이 이름 사전 — VPN 을 가상 어댑터보다 먼저 본다(mac 의 `utun` 은 VPN 이고
 *    가상 사전에는 없다. 반대로 Docker 의 `172.17.0.1` 은 사설 대역이라 이름으로만 걸린다).
 * ④ 마지막이 대역 — 사설이면 랜, 그 밖은 판정 불가(`other`)로 남긴다. **모르는 것을
 *    "안 된다"로 넘겨짚지 않는다** — 될 수도 있는 주소를 지우는 쪽이 더 나쁘다.
 */
export function classifyMobileAddress(
  address: string,
  adapter: string,
): { kind: MobileAddressKind; product: string | null } {
  const vpn = lookupAdapter(adapter, MOBILE_VPN_ADAPTERS);
  const virt = lookupAdapter(adapter, MOBILE_VIRTUAL_ADAPTERS);
  const named = (label: string | null): string | null => (label === null || label === '' ? null : label);

  if (isLinkLocalAddress(address)) return { kind: 'linkLocal', product: named(vpn ?? virt) };
  if (isCgnatAddress(address)) return { kind: 'vpn', product: named(vpn) };
  if (vpn !== null) return { kind: 'vpn', product: named(vpn) };
  if (virt !== null) return { kind: 'virtual', product: named(virt) };
  if (isPrivateLanAddress(address)) return { kind: 'lan', product: null };
  return { kind: 'other', product: null };
}

/**
 * 원재료를 정체가 붙은 목록으로 — **되는 순서로 세우고, 하나만 추천한다.**
 *
 * 정렬은 안정 정렬이라 같은 종류 안에서는 OS 가 준 순서가 유지된다(랜카드 두 장이 매번
 * 자리를 바꾸면 사용자가 방금 본 주소를 다시 못 찾는다). 추천은 **맨 앞이 열릴 수 있는
 * 주소일 때만** 붙는다 — 가상 어댑터밖에 없는 PC 에서 "이걸 쓰세요"라고 말하면 거짓이다.
 *
 * `order` 는 **부르는 쪽이 고른다** — 직접 쳐 넣는 목록과 카메라로 찍는 QR 은 "무엇이 먼저여야
 * 하는가"가 서로 다르기 때문이다(`MOBILE_QR_KIND_ORDER` 머리말). 기본값은 목록 쪽이라,
 * 순서를 따지지 않고 부르던 자리는 종전과 똑같이 돈다.
 */
export function buildMobileAddressEntries(
  inputs: readonly MobileAddressInput[],
  order: readonly MobileAddressKind[] = MOBILE_ADDRESS_KIND_ORDER,
): MobileAddressEntry[] {
  const entries: MobileAddressEntry[] = inputs.map((input) => {
    const { kind, product } = input.external === true
      ? { kind: 'external' as const, product: null }
      : classifyMobileAddress(input.address, input.adapter);
    return { url: input.url, address: input.address, adapter: input.adapter, kind, product, recommended: false };
  });

  const rank = (kind: MobileAddressKind): number => {
    const i = order.indexOf(kind);
    return i < 0 ? order.length : i;
  };
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.kind) - rank(b.entry.kind) || a.index - b.index)
    .map(({ entry }) => entry);

  const head = sorted[0];
  if (head !== undefined && isMobileAddressReachable(head.kind)) head.recommended = true;
  return sorted;
}
