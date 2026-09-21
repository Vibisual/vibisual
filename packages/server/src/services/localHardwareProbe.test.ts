import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { LocalEngineState } from '@vibisual/shared';
import { getEngineCandidates, getEngineState } from './localEngineService.js';
import { getLocalHardware, invalidateLocalHardware, peekLocalHardware } from './localHardwareService.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('./localEngineService.js', () => ({ getEngineState: vi.fn(), getEngineCandidates: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const DEVICE = 'Available devices:\n  Vulkan0: Test GPU (8192 MiB, 4096 MiB free)';
const ENGINE: LocalEngineState = {
  installed: true, build: 'test-build', backends: ['vulkan'], serverBin: '/engine/vulkan/llama-server', dir: '/engine',
};

function fakeChild(): ChildProcess {
  // ChildProcess 의 이벤트 계약만 모사하며 외부 실행본은 띄우지 않는다.
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  }) as unknown as ChildProcess;
}

let children: ChildProcess[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
  vi.mocked(getEngineState).mockReturnValue(ENGINE);
  vi.mocked(getEngineCandidates).mockReturnValue([]);
  invalidateLocalHardware();
  children = [];
  vi.mocked(spawn).mockImplementation(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
});
afterEach(() => {
  invalidateLocalHardware();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function answer(index: number, output: string, code: number | null = 0): void {
  children[index]?.stdout?.emit('data', Buffer.from(output));
  children[index]?.emit('close', code);
}

describe('hardware probe — 실패와 CPU 전용을 구분한다', () => {
  it.each([1, null])('조회 종료 코드 %s 는 GPU 줄이 일부 나왔어도 정상 측정이 아니다', async (code) => {
    const pending = getLocalHardware();
    answer(0, DEVICE, code);
    expect(await pending).toMatchObject({ measuredAt: 0, devices: [] });
    await getLocalHardware();
    expect(children).toHaveLength(1); // 실패 조회도 매 스냅샷마다 재실행하지 않는다.
  });

  it('시작 실패는 알 수 없음으로 남는다', async () => {
    const pending = getLocalHardware();
    children[0]?.emit('error', new Error('loader unavailable'));
    children[0]?.emit('close', -1);
    expect((await pending).measuredAt).toBe(0);
  });

  it('타임아웃은 부분 출력으로 CPU/GPU를 판정하지 않고 자식을 회수한다', async () => {
    const pending = getLocalHardware();
    children[0]?.stdout?.emit('data', Buffer.from(DEVICE));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).measuredAt).toBe(0);
    expect(children[0]?.kill).toHaveBeenCalledOnce();
  });

  it('성공했어도 장치 목록이 아닌 출력은 알 수 없음이다', async () => {
    const pending = getLocalHardware();
    answer(0, 'unknown option --list-devices');
    expect((await pending).measuredAt).toBe(0);
  });

  it('목록 제목은 읽어도 장치 형식을 읽지 못하면 CPU 전용으로 오판하지 않는다', async () => {
    const pending = getLocalHardware();
    answer(0, 'Available devices:\n Vulkan0: Test GPU (new memory format)');
    expect((await pending).measuredAt).toBe(0);
  });

  it('첫 GPU 로더 실패 뒤 다른 백엔드가 쓸 수 있는 장치를 조회한다', async () => {
    vi.mocked(getEngineCandidates).mockReturnValue([
      { backend: 'vulkan', serverBin: '/engine/alternate/llama-server' },
    ]);
    const pending = getLocalHardware();
    answer(0, '', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(2);
    answer(1, DEVICE);
    expect((await pending).devices).toHaveLength(1);
  });

  it('엔진이 장치 없음을 답했을 때만 CPU 전용 실측이다', async () => {
    const pending = getLocalHardware();
    answer(0, 'Available devices:\n  (none)');
    expect(await pending).toMatchObject({ measuredAt: Date.now(), devices: [] });
  });

  it('stdout 장치 줄 도중 들어온 stderr 로그가 줄을 손상시키지 않는다', async () => {
    const pending = getLocalHardware();
    children[0]?.stdout?.emit('data', Buffer.from('Available devices:\n  Vulkan0: Test'));
    children[0]?.stderr?.emit('data', Buffer.from('initializing backend\n'));
    children[0]?.stdout?.emit('data', Buffer.from(' GPU (8192 MiB, 4096 MiB free)'));
    children[0]?.emit('close', 0);
    expect((await pending).devices).toHaveLength(1);
  });

  it('엔진을 바꾼 뒤 늦게 끝난 옛 조회가 새 측정을 덮지 않는다', async () => {
    const old = getLocalHardware();
    vi.mocked(getEngineState).mockReturnValue({ ...ENGINE, build: 'next-build' });
    const current = getLocalHardware();
    answer(1, 'Available devices:\n  Vulkan0: New GPU (16384 MiB, 8192 MiB free)');
    expect((await current).devices[0]?.name).toContain('New GPU');
    answer(0, DEVICE);
    expect((await old).measuredAt).toBe(0);
    expect(peekLocalHardware().devices[0]?.name).toContain('New GPU');
  });

  it('무효화 후 옛 finally가 새 singleflight를 지우지 않는다', async () => {
    const old = getLocalHardware();
    invalidateLocalHardware();
    const current = getLocalHardware();
    answer(0, DEVICE);
    await old;
    const same = getLocalHardware();
    expect(children).toHaveLength(2);
    answer(1, DEVICE);
    await Promise.all([current, same]);
  });
});
