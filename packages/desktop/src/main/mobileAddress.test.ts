import { describe, it, expect } from 'vitest';
import {
  classifyMobileAddress,
  buildMobileAddressEntries,
  isCgnatAddress,
  isPrivateLanAddress,
  isLinkLocalAddress,
  isMobileAddressReachable,
  MOBILE_ADDRESS_KIND_ORDER,
  MOBILE_QR_KIND_ORDER,
  type MobileAddressInput,
} from '@vibisual/shared';

// §4 (판올림 번호 발급 대기) — 모바일 접속 주소의 정체 판정.
//
// 이 판정은 **어댑터 이름**을 본다. 그런데 그 이름은 OS 마다 전혀 다르고(Windows `이더넷` ·
// macOS `en0` · Linux `wlan0`), 우리에겐 세 OS 실기가 없다. 판정 함수가 `process.platform` 을
// 읽지 않고 **이름을 인자로 받게** 만든 이유가 이것이다 — Windows 개발기 한 대에서 세 OS 의
// 이름을 그대로 먹여 볼 수 있어야 규칙이 지켜졌는지 확인할 수 있다(CLAUDE.md 멀티플랫폼 규칙).

describe('대역 판정', () => {
  it('RFC 6598 CGNAT 는 100.64 ~ 100.127 만이다', () => {
    expect(isCgnatAddress('100.101.102.103')).toBe(true); // Tailscale 이 나눠 주는 대역의 주소(가상 값)
    expect(isCgnatAddress('100.64.0.1')).toBe(true);
    expect(isCgnatAddress('100.127.255.255')).toBe(true);
    // 경계 밖 — 100.x 라고 다 CGNAT 가 아니다(100.63/100.128 은 공인 대역).
    expect(isCgnatAddress('100.63.0.1')).toBe(false);
    expect(isCgnatAddress('100.128.0.1')).toBe(false);
  });

  it('RFC 1918 사설 대역만 랜으로 본다', () => {
    expect(isPrivateLanAddress('192.168.0.23')).toBe(true);
    expect(isPrivateLanAddress('10.0.0.5')).toBe(true);
    expect(isPrivateLanAddress('172.16.0.1')).toBe(true);
    expect(isPrivateLanAddress('172.31.255.254')).toBe(true);
    expect(isPrivateLanAddress('172.15.0.1')).toBe(false); // 12비트 경계 바깥
    expect(isPrivateLanAddress('172.32.0.1')).toBe(false);
    expect(isPrivateLanAddress('8.8.8.8')).toBe(false);
  });

  it('169.254 는 주소를 못 받은 상태다', () => {
    expect(isLinkLocalAddress('169.254.13.7')).toBe(true);
    expect(isLinkLocalAddress('169.253.13.7')).toBe(false);
  });

  it('IPv4 가 아닌 것은 어느 대역에도 들지 않는다', () => {
    for (const bad of ['', 'localhost', '1.2.3', '1.2.3.4.5', '10.0.0.256', 'fe80::1', '10.0.0.a']) {
      expect(isCgnatAddress(bad)).toBe(false);
      expect(isPrivateLanAddress(bad)).toBe(false);
      expect(isLinkLocalAddress(bad)).toBe(false);
    }
  });
});

describe('세 OS 의 어댑터 이름', () => {
  it('Tailscale — 이름이 셋 다 다른데 전부 VPN 으로 읽힌다', () => {
    // Windows: 어댑터 이름이 그대로 제품명.
    expect(classifyMobileAddress('100.101.102.103', 'Tailscale')).toEqual({ kind: 'vpn', product: 'Tailscale' });
    // Linux.
    expect(classifyMobileAddress('100.101.102.103', 'tailscale0')).toEqual({ kind: 'vpn', product: 'Tailscale' });
    // macOS: 공용 터널 이름이라 제품을 알 수 없다 — 종류만 말하고 이름은 지어내지 않는다.
    expect(classifyMobileAddress('100.101.102.103', 'utun3')).toEqual({ kind: 'vpn', product: null });
  });

  it('진짜 랜은 세 OS 어느 이름이든 lan 이다', () => {
    for (const adapter of ['이더넷', 'Wi-Fi', 'en0', 'en1', 'eth0', 'wlan0', 'enp3s0']) {
      expect(classifyMobileAddress('192.168.0.23', adapter)).toEqual({ kind: 'lan', product: null });
    }
  });

  it('폰에서 절대 안 되는 가상 어댑터를 이름으로 가려낸다', () => {
    // Windows — WSL·Hyper-V 는 사설 대역을 쓰므로 **대역만 보면 진짜 랜과 구별되지 않는다.**
    expect(classifyMobileAddress('172.30.16.1', 'vEthernet (WSL (Hyper-V firewall))'))
      .toEqual({ kind: 'virtual', product: 'WSL' });
    expect(classifyMobileAddress('172.17.128.1', 'vEthernet (Default Switch)'))
      .toEqual({ kind: 'virtual', product: 'Hyper-V' });
    expect(classifyMobileAddress('192.168.56.1', 'VirtualBox Host-Only Network'))
      .toEqual({ kind: 'virtual', product: 'VirtualBox' });
    expect(classifyMobileAddress('192.168.200.1', 'VMware Network Adapter VMnet8'))
      .toEqual({ kind: 'virtual', product: 'VMware' });
    // Linux.
    expect(classifyMobileAddress('172.17.0.1', 'docker0')).toEqual({ kind: 'virtual', product: 'Docker' });
    expect(classifyMobileAddress('172.18.0.1', 'br-1a2b3c4d5e6f')).toEqual({ kind: 'virtual', product: 'Docker' });
    expect(classifyMobileAddress('192.168.122.1', 'virbr0')).toEqual({ kind: 'virtual', product: 'libvirt' });
    // macOS — 인터넷 공유 브리지. 이름으로 제품을 못 밝히니 종류만.
    expect(classifyMobileAddress('192.168.2.1', 'bridge100')).toEqual({ kind: 'virtual', product: null });
  });

  it('169.254 는 어느 어댑터에 붙어 있든 안 되는 주소다', () => {
    expect(classifyMobileAddress('169.254.1.2', 'Wi-Fi').kind).toBe('linkLocal');
    expect(classifyMobileAddress('169.254.1.2', 'Tailscale').kind).toBe('linkLocal');
  });

  it('사전에 없는 것은 "안 된다"로 넘겨짚지 않는다', () => {
    // 공인 IP 가 랜카드에 직접 붙는 구성(일부 회선)은 실제로 열린다 — 지우면 안 된다.
    expect(classifyMobileAddress('203.0.113.7', 'eth0')).toEqual({ kind: 'other', product: null });
    expect(isMobileAddressReachable('other')).toBe(true);
    expect(isMobileAddressReachable('virtual')).toBe(false);
    expect(isMobileAddressReachable('linkLocal')).toBe(false);
  });
});

describe('목록 세우기', () => {
  /** 실측한 구성과 같은 모양(주소는 가상 값) + 가상 어댑터를 섞은 것. OS 가 주는 순서는 뒤죽박죽이다. */
  const inputs: MobileAddressInput[] = [
    { url: 'http://172.30.16.1:54957', address: '172.30.16.1', adapter: 'vEthernet (WSL)' },
    { url: 'http://100.101.102.103:54957', address: '100.101.102.103', adapter: 'Tailscale' },
    { url: 'http://169.254.9.9:54957', address: '169.254.9.9', adapter: 'Wi-Fi' },
    { url: 'http://192.168.0.23:54957', address: '192.168.0.23', adapter: '이더넷' },
  ];

  it('되는 순서로 세우고 추천은 하나뿐이다', () => {
    const out = buildMobileAddressEntries(inputs);
    expect(out.map((e) => e.kind)).toEqual(['lan', 'vpn', 'virtual', 'linkLocal']);
    expect(out.filter((e) => e.recommended)).toHaveLength(1);
    expect(out[0]?.address).toBe('192.168.0.23');
    expect(out[0]?.recommended).toBe(true);
  });

  it('인터넷 주소는 랜·VPN 다음, 안 되는 것들보다는 앞', () => {
    const out = buildMobileAddressEntries([
      ...inputs,
      { url: 'https://203.0.113.7:8443', address: '203.0.113.7', adapter: '', external: true },
    ]);
    expect(out.map((e) => e.kind)).toEqual(['lan', 'vpn', 'external', 'virtual', 'linkLocal']);
  });

  it('같은 종류 안에서는 OS 가 준 순서를 흔들지 않는다', () => {
    // 랜카드 두 장이 매번 자리를 바꾸면 사용자가 방금 본 주소를 다시 못 찾는다.
    const out = buildMobileAddressEntries([
      { url: 'http://192.168.0.5:1', address: '192.168.0.5', adapter: 'Wi-Fi' },
      { url: 'http://10.0.0.9:1', address: '10.0.0.9', adapter: '이더넷' },
    ]);
    expect(out.map((e) => e.address)).toEqual(['192.168.0.5', '10.0.0.9']);
  });

  it('열릴 수 있는 주소가 하나도 없으면 아무것도 추천하지 않는다', () => {
    const out = buildMobileAddressEntries([
      { url: 'http://172.17.0.1:1', address: '172.17.0.1', adapter: 'docker0' },
      { url: 'http://169.254.1.1:1', address: '169.254.1.1', adapter: 'Wi-Fi' },
    ]);
    expect(out.some((e) => e.recommended)).toBe(false);
  });

  it('주소가 없으면 빈 목록이다', () => {
    expect(buildMobileAddressEntries([])).toEqual([]);
  });
});

describe('QR 대상 순서', () => {
  // 목록과 QR 은 "무엇이 먼저여야 하는가"가 다르다. 목록은 폰에 직접 쳐 넣는 것이라 지금 될
  // 가능성이 높은 것이 먼저지만, QR 은 폰이 어디 있든 찍는 것이라 집 와이파이를 벗어나도
  // 남는 길(외부 IP)이 먼저여야 한다. 첫 칸이 곧 기본 선택이므로 이 순서가 "찍었을 때 무엇이
  // 열리는가"를 정한다.
  const inputs: MobileAddressInput[] = [
    { url: 'http://172.30.16.1:1', address: '172.30.16.1', adapter: 'vEthernet (WSL)' },
    { url: 'http://192.168.0.23:1', address: '192.168.0.23', adapter: '이더넷' },
    { url: 'http://100.101.102.103:1', address: '100.101.102.103', adapter: 'Tailscale' },
    { url: 'https://203.0.113.7:8443', address: '203.0.113.7', adapter: '', external: true },
  ];

  it('외부 IP 가 맨 앞이다 — 목록 순서와 반대다', () => {
    const qr = buildMobileAddressEntries(inputs, MOBILE_QR_KIND_ORDER);
    expect(qr.map((e) => e.kind)).toEqual(['external', 'lan', 'vpn', 'virtual']);
    expect(qr[0]?.address).toBe('203.0.113.7');

    // 같은 원재료라도 목록 순서로 부르면 랜이 먼저다 — 두 순서가 정말 갈라져 있다.
    expect(buildMobileAddressEntries(inputs).map((e) => e.kind))
      .toEqual(['lan', 'vpn', 'external', 'virtual']);
  });

  it('순서를 안 주면 종전과 똑같이 목록 순서로 돈다', () => {
    expect(buildMobileAddressEntries(inputs))
      .toEqual(buildMobileAddressEntries(inputs, MOBILE_ADDRESS_KIND_ORDER));
  });

  it('앞으로 당기는 것은 외부뿐 — 안 되는 주소는 QR 에서도 뒤에 남는다', () => {
    const qr = buildMobileAddressEntries([
      { url: 'http://169.254.9.9:1', address: '169.254.9.9', adapter: 'Wi-Fi' },
      { url: 'http://172.17.0.1:1', address: '172.17.0.1', adapter: 'docker0' },
      { url: 'https://203.0.113.7:8443', address: '203.0.113.7', adapter: '', external: true },
    ], MOBILE_QR_KIND_ORDER);
    expect(qr.map((e) => e.kind)).toEqual(['external', 'virtual', 'linkLocal']);
  });

  it('외부가 없으면 QR 도 랜부터다 — 순서만 다를 뿐 없는 길을 만들지 않는다', () => {
    const qr = buildMobileAddressEntries([
      { url: 'http://100.101.102.103:1', address: '100.101.102.103', adapter: 'Tailscale' },
      { url: 'http://192.168.0.23:1', address: '192.168.0.23', adapter: '이더넷' },
    ], MOBILE_QR_KIND_ORDER);
    expect(qr.map((e) => e.kind)).toEqual(['lan', 'vpn']);
  });

  it('두 순서는 같은 종류를 빠짐없이 담는다', () => {
    // 새 종류를 만들고 QR 순서에 안 넣으면 그 주소만 조용히 맨 뒤로 밀린다 — 화면에서는
    // 원인을 알 수 없는 자리다. 목록 순서를 정본으로 두고 집합이 같은지 여기서 고정한다.
    expect([...MOBILE_QR_KIND_ORDER].sort()).toEqual([...MOBILE_ADDRESS_KIND_ORDER].sort());
  });
});
