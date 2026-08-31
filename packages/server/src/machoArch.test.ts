import { describe, it, expect } from 'vitest';
import {
  readMachoArchs,
  isArchCompatible,
  toProcessArch,
  MACHO_HEADER_PROBE_BYTES,
  type MachoArch,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·updateDelivery.test.ts 선례).
//
// **이 파일이 왜 있는가.** `self-install` 이 어긋난 아키텍처의 번들을 깔면 앱은 다시 뜨지 않는다
// (`koffi` 가 제 바이너리를 못 찾아 main 프로세스가 즉사 — 이 저장소가 v0.1.12 에서 겪은 사고).
// 그런데 우리에게는 mac 실기가 없다. 판정을 **바이트에서만** 하도록 짜 둔 덕분에 헤더를 손으로
// 조립해 Windows 개발기에서 thin x64 · thin arm64 · universal 세 경우를 전부 잰다.

// ── 헤더 조립 도구 ──────────────────────────────────────────────────────────
// 실제 macOS 실행본은 **리틀엔디언**이라 디스크에 `cf fa ed fe`(= LE 로 읽으면 0xfeedfacf)로 시작한다.
// fat 헤더만 예외적으로 **빅엔디언**이다(`ca fe ba be`).
const CPU = { x64: 0x01000007, arm64: 0x0100000c, ppc: 0x00000012 } as const;

function u32le(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
function u32be(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** thin Mach-O(64비트, 리틀엔디언) 헤더 — 실제 mac 실행본의 모양. */
function thin(cpuType: number): Uint8Array {
  return new Uint8Array([...u32le(0xfeedfacf), ...u32le(cpuType), ...new Array(16).fill(0)]);
}

/** universal(fat) 헤더 — 빅엔디언, 32비트 오프셋 형식(fat_arch = 20바이트). */
function fat(cpuTypes: number[]): Uint8Array {
  const out = [...u32be(0xcafebabe), ...u32be(cpuTypes.length)];
  for (const cpu of cpuTypes) {
    out.push(...u32be(cpu)); // cputype
    out.push(...u32be(0)); // cpusubtype
    out.push(...u32be(0)); // offset
    out.push(...u32be(0)); // size
    out.push(...u32be(0)); // align
  }
  return new Uint8Array(out);
}

describe('readMachoArchs — thin 실행본', () => {
  it('arm64 thin 은 arm64 하나로 읽는다', () => {
    expect(readMachoArchs(thin(CPU.arm64))).toEqual<MachoArch[]>(['arm64']);
  });

  it('x86_64 thin 은 x64 하나로 읽는다', () => {
    expect(readMachoArchs(thin(CPU.x64))).toEqual<MachoArch[]>(['x64']);
  });

  it('우리가 배포하지 않는 cputype 은 other 로 접는다 (모르는 것을 x64 로 오독하지 않는다)', () => {
    expect(readMachoArchs(thin(CPU.ppc))).toEqual<MachoArch[]>(['other']);
  });

  it('빅엔디언으로 기록된 thin 헤더도 읽는다', () => {
    const be = new Uint8Array([...u32be(0xfeedfacf), ...u32be(CPU.arm64), ...new Array(16).fill(0)]);
    expect(readMachoArchs(be)).toEqual<MachoArch[]>(['arm64']);
  });
});

describe('readMachoArchs — universal(fat)', () => {
  it('두 아키텍처를 담은 universal 은 둘 다 읽는다', () => {
    expect(readMachoArchs(fat([CPU.x64, CPU.arm64]))).toEqual<MachoArch[]>(['x64', 'arm64']);
  });

  it('아키텍처가 하나뿐인 fat 도 정상 처리한다', () => {
    expect(readMachoArchs(fat([CPU.arm64]))).toEqual<MachoArch[]>(['arm64']);
  });

  it('fat 항목이 잘려 있으면 일부만 읽고 "다 봤다"고 하지 않는다 — 빈 배열(=모른다)', () => {
    const truncated = fat([CPU.x64, CPU.arm64]).slice(0, 20); // 두 번째 항목이 잘림
    expect(readMachoArchs(truncated)).toEqual([]);
  });

  it('터무니없는 항목 수는 fat 헤더가 아니라고 본다 (java .class 도 cafebabe 로 시작한다)', () => {
    const bogus = new Uint8Array([...u32be(0xcafebabe), ...u32be(9999), ...new Array(32).fill(0)]);
    expect(readMachoArchs(bogus)).toEqual([]);
  });
});

describe('readMachoArchs — Mach-O 가 아닌 것', () => {
  it('셸 스크립트는 빈 배열', () => {
    expect(readMachoArchs(new TextEncoder().encode('#!/bin/sh\necho hi\n'))).toEqual([]);
  });

  it('너무 짧은 입력은 빈 배열', () => {
    expect(readMachoArchs(new Uint8Array([0xcf, 0xfa]))).toEqual([]);
    expect(readMachoArchs(new Uint8Array([]))).toEqual([]);
  });
});

describe('isArchCompatible — 교체를 시작해도 되는가', () => {
  it('정확히 같은 아키텍처면 통과', () => {
    expect(isArchCompatible(['arm64'], 'arm64')).toBe(true);
    expect(isArchCompatible(['x64'], 'x64')).toBe(true);
  });

  it('universal 은 어느 쪽에서도 통과', () => {
    expect(isArchCompatible(['x64', 'arm64'], 'arm64')).toBe(true);
    expect(isArchCompatible(['x64', 'arm64'], 'x64')).toBe(true);
  });

  it('어긋나면 막는다 — Apple Silicon 에 Intel 빌드가 깔리면 앱이 뜨자마자 죽는다', () => {
    expect(isArchCompatible(['x64'], 'arm64')).toBe(false);
    expect(isArchCompatible(['arm64'], 'x64')).toBe(false);
  });

  it('Rosetta 는 근거가 아니다 — 도는지가 아니라 "우리가 지은 그 짝인가"로 판정한다', () => {
    // x64 바이너리는 Rosetta 로 arm64 기기에서 돌기는 하지만, 네이티브 모듈이 어긋나
    // 우리 앱은 죽는다. 그래서 "돌아간다"를 통과 근거로 삼지 않는다.
    expect(isArchCompatible(['x64'], 'arm64')).toBe(false);
  });

  it('모르면 통과시키지 않는다 (빈 배열 = 헤더를 못 읽었다)', () => {
    expect(isArchCompatible([], 'arm64')).toBe(false);
    expect(isArchCompatible([], 'x64')).toBe(false);
  });

  it('other 만 담긴 번들도 막는다', () => {
    expect(isArchCompatible(['other'], 'arm64')).toBe(false);
  });
});

describe('toProcessArch', () => {
  it('우리가 배포하는 둘만 통과시킨다', () => {
    expect(toProcessArch('arm64')).toBe('arm64');
    expect(toProcessArch('x64')).toBe('x64');
  });

  it('그 외는 null — 설치 대상이 아니다', () => {
    expect(toProcessArch('ia32')).toBeNull();
    expect(toProcessArch('arm')).toBeNull();
    expect(toProcessArch('')).toBeNull();
  });
});

describe('MACHO_HEADER_PROBE_BYTES', () => {
  it('현실적인 universal 헤더를 담고도 남는다 (170MB 를 통째로 읽지 않기 위한 상한)', () => {
    // fat 최대 항목 수(64) × 32바이트 + 머리 8바이트 = 2,056 — 4KB 안에 들어온다.
    expect(MACHO_HEADER_PROBE_BYTES).toBeGreaterThanOrEqual(8 + 64 * 32);
  });
});
