import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  archToken, engineDir, getEngineCandidates, getEngineState, getInflightEngineInstall,
  installEngine, platformToken, uninstallEngine,
} from './localEngineService.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../broadcastBus.js', () => ({ broadcast: vi.fn() }));

let home: string;
let brokenBackends: Set<string>;
let downloaded: string[];
const binName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

function previousInstall(): void {
  fs.mkdirSync(engineDir(), { recursive: true });
  fs.writeFileSync(path.join(engineDir(), binName), 'previous engine');
  fs.writeFileSync(path.join(engineDir(), '.vibisual-engine.json'), JSON.stringify({
    build: 'previous', backends: ['cpu'], installedAt: 1,
  }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-install-flow-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  brokenBackends = new Set();
  downloaded = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/releases')) {
      return Response.json([{ tag_name: 'new-build', assets: ['vulkan', 'cpu'].map((backend) => ({
        name: `llama-test-bin-${platformToken()}-${backend}-${archToken()}.zip`,
        browser_download_url: `https://example.invalid/${backend}.zip`, size: 4,
      })) }]);
    }
    downloaded.push(url);
    return new Response('test', { headers: { 'content-length': '4' } });
  }));
  vi.mocked(spawn).mockImplementation((command, args) => {
    const argv = Array.isArray(args) ? args : [];
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    }) as unknown as ChildProcess;
    queueMicrotask(() => {
      if (argv.includes('--version')) {
        child.emit('close', 0);
        return;
      }
      const destIndex = argv.indexOf('-C') >= 0 ? argv.indexOf('-C') : argv.indexOf('-d');
      const dest = destIndex >= 0 ? argv[destIndex + 1] : /-DestinationPath '([^']+)'/.exec(argv.at(-1) ?? '')?.[1];
      if (!dest) throw new Error(`unexpected extractor ${command}`);
      const backend = path.basename(dest);
      if (brokenBackends.has(backend)) {
        child.emit('close', 1);
        return;
      }
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, binName), backend);
      fs.writeFileSync(path.join(dest, 'backend-library'), `${backend} library`);
      child.emit('close', 0);
    });
    return child;
  });
});

afterEach(async () => {
  await vi.waitFor(() => {
    expect(['done', 'error']).toContain(getInflightEngineInstall()?.status);
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

async function finished(): Promise<void> {
  await vi.waitFor(() => {
    expect(['done', 'error']).toContain(getInflightEngineInstall()?.status);
  });
}

describe('엔진 설치 — 모의 다운로드/실행본으로 전체 흐름 확인', () => {
  it('CPU가 GPU 파일을 덮지 않고 서로 다른 실행본으로 남는다', async () => {
    installEngine(['vulkan', 'cpu']);
    await finished();
    expect(getInflightEngineInstall()?.status).toBe('done');
    const candidates = getEngineCandidates();
    expect(candidates.map((candidate) => candidate.backend)).toEqual(['vulkan', 'cpu']);
    expect(candidates.map((candidate) => fs.readFileSync(candidate.serverBin, 'utf8'))).toEqual(['vulkan', 'cpu']);
  });

  it('GPU 설치가 실패해도 CPU 실행본을 확보해 완료한다', async () => {
    brokenBackends.add('vulkan');
    installEngine(['vulkan']);
    await finished();
    expect(getInflightEngineInstall()?.status).toBe('done');
    expect(getEngineCandidates().map((candidate) => candidate.backend)).toEqual(['cpu']);
    expect(downloaded).toEqual(['https://example.invalid/vulkan.zip', 'https://example.invalid/cpu.zip']);
  });

  it('모든 새 백엔드가 실패하면 기존 설치는 그대로 동작 가능한 자리에 남는다', async () => {
    previousInstall();
    brokenBackends = new Set(['vulkan', 'cpu']);
    installEngine();
    await finished();
    expect(getInflightEngineInstall()?.status).toBe('error');
    expect(getEngineState()).toMatchObject({ installed: true, build: 'previous' });
    expect(fs.readFileSync(path.join(engineDir(), binName), 'utf8')).toBe('previous engine');
  });

  it('새 설치가 준비 중일 때 기존 설치를 유지하고 삭제 경쟁을 막는다', async () => {
    previousInstall();
    const first = installEngine();
    expect(installEngine().installId).toBe(first.installId);
    expect(getEngineState()).toMatchObject({ installed: true, build: 'previous' });
    await expect(uninstallEngine()).rejects.toThrow('installation is in progress');
    await finished();
    expect(getEngineState().build).toBe('new-build');
  });
});
