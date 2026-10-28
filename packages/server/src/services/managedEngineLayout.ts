import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANAGED_ENGINE_DIR_NAME,
  MANAGED_ENGINE_KEEP_VERSIONS,
  MANAGED_ENGINE_META_NAME,
  MANAGED_ENGINE_ROLLBACK_MARK,
  type ManagedEngineId,
  type ManagedEngineVersionEntry,
} from '@vibisual/shared';
import { isWithinRoot } from './pathKey.js';

/**
 * §4 (앱 전용 엔진) — 앱 전용 폴더 배치와 지금 판. **동기 · 서비스 의존 없음** — `claudeBin`·`codexCli` 가 이 모듈만 본다
 * (받기 서비스를 import 하면 top-level 로드 순서가 꼬인다). 폴더가 진실이다 — 판을 적어 두지 않고 매번 훑는다(§3.2.3).
 * 받다 만 것·탈락은 `staging/` 이라 `versions/<판>/` 에 있으면 점검 통과다. 플랫폼은 인자.
 */

/** 앱 전용 엔진 뿌리(`<home>/.vibisual/cli-engines`). */
export function managedEngineRootIn(home: string): string {
  return path.join(home, '.vibisual', MANAGED_ENGINE_DIR_NAME);
}

/** 엔진 하나의 앱 전용 폴더(`<home>/.vibisual/cli-engines/<engine>`). */
export function managedEngineDirIn(home: string, engine: ManagedEngineId): string {
  return path.join(managedEngineRootIn(home), engine);
}

/** 지금 사용자 홈 기준의 앱 전용 폴더. 홈은 부를 때마다 읽는다(시험이 `HOME`/`USERPROFILE` 을 갈아 끼운다). */
export function managedEngineDir(engine: ManagedEngineId): string {
  return managedEngineDirIn(os.homedir(), engine);
}

/** 점검을 통과한 판들이 사는 곳. */
export function managedVersionsDir(engine: ManagedEngineId, home: string = os.homedir()): string {
  return path.join(managedEngineDirIn(home, engine), 'versions');
}

/** 받는 중 · 점검에서 떨어진 판이 기다리는 곳. */
export function managedStagingDir(engine: ManagedEngineId, home: string = os.homedir()): string {
  return path.join(managedEngineDirIn(home, engine), 'staging');
}

/** Claude Code 릴리스 저장소의 플랫폼 이름(`manifest.json` `platforms` 키) — 공식 install.sh/ps1 과 같다. musl 이면 `-musl`, 배포본 없는 조합은 null. */
export function claudeReleasePlatformIn(platform: NodeJS.Platform, arch: string, musl: boolean): string | null {
  const a = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!a) return null;
  if (platform === 'win32') return `win32-${a}`;
  if (platform === 'darwin') return `darwin-${a}`;
  if (platform === 'linux') return musl ? `linux-${a}-musl` : `linux-${a}`;
  return null;
}

/** 코덱스 패키지 타깃 삼중항. 리눅스는 libc 무관 `-unknown-linux-musl`(공식 install.sh 도 musl 정적 빌드만 받는다), Windows 는 `-pc-windows-msvc`. */
export function codexReleaseTargetIn(platform: NodeJS.Platform, arch: string): string | null {
  const a = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!a) return null;
  if (platform === 'win32') return `${a}-pc-windows-msvc`;
  if (platform === 'darwin') return `${a}-apple-darwin`;
  if (platform === 'linux') return `${a}-unknown-linux-musl`;
  return null;
}

/** 리눅스가 musl 인가 — 공식 install.sh 처럼 musl 로더 파일을 본다. glibc 런타임 판(`glibcVersionRuntime`)이 보이면 그것이 먼저다(glibc 위에 깐 musl 로더로 오판하지 않게). */
export function isMuslLinuxIn(
  platform: NodeJS.Platform,
  probe: { glibcRuntime: string | null; exists: (file: string) => boolean },
): boolean {
  if (platform !== 'linux') return false;
  if (probe.glibcRuntime) return false;
  return probe.exists('/lib/libc.musl-x86_64.so.1') || probe.exists('/lib/libc.musl-aarch64.so.1');
}

let hostMuslCache: boolean | null = null;

/** 이 기기가 musl 리눅스인가(한 번 재고 기억한다 — `process.report` 는 가볍지 않다). */
export function hostIsMusl(): boolean {
  if (hostMuslCache !== null) return hostMuslCache;
  let glibc: string | null = null;
  if (process.platform === 'linux') {
    try {
      const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: unknown } } | undefined;
      const v = report?.header?.glibcVersionRuntime;
      glibc = typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
      glibc = null;
    }
  }
  hostMuslCache = isMuslLinuxIn(process.platform, {
    glibcRuntime: glibc,
    exists: (file) => {
      try { return fs.statSync(file).isFile(); } catch { return false; }
    },
  });
  return hostMuslCache;
}

/** 이 기기의 배포 식별자(엔진별). 배포본이 없는 조합이면 null — 그 PC 에서는 앱 전용 받기를 하지 않는다. */
export function hostPlatformTarget(engine: ManagedEngineId): string | null {
  return engine === 'claude'
    ? claudeReleasePlatformIn(process.platform, process.arch, hostIsMusl())
    : codexReleaseTargetIn(process.platform, process.arch);
}

/** 판 폴더 안 실행본 후보(앞에서부터, 경로 마디 배열). 코덱스 새 패키지는 `bin/codex(.exe)`, 옛 패키지는 맨 위 `codex(.exe)`. */
export function managedBinCandidatesIn(engine: ManagedEngineId, platform: NodeJS.Platform): string[][] {
  const exe = platform === 'win32' ? '.exe' : '';
  return engine === 'claude'
    ? [[`claude${exe}`]]
    : [['bin', `codex${exe}`], [`codex${exe}`]];
}

const VERSION_RE = /^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?$/;

/** 판 이름으로 쓸 수 있는 글자인가("2.1.310" · "0.163.0-alpha.11"). 폴더 이름이 곧 판이라 다른 것은 건너뛴다. */
export function isEngineVersion(s: string): boolean {
  return VERSION_RE.test(s);
}

/** 판 비교(음수·0·양수). 숫자 마디는 숫자로 비교한다(문자열이면 `2.1.99` 가 `2.1.288` 보다 새것이 된다). 같으면 정식판이 미리보기판보다 새것. */
export function compareEngineVersions(a: string, b: string): number {
  const split = (v: string): { core: number[]; pre: string } => {
    const dash = v.indexOf('-');
    const core = (dash >= 0 ? v.slice(0, dash) : v).split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { core, pre: dash >= 0 ? v.slice(dash + 1) : '' };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i += 1) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xs = x.pre.split('.');
  const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    const xp = xs[i];
    const yp = ys[i];
    if (xp === undefined) return -1;
    if (yp === undefined) return 1;
    const xn = /^\d+$/.test(xp) ? Number(xp) : null;
    const yn = /^\d+$/.test(yp) ? Number(yp) : null;
    if (xn !== null && yn !== null) {
      if (xn !== yn) return xn - yn;
    } else if (xp !== yp) {
      return xp < yp ? -1 : 1;
    }
  }
  return 0;
}

/** 판 폴더의 설치 메타 — 무엇을 어디서 받았는지. 올모델 엔진의 같은 이름 메타와 같은 규약. */
export interface ManagedEngineMeta {
  engine: ManagedEngineId;
  version: string;
  /** 받은 배포 식별자(`win32-x64` · `x86_64-pc-windows-msvc`). */
  platformTarget: string;
  /** 받은 파일의 SHA-256(Claude = 실행본 · 코덱스 = 패키지 tar.gz). */
  sha256: string;
  /** 받은 주소 — 공식 배포처라는 것을 나중에도 확인할 수 있게 남긴다. */
  source: string;
  /** 받은 파일 크기(바이트). */
  size: number;
  installedAt: number;
}

export function readManagedMeta(dir: string): ManagedEngineMeta | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, MANAGED_ENGINE_META_NAME), 'utf8')) as Partial<ManagedEngineMeta>;
    if (typeof j.version !== 'string' || typeof j.sha256 !== 'string') return null;
    return {
      engine: j.engine === 'codex' ? 'codex' : 'claude',
      version: j.version,
      platformTarget: typeof j.platformTarget === 'string' ? j.platformTarget : '',
      sha256: j.sha256,
      source: typeof j.source === 'string' ? j.source : '',
      size: typeof j.size === 'number' ? j.size : 0,
      installedAt: typeof j.installedAt === 'number' ? j.installedAt : 0,
    };
  } catch {
    return null;
  }
}

function isRunnableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform === 'win32') return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 판 폴더 하나에서 실행본 절대 경로 — 없으면 null. */
export function findManagedBinIn(versionDir: string, engine: ManagedEngineId, platform: NodeJS.Platform = process.platform): string | null {
  for (const parts of managedBinCandidatesIn(engine, platform)) {
    const file = path.join(versionDir, ...parts);
    if (isRunnableFile(file, platform)) return file;
  }
  return null;
}

export interface ManagedScanOptions {
  home?: string;
  platform?: NodeJS.Platform;
}

/** `versions/` 를 훑어 깔린 판 전부(새 판 먼저). 실행본이 없는 폴더 · 판 이름이 아닌 폴더는 건너뛴다. */
export function scanManagedVersions(engine: ManagedEngineId, opts: ManagedScanOptions = {}): ManagedEngineVersionEntry[] {
  const platform = opts.platform ?? process.platform;
  const dir = managedVersionsDir(engine, opts.home ?? os.homedir());
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ManagedEngineVersionEntry[] = [];
  for (const name of names) {
    if (!isEngineVersion(name)) continue;
    const versionDir = path.join(dir, name);
    const binPath = findManagedBinIn(versionDir, engine, platform);
    if (!binPath) continue;
    let installedAt = readManagedMeta(versionDir)?.installedAt ?? 0;
    if (!installedAt) {
      try { installedAt = fs.statSync(versionDir).mtimeMs; } catch { installedAt = 0; }
    }
    const rolledBack = fs.existsSync(path.join(versionDir, MANAGED_ENGINE_ROLLBACK_MARK));
    out.push({ version: name, binPath, installedAt, ...(rolledBack ? { rolledBack: true } : {}) });
  }
  out.sort((x, y) => compareEngineVersions(y.version, x.version));
  return out;
}

/**
 * 지금 판 = 되돌림 표식 없는 판 중 가장 새것, 앞 판 = 그다음. 표식은 더 새 판이 깔릴 때까지 지킨다.
 * 전부 표식이면 가장 새것을 쓴다 — 안 그러면 사용자 설치본으로 조용히 넘어간다.
 */
export function pickManagedVersions(entries: readonly ManagedEngineVersionEntry[]): {
  active: ManagedEngineVersionEntry | null;
  previous: ManagedEngineVersionEntry | null;
} {
  const usable = entries.filter((e) => !e.rolledBack);
  if (usable.length === 0) return { active: entries[0] ?? null, previous: null };
  return { active: usable[0] ?? null, previous: usable[1] ?? null };
}

/**
 * 지울 판 — 지금 판 + 앞 판(`keep` 벌)은 남기고, **지금 판보다 새로 되돌린 판도 남긴다**.
 * 그 폴더의 표식이 "다시 가지 마라"의 유일한 기록이라, 지우면 다음 확인이 그 판을 다시 받아 되돌린 일을 무른다.
 * 그 판은 더 새 판이 깔려 지금 판보다 오래되면 그때 지워진다.
 */
export function managedVersionsToPrune(
  entries: readonly ManagedEngineVersionEntry[],
  keep: number = MANAGED_ENGINE_KEEP_VERSIONS,
): ManagedEngineVersionEntry[] {
  const { active } = pickManagedVersions(entries);
  if (!active) return [];
  const kept = new Set<string>(entries.filter((e) => !e.rolledBack).slice(0, Math.max(1, keep)).map((e) => e.version));
  for (const e of entries) {
    if (e.rolledBack && compareEngineVersions(e.version, active.version) > 0) kept.add(e.version);
  }
  kept.add(active.version);
  return entries.filter((e) => !kept.has(e.version));
}

/** 지금 쓸 앱 전용 실행본 — 없으면 null(아직 안 받았거나 폴더가 비었다). */
export function findManagedBin(engine: ManagedEngineId, opts: ManagedScanOptions = {}): string | null {
  return pickManagedVersions(scanManagedVersions(engine, opts)).active?.binPath ?? null;
}

/** 이 경로가 그 엔진의 앱 전용 폴더 안인가(판 · 대기 폴더 모두). 대소문자는 그 플랫폼이 무시할 때만 접는다(`pathKey`). */
export function isManagedEngineBin(engine: ManagedEngineId, binPath: string, home: string = os.homedir()): boolean {
  if (!binPath || !path.isAbsolute(binPath)) return false;
  return isWithinRoot(binPath, managedEngineDirIn(home, engine));
}
