import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGED_ENGINE_META_NAME, MANAGED_ENGINE_ROLLBACK_MARK, type ManagedEngineVersionEntry } from '@vibisual/shared';
import {
  claudeReleasePlatformIn,
  codexReleaseTargetIn,
  compareEngineVersions,
  findManagedBin,
  isEngineVersion,
  isManagedEngineBin,
  isMuslLinuxIn,
  managedBinCandidatesIn,
  managedEngineDirIn,
  managedVersionsToPrune,
  pickManagedVersions,
  scanManagedVersions,
} from './managedEngineLayout.js';

/**
 * §4 (앱 전용 엔진) — 폴더가 진실이다: 판 폴더 · 되돌림 표식 · 실행본 자리만 보고 "지금 무엇을 쓰나"를 답한다.
 * 플랫폼은 인자로 넣어 세 OS 를 이 개발기에서 다 본다(멀티플랫폼 규칙).
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-managed-layout-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function plant(engine: 'claude' | 'codex', version: string, opts: { platform?: NodeJS.Platform; rolledBack?: boolean; nested?: boolean } = {}): string {
  const platform = opts.platform ?? process.platform;
  const dir = path.join(managedEngineDirIn(home, engine), 'versions', version);
  const parts = managedBinCandidatesIn(engine, platform)[opts.nested === false ? 1 : 0] ?? [];
  const bin = path.join(dir, ...parts);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, 'bin');
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(dir, MANAGED_ENGINE_META_NAME), JSON.stringify({ version, sha256: 'a'.repeat(64), installedAt: 1000 }));
  if (opts.rolledBack) fs.writeFileSync(path.join(dir, MANAGED_ENGINE_ROLLBACK_MARK), 'x');
  return bin;
}

describe('배포 식별자 — 공식 install.sh/ps1 과 같은 이름', () => {
  it.each([
    ['win32', 'x64', false, 'win32-x64'],
    ['win32', 'arm64', false, 'win32-arm64'],
    ['darwin', 'x64', false, 'darwin-x64'],
    ['darwin', 'arm64', false, 'darwin-arm64'],
    ['linux', 'x64', false, 'linux-x64'],
    ['linux', 'arm64', false, 'linux-arm64'],
    ['linux', 'x64', true, 'linux-x64-musl'],
    ['linux', 'arm64', true, 'linux-arm64-musl'],
  ] as const)('Claude %s/%s musl=%s → %s', (platform, arch, musl, want) => {
    expect(claudeReleasePlatformIn(platform, arch, musl)).toBe(want);
  });

  it('배포본이 없는 조합은 null — 그 PC 에서는 앱 전용 받기를 하지 않는다', () => {
    expect(claudeReleasePlatformIn('freebsd', 'x64', false)).toBeNull();
    expect(claudeReleasePlatformIn('linux', 'ia32', false)).toBeNull();
    expect(codexReleaseTargetIn('win32', 'ia32')).toBeNull();
  });

  it.each([
    ['win32', 'x64', 'x86_64-pc-windows-msvc'],
    ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
    ['darwin', 'x64', 'x86_64-apple-darwin'],
    ['darwin', 'arm64', 'aarch64-apple-darwin'],
    ['linux', 'x64', 'x86_64-unknown-linux-musl'],
    ['linux', 'arm64', 'aarch64-unknown-linux-musl'],
  ] as const)('Codex %s/%s → %s (리눅스는 libc 와 무관하게 musl 정적 빌드)', (platform, arch, want) => {
    expect(codexReleaseTargetIn(platform, arch)).toBe(want);
  });

  it('musl 판정 — glibc 런타임이 보이면 glibc, 아니면 musl 로더 파일로', () => {
    const exists = (f: string): boolean => f === '/lib/libc.musl-x86_64.so.1';
    expect(isMuslLinuxIn('linux', { glibcRuntime: null, exists })).toBe(true);
    expect(isMuslLinuxIn('linux', { glibcRuntime: '2.39', exists })).toBe(false);
    expect(isMuslLinuxIn('linux', { glibcRuntime: null, exists: () => false })).toBe(false);
    expect(isMuslLinuxIn('win32', { glibcRuntime: null, exists: () => true })).toBe(false);
  });
});

describe('판 비교 — 숫자는 숫자로, 정식판이 미리보기판보다 새것', () => {
  it('자릿수가 바뀌는 판올림을 문자열로 비교하지 않는다', () => {
    expect(compareEngineVersions('2.1.99', '2.1.288')).toBeLessThan(0);
    expect(compareEngineVersions('2.1.1000', '2.1.999')).toBeGreaterThan(0);
    expect(compareEngineVersions('2.1.310', '2.1.310')).toBe(0);
  });

  it('같은 숫자면 정식판이 새것이고, 미리보기 번호는 숫자로 잰다', () => {
    expect(compareEngineVersions('0.163.0', '0.163.0-alpha.11')).toBeGreaterThan(0);
    expect(compareEngineVersions('0.163.0-alpha.2', '0.163.0-alpha.11')).toBeLessThan(0);
    expect(compareEngineVersions('0.164.0', '0.163.0')).toBeGreaterThan(0);
  });

  it('판 이름이 아닌 폴더 이름은 판으로 읽지 않는다', () => {
    expect(isEngineVersion('2.1.310')).toBe(true);
    expect(isEngineVersion('0.163.0-alpha.11')).toBe(true);
    expect(isEngineVersion('2.1.310.part-abc')).toBe(false);
    expect(isEngineVersion('<html>')).toBe(false);
  });
});

describe('폴더를 훑어 지금 판 · 앞 판을 고른다', () => {
  it('새 판이 지금 판이고 그다음이 앞 판이다 — 실행본 없는 폴더 · 판 이름 아닌 폴더는 건너뛴다', () => {
    plant('claude', '2.1.300');
    plant('claude', '2.1.310');
    fs.mkdirSync(path.join(managedEngineDirIn(home, 'claude'), 'versions', '2.1.305'), { recursive: true }); // 실행본 없음
    fs.mkdirSync(path.join(managedEngineDirIn(home, 'claude'), 'versions', 'junk'), { recursive: true });
    const entries = scanManagedVersions('claude', { home });
    expect(entries.map((e) => e.version)).toEqual(['2.1.310', '2.1.300']);
    const { active, previous } = pickManagedVersions(entries);
    expect(active?.version).toBe('2.1.310');
    expect(previous?.version).toBe('2.1.300');
    expect(findManagedBin('claude', { home })).toBe(active?.binPath);
  });

  it('되돌린 판은 쓰지 않는다 — 다음 판이 지금 판이 된다', () => {
    plant('claude', '2.1.300');
    plant('claude', '2.1.305');
    plant('claude', '2.1.310', { rolledBack: true });
    const entries = scanManagedVersions('claude', { home });
    expect(entries.find((e) => e.version === '2.1.310')?.rolledBack).toBe(true);
    const { active, previous } = pickManagedVersions(entries);
    expect(active?.version).toBe('2.1.305');
    expect(previous?.version).toBe('2.1.300');
  });

  it('깔린 판이 전부 되돌려졌으면 가장 새것을 쓴다 — 앱 전용을 두고 사용자 설치본으로 조용히 넘어가지 않는다', () => {
    plant('claude', '2.1.310', { rolledBack: true });
    expect(pickManagedVersions(scanManagedVersions('claude', { home })).active?.version).toBe('2.1.310');
  });

  it('코덱스는 새 패키지(bin/codex) · 옛 패키지(맨 위 codex) 둘 다 실행본으로 읽는다', () => {
    const nested = plant('codex', '0.164.0', { platform: 'win32' });
    const flat = plant('codex', '0.163.0', { platform: 'win32', nested: false });
    expect(nested.endsWith(path.join('bin', 'codex.exe'))).toBe(true);
    expect(flat.endsWith('codex.exe')).toBe(true);
    const entries = scanManagedVersions('codex', { home, platform: 'win32' });
    expect(entries.map((e) => e.version)).toEqual(['0.164.0', '0.163.0']);
  });

  it('비어 있으면 아무것도 쓰지 않는다(종전 탐색으로 떨어진다)', () => {
    expect(findManagedBin('claude', { home })).toBeNull();
    expect(scanManagedVersions('codex', { home })).toEqual([]);
  });
});

describe('정리 — 지금 판 + 앞 판, 그리고 지금보다 새로 되돌린 판은 남긴다', () => {
  const e = (version: string, rolledBack = false): ManagedEngineVersionEntry => ({ version, binPath: `/x/${version}`, installedAt: 0, ...(rolledBack ? { rolledBack } : {}) });

  it('세 판이면 가장 오래된 것만 지운다', () => {
    expect(managedVersionsToPrune([e('3'), e('2'), e('1')]).map((x) => x.version)).toEqual(['1']);
  });

  it('지금보다 새로 되돌린 판은 지우지 않는다 — 그 표식이 "다시 가지 마라"의 유일한 기록이다', () => {
    const entries = [e('4', true), e('3'), e('2'), e('1')];
    expect(managedVersionsToPrune(entries).map((x) => x.version)).toEqual(['1']);
  });

  it('지금보다 오래된 되돌린 판은 지운다', () => {
    const entries = [e('5'), e('4'), e('3', true)];
    expect(managedVersionsToPrune(entries).map((x) => x.version)).toEqual(['3']);
  });
});

describe('앱 전용 폴더 판정 — 대소문자는 그 플랫폼이 무시할 때만 접는다', () => {
  it('판 폴더 · 대기 폴더 안의 경로만 앱 전용이다', () => {
    const inside = path.join(managedEngineDirIn(home, 'claude'), 'versions', '2.1.310', 'claude.exe');
    expect(isManagedEngineBin('claude', inside, home)).toBe(true);
    expect(isManagedEngineBin('codex', inside, home)).toBe(false);
    expect(isManagedEngineBin('claude', path.join(home, '.local', 'bin', 'claude'), home)).toBe(false);
    expect(isManagedEngineBin('claude', 'claude', home)).toBe(false);
  });
});
