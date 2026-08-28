/**
 * localTools.ts — §5.19 (H) 로컬 모델이 실제로 파일을 읽고 고치는 자리.
 *
 * **왜 이 파일이 있는가**: 클로드 경로에서는 도구를 `claude` CLI 가 들고 있다. 로컬에는 그
 * CLI 가 없으므로 **우리가 도구를 준다** — 그러지 않으면 로컬 버블은 영원히 채팅창이고,
 * "같은 프로젝트의 파일을 고친다"는 목적에 한 발짝도 못 간다.
 *
 * **경계 셋**:
 *  1. **프로젝트 루트 밖으로 못 나간다.** 경로는 전부 루트 기준으로 풀고, 푼 결과가 루트
 *     안이 아니면 거절한다(`..` 도 심볼릭 링크도 여기서 걸린다). 모델이 시키는 대로 파일을
 *     여는 자리라, 이 가드가 없으면 프롬프트 한 줄로 홈 디렉터리가 열린다.
 *  2. **결과는 잘라서 준다.** 도구 결과는 그대로 문맥에 쌓인다 — 큰 파일 한 번이면 대화가
 *     통째로 막힌다. 자를 때는 **잘랐다고 말한다**(모델이 전부인 줄 알면 잘못 판단한다).
 *  3. **판정하지 않는다.** 이 파일은 시키는 것을 하고 결과를 돌려줄 뿐, 허용 여부는
 *     호출자가 `resolveLocalToolGate` + 권한 브로커로 이미 정하고 들어온다.
 *
 * 도구 이름은 클로드 경로와 **같은 이름**이다(§5.19 (H)) — 권한 팝업·감사·도구 카드가 전부
 * 이름으로 갈라지므로, 다른 이름을 쓰면 같은 일이 화면에서 남남이 된다.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PlatformName } from '@vibisual/shared';
import { isPathWithin } from '@vibisual/shared';
import {
  LOCAL_TOOL_READ_MAX_BYTES,
  LOCAL_TOOL_RESULT_MAX_CHARS,
  LOCAL_WEB_SEARCH_MAX_HITS,
  LOCAL_WEB_SEARCH_API_URL,
  LOCAL_WEB_SEARCH_TIMEOUT_MS,
  LOCAL_TOOL_LIST_MAX_ENTRIES,
  LOCAL_TOOL_COMMAND_TIMEOUT_MS,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { augmentedEnv } from './binLocator.js';

/** 훑지 않는 폴더 — 여기까지 걸으면 목록·검색이 사실상 안 끝난다. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', '.vibisual', 'coverage', '.turbo',
]);

/** 도구 한 건의 결과. `isError` 는 실패를 **모델에게** 알리는 표식이다(던지지 않는다). */
export interface LocalToolOutcome {
  content: string;
  isError: boolean;
}

function ok(content: string): LocalToolOutcome {
  return { content, isError: false };
}
function fail(content: string): LocalToolOutcome {
  return { content, isError: true };
}

/**
 * 결과를 상한까지 자른다. **자른 사실을 본문에 남긴다** — 조용히 자르면 모델은 그것이
 * 파일의 전부인 줄 알고 없는 코드를 지웠다고 판단한다.
 */
export function clipToolResult(text: string, max = LOCAL_TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const dropped = text.length - max;
  return `${text.slice(0, max)}\n\n… [truncated ${String(dropped)} more characters]`;
}

/**
 * 루트 안의 절대경로로 푼다. 밖이면 `null` — **판정을 문자열 비교에 맡기지 않고** 풀어서 본다
 * (`..`·절대경로·심볼릭 링크가 전부 여기서 정리된다).
 */
export function resolveInRoot(
  root: string,
  candidate: string,
  platform: PlatformName = process.platform,
): string | null {
  if (!candidate || typeof candidate !== 'string') return null;
  // ⚠️ 링크는 **양쪽 다** 푼다. 대상만 풀고 루트를 안 풀면, 루트가 링크 위에 놓이는 순간
  //    루트 안의 파일이 전부 "밖"으로 판정된다 — mac 의 `/tmp`·`/var` 는 `/private/…` 로
  //    가는 링크라 거기 둔 프로젝트는 도구가 한 파일도 못 연다(2026-08-28 CI mac 러너에서
  //    이 파일 8건이 그렇게 죽었다. win 은 tmp 가 링크가 아니라 초록이었다 — 개발기 한 대로는
  //    영영 안 보이는 종류다). 링크를 푸는 목적은 **링크로 밖을 가리키는 경로를 막는 것**이지
  //    링크 위에 놓인 프로젝트를 통째로 막는 것이 아니다.
  const rootAbs = realpathOrSelf(path.resolve(root));
  const abs = path.resolve(rootAbs, candidate);
  // 실물이 있으면 링크까지 풀어서 다시 본다 — 링크로 밖을 가리키는 경로를 막는다.
  let probe = abs;
  try {
    probe = fs.realpathSync(abs);
  } catch {
    // 아직 없는 파일(새로 쓰는 경우)은 부모까지만 풀어 본다.
    try {
      probe = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      probe = abs; // 부모도 없으면 아래 판정으로 간다(mkdir 은 호출자가 한다)
    }
  }
  // 대소문자를 접을지는 `isPathWithin`(= `pathKey` 정본) 한 곳이 정한다. 여기 있던
  // `win32 ? toLowerCase : 그대로` 는 mac 을 빠뜨린 그 패턴의 **네 번째 자리**였다.
  return isPathWithin(probe, rootAbs, platform) ? probe : null;
}

/** 실물이 있으면 링크를 푼 경로, 없으면 준 경로 그대로(아직 만들지 않은 루트도 다룬다). */
function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** 화면·모델 양쪽에 쓸 상대 경로(루트 기준). 밖이면 절대경로 그대로. */
function rel(root: string, abs: string): string {
  const r = path.relative(path.resolve(root), abs);
  return r && !r.startsWith('..') ? r.split(path.sep).join('/') : abs;
}

// ─── 파일 훑기 ───

/** 루트 아래 파일을 걷는다. `SKIP_DIRS` 는 들어가지 않고, 상한을 넘으면 멈춘다. */
function walkFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 못 읽는 폴더는 건너뛴다 — 여기서 턴을 죽이지 않는다
    }
    for (const e of entries) {
      if (out.length >= limit) break;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (e.isFile()) out.push(full);
    }
  }
  return out;
}

/**
 * 글롭 한 줄을 정규식으로 옮긴다. `**` 는 경계를 넘고 `*` 는 한 칸 안에서만 움직인다.
 * 새 의존성을 들이지 않으려고 여기서 직접 옮긴다(필요한 문법이 이 셋뿐이다).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` 는 "0개 이상의 폴더" 라서 슬래시까지 함께 삼켜야 `src/**/*.ts` 가 `src/a.ts` 도 잡는다.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') { out += '[^/]'; continue; }
    if (c !== undefined && '\\^$.|+()[]{}'.includes(c)) { out += `\\${c}`; continue; }
    out += c ?? '';
  }
  return new RegExp(`^${out}$`, process.platform === 'win32' ? 'i' : '');
}

// ─── 도구 본체 ───

async function toolRead(root: string, args: Record<string, unknown>): Promise<LocalToolOutcome> {
  const p = typeof args['path'] === 'string' ? args['path'] : '';
  const abs = resolveInRoot(root, p);
  if (!abs) return fail(`path is outside the project root: ${p}`);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return fail(`file not found: ${rel(root, abs)}`);
  }
  if (stat.isDirectory()) return fail(`${rel(root, abs)} is a directory — use Glob to list files`);
  let buf: Buffer;
  try {
    buf = await fsp.readFile(abs);
  } catch (err) {
    return fail(`cannot read ${rel(root, abs)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let text = buf.subarray(0, LOCAL_TOOL_READ_MAX_BYTES).toString('utf8');
  if (buf.length > LOCAL_TOOL_READ_MAX_BYTES) text += '\n… [file truncated]';
  const lines = text.split('\n');
  const offset = typeof args['offset'] === 'number' && args['offset'] > 0 ? Math.floor(args['offset']) : 1;
  const limit = typeof args['limit'] === 'number' && args['limit'] > 0 ? Math.floor(args['limit']) : lines.length;
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  // 줄 번호를 붙여 준다 — 이걸 봐야 모델이 Edit 의 앵커를 정확히 고른다.
  const numbered = slice.map((l, i) => `${String(offset + i)}\t${l}`).join('\n');
  return ok(clipToolResult(numbered));
}

async function toolWrite(root: string, args: Record<string, unknown>): Promise<LocalToolOutcome> {
  const p = typeof args['path'] === 'string' ? args['path'] : '';
  const content = typeof args['content'] === 'string' ? args['content'] : null;
  if (content === null) return fail('content is required');
  const abs = resolveInRoot(root, p);
  if (!abs) return fail(`path is outside the project root: ${p}`);
  try {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  } catch (err) {
    return fail(`cannot write ${rel(root, abs)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return ok(`wrote ${rel(root, abs)} (${String(content.length)} chars)`);
}

async function toolEdit(root: string, args: Record<string, unknown>): Promise<LocalToolOutcome> {
  const p = typeof args['path'] === 'string' ? args['path'] : '';
  const oldStr = typeof args['old_string'] === 'string' ? args['old_string'] : null;
  const newStr = typeof args['new_string'] === 'string' ? args['new_string'] : null;
  const all = args['replace_all'] === true;
  if (oldStr === null || newStr === null) return fail('old_string and new_string are required');
  if (oldStr === newStr) return fail('old_string and new_string are identical — nothing to do');
  const abs = resolveInRoot(root, p);
  if (!abs) return fail(`path is outside the project root: ${p}`);
  let text: string;
  try {
    text = await fsp.readFile(abs, 'utf8');
  } catch {
    return fail(`file not found: ${rel(root, abs)}`);
  }
  const count = text.split(oldStr).length - 1;
  if (count === 0) return fail(`old_string not found in ${rel(root, abs)} — read the file again and copy the exact text`);
  // 유일하지 않은 앵커를 조용히 첫 번째에 적용하면 **엉뚱한 곳**이 바뀐다. 세어서 되돌려 준다.
  if (count > 1 && !all) {
    return fail(`old_string appears ${String(count)} times in ${rel(root, abs)} — add more context or set replace_all`);
  }
  const next = all ? text.split(oldStr).join(newStr) : text.replace(oldStr, newStr);
  try {
    await fsp.writeFile(abs, next, 'utf8');
  } catch (err) {
    return fail(`cannot write ${rel(root, abs)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return ok(`edited ${rel(root, abs)} (${String(count)} replacement${count > 1 ? 's' : ''})`);
}

function toolGlob(root: string, args: Record<string, unknown>): LocalToolOutcome {
  const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
  if (!pattern) return fail('pattern is required');
  const re = globToRegExp(pattern);
  const files = walkFiles(path.resolve(root), LOCAL_TOOL_LIST_MAX_ENTRIES * 8);
  const hits = files.map((f) => rel(root, f)).filter((r) => re.test(r)).slice(0, LOCAL_TOOL_LIST_MAX_ENTRIES);
  if (hits.length === 0) return ok(`no files match ${pattern}`);
  return ok(clipToolResult(hits.join('\n')));
}

function toolGrep(root: string, args: Record<string, unknown>): LocalToolOutcome {
  const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
  if (!pattern) return fail('pattern is required');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch (err) {
    return fail(`invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
  }
  const globRe = typeof args['glob'] === 'string' && args['glob'] ? globToRegExp(args['glob']) : null;
  const files = walkFiles(path.resolve(root), LOCAL_TOOL_LIST_MAX_ENTRIES * 8);
  const out: string[] = [];
  for (const f of files) {
    const r = rel(root, f);
    if (globRe && !globRe.test(r)) continue;
    let text: string;
    try {
      const buf = fs.readFileSync(f);
      if (buf.includes(0)) continue; // 이진 파일은 건너뛴다
      text = buf.subarray(0, LOCAL_TOOL_READ_MAX_BYTES).toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!re.test(line)) continue;
      out.push(`${r}:${String(i + 1)}: ${line.trim().slice(0, 300)}`);
      if (out.length >= LOCAL_TOOL_LIST_MAX_ENTRIES) break;
    }
    if (out.length >= LOCAL_TOOL_LIST_MAX_ENTRIES) break;
  }
  if (out.length === 0) return ok(`no matches for ${pattern}`);
  return ok(clipToolResult(out.join('\n')));
}

function toolBash(root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<LocalToolOutcome> {
  const command = typeof args['command'] === 'string' ? args['command'] : '';
  if (!command.trim()) return Promise.resolve(fail('command is required'));
  return new Promise<LocalToolOutcome>((resolve) => {
    const isWin = process.platform === 'win32';
    // §5.19 (H) — 셸에 **보강된 PATH** 를 물려준다. Finder/Dock 으로 띄운 macOS 앱은 launchd 의
    //   최소 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)만 들고 있어, env 를 넘기지 않으면 모델이 부른
    //   `git`·`node`·`pnpm`(전부 Homebrew 자리)이 죄다 `command not found` 로 돌아온다.
    //   모델은 그걸 "이 프로젝트엔 그 도구가 없다"로 읽고 엉뚱한 우회를 시작한다.
    const env = augmentedEnv();
    const child = isWin
      ? spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, windowsHide: true, env })
      : spawn('/bin/sh', ['-c', command], { cwd: root, env });
    let out = '';
    let done = false;
    const finish = (body: string, isError: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ content: clipToolResult(body), isError });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 이미 죽었으면 그만 */ }
      finish(`${out}\n[command timed out after ${String(LOCAL_TOOL_COMMAND_TIMEOUT_MS)}ms]`, true);
    }, LOCAL_TOOL_COMMAND_TIMEOUT_MS);
    // [중지]는 도구 실행도 함께 끊는다 — 안 끊으면 멈춘 뒤에도 명령이 계속 돈다.
    signal?.addEventListener('abort', () => {
      try { child.kill(); } catch { /* 이미 죽었으면 그만 */ }
      finish(`${out}\n[stopped by user]`, true);
    }, { once: true });
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', (err) => finish(`cannot run command: ${err.message}`, true));
    child.on('close', (code) => {
      const body = out.trim() || '(no output)';
      finish(code === 0 ? body : `${body}\n[exit code ${String(code)}]`, code !== 0);
    });
  });
}

/**
 * 도구 한 건을 실행한다. **던지지 않는다** — 실패도 모델이 읽고 고쳐 쓸 수 있게 결과로 준다
 * (여기서 예외가 새면 턴 전체가 죽고, 모델은 무엇이 잘못됐는지 영영 모른다).
 */
// ─── §5.19 (H) 바깥을 보는 도구 — 로컬 모델에게 특히 필요한 것 ───
//
// 로컬로 돌리는 모델은 학습 시점이 뒤처져 있고, 그 사실을 **자기가 모른다**. 파일만 보여 주면
// 옛 API 를 오늘 것인 양 쓴다. 그래서 바깥을 볼 수단은 클로드 경로보다 여기서 더 중요하다.

/** HTML 을 사람이 읽는 글로 접는다. 파서를 들이지 않는다 — 우리가 필요한 건 본문뿐이다. */
export function htmlToText(html: string): string {
  return html
    // 통째로 버릴 것들부터. 안에 든 글이 본문으로 새어 나오면 안 된다.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 줄이 되는 태그는 줄로 바꾼다(안 그러면 제목과 본문이 한 줄에 붙는다).
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    // 엔티티는 흔한 것만. 전부 풀려고 표를 들이면 그게 더 큰 짐이 된다.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** 우리가 브라우저인 척하지 않는다 — 다만 기본 UA 로는 막는 곳이 많아 이름은 밝힌다. */
const WEB_UA = 'Mozilla/5.0 (compatible; VibisualLocalAgent/1.0)';

async function toolWebFetch(args: Record<string, unknown>, signal?: AbortSignal): Promise<LocalToolOutcome> {
  const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
  if (!url) return fail('WebFetch needs a "url"');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(`WebFetch only speaks http and https, got ${parsed.protocol}`);
  }
  try {
    const res = await fetch(parsed.toString(), {
      headers: { 'user-agent': WEB_UA, accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      ...(signal ? { signal } : {}),
    });
    const type = res.headers.get('content-type') ?? '';
    const body = await res.text();
    if (!res.ok) {
      // 실패도 **결과로** 돌려준다 — 모델이 다른 주소를 고를 수 있어야 한다.
      return fail(`HTTP ${String(res.status)} from ${parsed.host}\n${htmlToText(body).slice(0, 500)}`);
    }
    const text = /json|text\/plain/i.test(type) ? body : htmlToText(body);
    if (!text.trim()) return fail(`${parsed.host} returned no readable text (content-type: ${type || 'unknown'})`);
    return ok(`${parsed.toString()}\n\n${text}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`could not fetch ${parsed.host}: ${msg}`);
  }
}

/** 여러 줄·연속 공백을 한 칸으로 접는다 — 모델에게 주는 한 줄 요약용. */
function collapseSpaces(s: string): string {
  return s.split(/\s+/).join(' ').trim();
}

/**
 * 요약 자리에 실려 오는 페이지 본문을 읽을 수 있게 다듬는다.
 *
 * 검색 창구는 `description` 에 **긁어 온 마크다운**을 그대로 담아 준다(실측 — `# 제목`,
 * `[Link for this heading](…)` 같은 것이 240자 중 절반을 먹는다). 모델이 볼 것은 "이 페이지가
 * 무슨 내용인가" 한 줄이므로, 링크는 글자만 남기고 장식 기호는 걷어낸다.
 */
export function tidySnippet(raw: string): string {
  let s = raw;
  // [글자](주소) → 글자 · ![대체글](주소) → 대체글
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 줄머리 장식(#, >, -, *, 숫자.)과 강조 기호
  s = s.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, ' ');
  s = s.replace(/[*_`]+/g, '');
  return collapseSpaces(s);
}

/**
 * 웹 검색 — **공식 창구를 부른다**(선택 근거는 shared `LOCAL_WEB_SEARCH_API_URL` 주석).
 *
 * 종전에는 검색 결과 **화면**(`html.duckduckgo.com`)을 받아 HTML 을 파싱했다. 키가 필요 없다는
 * 이유 하나로 골랐지만 그건 그 서비스 약관이 금지하는 자동 조회였고, 배포되는 제품이라
 * 우리 사용자들이 차단 대상이 되는 자리였다. 지금은 공개된 검색 API 를 부른다 — 키 없이도
 * 되고, 더 쓰려는 사용자는 `FIRECRAWL_API_KEY` 를 환경변수로 두면 자기 키로 올라간다.
 *
 * **못 읽으면 못 읽었다고 말하고 끝낸다** — 조용히 빈 결과를 주면 모델은 "검색해도 아무것도
 * 없다"로 잘못 배운다. 특히 한도를 넘긴 429 는 그 사실을 그대로 알려야 사용자가 손을 쓴다.
 */
async function toolWebSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<LocalToolOutcome> {
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return fail('WebSearch needs a "query"');

  const apiKey = process.env['FIRECRAWL_API_KEY'];
  // 시간 상한과 바깥의 중지를 한 컨트롤러로 모은다 — 모델을 멈췄는데 요청만 남는 일이 없게.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOCAL_WEB_SEARCH_TIMEOUT_MS);
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', () => ctl.abort(), { once: true });

  try {
    const res = await fetch(LOCAL_WEB_SEARCH_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': WEB_UA,
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query, limit: LOCAL_WEB_SEARCH_MAX_HITS }),
      signal: ctl.signal,
    });

    if (res.status === 429) {
      return fail(apiKey
        ? 'search is rate limited right now — wait a moment and try again, or use WebFetch on a URL you already know'
        : "this machine's free daily search quota is used up — wait for it to reset, set FIRECRAWL_API_KEY to raise it, or use WebFetch on a URL you already know");
    }
    if (!res.ok) return fail(`search is unavailable right now (HTTP ${String(res.status)})`);

    const hits = parseSearchHits(await res.json());
    if (hits.length === 0) {
      return fail(`no results could be read for "${query}" — try different words, or use WebFetch on a URL you already know`);
    }
    const lines = hits
      .slice(0, LOCAL_WEB_SEARCH_MAX_HITS)
      .map((h, i) => `${String(i + 1)}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`);
    return ok(`results for "${query}":\n\n${lines.join('\n')}`);
  } catch (err) {
    if (ctl.signal.aborted) return fail('search timed out');
    return fail(`could not search: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 검색 응답(`{ data: { web: [...] } }`)에서 제목·주소·요약을 건진다.
 * 모양이 바뀌면 빈 배열 — 거짓 결과를 지어내느니 "못 읽었다"가 낫다.
 */
export function parseSearchHits(body: unknown): Array<{ title: string; url: string; snippet: string }> {
  const web = (body as { data?: { web?: unknown } } | null | undefined)?.data?.web;
  if (!Array.isArray(web)) return [];
  const out: Array<{ title: string; url: string; snippet: string }> = [];
  for (const item of web) {
    const r = item as { url?: unknown; title?: unknown; description?: unknown };
    if (typeof r?.url !== 'string' || !r.url) continue;
    if (typeof r.title !== 'string' || !r.title) continue;
    // 요약 자리에 페이지 본문이 통째로 실려 오기도 한다 — 한 줄로 접어 잘라 넣는다.
    const snippet = typeof r.description === 'string' ? tidySnippet(r.description).slice(0, 240) : '';
    out.push({ title: collapseSpaces(r.title), url: r.url, snippet });
  }
  return out;
}

export async function runLocalTool(
  toolName: string,
  args: Record<string, unknown>,
  root: string,
  signal?: AbortSignal,
): Promise<LocalToolOutcome> {
  try {
    switch (toolName) {
      case 'Read': return await toolRead(root, args);
      case 'Write': return await toolWrite(root, args);
      case 'Edit': return await toolEdit(root, args);
      case 'Glob': return toolGlob(root, args);
      case 'Grep': return toolGrep(root, args);
      case 'Bash': return await toolBash(root, args, signal);
      case 'WebFetch': return await toolWebFetch(args, signal);
      case 'WebSearch': return await toolWebSearch(args, signal);
      default: return fail(`unknown tool: ${toolName}`);
    }
  } catch (err) {
    logger.warn(`[localTools] ${toolName} failed`, err);
    return fail(`${toolName} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 도구 카드 한 줄에 쓸 인자 요약 — 화면에 원문 JSON 을 통째로 붓지 않는다. */
export function summarizeToolInput(toolName: string, args: Record<string, unknown>): string {
  const pick = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string) : '');
  switch (toolName) {
    case 'Read': case 'Write': case 'Edit': return pick('path');
    case 'Glob': return pick('pattern');
    case 'Grep': return pick('glob') ? `${pick('pattern')}  (${pick('glob')})` : pick('pattern');
    case 'Bash': return pick('command');
    default: return JSON.stringify(args).slice(0, 200);
  }
}
