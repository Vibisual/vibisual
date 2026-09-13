import { describe, it, expect } from 'vitest';

import {
  CPU_MIN_WINDOW_MS,
  computeCpuPercent,
  parseDeviceLine,
  parseDevices,
  type CpuSample,
} from './localHardwareService.js';

/**
 * §5.19 (E)(F) — 이 PC 의 실측치를 읽는 자리.
 *
 * 이 파일이 검사하는 것은 **세 OS 에서 똑같은 산수**다. `os.cpus()` 와 `llama-server
 * --list-devices` 가 주는 값 자체는 개발 PC 에서 재현할 수 없지만, 그 값을 퍼센트와 장치
 * 목록으로 바꾸는 계산은 win/mac/linux 가 한 벌을 공유한다 — 여기서 틀리면 세 OS 가 한꺼번에
 * 틀리고, 그것을 잡을 다른 그물이 없다.
 *
 * 특히 **모르는 것을 0 으로 꾸미지 않는가**를 집요하게 본다. 사용량 팝업의 올모델 탭은 이
 * 값을 게이지로 그리므로, -1 이어야 할 자리가 0 이 되면 화면이 "CPU 가 놀고 있습니다"라는
 * 거짓을 말하게 된다.
 */

const CORES = 8;
/** 창을 확실히 채우는 누적 델타(코어당 250ms). */
const WIDE = CPU_MIN_WINDOW_MS * CORES * 1.25;

const sample = (idle: number, total: number): CpuSample => ({ idle, total });

describe('computeCpuPercent — 모르면 -1, 알면 0~100', () => {
  it('표본이 하나뿐이면 답이 없다 — 첫 호출은 기준점을 세울 뿐이다', () => {
    expect(computeCpuPercent(null, sample(1000, 2000), CORES)).toBe(-1);
  });

  it('코어를 못 읽은 OS 에서는 답하지 않는다(일부 리눅스가 빈 목록을 준다)', () => {
    expect(computeCpuPercent(sample(0, 0), sample(1000, WIDE), 0)).toBe(-1);
  });

  it('쉰 시간이 델타의 80% 면 20% 바빴다', () => {
    const prev = sample(1_000, 2_000);
    const next = sample(1_000 + WIDE * 0.8, 2_000 + WIDE);
    expect(computeCpuPercent(prev, next, CORES)).toBe(20);
  });

  it('내내 쉬었으면 0% 다 — 이 0 은 "모름"이 아니라 실제로 잰 0 이다', () => {
    const prev = sample(1_000, 2_000);
    expect(computeCpuPercent(prev, sample(1_000 + WIDE, 2_000 + WIDE), CORES)).toBe(0);
  });

  it('한 틱도 안 쉬었으면 100% 다', () => {
    const prev = sample(1_000, 2_000);
    expect(computeCpuPercent(prev, sample(1_000, 2_000 + WIDE), CORES)).toBe(100);
  });

  it('측정 창이 안 찼으면 답을 내지 않는다 — 짧은 표본의 잡음을 게이지에 싣지 않는다', () => {
    const short = CPU_MIN_WINDOW_MS * CORES - 1;
    const prev = sample(1_000, 2_000);
    expect(computeCpuPercent(prev, sample(1_000, 2_000 + short), CORES)).toBe(-1);
  });

  it('카운터가 되감기면(절전 복귀·코어 수 변동) 지어내지 않는다', () => {
    const prev = sample(5_000, 10_000);
    expect(computeCpuPercent(prev, sample(100, 200), CORES)).toBe(-1);
  });

  it('총량은 늘었는데 쉰 시간만 줄어든 어긋난 표본도 버린다', () => {
    const prev = sample(5_000, 10_000);
    expect(computeCpuPercent(prev, sample(4_000, 10_000 + WIDE), CORES)).toBe(-1);
  });

  it('델타가 0 이면 답이 없다 — 같은 순간에 두 번 물은 것이다', () => {
    const prev = sample(1_000, 2_000);
    expect(computeCpuPercent(prev, sample(1_000, 2_000), CORES)).toBe(-1);
  });

  it('결과는 0~100 을 벗어나지 않는다', () => {
    const prev = sample(0, 0);
    const pct = computeCpuPercent(prev, sample(-500, WIDE), CORES);
    expect(pct === -1 || (pct >= 0 && pct <= 100)).toBe(true);
  });

  it('최소 창은 인자로 낮출 수 있다 — 창 규칙 자체가 계산을 막는지 가려낸다', () => {
    const prev = sample(1_000, 2_000);
    const next = sample(1_000 + 80, 2_000 + 160);
    expect(computeCpuPercent(prev, next, CORES)).toBe(-1);
    expect(computeCpuPercent(prev, next, CORES, 1)).toBe(50);
  });
});

describe('parseDeviceLine — 장치 줄 하나', () => {
  it('엔진이 적어 주는 형식을 그대로 읽는다', () => {
    const d = parseDeviceLine('  Vulkan0: NVIDIA GeForce RTX 4090 (24138 MiB, 23370 MiB free)');
    expect(d).not.toBeNull();
    expect(d?.name).toBe('Vulkan0: NVIDIA GeForce RTX 4090');
    expect(d?.totalBytes).toBe(24138 * 1024 * 1024);
    expect(d?.freeBytes).toBe(23370 * 1024 * 1024);
  });

  it('형식이 다른 줄은 조용히 넘긴다 — 파싱 실패가 기능을 죽이면 안 된다', () => {
    expect(parseDeviceLine('ggml_vulkan: 0 = NVIDIA GeForce RTX 4090 (NVIDIA) | uma: 0')).toBeNull();
    expect(parseDeviceLine('Available devices:')).toBeNull();
    expect(parseDeviceLine('')).toBeNull();
  });
});

describe('parseDevices — 출력 전체', () => {
  it('장치 줄만 추린다', () => {
    const out = [
      'ggml_vulkan: Found 2 Vulkan devices:',
      'Available devices:',
      '  Vulkan0: NVIDIA GeForce RTX 4090 (24138 MiB, 23370 MiB free)',
      '  Vulkan1: Intel(R) UHD Graphics (16384 MiB, 15000 MiB free)',
    ].join('\n');
    const devices = parseDevices(out);
    expect(devices.map((d) => d.name)).toEqual([
      'Vulkan0: NVIDIA GeForce RTX 4090',
      'Vulkan1: Intel(R) UHD Graphics',
    ]);
  });

  it('가속 장치가 없으면 빈 배열이다 — 그것이 "CPU 로 돈다"는 뜻이다', () => {
    expect(parseDevices('Available devices:\n  (none)')).toEqual([]);
  });

  it('CRLF 출력도 같은 답을 준다(Windows 자식 프로세스)', () => {
    const devices = parseDevices('Available devices:\r\n  Vulkan0: Radeon RX 7900 (20464 MiB, 20000 MiB free)\r\n');
    expect(devices).toHaveLength(1);
    expect(devices[0]?.name).toBe('Vulkan0: Radeon RX 7900');
  });
});
