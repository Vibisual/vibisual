import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_RELEASES_BASE_URL, CODEX_RELEASES_LATEST_API, MANAGED_ENGINE_META_NAME, MANAGED_ENGINE_RETRY_BACKOFF_MS, MANAGED_ENGINE_ROLLBACK_MARK } from '@vibisual/shared';
import { ManagedEngineService, type ManagedEngineDeps } from './managedEngineService.js';
import { managedStagingDir, managedVersionsDir } from './managedEngineLayout.js';

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/**
 * §4 (앱 전용 엔진) — 받기 → 대조 → 점검 → 전환 → 정리, 되돌리기, 자동 업데이트 판단.
 * 네트워크 · 디스크 여유 · 점검 실행은 가짜로 주입하고, 폴더 배치는 임시 홈에서 실제 파일로 본다(폴더가 진실이다).
 */

const WIN = process.platform === 'win32';
const CLAUDE_TARGET = WIN ? 'win32-x64' : 'linux-x64';
const CODEX_TARGET = WIN ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-musl';
const CLAUDE_FILE = WIN ? 'claude.exe' : 'claude';

let home: string;
let tmp: string;
let latestClaude: string;
let latestCodex: string;
let payload: Buffer;
let deps: ManagedEngineDeps & Record<string, ReturnType<typeof vi.fn> | unknown>;
/** 예약된 재시도 — 시험이 직접 부른다(진짜 시계를 쓰지 않는다). */
let scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }>;

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
/** 받기 도우미 흉내 — 파일을 쓰고, 받은 바이트 · 다시 읽은 파일의 지문을 둘 다 돌려준다. */
const helperResult = (b: Buffer) => ({ received: b.length, total: b.length, streamSha256: sha(b), fileSha256: sha(b) });

function makeDeps(over: Partial<ManagedEngineDeps> = {}): ManagedEngineDeps {
  return {
    home: () => home,
    platform: process.platform,
    target: (engine) => (engine === 'claude' ? CLAUDE_TARGET : CODEX_TARGET),
    fetchText: vi.fn(async (url: string) => {
      if (url === `${CLAUDE_RELEASES_BASE_URL}/latest`) return `${latestClaude}\n`;
      throw new Error(`unexpected text ${url}`);
    }),
    fetchJson: vi.fn(async (url: string) => {
      if (url.endsWith('/manifest.json')) {
        return { version: latestClaude, platforms: { [CLAUDE_TARGET]: { binary: CLAUDE_FILE, checksum: sha(payload), size: payload.length } } };
      }
      if (url === CODEX_RELEASES_LATEST_API) {
        return {
          tag_name: `rust-v${latestCodex}`,
          assets: [{ name: `codex-package-${CODEX_TARGET}.tar.gz`, browser_download_url: 'https://github.com/openai/codex/x.tar.gz', size: payload.length, digest: `sha256:${sha(payload)}` }],
        };
      }
      throw new Error(`unexpected json ${url}`);
    }),
    download: vi.fn(async (_url: string, dest: string, onBytes: (r: number, t: number) => void) => {
      fs.writeFileSync(dest, payload);
      onBytes(payload.length, payload.length);
      return helperResult(payload);
    }),
    extract: vi.fn(async (_archive: string, destDir: string) => {
      const bin = path.join(destDir, 'bin', WIN ? 'codex.exe' : 'codex');
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(bin, 'codex');
      fs.writeFileSync(path.join(destDir, 'codex-package.json'), '{}');
    }),
    shortfall: () => 0,
    freeBytes: () => null,
    probeVersion: vi.fn(async () => null),
    runProbes: vi.fn(async () => ({ failures: [] })),
    tmpDir: () => tmp,
    isInUse: () => true,
    autoUpdateEnabled: () => true,
    onActiveChanged: vi.fn(),
    now: () => 1_000_000,
    sleep: async () => undefined,
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms, cancelled: false };
      scheduled.push(entry);
      return () => { entry.cancelled = true; };
    },
    ...over,
  };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-managed-home-'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-managed-tmp-'));
  latestClaude = '2.1.310';
  latestCodex = '0.164.0';
  payload = Buffer.from('claude-binary-v1');
  scheduled = [];
  deps = makeDeps() as typeof deps;
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('받기 → 대조 → 점검 → 전환', () => {
  it('공식 저장소의 latest → manifest → 실행본을 받아 대조 · 점검 후 그 판으로 바꾼다', async () => {
    const svc = new ManagedEngineService(deps);
    const lines: string[] = [];
    const r = await svc.ensureLatest('claude', { manual: true, report: (l) => lines.push(l) });
    expect(r).toMatchObject({ outcome: 'installed', version: '2.1.310' });
    const bin = path.join(managedVersionsDir('claude', home), '2.1.310', CLAUDE_FILE);
    expect(fs.existsSync(bin)).toBe(true);
    expect(r.binPath).toBe(bin);
    expect(deps.download).toHaveBeenCalledWith(`${CLAUDE_RELEASES_BASE_URL}/2.1.310/${CLAUDE_TARGET}/${CLAUDE_FILE}`, expect.any(String), expect.any(Function));
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(bin), MANAGED_ENGINE_META_NAME), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ engine: 'claude', version: '2.1.310', platformTarget: CLAUDE_TARGET, sha256: sha(payload) });
    expect(deps.onActiveChanged).toHaveBeenCalledWith('claude');
    expect(svc.status('claude')).toMatchObject({ active: { version: '2.1.310' }, latest: '2.1.310', lastError: null, updating: false });
    expect(lines.some((l) => l.includes('Now using Claude Code 2.1.310'))).toBe(true);
    // 점검은 빈 임시 설정 홈에서 — 그 폴더는 끝나면 지운다.
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('이미 최신이면 받지 않는다', async () => {
    const svc = new ManagedEngineService(deps);
    await svc.ensureLatest('claude', { manual: true });
    vi.mocked(deps.download).mockClear();
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: false });
    expect(r.outcome).toBe('up-to-date');
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('SHA-256 이 다르면 깔지 않고, 받다 만 파일도 남기지 않는다', async () => {
    deps = makeDeps({
      download: vi.fn(async (_u: string, dest: string) => {
        fs.writeFileSync(dest, payload);
        return { ...helperResult(payload), streamSha256: 'f'.repeat(64), fileSha256: 'f'.repeat(64) };
      }),
    }) as typeof deps;
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(r.outcome).toBe('error');
    expect(r.error).toContain('checksum mismatch');
    expect(r.error).toContain('received bytes differ');
    expect(fs.existsSync(managedVersionsDir('claude', home))).toBe(false);
    expect(fs.readdirSync(managedStagingDir('claude', home)).filter((n) => n.includes('.part-'))).toEqual([]);
  });

  it('받은 바이트는 맞는데 디스크에 앉은 파일이 다르면 깔지 않고, 어디서 망가졌는지 적는다(실측 꼴)', async () => {
    deps = makeDeps({
      download: vi.fn(async (_u: string, dest: string) => {
        fs.writeFileSync(dest, payload);
        return { ...helperResult(payload), fileSha256: 'e'.repeat(64) };
      }),
    }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    const r = await svc.ensureLatest('claude', { manual: true });
    expect(r.outcome).toBe('error');
    expect(r.error).toContain('corrupted while writing to disk');
    expect(svc.status('claude').active).toBeNull();
  });

  it('받은 크기가 manifest 와 다르면 깔지 않는다', async () => {
    deps = makeDeps({
      download: vi.fn(async (_u: string, dest: string) => {
        fs.writeFileSync(dest, 'short');
        return helperResult(Buffer.from('short'));
      }),
    }) as typeof deps;
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(r).toMatchObject({ outcome: 'error' });
    expect(r.error).toContain('size mismatch');
  });

  it('앞선 실행이 남긴 받기 조각(.part-* 폴더 · 받다 만 .tar.gz)은 다음 받기가 시작 전에 걷는다', async () => {
    const staging = managedStagingDir('claude', home);
    fs.mkdirSync(path.join(staging, '2.1.309.part-OLD1'), { recursive: true });
    fs.writeFileSync(path.join(staging, '2.1.309.part-OLD1', CLAUDE_FILE), 'half');
    fs.writeFileSync(path.join(staging, '0.163.0-dead.tar.gz'), 'half');
    let seenAtDownload: string[] = [];
    deps = makeDeps({
      download: vi.fn(async (_u: string, dest: string) => {
        seenAtDownload = fs.readdirSync(staging);
        fs.writeFileSync(dest, payload);
        return helperResult(payload);
      }),
    }) as typeof deps;
    // 실패로 끝나도(성공 뒤 정리가 돌지 않아도) 남은 조각은 걷혀 있어야 한다.
    deps.runProbes = vi.fn(async () => ({ failures: [{ label: '--model sonnet', reason: 'x' }] }));
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(r.outcome).toBe('probe-failed');
    expect(seenAtDownload.filter((n) => n.startsWith('2.1.309') || n.endsWith('.tar.gz'))).toEqual([]);
    expect(fs.readdirSync(staging).sort()).toEqual(['2.1.310']);
  });

  it('지역 차단 등으로 포인터가 판 글자가 아니면(HTML) 그 글자로 아무것도 받지 않는다', async () => {
    latestClaude = '<html>blocked</html>';
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(r.outcome).toBe('error');
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('디스크가 모자라면 받지 않고 사유를 적는다', async () => {
    deps = makeDeps({ freeBytes: () => payload.length }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    const r = await svc.ensureLatest('claude', { manual: true });
    expect(r.error).toContain('not enough disk space');
    expect(svc.status('claude').lastError).toContain('not enough disk space');
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('배포처의 최신이 지금 판보다 옛 판이면(회수) 받지 않고 지금 판을 지킨다', async () => {
    await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    latestClaude = '2.1.305';
    vi.mocked(deps.download).mockClear();
    const svc = new ManagedEngineService(deps);
    expect(await svc.peekLatest('claude')).toMatchObject({ latest: '2.1.305', installed: true });
    const r = await svc.ensureLatest('claude', { manual: false });
    expect(r).toMatchObject({ outcome: 'up-to-date', version: '2.1.310' });
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('배포본이 없는 PC 는 받지 않는다', async () => {
    deps = makeDeps({ target: () => null }) as typeof deps;
    const r = await new ManagedEngineService(deps).ensureLatest('codex', { manual: true });
    expect(r.outcome).toBe('unsupported');
  });

  it('동시에 부르면 같은 작업에 합류한다(받기 한 번 · 진행 줄은 둘 다 받는다)', async () => {
    const svc = new ManagedEngineService(deps);
    const a: string[] = [];
    const b: string[] = [];
    const p1 = svc.ensureLatest('claude', { manual: true, report: (l) => a.push(l) });
    const p2 = svc.ensureLatest('claude', { manual: false, report: (l) => b.push(l) });
    expect(p1).toBe(p2);
    expect(svc.status('claude').updating).toBe(true);
    await p1;
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(b.some((l) => l.includes('Now using'))).toBe(true);
    expect(svc.status('claude').updating).toBe(false);
  });
});

describe('점검에서 떨어지면 바꾸지 않는다', () => {
  it('떨어진 판은 쓰지 않고, 떨어진 플래그를 적고, 받은 것은 남겨 다음엔 점검만 다시 한다', async () => {
    const runProbes = vi.fn(async () => ({ failures: [{ label: '--model sonnet', reason: "error: unknown option '--model'" }] }));
    deps = makeDeps({ runProbes }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    const r = await svc.ensureLatest('claude', { manual: true });
    expect(r).toMatchObject({ outcome: 'probe-failed', version: '2.1.310', failedProbes: ['--model sonnet'] });
    expect(svc.status('claude')).toMatchObject({ active: null, failedProbes: ['--model sonnet'] });
    expect(fs.existsSync(path.join(managedStagingDir('claude', home), '2.1.310', CLAUDE_FILE))).toBe(true);

    // 앱이 고쳐져 들어왔다 — 다시 받지 않고 점검만 다시 해서 통과한다.
    runProbes.mockResolvedValue({ failures: [] });
    vi.mocked(deps.download).mockClear();
    const again = await new ManagedEngineService(deps).ensureLatest('claude', { manual: false });
    expect(again.outcome).toBe('installed');
    expect(deps.download).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(managedStagingDir('claude', home), '2.1.310'))).toBe(false);
  });

  it('--version 이 받은 판을 말하지 않으면 떨어진다(한 박자 쉬고 두 번 더 묻고 나서)', async () => {
    const probeVersion = vi.fn(async () => '--version printed "1.0.0" (expected 2.1.310)');
    deps = makeDeps({ probeVersion }) as typeof deps;
    const r = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(r.outcome).toBe('probe-failed');
    expect(probeVersion).toHaveBeenCalledTimes(3);
    expect(deps.runProbes).not.toHaveBeenCalled();
  });
});

describe('되돌리기 · 정리', () => {
  async function installVersions(versions: string[]): Promise<ManagedEngineService> {
    let svc = new ManagedEngineService(deps);
    for (const v of versions) {
      latestClaude = v;
      payload = Buffer.from(`claude-${v}`);
      svc = new ManagedEngineService(deps); // 새 확인(조회 재사용 창 밖)
      const r = await svc.ensureLatest('claude', { manual: true });
      expect(r.outcome).toBe('installed');
    }
    return svc;
  }

  it('지금 판 + 앞 판만 남긴다', async () => {
    await installVersions(['2.1.300', '2.1.305', '2.1.310']);
    expect(fs.readdirSync(managedVersionsDir('claude', home)).sort()).toEqual(['2.1.305', '2.1.310']);
  });

  it('[이전 판으로] 는 앞 판을 쓰고, 자동 업데이트는 되돌린 판으로 다시 가지 않는다', async () => {
    const svc = await installVersions(['2.1.305', '2.1.310']);
    const rb = await svc.rollback('claude');
    expect(rb).toMatchObject({ ok: true, status: { active: { version: '2.1.305' } } });
    expect(fs.existsSync(path.join(managedVersionsDir('claude', home), '2.1.310', MANAGED_ENGINE_ROLLBACK_MARK))).toBe(true);
    expect(deps.onActiveChanged).toHaveBeenLastCalledWith('claude');

    const auto = await new ManagedEngineService(deps).ensureLatest('claude', { manual: false });
    expect(auto).toMatchObject({ outcome: 'skipped-rolled-back', version: '2.1.305' });

    // 사용자가 직접 [지금 업데이트]를 누르면 표식을 걷고 그 판으로 간다.
    const manual = await new ManagedEngineService(deps).ensureLatest('claude', { manual: true });
    expect(manual).toMatchObject({ outcome: 'installed', version: '2.1.310' });
    expect(new ManagedEngineService(deps).status('claude').active?.version).toBe('2.1.310');
  });

  it('되돌린 판은 더 새 판이 깔릴 때까지 지우지 않는다(지우면 다음 확인이 그 판을 다시 받아 되돌린 일을 무른다)', async () => {
    const svc = await installVersions(['2.1.300', '2.1.305']);
    await svc.rollback('claude');
    latestClaude = '2.1.305';
    await new ManagedEngineService(deps).ensureLatest('claude', { manual: false });
    expect(fs.readdirSync(managedVersionsDir('claude', home)).sort()).toEqual(['2.1.300', '2.1.305']);
    await installVersions(['2.1.320']);
    // 이제 2.1.305(되돌린 판)는 지금 판보다 오래됐다 — 정리된다.
    expect(fs.readdirSync(managedVersionsDir('claude', home)).sort()).toEqual(['2.1.300', '2.1.320']);
  });

  it('앞 판이 없으면 되돌리지 않는다', async () => {
    const svc = await installVersions(['2.1.310']);
    expect(await svc.rollback('claude')).toMatchObject({ ok: false, error: 'no-previous' });
  });
});

describe('코덱스 — GitHub 릴리스 패키지', () => {
  it('자산 digest 로 대조하고 풀어 bin/codex 를 쓴다', async () => {
    payload = Buffer.from('codex-archive');
    const r = await new ManagedEngineService(deps).ensureLatest('codex', { manual: true });
    expect(r).toMatchObject({ outcome: 'installed', version: '0.164.0' });
    expect(r.binPath).toBe(path.join(managedVersionsDir('codex', home), '0.164.0', 'bin', WIN ? 'codex.exe' : 'codex'));
    expect(deps.extract).toHaveBeenCalledTimes(1);
    // 받은 압축 파일은 풀고 나면 남기지 않는다.
    expect(fs.readdirSync(managedStagingDir('codex', home)).filter((n) => n.endsWith('.tar.gz'))).toEqual([]);
  });

  it('digest 가 없으면 SHA256SUMS 자산으로 대조한다 — 지문이 없으면 깔지 않는다', async () => {
    payload = Buffer.from('codex-archive');
    const fetchJson = vi.fn(async () => ({
      tag_name: 'rust-v0.164.0',
      assets: [
        { name: `codex-package-${CODEX_TARGET}.tar.gz`, browser_download_url: 'https://github.com/x.tar.gz', size: payload.length },
        { name: 'codex-package_SHA256SUMS', browser_download_url: 'https://github.com/sums' },
      ],
    }));
    const fetchText = vi.fn(async () => `${sha(payload)}  codex-package-${CODEX_TARGET}.tar.gz\n`);
    expect((await new ManagedEngineService(makeDeps({ fetchJson, fetchText })).ensureLatest('codex', { manual: true })).outcome).toBe('installed');

    const noSums = vi.fn(async () => ({ tag_name: 'rust-v0.165.0', assets: [{ name: `codex-package-${CODEX_TARGET}.tar.gz`, browser_download_url: 'https://github.com/y' }] }));
    const r = await new ManagedEngineService(makeDeps({ fetchJson: noSums })).ensureLatest('codex', { manual: true });
    expect(r.outcome).toBe('error');
    expect(r.error).toContain('no SHA-256');
  });
});

describe('자동 업데이트 판단', () => {
  it('스위치가 꺼져 있으면 돌지 않는다', () => {
    expect(new ManagedEngineService(makeDeps({ autoUpdateEnabled: () => false })).autoGate('codex')).toBe('disabled');
  });

  it('그 엔진을 쓰지 않는 PC 면 받지 않고 이유를 상태에 싣는다', () => {
    const svc = new ManagedEngineService(makeDeps({ isInUse: () => false }));
    expect(svc.autoGate('codex')).toBe('not-in-use');
    expect(svc.status('codex').deferred).toBe('not-in-use');
  });

  it('앱 전용 사본이 이미 있으면 다른 실행본이 없어도 계속 맡는다', async () => {
    payload = Buffer.from('codex-archive');
    await new ManagedEngineService(deps).ensureLatest('codex', { manual: true });
    expect(new ManagedEngineService(makeDeps({ isInUse: () => false })).autoGate('codex')).toBe('ok');
  });

  it('최신 판만 먼저 본다(받지 않는다)', async () => {
    const svc = new ManagedEngineService(deps);
    expect(await svc.peekLatest('claude')).toEqual({ latest: '2.1.310', installed: false, rolledBack: false });
    expect(deps.download).not.toHaveBeenCalled();
    await svc.ensureLatest('claude', { manual: true });
    expect(await svc.peekLatest('claude')).toMatchObject({ installed: true, rolledBack: false });
  });
});

describe('받기가 오류로 끝나면 짧게 다시 한다 — 6시간을 기다리지 않는다', () => {
  const failingDownload = () => vi.fn(async (_url: string, _dest: string): Promise<ReturnType<typeof helperResult>> => {
    throw new Error('download 503 https://downloads.claude.ai/x');
  });

  it('오류면 5분 뒤 재시도를 예약하고 시각을 상태에 싣는다 · 예약이 돌면 그 엔진의 판단을 다시 부른다', async () => {
    deps = makeDeps({ download: failingDownload() }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    const retried: string[] = [];
    svc.setRetryHandler((engine) => retried.push(engine));
    const r = await svc.ensureLatest('claude', { manual: false });
    expect(r.outcome).toBe('error');
    expect(scheduled.map((s) => s.ms)).toEqual([MANAGED_ENGINE_RETRY_BACKOFF_MS[0]]);
    expect(svc.status('claude').nextRetryAt).toBe(1_000_000 + (MANAGED_ENGINE_RETRY_BACKOFF_MS[0] ?? 0));
    scheduled[0]?.fn();
    expect(retried).toEqual(['claude']);
    expect(svc.status('claude').nextRetryAt).toBeUndefined();
  });

  it('간격은 5분 → 15분 → 60분, 그 뒤로는 예약하지 않는다(6시간 확인에 맡긴다)', async () => {
    deps = makeDeps({ download: failingDownload() }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    svc.setRetryHandler(() => undefined);
    for (let i = 0; i < MANAGED_ENGINE_RETRY_BACKOFF_MS.length + 1; i += 1) {
      await svc.ensureLatest('claude', { manual: false });
    }
    expect(scheduled.map((s) => s.ms)).toEqual([...MANAGED_ENGINE_RETRY_BACKOFF_MS]);
    // 앞 예약은 새 결과가 나올 때 취소된다(같은 엔진에 예약이 둘 서지 않는다).
    expect(scheduled.slice(0, -1).every((s) => s.cancelled)).toBe(true);
    expect(svc.status('claude').nextRetryAt).toBeUndefined();
  });

  it('성공하면 횟수를 지운다 — 다음 오류는 다시 5분부터', async () => {
    let clock = 1_000_000;
    const download = failingDownload();
    deps = makeDeps({ download, now: () => clock }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    svc.setRetryHandler(() => undefined);
    await svc.ensureLatest('claude', { manual: false });
    await svc.ensureLatest('claude', { manual: false });
    expect(scheduled.map((s) => s.ms)).toEqual(MANAGED_ENGINE_RETRY_BACKOFF_MS.slice(0, 2));
    download.mockImplementation(async (_u: string, dest: string) => {
      fs.writeFileSync(dest, payload);
      return helperResult(payload);
    });
    expect((await svc.ensureLatest('claude', { manual: false })).outcome).toBe('installed');
    expect(svc.status('claude').nextRetryAt).toBeUndefined();
    expect(scheduled.every((s) => s.cancelled)).toBe(true);
    // 새 판이 나왔는데 받기가 또 실패한다 — 간격은 처음부터다(15분 → 60분으로 이어지지 않는다).
    clock += 10 * 60_000; // 조회 재사용 창(60초) 밖
    latestClaude = '2.1.311';
    download.mockImplementation(async () => { throw new Error('offline'); });
    scheduled = [];
    expect((await svc.ensureLatest('claude', { manual: false })).outcome).toBe('error');
    expect(scheduled.map((s) => s.ms)).toEqual([MANAGED_ENGINE_RETRY_BACKOFF_MS[0]]);
  });

  it('점검 탈락은 다시 받아도 같은 판이라 재시도를 예약하지 않는다', async () => {
    deps = makeDeps({ runProbes: vi.fn(async () => ({ failures: [{ label: '--model sonnet', reason: 'x' }] })) }) as typeof deps;
    const svc = new ManagedEngineService(deps);
    svc.setRetryHandler(() => undefined);
    expect((await svc.ensureLatest('claude', { manual: false })).outcome).toBe('probe-failed');
    expect(scheduled).toEqual([]);
  });

  it('재시도 자리가 없으면(부팅 배선 전 · 시험) 예약하지 않는다', async () => {
    deps = makeDeps({ download: failingDownload() }) as typeof deps;
    await new ManagedEngineService(deps).ensureLatest('claude', { manual: false });
    expect(scheduled).toEqual([]);
  });
});
