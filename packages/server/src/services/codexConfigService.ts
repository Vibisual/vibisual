import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathKey } from '@vibisual/shared';
import type {
  CodexConfigLayer,
  CodexConfigLayerValues,
  CodexEffectiveConfig,
  PlatformName,
} from '@vibisual/shared';
import { codexHome } from './codexCli.js';
import { HOST_PLATFORM } from './pathKey.js';

/**
 * §5.25 (G-2) — 코덱스가 **이 작업 폴더에서** 읽을 설정 파일들을 겹 순서대로 **읽기만** 한다.
 *
 * 설정 창의 코덱스 칸(추론 강도·웹 검색·답변 길이·네트워크)을 비워 두면 우리는 `-c` 를 붙이지 않고,
 * 그때 무엇이 도는지는 코덱스가 설정 파일을 겹쳐 정한다. 그 값을 화면이 말하려면 코덱스와 **같은
 * 순서로** 파일을 찾아야 한다. 순서는 코덱스 공개 문서(Config basics · Configuration reference)
 * 그대로다 — 고른 프로필 → 신뢰한 프로젝트의 `.codex/config.toml`(가까운 쪽이 이김) → 사용자
 * `$CODEX_HOME/config.toml` → 시스템 `/etc/codex/config.toml`(Unix) → 모델·내장값(이 파일 밖, 클라가 채움).
 *
 * **TOML 전체를 해석하지 않는다.** 필요한 키 몇 개만 훑는다 — 코덱스가 새 키·새 표를 더해도 우리가
 * 깨지지 않게. 못 알아본 값은 없는 것으로 보고 지어내지 않는다.
 *
 * **고치지 않는다.** 남의 설정 파일이다(§5.25 (G) 의 원칙).
 */

/** 코덱스 설정 파일 이름 — 사용자·프로젝트·시스템 셋 다 같다. */
const CODEX_CONFIG_FILENAME = 'config.toml';
/** 프로젝트 설정이 사는 폴더. */
const CODEX_PROJECT_DIRNAME = '.codex';
/** 시스템 설정 파일 — 코덱스 문서가 Unix 에만 적어 둔 자리다. Windows 에는 대응 자리가 문서에 없다. */
const CODEX_SYSTEM_CONFIG_POSIX = '/etc/codex/config.toml';
/** `project_root_markers` 를 적지 않았을 때 코덱스가 프로젝트 루트를 찾는 표식. */
const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const;
/** 프로젝트 설정을 읽게 해 주는 신뢰 등급 값. */
const TRUSTED_LEVEL = 'trusted';

type TomlValue = string | boolean | TomlValue[] | { [key: string]: TomlValue } | null;

/** 한 파일에서 훑어 낸 것. */
export interface CodexConfigScan {
  values: CodexConfigLayerValues;
  /** 루트의 `profile = "<이름>"`. */
  profile?: string;
  /** `[profiles.<이름>]` 표마다 우리 칸과 겹치는 값. */
  profiles: Map<string, CodexConfigLayerValues>;
  /** 루트의 `project_root_markers`. 빈 배열도 뜻이 있다(루트를 찾지 않음). */
  projectRootMarkers?: string[];
  /** `[projects.<경로>] trust_level` — 적힌 순서 그대로. */
  trust: Array<{ path: string; level: string }>;
}

/** 우리 설정 창과 겹치는 키 경로(표 경로 기준) → 값 칸. */
function applyValue(target: CodexConfigLayerValues, keys: readonly string[], value: TomlValue): boolean {
  const [a, b] = keys;
  if (keys.length === 1 && typeof value === 'string' && value.trim()) {
    if (a === 'model_reasoning_effort') { target.reasoningEffort = value.trim(); return true; }
    if (a === 'model_verbosity') { target.modelVerbosity = value.trim(); return true; }
    if (a === 'web_search') { target.webSearch = value.trim(); return true; }
  }
  if (keys.length === 2 && a === 'sandbox_workspace_write' && b === 'network_access' && typeof value === 'boolean') {
    target.networkAccess = value;
    return true;
  }
  return false;
}

/** 인라인 표(`a = { b = 1 }`)를 잎 단위로 편다. 배열은 펴지 않는다. */
function forEachLeaf(keys: string[], value: TomlValue, visit: (keys: string[], value: TomlValue) => void): void {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) forEachLeaf([...keys, k], v, visit);
    return;
  }
  visit(keys, value);
}

/** 작은 TOML 훑개 — 표 머리·키·값만 읽고 모르는 모양은 그 줄을 건너뛴다. */
class TomlScanner {
  private pos = 0;
  constructor(private readonly src: string) {}

  /** 지금 자리의 글자. 게터로 두면 TS 가 비교 뒤에 값을 좁혀 버려 메서드로 둔다. */
  private peek(): string {
    return this.src[this.pos] ?? '';
  }

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private skipInline(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }

  /** 공백·줄바꿈·주석을 건너뛴다(배열 안처럼 줄을 넘어도 되는 자리). */
  private skipBlank(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { this.pos++; continue; }
      if (c === '#') { this.skipLine(); continue; }
      return;
    }
  }

  private skipLine(): void {
    while (!this.eof() && this.peek() !== '\n') this.pos++;
  }

  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private basicString(): string {
    this.pos++; // "
    let out = '';
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"') { this.pos++; return out; }
      if (c === '\n') break;
      if (c === '\\') {
        const n = this.src[this.pos + 1] ?? '';
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' };
        if (n in map) { out += map[n]; this.pos += 2; continue; }
        if (n === 'u' || n === 'U') {
          const len = n === 'u' ? 4 : 8;
          const hex = this.src.slice(this.pos + 2, this.pos + 2 + len);
          const code = /^[0-9a-fA-F]+$/.test(hex) && hex.length === len ? Number.parseInt(hex, 16) : NaN;
          if (!Number.isNaN(code) && code <= 0x10ffff) { out += String.fromCodePoint(code); this.pos += 2 + len; continue; }
        }
        throw new Error('bad escape');
      }
      out += c;
      this.pos++;
    }
    throw new Error('unterminated string');
  }

  private literalString(): string {
    const end = this.src.indexOf("'", this.pos + 1);
    const nl = this.src.indexOf('\n', this.pos + 1);
    if (end < 0 || (nl >= 0 && nl < end)) throw new Error('unterminated string');
    const out = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    return out;
  }

  /** `"""…"""` · `'''…'''` — 우리 키에는 쓰이지 않지만 줄을 넘으므로 끝까지 건너뛰어야 한다. */
  private multilineString(delim: string): string {
    const start = this.pos + 3;
    let end = this.src.indexOf(delim, start);
    // 기본 문자열은 `\"""` 가 끝이 아니다.
    while (delim === '"""' && end > 0 && this.src[end - 1] === '\\') end = this.src.indexOf(delim, end + 1);
    if (end < 0) { this.pos = this.src.length; throw new Error('unterminated multiline string'); }
    // 닫는 따옴표 뒤에 따옴표가 두 개까지 더 붙을 수 있다(`""""` 는 내용의 따옴표 하나 + 끝).
    while (this.src[end + 3] === delim[0] && end + 3 < this.src.length) end++;
    this.pos = end + 3;
    return this.src.slice(start, end);
  }

  private keySegment(): string {
    const c = this.peek();
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    const m = /^[A-Za-z0-9_-]+/.exec(this.src.slice(this.pos, this.pos + 256));
    if (!m) throw new Error('bad key');
    this.pos += m[0].length;
    return m[0];
  }

  private dottedKey(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipInline();
      keys.push(this.keySegment());
      this.skipInline();
      if (this.peek() !== '.') return keys;
      this.pos++;
    }
  }

  private value(): TomlValue {
    const c = this.peek();
    if (this.startsWith('"""') || this.startsWith("'''")) return this.multilineString(this.src.slice(this.pos, this.pos + 3));
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    if (c === '[') {
      this.pos++;
      const arr: TomlValue[] = [];
      for (;;) {
        this.skipBlank();
        if (this.eof()) throw new Error('unterminated array');
        if (this.peek() === ']') { this.pos++; return arr; }
        arr.push(this.value());
        this.skipBlank();
        if (this.peek() === ',') { this.pos++; continue; }
        if (this.peek() === ']') { this.pos++; return arr; }
        throw new Error('bad array');
      }
    }
    if (c === '{') {
      this.pos++;
      const table: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
      for (;;) {
        this.skipInline();
        if (this.peek() === '}') { this.pos++; return table; }
        const keys = this.dottedKey();
        if (this.peek() !== '=') throw new Error('bad inline table');
        this.pos++;
        this.skipInline();
        const v = this.value();
        let cursor = table;
        for (const k of keys.slice(0, -1)) {
          const next = cursor[k];
          if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[k] = Object.create(null) as { [key: string]: TomlValue };
          cursor = cursor[k] as { [key: string]: TomlValue };
        }
        cursor[keys[keys.length - 1]!] = v;
        this.skipInline();
        if (this.peek() === ',') { this.pos++; continue; }
        if (this.peek() === '}') { this.pos++; return table; }
        throw new Error('bad inline table');
      }
    }
    const word = /^[^\s,\]}#]+/.exec(this.src.slice(this.pos, this.pos + 256));
    if (!word) throw new Error('bad value');
    this.pos += word[0].length;
    if (word[0] === 'true') return true;
    if (word[0] === 'false') return false;
    return null; // 숫자·날짜 — 우리 키에는 없다.
  }

  /** 문서를 끝까지 훑으며 (표 경로 + 키 경로, 값) 을 넘긴다. 배열 표(`[[x]]`) 안의 키는 넘기지 않는다. */
  scan(visit: (keys: string[], value: TomlValue) => void): void {
    let table: string[] = [];
    let inArrayTable = false;
    while (!this.eof()) {
      this.skipBlank();
      if (this.eof()) return;
      const lineStart = this.pos;
      try {
        if (this.peek() === '[') {
          const isArray = this.startsWith('[[');
          this.pos += isArray ? 2 : 1;
          const keys = this.dottedKey();
          if (!this.startsWith(isArray ? ']]' : ']')) throw new Error('bad header');
          this.pos += isArray ? 2 : 1;
          table = keys;
          inArrayTable = isArray;
          this.skipLine();
          continue;
        }
        const keys = this.dottedKey();
        if (this.peek() !== '=') throw new Error('bad key/value');
        this.pos++;
        this.skipInline();
        const v = this.value();
        if (!inArrayTable) visit([...table, ...keys], v);
        this.skipLine();
      } catch {
        // 못 알아본 줄 — 그 줄만 버리고 다음 줄에서 다시 맞춘다(여러 줄 문자열은 이미 끝까지 넘겼다).
        if (this.pos <= lineStart) this.pos = lineStart + 1;
        this.skipLine();
      }
    }
  }
}

/**
 * 설정 파일 원문 → 우리 칸과 겹치는 값. 순수 함수 — 파일을 읽지 않는다.
 *
 * 한 파일 안에서 같은 키가 두 번 나오면 뒤의 것을 쓴다(코덱스는 그런 파일을 거부하지만, 거부된
 * 파일의 값을 우리가 따로 지어낼 이유도 없다 — 어느 쪽이든 화면이 틀릴 일은 드물다).
 */
export function scanCodexConfigToml(raw: string): CodexConfigScan {
  const out: CodexConfigScan = { values: {}, profiles: new Map(), trust: [] };
  new TomlScanner(raw.replace(/^\uFEFF/, '')).scan((keys, value) => {
    forEachLeaf(keys, value, (leaf, v) => {
      if (applyValue(out.values, leaf, v)) return;
      const [head, name, ...rest] = leaf;
      if (leaf.length === 1 && head === 'profile' && typeof v === 'string' && v.trim()) {
        out.profile = v.trim();
        return;
      }
      if (leaf.length === 1 && head === 'project_root_markers' && Array.isArray(v)) {
        out.projectRootMarkers = v.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
        return;
      }
      if (head === 'projects' && name !== undefined && rest.length === 1 && rest[0] === 'trust_level' && typeof v === 'string') {
        out.trust.push({ path: name, level: v.trim() });
        return;
      }
      if (head === 'profiles' && name !== undefined && rest.length > 0) {
        const values = out.profiles.get(name) ?? {};
        if (applyValue(values, rest, v)) out.profiles.set(name, values);
      }
    });
  });
  return out;
}

/** `\\?\C:\x` · `\\?\UNC\srv\share` 같은 확장 경로 접두사를 뗀다 — 설정 파일의 키에는 붙어 있지 않다. */
export function stripExtendedPathPrefix(p: string): string {
  if (/^[\\/]{2}\?[\\/]UNC[\\/]/i.test(p)) return `\\\\${p.slice(8)}`;
  if (/^[\\/]{2}\?[\\/]/.test(p)) return p.slice(4);
  return p;
}

function hasValues(values: CodexConfigLayerValues): boolean {
  return Object.keys(values).length > 0;
}

export interface ReadCodexEffectiveConfigInput {
  /** 코덱스를 띄울 작업 폴더(`codex exec -C`). */
  cwd: string;
  /** `$CODEX_HOME` 또는 `~/.codex`. */
  codexHomeDir: string;
  platform: PlatformName;
  /** 없거나 못 읽으면 `null`. */
  readFile?: (file: string) => string | null;
  exists?: (file: string) => boolean;
  now?: number;
}

function defaultReadFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function defaultExists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/**
 * 코덱스가 이 작업 폴더에서 겹칠 설정 파일들 — **이기는 순서**로.
 *
 * - 프로젝트 루트는 `project_root_markers`(사용자 → 시스템 파일, 없으면 `.git`)가 처음 보이는 조상이다.
 *   못 찾으면 작업 폴더 자신이 루트다. 빈 배열이면 찾지 않는다.
 * - 프로젝트 파일은 작업 폴더 → 루트 순서(가까운 쪽이 이김)이고, **작업 폴더나 루트가 `trusted`
 *   일 때만** 읽는다. 신뢰 목록은 사용자 → 시스템 파일에서 찾고, 작업 폴더 항목이 루트 항목보다 먼저다.
 * - 경로 비교는 `pathKey(platform)` — Windows 코덱스는 키를 소문자로 적고, Linux 는 대소문자가 다르면
 *   다른 폴더다.
 * - 프로필은 앞의 겹들 중 가장 이기는 `profile = ` 이 고른 이름의 표를 같은 순서로 모은다.
 */
export function readCodexEffectiveConfig(input: ReadCodexEffectiveConfigInput): CodexEffectiveConfig {
  const { platform, codexHomeDir } = input;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const readFile = input.readFile ?? defaultReadFile;
  const exists = input.exists ?? defaultExists;
  const cwd = stripExtendedPathPrefix(input.cwd);
  const key = (x: string): string => pathKey(stripExtendedPathPrefix(x), platform);

  const read = (file: string): CodexConfigScan | null => {
    const raw = readFile(file);
    return raw === null ? null : scanCodexConfigToml(raw);
  };

  const userPath = p.join(codexHomeDir, CODEX_CONFIG_FILENAME);
  const user = read(userPath);
  const systemPath = platform === 'win32' ? null : CODEX_SYSTEM_CONFIG_POSIX;
  const system = systemPath ? read(systemPath) : null;

  const markers = user?.projectRootMarkers ?? system?.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS];
  let root = cwd;
  if (markers.length > 0) {
    for (let dir = cwd; ; ) {
      if (markers.some((m) => exists(p.join(dir, m)))) { root = dir; break; }
      const parent = p.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const trustOf = (dir: string): string | undefined => {
    const k = key(dir);
    for (const scan of [user, system]) {
      const hit = scan?.trust.find((t) => key(t.path) === k);
      if (hit) return hit.level;
    }
    return undefined;
  };
  const trusted = (trustOf(cwd) ?? trustOf(root)) === TRUSTED_LEVEL;

  const files: Array<{ source: 'project' | 'user' | 'system'; path: string; scan: CodexConfigScan }> = [];
  if (trusted) {
    const rootKey = key(root);
    const userKey = key(userPath);
    for (let dir = cwd; ; ) {
      const file = p.join(dir, CODEX_PROJECT_DIRNAME, CODEX_CONFIG_FILENAME);
      // 작업 폴더가 홈이면 프로젝트 파일이 곧 사용자 파일이다 — 두 번 세지 않는다.
      if (key(file) !== userKey) {
        const scan = read(file);
        if (scan) files.push({ source: 'project', path: file, scan });
      }
      const parent = p.dirname(dir);
      if (key(dir) === rootKey || parent === dir) break;
      dir = parent;
    }
  }
  if (user) files.push({ source: 'user', path: userPath, scan: user });
  if (system && systemPath) files.push({ source: 'system', path: systemPath, scan: system });

  const layers: CodexConfigLayer[] = [];
  const profileName = files.find((f) => f.scan.profile)?.scan.profile;
  if (profileName) {
    for (const f of files) {
      const values = f.scan.profiles.get(profileName);
      if (values && hasValues(values)) layers.push({ source: 'profile', profile: profileName, path: f.path, values });
    }
  }
  for (const f of files) layers.push({ source: f.source, path: f.path, values: f.scan.values });

  return { cwd, layers, checkedAt: input.now ?? Date.now() };
}

/** 지금 프로세스 기준으로 읽는다. 호출마다 새로 읽는다 — 파일 몇 개라 캐시가 틀리는 비용이 더 크다. */
export function readCodexEffectiveConfigFor(cwd: string): CodexEffectiveConfig {
  return readCodexEffectiveConfig({ cwd, codexHomeDir: codexHome(), platform: HOST_PLATFORM });
}
