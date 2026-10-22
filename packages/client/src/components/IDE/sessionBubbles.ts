/**
 * sessionBubbles.ts — §5.5 #17-50 [버블]: 대화 칸의 **도구 호출** → 이 세션만의 버블 모델(순수 함수).
 *
 * 캔버스(§2.1)는 프로젝트 전체의 지도라 한 세션이 무엇을 만졌는지가 다른 세션·지난 일과 섞이고, TTL·확인
 * dismiss·묶음(§2.4 · §5.4 #36)이 지나면 사라진다. 여기서는 프로젝트 그래프를 **한 칸도 빌려 오지 않고**
 * 그 칸이 보여 주는 스트림 이벤트만 읽어 "이 세션이 무엇을 읽고 썼나"를 다시 세운다.
 *
 * 판정은 캔버스와 **같은 함수**를 쓴다 — 셸 읽기·쓰기 경로(`extractBashReadTargets`·`extractBashWritePaths`),
 * 명령 앱(`detectCommandApps`), 웹 호스트(`webHostFromUrl`), 경로 키(`pathKey`·`isPathWithin`). 두 벌이 되면
 * 캔버스에는 뜨는 파일이 여기서는 안 뜬다(§2.1 #3). 디스크·스토어·DOM 을 보지 않으므로 단위 테스트로 고정한다.
 *
 * 비용: 도구 호출 해석은 이벤트 **객체마다** `WeakMap` 에 들고 있다 — 스트림은 끝에 줄이 붙는 배열이라 매번
 * 전량을 다시 모아도 새 줄만 해석된다(모으기 자체는 단순 합산 O(n)).
 */
import {
  BASH_READ_PATH_LIMIT,
  BASH_WRITE_PATH_LIMIT,
  detectCommandApps,
  extractBashReadTargets,
  extractBashWritePaths,
  isAbsoluteShellPath,
  isPathWithin,
  isShellToolName,
  joinShellPath,
  normalizePathShape,
  pathKey,
  shellDialectOfTool,
  toNativeDriveShellPath,
  webHostFromUrl,
  type PlatformName,
  type QueuedCommand,
  type SubAgentStreamEvent,
} from '@vibisual/shared';
import { dispatchedTurnAnchorsAsc, turnOfEvent, type TurnAnchor } from './streamItems.js';

/** 지도가 기억하는 꼬리 길이 — 정보 칸이 보여 줄 만큼만(긴 세션에서 배열이 자라지 않게). */
export const SESSION_BUBBLE_KEEP = {
  /** 명령 앱 버블이 남기는 최근 명령 수. */
  appCommands: 5,
  /** 「웹 검색」 버블이 남기는 최근 검색어 수. */
  searchQueries: 5,
  /** 정보 칸에 실을 명령 한 줄 상한(글자). */
  commandChars: 240,
} as const;

/** 닿은 방향 — 읽기 = 버블에서 세션으로, 쓰기 = 세션에서 버블로(§2.1 #3 한 쌍에 방향은 하나). */
export type SessionTouchDirection = 'read' | 'write';

/** 한 버블에 닿은 기록. 표시가 쓰는 사실만 든다. */
export interface SessionTouch {
  reads: number;
  writes: number;
  /** 처음 닿은 시각 — 궤도·위성 칸 순서(자리 고정)의 근거. */
  firstAt: number;
  lastAt: number;
  /** 마지막으로 닿은 도구 이름(정보 칸). */
  lastTool: string;
  /** 마지막으로 닿은 방향 — 선의 방향. */
  lastDirection: SessionTouchDirection;
  /** 마지막으로 닿은 턴(명령 id) — [대화에서 보기]. 첫 명령 이전의 복원분이면 null. */
  turnId: string | null;
  /** 결과가 아직 안 온 호출이 닿아 있는가(맥동은 세션이 돌 때만 — 화면이 정한다). */
  pending: boolean;
  /** 세션이 직접 닿았나. false 면 중첩 서브에이전트로만 닿았다(선이 그 서브에이전트에서 나온다). */
  direct: boolean;
  /** 중첩 서브에이전트로 닿았으면 그 서브에이전트 버블의 key(마지막 것). */
  viaTaskKey: string | null;
}

export interface SessionFileBubble extends SessionTouch {
  key: string;
  /** 표시·열기용 경로(모양만 정규화 — 대소문자 원문). */
  path: string;
  name: string;
  folderKey: string;
}

export interface SessionFolderBubble extends SessionTouch {
  key: string;
  path: string;
  /** 프로젝트 안인가 — 내부/외부 폴더 색이 갈린다. */
  internal: boolean;
  /** 프로젝트 기준 상대 경로(안쪽일 때만 · 루트 자신은 ''). */
  relPath: string | null;
  /** 이 폴더를 검색 범위로 쓴 횟수(Grep·Glob·LS·셸 grep). */
  searches: number;
  /** 이 폴더에서 만진 파일 — 처음 닿은 순서(위성 칸 고정). */
  files: SessionFileBubble[];
}

export interface SessionWebBubble extends SessionTouch {
  key: string;
  kind: 'fetch' | 'search';
  /** `fetch` 의 호스트. */
  host: string | null;
  lastUrl: string | null;
  /** `search` 의 최근 검색어(최근 것부터). */
  queries: string[];
}

export interface SessionAppBubble extends SessionTouch {
  key: string;
  name: string;
  executable?: string;
  /** 최근 명령(최근 것부터). */
  commands: string[];
}

export interface SessionTaskBubble extends SessionTouch {
  key: string;
  description: string;
  agentType: string | null;
  /** 결과가 왔나. */
  done: boolean;
}

export interface SessionBubbleModel {
  folders: SessionFolderBubble[];
  webs: SessionWebBubble[];
  apps: SessionAppBubble[];
  tasks: SessionTaskBubble[];
  /** 해석한 도구 호출 전부(버블을 만들지 않는 도구 포함). */
  toolCalls: number;
  fileCount: number;
  readCount: number;
  writeCount: number;
  /** 버블이 하나도 없는가(빈 상태). */
  empty: boolean;
}

/** 한 세션 몫의 재료 — 메인 탭은 여러 개를 함께 넘긴다. */
export interface SessionBubbleStream {
  events: readonly SubAgentStreamEvent[];
  /** 그 세션의 명령 — 턴 도장이 없는 옛 줄을 시각으로 제 턴에 귀속시킬 때 쓴다. */
  commands: readonly QueuedCommand[];
}

export interface SessionBubbleInput {
  streams: readonly SessionBubbleStream[];
  /** 그 칸의 프로젝트 루트 — 안팎 판정·상대 경로 풀기의 기준. 모르면 null(상대 경로는 버린다). */
  rootPath: string | null;
  platform: PlatformName;
}

// ─── 도구 호출 해석 ──────────────────────────────────────────────────────────

/** 호출 하나가 닿은 파일·폴더 한 칸. */
interface ParsedTouch {
  kind: 'file' | 'folder';
  path: string;
  direction: SessionTouchDirection;
  /** 검색 범위로 닿았나(폴더면 searches 를 센다). */
  search: boolean;
}

/** 호출 하나의 해석 결과. 버블을 만들지 않는 도구면 모든 칸이 비어 있다. */
interface ParsedCall {
  touches: ParsedTouch[];
  web: { kind: 'fetch'; host: string; url: string } | { kind: 'search'; query: string } | null;
  apps: Array<{ id: string; name: string; executable?: string }>;
  command: string | null;
  task: { description: string; agentType: string | null } | null;
}

const EMPTY_CALL: ParsedCall = { touches: [], web: null, apps: [], command: null, task: null };

const READ_FILE_TOOLS = new Set(['Read', 'NotebookRead']);
const WRITE_FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS']);
const TASK_TOOLS = new Set(['Task', 'Agent']);

/** 서버가 비-편집 도구 입력을 미리보기 길이에서 자른다(`TOOL_INPUT_PREVIEW_LIMIT`). 그때도 **끝까지 온** 문자열 칸은 건진다. */
function salvageTruncatedJson(text: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    const key = m[1];
    const raw = m[2];
    if (!key || !raw || key in out) continue;
    try { out[key] = JSON.parse(raw) as unknown; } catch { /* 깨진 칸은 버린다 */ }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** tool_use 본문 → 입력 객체. JSON 이 아니면(코덱스의 셸·검색·고친 파일 줄) null. */
export function readToolInput(content: string): Record<string, unknown> | null {
  const text = content.trim();
  if (!text.startsWith('{')) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return salvageTruncatedJson(text);
  }
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * 끝 마디에 확장자가 있으면 파일로 본다 — 디스크를 보지 않으므로 이 한 규칙으로만 가른다.
 * 점 앞에 글자가 있어야 확장자다 — `.github`·`.vscode` 처럼 점으로 **시작만** 하는 이름은 폴더로 읽는다(검색 범위로 오는 것은
 * 대개 그쪽이다). `Makefile` 처럼 확장자 없는 파일도 폴더로 읽힌다 — 이 판정은 검색 범위에만 쓰고, 경로 인자가 확실히
 * 파일인 도구(Read·Edit…)는 타지 않는다.
 */
export function looksLikeFilePath(p: string): boolean {
  const last = normalizePathShape(p).split('/').pop() ?? '';
  return /[^.]\.[A-Za-z0-9_-]{1,12}$/.test(last);
}

/**
 * 경로 한 줄을 지도 열쇠로 쓸 수 있는 모양으로. 상대 경로는 칸의 루트에 잇고(`.`·`..` 접기 포함),
 * win32 면 git bash 의 `/c/...` 를 `c:/...` 로 바꾼다(같은 파일이 다른 버블로 갈라지지 않게).
 * 홈(`~`)·변수처럼 글자만으로 풀 수 없는 경로는 null — 지어내지 않는다.
 */
export function resolveSessionPath(raw: string, rootPath: string | null, platform: PlatformName): string | null {
  let p = raw.trim().replace(/^["']|["']$/g, '');
  if (!p || p.startsWith('~') || p.startsWith('$') || p.includes('%')) return null;
  if (platform === 'win32') p = toNativeDriveShellPath(p.replace(/\\/g, '/'));
  if (!isAbsoluteShellPath(p)) {
    if (!rootPath) return null;
    p = joinShellPath(normalizePathShape(rootPath), p);
    if (!isAbsoluteShellPath(p)) return null;
  }
  return normalizePathShape(p);
}

/** 코덱스 `file_change` 줄 — 고친 경로를 쉼표로 이은 본문(`a.ts, b.ts`). 경로가 없으면 `(file change)`. */
function codexChangedPaths(content: string): string[] {
  const text = content.trim();
  if (!text || text.startsWith('(')) return [];
  return text.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
}

function parseCall(evt: SubAgentStreamEvent, rootPath: string | null, platform: PlatformName): ParsedCall {
  const tool = evt.toolName ?? '';
  if (!tool) return EMPTY_CALL;
  const input = readToolInput(evt.content);
  const touches: ParsedTouch[] = [];
  const touch = (raw: string | null, kind: 'file' | 'folder', direction: SessionTouchDirection, search = false): void => {
    if (!raw) return;
    const path = resolveSessionPath(raw, rootPath, platform);
    if (path) touches.push({ kind, path, direction, search });
  };

  if (READ_FILE_TOOLS.has(tool)) {
    touch(str(input, 'file_path') ?? str(input, 'notebook_path'), 'file', 'read');
    return { ...EMPTY_CALL, touches };
  }
  if (WRITE_FILE_TOOLS.has(tool)) {
    if (input) touch(str(input, 'file_path') ?? str(input, 'notebook_path'), 'file', 'write');
    else for (const p of codexChangedPaths(evt.content)) touch(p, 'file', 'write');
    return { ...EMPTY_CALL, touches };
  }
  if (SEARCH_TOOLS.has(tool)) {
    // 경로 인자가 없으면 그 칸의 루트를 훑은 것이다(CLI 의 기본 검색 자리 = 작업 폴더).
    const scope = str(input, 'path') ?? rootPath;
    if (scope) touch(scope, tool === 'Grep' && looksLikeFilePath(scope) ? 'file' : 'folder', 'read', true);
    return { ...EMPTY_CALL, touches };
  }
  if (isShellToolName(tool)) {
    const command = input ? str(input, 'command') : (evt.content.trim() || null);
    if (!command) return EMPTY_CALL;
    const dialect = shellDialectOfTool(tool);
    for (const t of extractBashReadTargets(command, BASH_READ_PATH_LIMIT, { platform, dialect })) {
      touch(t.path, t.search && !looksLikeFilePath(t.path) ? 'folder' : 'file', 'read', t.search);
    }
    for (const p of extractBashWritePaths(command, BASH_WRITE_PATH_LIMIT, { platform, dialect })) touch(p, 'file', 'write');
    const apps = detectCommandApps(command, { ...(rootPath ? { cwd: rootPath } : {}), platform })
      .map((a) => ({ id: a.id, name: a.name, ...(a.executable ? { executable: a.executable } : {}) }));
    return { touches, web: null, apps, command, task: null };
  }
  if (tool === 'WebFetch') {
    const url = str(input, 'url') ?? (input ? null : evt.content.trim() || null);
    const host = url ? webHostFromUrl(url) : null;
    return host && url ? { ...EMPTY_CALL, web: { kind: 'fetch', host, url } } : EMPTY_CALL;
  }
  if (tool === 'WebSearch') {
    const query = str(input, 'query') ?? (input ? null : evt.content.trim() || null);
    return query && query !== '(web search)' ? { ...EMPTY_CALL, web: { kind: 'search', query } } : { ...EMPTY_CALL, web: { kind: 'search', query: '' } };
  }
  if (TASK_TOOLS.has(tool)) {
    const description = str(input, 'description') ?? str(input, 'subagent_type') ?? tool;
    return { ...EMPTY_CALL, task: { description, agentType: str(input, 'subagent_type') } };
  }
  return EMPTY_CALL;
}

/** 해석 결과는 이벤트 객체에 매인다 — 루트·플랫폼이 같을 때만 다시 쓴다. */
const parseCache = new WeakMap<SubAgentStreamEvent, { ctx: string; call: ParsedCall }>();

function parsedCallOf(evt: SubAgentStreamEvent, rootPath: string | null, platform: PlatformName): ParsedCall {
  const ctx = `${platform}\n${rootPath ?? ''}`;
  const hit = parseCache.get(evt);
  if (hit && hit.ctx === ctx) return hit.call;
  const call = parseCall(evt, rootPath, platform);
  parseCache.set(evt, { ctx, call });
  return call;
}

// ─── 모으기 ─────────────────────────────────────────────────────────────────

function newTouch(at: number, tool: string, direction: SessionTouchDirection, turnId: string | null): SessionTouch {
  return {
    reads: 0, writes: 0, firstAt: at, lastAt: at, lastTool: tool, lastDirection: direction,
    turnId, pending: false, direct: false, viaTaskKey: null,
  };
}

/** 한 번 닿은 것을 기록에 더한다. 시각이 같거나 늦으면 "마지막" 칸을 갈아 끼운다. */
function addTouch(
  t: SessionTouch, at: number, tool: string, direction: SessionTouchDirection, turnId: string | null,
  pending: boolean, viaTaskKey: string | null,
): void {
  if (direction === 'write') t.writes += 1; else t.reads += 1;
  if (at < t.firstAt) t.firstAt = at;
  if (at >= t.lastAt) {
    t.lastAt = at;
    t.lastTool = tool;
    t.lastDirection = direction;
    t.turnId = turnId;
  }
  if (pending) t.pending = true;
  if (viaTaskKey === null) t.direct = true;
  else t.viaTaskKey = viaTaskKey;
}

/** 폴더 열쇠 = 그 폴더의 경로 키. 파일이면 직속 부모. 루트 위(드라이브 루트)는 그 자신. */
function parentPath(path: string): string {
  const shaped = normalizePathShape(path);
  const cut = shaped.lastIndexOf('/');
  if (cut <= 0) return shaped.startsWith('/') ? '/' : shaped;
  const parent = shaped.slice(0, cut);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

function baseName(path: string): string {
  const shaped = normalizePathShape(path);
  return shaped.split('/').filter(Boolean).pop() ?? shaped;
}

function relativeTo(path: string, rootPath: string, platform: PlatformName): string {
  const root = normalizePathShape(rootPath);
  if (pathKey(path, platform) === pathKey(root, platform)) return '';
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.slice(prefix.length);
}

function clampCommand(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > SESSION_BUBBLE_KEEP.commandChars ? `${flat.slice(0, SESSION_BUBBLE_KEEP.commandChars)}…` : flat;
}

function pushRecent(list: string[], value: string, max: number): void {
  if (!value) return;
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
  list.unshift(value);
  if (list.length > max) list.length = max;
}

/**
 * 이 칸의 스트림 → 세션 버블 모델.
 *
 * - **도구 호출(`tool_use`)만** 센다. 결과(`tool_result`)는 그 호출이 끝났는지를 가를 뿐이다(`toolUseId` 짝).
 *   짝 id 가 없는 옛 줄은 끝난 것으로 본다 — 영원히 "도는 중"으로 남는 것보다 낫다.
 * - 중첩 서브에이전트가 한 호출(`nestedUnderToolUseId`)은 그 서브에이전트 버블을 거쳐 닿은 것으로 적는다.
 * - 정렬은 **처음 닿은 순서** — 새 버블은 늘 뒤에 붙고 앞의 것은 자리를 지킨다.
 */
export function buildSessionBubbles(input: SessionBubbleInput): SessionBubbleModel {
  const { rootPath, platform } = input;
  const folders = new Map<string, SessionFolderBubble>();
  const files = new Map<string, SessionFileBubble>();
  const webs = new Map<string, SessionWebBubble>();
  const apps = new Map<string, SessionAppBubble>();
  const tasks = new Map<string, SessionTaskBubble>();
  /** Task 호출 id → 그 서브에이전트 버블 열쇠(세션마다 겹치지 않게 열쇠에 세션을 싣는다). */
  const taskKeyByUseId = new Map<string, string>();
  let toolCalls = 0;

  for (const stream of input.streams) {
    const anchors: TurnAnchor[] = dispatchedTurnAnchorsAsc(stream.commands);
    // 결과가 온 호출 id — 짝 판정은 id 로만 한다(FIFO 짝은 끝내 안 오는 호출 하나에 전부 밀린다).
    const answered = new Set<string>();
    for (const evt of stream.events) {
      if (evt.eventType === 'tool_result' && evt.toolUseId) answered.add(evt.toolUseId);
    }
    for (const evt of stream.events) {
      if (evt.eventType !== 'tool_use') continue;
      toolCalls += 1;
      const call = parsedCallOf(evt, rootPath, platform);
      const tool = evt.toolName ?? '';
      const at = evt.timestamp;
      const turnId = turnOfEvent(evt, anchors);
      const pending = evt.toolUseId !== undefined && !answered.has(evt.toolUseId);
      const viaTaskKey = evt.nestedUnderToolUseId ? (taskKeyByUseId.get(evt.nestedUnderToolUseId) ?? null) : null;

      if (call.task) {
        const key = `task:${evt.subAgentId}:${evt.toolUseId ?? evt.id}`;
        if (evt.toolUseId) taskKeyByUseId.set(evt.toolUseId, key);
        const existing = tasks.get(key);
        const bubble: SessionTaskBubble = existing ?? {
          ...newTouch(at, tool, 'write', turnId), key, description: call.task.description,
          agentType: call.task.agentType, done: false,
        };
        addTouch(bubble, at, tool, 'write', turnId, pending, viaTaskKey);
        bubble.done = !pending;
        tasks.set(key, bubble);
      }

      for (const t of call.touches) {
        const folderPath = t.kind === 'file' ? parentPath(t.path) : t.path;
        const folderKey = pathKey(folderPath, platform);
        let folder = folders.get(folderKey);
        if (!folder) {
          const internal = rootPath !== null && isPathWithin(folderPath, rootPath, platform);
          folder = {
            ...newTouch(at, tool, t.direction, turnId), key: folderKey, path: folderPath, internal,
            relPath: internal && rootPath ? relativeTo(folderPath, rootPath, platform) : null,
            searches: 0, files: [],
          };
          folders.set(folderKey, folder);
        }
        addTouch(folder, at, tool, t.direction, turnId, pending, viaTaskKey);
        if (t.kind === 'folder') {
          if (t.search) folder.searches += 1;
          continue;
        }
        const fileKey = pathKey(t.path, platform);
        let file = files.get(fileKey);
        if (!file) {
          file = { ...newTouch(at, tool, t.direction, turnId), key: fileKey, path: t.path, name: baseName(t.path), folderKey };
          files.set(fileKey, file);
          folder.files.push(file);
        }
        addTouch(file, at, tool, t.direction, turnId, pending, viaTaskKey);
      }

      if (call.web) {
        const key = call.web.kind === 'fetch' ? `web:${call.web.host}` : 'web:search';
        let web = webs.get(key);
        if (!web) {
          web = {
            ...newTouch(at, tool, 'read', turnId), key, kind: call.web.kind,
            host: call.web.kind === 'fetch' ? call.web.host : null, lastUrl: null, queries: [],
          };
          webs.set(key, web);
        }
        addTouch(web, at, tool, 'read', turnId, pending, viaTaskKey);
        if (call.web.kind === 'fetch' && at >= web.lastAt) web.lastUrl = call.web.url;
        if (call.web.kind === 'search') pushRecent(web.queries, call.web.query, SESSION_BUBBLE_KEEP.searchQueries);
      }

      for (const a of call.apps) {
        const key = `app:${a.id}`;
        let app = apps.get(key);
        if (!app) {
          app = { ...newTouch(at, tool, 'write', turnId), key, name: a.name, ...(a.executable ? { executable: a.executable } : {}), commands: [] };
          apps.set(key, app);
        }
        addTouch(app, at, tool, 'write', turnId, pending, viaTaskKey);
        if (call.command) pushRecent(app.commands, clampCommand(call.command), SESSION_BUBBLE_KEEP.appCommands);
      }
    }
  }

  const byFirst = <T extends SessionTouch>(a: T, b: T): number => a.firstAt - b.firstAt;
  const folderList = [...folders.values()].sort(byFirst);
  for (const f of folderList) f.files.sort(byFirst);
  let readCount = 0;
  let writeCount = 0;
  for (const f of files.values()) { readCount += f.reads; writeCount += f.writes; }
  const model: SessionBubbleModel = {
    folders: folderList,
    webs: [...webs.values()].sort(byFirst),
    apps: [...apps.values()].sort(byFirst),
    tasks: [...tasks.values()].sort(byFirst),
    toolCalls,
    fileCount: files.size,
    readCount,
    writeCount,
    empty: false,
  };
  model.empty = model.folders.length === 0 && model.webs.length === 0 && model.apps.length === 0 && model.tasks.length === 0;
  return model;
}
