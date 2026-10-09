/**
 * pathLock.ts — §5.3 #12-3 · 자물쇠의 **공용 판정기**.
 *
 * 버블 위 우클릭으로 건 자물쇠(파일·폴더·호스트)에 **어느 AI 의 어느 도구 호출이 닿는가**를 정한다.
 * 승인 창구(`/api/permission-check` 의 클로드·코덱스 갈래 · 로컬 모델의 `requestTool`)와 훅 세션에
 * 돌려주는 `ask` 가 모두 이 한 함수(`findToolLockHits`)를 부른다 — 두 벌이 되면 한쪽에서는 잠겼는데
 * 다른 쪽에서는 열리고, 사용자에게는 "잠갔는데 열렸다"로만 보인다(§5.22 `classifyToolRisk` 와 같은 규율).
 *
 * 판정의 기울기는 감사 경계와 **반대**다. 그쪽은 "모르는 것을 위험으로 넘겨짚지 않는다"였지만,
 * 자물쇠는 사용자가 "여기는 묻고 열어라"라고 손으로 그은 선이라 **놓치는 쪽의 대가가 더 크다** —
 * 잠긴 곳을 가리키는 낱말이 보이면 센다. 더 묻는 대가는 카드 한 장이다.
 *
 * 순수 함수 모듈(디스크 접근 ❌ · `process.platform` 읽기 ❌ — 플랫폼·홈은 **인자로 받는다**)이라
 * 개발기 한 대에서 세 OS 를 전부 단위 테스트할 수 있다(멀티플랫폼 1축 — `pathLock.test.ts`).
 */
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import {
  normalizeShellCommandName,
  readShellCdTarget,
  splitShellSegments,
  tokenizeShellCommand,
} from './bashCommandPaths.js';
import { webHostFromNodeKey, webHostFromUrl } from './webToolEntry.js';
import {
  AUDIT_HOME_PREFIX_PATTERN,
  AUDIT_MSYS_PATH_PATTERN,
  AUDIT_PATCH_INPUT_KEYS,
  AUDIT_PATCH_TOOLS,
  AUDIT_PATH_INPUT_KEYS,
  AUDIT_TOKEN_FLAG_VALUE_PATTERN,
  AUDIT_URL_PATTERN,
  extractPatchFileOps,
  PATH_LOCK_FIND_ACTION_FLAGS,
  PATH_LOCK_LABEL_MAX_CHARS,
  PATH_LOCK_LIST_TOOLS,
  PATH_LOCK_MAX_PER_PROJECT,
  PATH_LOCK_RECURSIVE_FLAG_PATTERNS,
  PATH_LOCK_RECURSIVE_READ_COMMANDS,
  PATH_LOCK_SEARCH_TOOLS,
  PATH_LOCK_TREE_ALL_ARGS_COMMANDS,
  PATH_LOCK_TREE_READ_COMMANDS,
  PATH_LOCK_TREE_SOURCE_DEST_COMMANDS,
  PATH_LOCK_URL_INPUT_KEYS,
  PATH_LOCK_WRITE_TOOLS,
} from './constants.js';
import type {
  BubbleData,
  PathLock,
  PathLockAccess,
  PathLockHit,
  PathLockKind,
  PathLockTarget,
} from './types.js';

/** 자물쇠 종류 전부(외부 입력 검증용). */
export const PATH_LOCK_KINDS: readonly PathLockKind[] = ['file', 'folder', 'host'];

/** 프로젝트 이름 → 그 탭이 건 자물쇠들. 스냅샷(`GraphSnapshot.pathLocks`)과 같은 모양이다. */
export type PathLocksByProject = Readonly<Record<string, readonly PathLock[]>>;

// ─────────────────────────────────────────────────────────────────────────────
// 경로 모양
// ─────────────────────────────────────────────────────────────────────────────

/** 슬래시 모양으로 정규화한 경로가 절대경로인가(드라이브 · UNC · POSIX 루트). */
function isAbsoluteLockPath(shaped: string): boolean {
  return /^[A-Za-z]:\//.test(shaped) || shaped.startsWith('/');
}

/** `.`/`..` 를 접는다. 루트 위로는 올라가지 않는다(§5.22 `auditCollapsePath` 와 같은 규칙). */
function collapseLockPath(shaped: string): string {
  let prefix = '';
  let rest = shaped;
  const drive = shaped.match(/^[A-Za-z]:\//);
  if (drive) {
    prefix = drive[0];
    rest = shaped.slice(prefix.length);
  } else if (shaped.startsWith('//')) {
    prefix = '//';
    rest = shaped.slice(2);
  } else if (shaped.startsWith('/')) {
    prefix = '/';
    rest = shaped.slice(1);
  }
  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `${prefix}${out.join('/')}`;
}

/**
 * 호출 안의 경로 낱말 하나를 자물쇠와 견줄 수 있는 **절대경로**로 편다. 못 펴면 `null`.
 *
 * - `~` → `homeDir`(모르면 못 편다 — 모르는 홈을 지어내지 않는다)
 * - win32 의 msys 경로(`/c/x`) → `c:/x`(Git Bash 로 도는 셸이 이 모양을 쓴다)
 * - 상대경로 → `base`(그 호출의 cwd)에 붙인다. `base` 가 없으면 못 편다.
 */
export function resolveLockPath(
  raw: string,
  base: string | null | undefined,
  platform: PlatformName,
  homeDir?: string,
): string | null {
  let p = raw.trim();
  if (!p) return null;
  if (p === '~' || AUDIT_HOME_PREFIX_PATTERN.test(p)) {
    if (!homeDir) return null;
    p = p === '~' ? homeDir : `${homeDir}/${p.slice(2)}`;
  }
  if (platform === 'win32') {
    const m = p.match(AUDIT_MSYS_PATH_PATTERN);
    if (m && m[1]) p = `${m[1]}:/${p.slice(3)}`;
  }
  let shaped = normalizePathShape(p);
  if (!isAbsoluteLockPath(shaped)) {
    if (!base) return null;
    const b = resolveLockPath(base, null, platform, homeDir);
    if (!b) return null;
    shaped = `${b}/${shaped}`;
  }
  const collapsed = collapseLockPath(shaped);
  return collapsed || null;
}

/** 두 경로 키의 관계. `covers` 는 앞의 것이 자물쇠의 **상위 폴더**라는 뜻이다. */
type LockRelation = 'self' | 'inside' | 'covers';

function relationTo(candidateKey: string, lockKey: string): LockRelation | null {
  if (candidateKey === lockKey) return 'self';
  const lockPrefix = lockKey.endsWith('/') ? lockKey : `${lockKey}/`;
  if (candidateKey.startsWith(lockPrefix)) return 'inside';
  const candidatePrefix = candidateKey.endsWith('/') ? candidateKey : `${candidateKey}/`;
  if (lockKey.startsWith(candidatePrefix)) return 'covers';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자물쇠 한 개 — id · 외부 입력 검증 · 합치기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 호스트 자물쇠 대상을 `webHostFromUrl` 모양으로. 도메인 버블 키에서 온 `localhost:5173` 은 스킴이
 * 없는데, 그대로 넘기면 `localhost:` 를 스킴으로 읽어 버린다 — `://` 가 없으면 `https://` 를 붙여 읽는다.
 */
function normalizeLockHost(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return webHostFromUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
}

/** 자물쇠 id — 종류 + 플랫폼 경로 키(호스트는 소문자). 같은 대상은 한 번만 잠긴다. */
export function pathLockId(kind: PathLockKind, target: string, platform: PlatformName): string {
  return `${kind}:${kind === 'host' ? target.toLowerCase() : pathKey(target, platform)}`;
}

/**
 * 외부(REST 바디·메뉴·옛 저장분)에서 온 잠글 대상을 안전한 모양으로. 못 쓰면 `null`.
 * 경로는 **절대경로만** 받는다 — 상대경로는 무엇을 잠갔는지 기준이 없어 나중에 다른 곳을 잠근다.
 */
export function normalizePathLockTarget(input: unknown): PathLockTarget | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const kind = raw['kind'];
  const target = raw['target'];
  if (kind !== 'file' && kind !== 'folder' && kind !== 'host') return null;
  if (typeof target !== 'string' || !target.trim()) return null;
  let normalized: string | null;
  if (kind === 'host') {
    normalized = normalizeLockHost(target);
  } else {
    const shaped = collapseLockPath(normalizePathShape(target.trim()));
    normalized = shaped && isAbsoluteLockPath(shaped) ? shaped : null;
  }
  if (!normalized) return null;
  const labelRaw = raw['label'];
  const label = typeof labelRaw === 'string' && labelRaw.trim()
    ? labelRaw.trim().slice(0, PATH_LOCK_LABEL_MAX_CHARS)
    : undefined;
  return { kind, target: normalized, ...(label ? { label } : {}) };
}

/** 잠글 대상 하나로 자물쇠를 짓는다. 못 쓰는 대상이면 `null`. */
export function buildPathLock(
  input: unknown,
  platform: PlatformName,
  lockedAt: number,
): PathLock | null {
  const target = normalizePathLockTarget(input);
  if (!target) return null;
  return { ...target, id: pathLockId(target.kind, target.target, platform), lockedAt };
}

/**
 * 저장분·전선에서 온 자물쇠 목록을 안전한 모양으로 — 못 쓰는 항목은 버리고, id 는 **이 플랫폼에서
 * 다시 짓고**(다른 OS 에서 저장한 체크포인트도 같은 대상은 하나로 접힌다), 중복은 앞의 것을 남긴다.
 * 상한(`PATH_LOCK_MAX_PER_PROJECT`)을 넘는 꼬리는 버린다.
 */
export function normalizePathLocks(input: unknown, platform: PlatformName): PathLock[] {
  if (!Array.isArray(input)) return [];
  const out: PathLock[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const at = item && typeof item === 'object' ? (item as Record<string, unknown>)['lockedAt'] : undefined;
    const lock = buildPathLock(item, platform, typeof at === 'number' && Number.isFinite(at) ? at : 0);
    if (!lock || seen.has(lock.id)) continue;
    seen.add(lock.id);
    out.push(lock);
    if (out.length >= PATH_LOCK_MAX_PER_PROJECT) break;
  }
  return out;
}

/**
 * 두 목록의 합집합(id 기준, 앞 목록 우선). identity 보충·다중 프로젝트 병합이 쓴다 —
 * 어긋나도 **잠긴 쪽으로** 남는다(사라진 자물쇠는 AI 가 그대로 연다).
 */
export function mergePathLocks(
  base: readonly PathLock[] | undefined,
  extra: readonly PathLock[] | undefined,
): PathLock[] {
  const out = [...(base ?? [])];
  const seen = new Set(out.map((l) => l.id));
  for (const lock of extra ?? []) {
    if (seen.has(lock.id)) continue;
    seen.add(lock.id);
    out.push(lock);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 버블 → 잠글 대상 · 표시용 "덮는 자물쇠"
// ─────────────────────────────────────────────────────────────────────────────

/** 판정에 필요한 것만 추린 버블. */
export type LockableBubble = Pick<BubbleData, 'bubbleType' | 'path' | 'absolutePath' | 'label' | 'ghostInfo'>;

/** 버블에서 절대경로를 집는다 — 스냅샷이 붙여 준 `absolutePath` 가 먼저, 없으면 절대경로 모양의 `path`. */
function bubbleAbsolutePath(node: LockableBubble): string | null {
  for (const candidate of [node.absolutePath, node.path]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const shaped = collapseLockPath(normalizePathShape(candidate.trim()));
    if (isAbsoluteLockPath(shaped)) return shaped;
  }
  return null;
}

/**
 * 이 버블이 가리키는 **잠글 수 있는 대상**. 잠글 수 없는 버블이면 `null`(메뉴가 항목을 내지 않는다).
 *
 * 파일 · 내부/외부 폴더 · 워크트리 · Ghost(지워진 자리 — 되살리는 쓰기도 묻는다) = 경로,
 * 도메인 = 호스트. 에이전트·골격·보드류·iframe·접힌 웹 버블은 "AI 가 여는 물건"이 아니다.
 */
export function pathLockTargetOf(node: LockableBubble | null | undefined): PathLockTarget | null {
  if (!node) return null;
  const label = typeof node.label === 'string' && node.label.trim() ? node.label.trim() : undefined;
  const pathTarget = (kind: 'file' | 'folder'): PathLockTarget | null => {
    const abs = bubbleAbsolutePath(node);
    return abs ? { kind, target: abs, ...(label ? { label } : {}) } : null;
  };
  switch (node.bubbleType) {
    case 'file':
      return pathTarget('file');
    case 'internal_folder':
    case 'external_folder':
    case 'worktree':
      return pathTarget('folder');
    case 'ghost': {
      const original = node.ghostInfo?.originalBubbleType;
      if (original === 'file') return pathTarget('file');
      if (original === 'internal_folder' || original === 'external_folder' || original === 'worktree') {
        return pathTarget('folder');
      }
      return null;
    }
    case 'domain': {
      const host = typeof node.path === 'string' ? webHostFromNodeKey(node.path) : null;
      return host ? { kind: 'host', target: host, ...(label ? { label } : {}) } : null;
    }
    default:
      return null;
  }
}

/** 그 대상을 덮는 자물쇠 — 자기 자신이 잠겼으면 `self`, 상위 폴더·상위 도메인이 잠갔으면 `inherited`. */
export interface PathLockCover {
  lock: PathLock;
  projectName: string;
  relation: 'self' | 'inherited';
}

/** 호스트 `host` 가 자물쇠 호스트 `lockHost` 에 걸리는가(같거나 그 하위 도메인). 포트가 붙은 자물쇠는 그 서버 하나만. */
function hostMatches(host: string, lockHost: string): boolean {
  if (host === lockHost) return true;
  if (lockHost.includes(':')) return false;
  const bare = host.split(':')[0] ?? host;
  return bare === lockHost || bare.endsWith(`.${lockHost}`);
}

/**
 * 표시용 — 이 대상(버블)을 덮는 자물쇠. 자기 자신이 먼저, 없으면 **가장 가까운** 상위 폴더 자물쇠.
 * 집행과 같은 경로 규칙(`pathKey`)을 쓴다 — 화면이 "안 잠김"이라 말하는데 집행이 묻거나 그 반대가
 * 되면 자물쇠 글리프를 믿을 수 없다.
 */
export function findPathLockCover(
  target: PathLockTarget | null | undefined,
  locks: PathLocksByProject | null | undefined,
  platform: PlatformName,
): PathLockCover | null {
  if (!target || !locks) return null;
  let best: PathLockCover | null = null;
  let bestDepth = -1;
  if (target.kind === 'host') {
    const host = target.target.toLowerCase();
    for (const [projectName, list] of Object.entries(locks)) {
      for (const lock of list) {
        if (lock.kind !== 'host') continue;
        const lockHost = lock.target.toLowerCase();
        if (lockHost === host) return { lock, projectName, relation: 'self' };
        if (hostMatches(host, lockHost) && lockHost.length > bestDepth) {
          best = { lock, projectName, relation: 'inherited' };
          bestDepth = lockHost.length;
        }
      }
    }
    return best;
  }
  const key = pathKey(target.target, platform);
  for (const [projectName, list] of Object.entries(locks)) {
    for (const lock of list) {
      if (lock.kind === 'host') continue;
      const lockKey = pathKey(lock.target, platform);
      const rel = relationTo(key, lockKey);
      if (rel === 'self') return { lock, projectName, relation: 'self' };
      if (rel === 'inside' && lock.kind === 'folder' && lockKey.length > bestDepth) {
        best = { lock, projectName, relation: 'inherited' };
        bestDepth = lockKey.length;
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 도구 호출 → 자물쇠 접촉
// ─────────────────────────────────────────────────────────────────────────────

/** 판정에 넘기는 범위. */
export interface PathLockScope {
  /** 프로젝트 이름 → 그 탭이 건 자물쇠. **열려 있는 모든 프로젝트**를 넘긴다(경로는 프로젝트를 가리지 않는다). */
  locks: PathLocksByProject;
  /** 상대경로를 붙일 기준(그 호출의 cwd). 없으면 절대경로만 본다. */
  cwd?: string | null;
  /** 경로 대소문자 규칙(shared 는 `process.platform` 을 읽지 않는다). */
  platform: PlatformName;
  /** `~` 를 펴는 홈 디렉터리. 없으면 `~` 로 시작하는 낱말은 펴지 못해 세지 않는다. */
  homeDir?: string;
}

interface IndexedLock {
  lock: PathLock;
  projectName: string;
  /** 경로 자물쇠는 `pathKey`, 호스트는 소문자. */
  key: string;
}

function indexLocks(locks: PathLocksByProject, platform: PlatformName): { paths: IndexedLock[]; hosts: IndexedLock[] } {
  const paths: IndexedLock[] = [];
  const hosts: IndexedLock[] = [];
  for (const [projectName, list] of Object.entries(locks)) {
    for (const lock of list ?? []) {
      if (!lock || typeof lock.target !== 'string' || !lock.target) continue;
      if (lock.kind === 'host') hosts.push({ lock, projectName, key: lock.target.toLowerCase() });
      else paths.push({ lock, projectName, key: pathKey(collapseLockPath(normalizePathShape(lock.target)), platform) });
    }
  }
  return { paths, hosts };
}

/**
 * 경로 하나를 견주는 방식.
 * - `direct` — 그 경로가 자물쇠 자신이거나 그 안일 때만(파일 도구 · 셸 낱말). 글롭은 **펼쳐져서**
 *   자물쇠 자신에 닿을 수 있으면 센다(`cat *.env` → `secret.env`).
 * - `tree`   — 위 + 그 경로가 자물쇠를 **덮을 때**(폴더째 검색·복사·삭제). 글롭은 자물쇠나 그 상위
 *   폴더로 펼쳐질 수 있으면 센다(`rm -rf build/*` → `build/keep`).
 * - `list`   — 이름만 훑는 도구(`Glob`·`LS`). 잠긴 곳 **안**을 가리킬 때만 센다 — 글롭도 고정
 *   앞머리가 자물쇠 안일 때만(상위 폴더를 훑는 것은 이름뿐이다).
 */
type MatchMode = 'direct' | 'tree' | 'list';

/** 글롭 낱말인가(`*` · `?` · `[` 가 있다). */
function isGlobToken(token: string): boolean {
  return /[*?[]/.test(token);
}

/** 글롭 한 마디를 정규식으로(`**` 는 여기 오지 않는다). */
function globSegmentRegex(segment: string, foldCase: boolean): RegExp {
  let src = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === '*') src += '[^/]*';
    else if (ch === '?') src += '[^/]';
    else if (ch === '[') {
      const close = segment.indexOf(']', i + 1);
      if (close > i + 1) {
        const body = segment.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\');
        src += `[${body}]`;
        i = close;
      } else {
        src += '\\[';
      }
    } else {
      src += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
  }
  return new RegExp(`^${src}$`, foldCase ? 'i' : '');
}

/**
 * 글롭(이미 절대경로로 편 모양)과 자물쇠의 관계.
 * - `inside`   고정 앞머리가 자물쇠 자신이거나 그 안이다(무엇으로 펼쳐지든 잠긴 곳 안이다)
 * - `self`     펼쳐져 자물쇠 자신에 닿을 수 있다(`**` 포함)
 * - `ancestor` 펼쳐져 자물쇠의 상위 폴더에 닿을 수 있다
 */
function globRelation(globPath: string, lockKey: string, platform: PlatformName): 'inside' | 'self' | 'ancestor' | null {
  const foldCase = pathKey('A', platform) === 'a';
  const segments = globPath.split('/');
  const firstWild = segments.findIndex((s) => isGlobToken(s));
  if (firstWild < 0) return null;
  const prefix = segments.slice(0, firstWild).join('/');
  const prefixKey = pathKey(prefix || '/', platform);
  const rel = relationTo(prefixKey, lockKey);
  if (rel === null) return null;
  if (rel === 'self' || rel === 'inside') return 'inside';
  const remainingGlob = segments.slice(firstWild).filter((s) => s.length > 0);
  if (remainingGlob.some((s) => s === '**')) return 'self';
  const prefixWithSlash = prefixKey.endsWith('/') ? prefixKey : `${prefixKey}/`;
  const lockRest = lockKey.slice(prefixWithSlash.length).split('/').filter((s) => s.length > 0);
  if (remainingGlob.length > lockRest.length) return null;
  for (let i = 0; i < remainingGlob.length; i++) {
    const seg = remainingGlob[i]!;
    const part = lockRest[i]!;
    const ok = isGlobToken(seg)
      ? globSegmentRegex(seg, foldCase).test(part)
      : pathKey(seg, platform) === pathKey(part, platform);
    if (!ok) return null;
  }
  return remainingGlob.length === lockRest.length ? 'self' : 'ancestor';
}

/** 입력 칸에서 첫 비지 않은 문자열. */
function firstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** 명령 칸 — 문자열이거나 argv 배열(코덱스 일부 판본). */
function commandOf(input: Record<string, unknown>): string {
  const c = input['command'];
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.every((x) => typeof x === 'string')) return (c as string[]).join(' ');
  return '';
}

/** `FOO=1 cmd …` 의 앞머리 대입. */
const ENV_ASSIGN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 리다이렉트 앞머리(`>` · `2>>` · `<` · `>|`). */
const REDIRECT_PREFIX_PATTERN = /^\d*[<>]+\|?/;

/** Windows 명령 스위치(`/s` · `/q` · `/c`) — 경로가 아니다. win32 에서만 이렇게 읽는다. */
const WINDOWS_SWITCH_PATTERN = /^\/[A-Za-z?]{1,2}$/;

/** 낱말 안에 경로가 묻어 오는 껍데기(따옴표·괄호·쉼표 — 인라인 스크립트의 `open('a.txt')`). */
const TOKEN_PIECE_SPLIT = /[\s'"`()[\]{},;=]+/;

/** 이 낱말 조각이 경로처럼 생겼는가 — 구분자가 있거나 확장자가 붙어 있다. */
function looksLikePathPiece(piece: string): boolean {
  return /[\\/]/.test(piece) || /\.[A-Za-z0-9]{1,8}$/.test(piece);
}

/**
 * 셸 낱말 하나에서 경로 후보를 꺼낸다. 플래그·변수·숫자·연산자는 버리고, `--out=x`·`FOO=x`·`>x` 는
 * 값만 남긴다. 인라인 스크립트처럼 따옴표·괄호가 섞인 낱말은 조각을 나눠 경로처럼 생긴 것을 더한다.
 */
function shellTokenCandidates(rawToken: string, platform: PlatformName): string[] {
  let token = rawToken.trim();
  if (!token) return [];
  if (token.startsWith('-')) {
    const flagValue = token.match(AUDIT_TOKEN_FLAG_VALUE_PATTERN);
    if (!flagValue || !flagValue[1]) return [];
    token = flagValue[1];
  } else if (ENV_ASSIGN_PATTERN.test(token)) {
    token = token.slice(token.indexOf('=') + 1);
  }
  token = token.replace(REDIRECT_PREFIX_PATTERN, '');
  if (!token || token.startsWith('&') || token.startsWith('$')) return [];
  if (/^\d+$/.test(token)) return [];
  if (platform === 'win32' && WINDOWS_SWITCH_PATTERN.test(token)) return [];
  const out = [token];
  if (TOKEN_PIECE_SPLIT.test(token)) {
    for (const piece of token.split(TOKEN_PIECE_SPLIT)) {
      if (piece && piece !== token && !piece.startsWith('$') && looksLikePathPiece(piece)) out.push(piece);
    }
  }
  return out;
}

/** 세그먼트의 명령 이름(앞머리 환경변수 대입은 건너뛴다). */
function segmentCommandName(segment: readonly string[]): string {
  for (const tok of segment) {
    if (ENV_ASSIGN_PATTERN.test(tok)) continue;
    return normalizeShellCommandName(tok);
  }
  return '';
}

/** 세그먼트의 비-플래그 인자(명령 이름·플래그·리다이렉트 제외). Windows 스위치는 win32 에서 뺀다. */
function positionalArgs(segment: readonly string[], platform: PlatformName): string[] {
  const out: string[] = [];
  let seenCommand = false;
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    if (!seenCommand) {
      if (ENV_ASSIGN_PATTERN.test(tok)) continue;
      seenCommand = true;
      continue;
    }
    if (REDIRECT_PREFIX_PATTERN.test(tok)) {
      // `> out.txt` 처럼 떨어져 온 대상은 그 토큰도 건너뛴다.
      if (/^\d*[<>]+\|?$/.test(tok)) i++;
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) continue;
    if (platform === 'win32' && WINDOWS_SWITCH_PATTERN.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** 패턴을 플래그로 받았는가(`grep -e P` · `rg -f FILE` · `Select-String -Pattern P`) — 그러면 위치 인자가 전부 경로다. */
function patternGivenByFlag(segment: readonly string[]): boolean {
  return segment.some((t) => t === '-e' || t === '-f' || t.startsWith('--regexp') || t.startsWith('--file') || /^-pattern$/i.test(t));
}

/** `find` 의 경로 인자 — 첫 식(`-name` · `(` · `!`) 앞까지. */
function findPathArgs(segment: readonly string[]): string[] {
  const out: string[] = [];
  let seenCommand = false;
  for (const tok of segment) {
    if (!seenCommand) {
      if (ENV_ASSIGN_PATTERN.test(tok)) continue;
      seenCommand = true;
      continue;
    }
    if (tok.startsWith('-') || tok === '(' || tok === '!' || tok === '\\(') break;
    out.push(tok);
  }
  return out;
}

/** cwd 를 범위로 쓴다는 표식(어떤 셸 낱말과도 겹치지 않는 값). */
const CWD_SCOPE = '\u0000cwd';

/**
 * 이 세그먼트가 **폴더째** 다루는 범위(원문 낱말들). 비면 트리 접촉이 없는 명령이다.
 * 범위가 자물쇠를 덮으면 센다 — 그 폴더를 읽고·옮기고·지우는 일이 그 안의 자물쇠에 닿는다.
 */
function treeScopesOf(name: string, segment: readonly string[], platform: PlatformName): string[] {
  const recursiveRead = PATH_LOCK_TREE_READ_COMMANDS.has(name)
    || (PATH_LOCK_RECURSIVE_READ_COMMANDS.has(name)
      && segment.some((t) => PATH_LOCK_RECURSIVE_FLAG_PATTERNS.some((re) => re.test(t))));
  if (recursiveRead) {
    const positional = positionalArgs(segment, platform);
    const paths = patternGivenByFlag(segment) ? positional : positional.slice(1);
    return paths.length > 0 ? paths : [CWD_SCOPE];
  }
  if (name === 'find' && segment.some((t) => PATH_LOCK_FIND_ACTION_FLAGS.has(t))) {
    const paths = findPathArgs(segment);
    return paths.length > 0 ? paths : [CWD_SCOPE];
  }
  if (PATH_LOCK_TREE_ALL_ARGS_COMMANDS.has(name)) return positionalArgs(segment, platform);
  if (PATH_LOCK_TREE_SOURCE_DEST_COMMANDS.has(name)) {
    const positional = positionalArgs(segment, platform);
    return positional.length >= 2 ? positional.slice(0, -1) : [];
  }
  return [];
}

/** 첫 접촉만 남기는 모음(같은 자물쇠를 두 번 말하지 않는다). */
class HitCollector {
  private readonly hits = new Map<string, PathLockHit>();

  add(entry: IndexedLock, access: PathLockAccess, matched: string): void {
    if (this.hits.has(entry.lock.id)) return;
    this.hits.set(entry.lock.id, {
      lockId: entry.lock.id,
      kind: entry.lock.kind,
      target: entry.lock.target,
      ...(entry.lock.label ? { label: entry.lock.label } : {}),
      projectName: entry.projectName,
      access,
      matched,
    });
  }

  list(): PathLockHit[] {
    return [...this.hits.values()];
  }
}

/**
 * §5.3 #12-3 — 이 도구 호출이 닿는 자물쇠들. 비었으면 자물쇠와 무관한 호출이다.
 *
 * 세는 것(SSOT #12-3 (F)):
 *  - 경로 도구와 **모든 도구의** 경로 칸: 그 경로가 자물쇠이거나 그 안.
 *  - `Grep`: 범위(경로 · 없으면 cwd)가 자물쇠를 덮어도(내용을 읽는다).
 *  - `Glob`·`LS`: 잠긴 폴더 **안**을 가리킬 때만(상위를 훑는 것은 이름뿐이다).
 *  - `apply_patch`: 머리줄 경로.
 *  - 셸 명령: 모든 낱말(`cd` 반영 · 글롭은 펼쳐질 수 있는 곳) + 폴더째 다루는 명령의 범위.
 *  - 호스트: URL 칸과 명령 안의 `http(s)` 주소.
 */
export function findToolLockHits(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
  scope: PathLockScope,
): PathLockHit[] {
  const index = indexLocks(scope.locks, scope.platform);
  if (index.paths.length === 0 && index.hosts.length === 0) return [];
  const input = toolInput ?? {};
  const hits = new HitCollector();
  const { platform, homeDir } = scope;
  const cwd = scope.cwd ?? null;

  /** 낱말 하나를 펴서 자물쇠와 견준다. */
  const touchPath = (raw: string, base: string | null, access: PathLockAccess, mode: MatchMode): void => {
    const resolved = resolveLockPath(raw, base, platform, homeDir);
    if (!resolved) return;
    if (isGlobToken(resolved)) {
      for (const entry of index.paths) {
        const rel = globRelation(resolved, entry.key, platform);
        if (rel === null) continue;
        if (rel === 'inside' || (mode === 'direct' && rel === 'self') || (mode === 'tree')) {
          hits.add(entry, access, resolved);
        }
      }
      return;
    }
    const key = pathKey(resolved, platform);
    for (const entry of index.paths) {
      const rel = relationTo(key, entry.key);
      if (rel === null) continue;
      if (rel !== 'covers' || mode === 'tree') hits.add(entry, access, resolved);
    }
  };

  const touchHost = (url: string): void => {
    if (index.hosts.length === 0) return;
    const host = normalizeLockHost(url);
    if (!host) return;
    for (const entry of index.hosts) {
      if (hostMatches(host, entry.key)) hits.add(entry, 'network', host);
    }
  };

  // 셸 명령 — 세그먼트마다 낱말을 견주고, 폴더째 다루는 명령은 그 범위까지 본다.
  const scanShellCommand = (text: string): void => {
    // heredoc 본문도 걷지 않는다 — `python - <<'EOF'` 의 본문은 **실행되는 코드**다. 글로 쓴 본문이
    //   잠긴 경로를 적어 한 번 더 묻는 쪽이, 실행되는 스크립트가 잠긴 파일을 몰래 여는 것보다 낫다.
    const segments = splitShellSegments(tokenizeShellCommand(text));
    let base: string | null = cwd;
    for (const segment of segments) {
      for (const token of segment) {
        for (const candidate of shellTokenCandidates(token, platform)) touchPath(candidate, base, 'shell', 'direct');
      }
      const cdTarget = readShellCdTarget(segment);
      if (cdTarget) {
        const next = resolveLockPath(cdTarget, base, platform, homeDir);
        if (next) base = next;
        continue;
      }
      const name = segmentCommandName(segment);
      if (!name) continue;
      for (const raw of treeScopesOf(name, segment, platform)) {
        if (raw === CWD_SCOPE) {
          if (base) touchPath(base, null, 'shell', 'tree');
          continue;
        }
        for (const candidate of shellTokenCandidates(raw, platform)) touchPath(candidate, base, 'shell', 'tree');
      }
    }
  };

  // ① 패치 — 입력이 셸 명령이 아니라 패치 본문이다. 머리줄의 경로만 본다(§5.22 와 같은 추출기).
  if (AUDIT_PATCH_TOOLS.has(toolName)) {
    const patch = firstString(input, AUDIT_PATCH_INPUT_KEYS) ?? '';
    for (const op of extractPatchFileOps(patch)) touchPath(op.path, cwd, 'write', 'direct');
    return hits.list();
  }

  // ② 경로 칸 — 도구가 무엇이든 본다(모르는 MCP 도구의 `path` 도 잠긴 곳을 가리키면 센다).
  const pathValues: string[] = [];
  for (const k of AUDIT_PATH_INPUT_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) pathValues.push(v.trim());
  }
  if (PATH_LOCK_SEARCH_TOOLS.has(toolName)) {
    // 내용 검색은 범위가 자물쇠를 덮어도 센다. 경로가 없으면 cwd 가 범위다.
    const scopes = pathValues.length > 0 ? pathValues : (cwd ? [cwd] : []);
    for (const p of scopes) touchPath(p, cwd, 'search', 'tree');
  } else if (PATH_LOCK_LIST_TOOLS.has(toolName)) {
    // 이름 훑기 — 패턴은 기준 폴더(`path` · 없으면 cwd) 아래에서 펼쳐진다. 절대경로 패턴이면 그대로.
    const dir = pathValues[0] ?? cwd;
    const pattern = typeof input['pattern'] === 'string' ? input['pattern'].trim() : '';
    const absolutePattern = pattern ? resolveLockPath(pattern, null, platform, homeDir) : null;
    const target = pattern ? (absolutePattern ?? (dir ? `${dir}/${pattern}` : null)) : dir;
    if (target) touchPath(target, cwd, 'list', 'list');
  } else {
    const access: PathLockAccess = PATH_LOCK_WRITE_TOOLS.has(toolName) ? 'write' : 'read';
    for (const p of pathValues) touchPath(p, cwd, access, 'direct');
  }

  // ③ URL 칸 — 도구 이름과 무관하게 본다(`WebFetch` · 모르는 MCP 도구의 `url`).
  const url = firstString(input, PATH_LOCK_URL_INPUT_KEYS);
  if (url) touchHost(url);

  // ④ 셸 명령 — `command` 칸이 있으면 도구 이름과 무관하게 본다.
  const command = commandOf(input);
  if (command) {
    for (const found of command.match(AUDIT_URL_PATTERN) ?? []) touchHost(found);
    // URL 을 먼저 걷는다 — `https://` 의 `//` 가 경로로 오독되지 않게(§5.22 와 같은 이유).
    if (index.paths.length > 0) scanShellCommand(command.replace(AUDIT_URL_PATTERN, ' '));
  }

  return hits.list();
}
