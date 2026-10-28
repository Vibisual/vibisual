/**
 * §4 — 접속 주소의 정체를 판정하는 유일한 자리: (주소, 어댑터 이름) → 종류 + 제품 이름(문구는 클라가 종류로 고른다).
 * IPv4 를 그대로 나열하면 Tailscale `100.77.x.x`(CGNAT)·WSL·Docker 처럼 폰에서 안 되는 주소가 진짜 랜과 구별 없이 섞인다.
 * 플랫폼 분기가 없다 — 세 OS 어댑터 이름(`이더넷`·`en0`·`wlan0`·`utun3`·`tailscale0` …)을 한 사전으로 맞춘다. 순수 함수(`node:`·`process` ❌).
 */

import { MOBILE_VPN_ADAPTERS, MOBILE_VIRTUAL_ADAPTERS } from './constants.js';

/**
 * 접속 주소의 정체 — 화면은 이 값으로 문구·아이콘·묶음을 고른다.
 * `lan` 같은 공유기(같은 와이파이면 열림) · `vpn` Tailscale·ZeroTier(폰도 같은 망이어야) · `external` 인터넷에서 닿는 주소(밖에서도)
 * · `virtual` WSL·Docker·VM(폰에선 안 됨) · `linkLocal` `169.254.x.x`(안 됨) · `other` 사전에 없음(될 수도 있어 지우지 않는다).
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
 * QR 순서 — 외부 IP 가 맨 앞이다. 목록은 쳐 넣는 것이라 "지금 될 가능성" 순이지만, QR 은 폰이 어디 있든 찍으므로 와이파이 밖에서
 * 남는 길은 외부 IP 뿐이다. 첫 칸이 기본 선택(`qrTargetIndex = 0`)이다. `virtual`·`linkLocal` 이 뒤인 것은 같다.
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
 * (주소, 어댑터 이름)의 정체 — 순서가 우선순위다. ① `169.254` 는 무조건 안 됨 ② CGNAT 대역 = VPN 확정(`utun3` 같은 이름이어도)
 * ③ 이름 사전, VPN 이 가상보다 먼저(mac `utun` = VPN, Docker `172.17.0.1` 은 이름으로만 걸린다) ④ 대역 — 사설이면 랜, 그 밖 `other`.
 * 모르는 것을 "안 된다"로 넘겨짚지 않는다(될 수도 있는 주소를 지우는 쪽이 더 나쁘다).
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
 * 정체 붙은 목록 — 되는 순서로 세우고 하나만 추천한다. 안정 정렬(같은 종류는 OS 순서 유지 — 자리가 바뀌면 방금 본 주소를 못 찾는다).
 * 추천은 맨 앞이 열릴 수 있을 때만. `order` 는 부르는 쪽이 고른다(목록 ≠ QR, 기본은 목록).
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
