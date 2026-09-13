/**
 * §5.11 v3.88 — 플러그인 호스트 (서버).
 *
 * 코어(`index.ts`)는 `mountPluginRoutes(app)` 한 줄만 안다. 플러그인이 늘어도 코어를 다시 열지 않는 것이
 * 이 층의 목적이다.
 *
 * **자립 규약 ⑥ — 카드의 REST 창구는 이 파일에 없다.** v4.67 의 SSOT 지정 창구는 여기에 손으로 붙어 있었고,
 * 그래서 그 카드 폴더를 다른 앱에 복사해도 서버 쪽은 따라가지 않았다(자립 규약이 클라이언트에서만 지켜졌다).
 * 이제 경로는 각 카드 폴더의 `server.ts` 가 선언하고, 이 파일은 **틀만** 제공한다 —
 * 배럴(`@vibisual/plugins/server`)을 돌며 마운트하고, 파일 접근·원자적 쓰기·캐시 무효화를
 * `PluginServerHost` 로 건넨다. 카드는 express 도 `node:fs` 도 모른다.
 *
 * **재시작 불필요 설계**: 라우터는 부팅 시 전부 마운트하되 `requirePluginEnabled` 로 감싼다. 비활성이면
 * 409 로 끊기므로, 토글이 즉시 유효해지고 플러그인 코드가 활성 여부를 직접 확인할 필요도 없다.
 */
import fs from 'fs';
import path from 'path';
import type { Express, Request, RequestHandler, Response, Router } from 'express';
import { PLUGIN_API_PREFIX } from '@vibisual/shared';
import type {
  PluginFactMap, PluginPromptContext, PluginServerHost, PluginServerModule,
} from '@vibisual/plugins';
import {
  PLUGIN_MANIFESTS, hasOwnToggle, isPluginEnabledFor, resolveEnabledPluginsFor, validateRegistry,
} from '@vibisual/plugins';
// §5.11 정독 게이트 — 판정은 전부 이 순수 함수들이 한다(서버가 자기 판정을 따로 들지 않는다).
import {
  buildSpecIndexCached, evaluateSpecReading, extractCitations, readSpecSettings, verifyCitation,
} from '@vibisual/plugins';
import {
  DEFAULT_SPEC_READING_SETTINGS, SPEC_INDEX_TTL_MS, SPEC_WIRE_FILE_MAX, SPEC_WIRE_SPANS_PER_FILE,
  resolveSpecReadingEnabled,
} from '@vibisual/shared';
import type { SpecReadSpan, SpecReadingSettings, SpecReadingState, SpecRequiredEntry } from '@vibisual/shared';
import { specReadingService } from './specReadingService.js';
import { subAgentManager } from './subAgentManager.js';
import { PLUGIN_SERVER_MODULES } from '@vibisual/plugins/server';
import { buildPluginPromptParts, collectPluginFacts } from '@vibisual/plugins/prompt';
import { atomicWriteFileSync } from './statePersistence.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey } from './pathKey.js';
import { userDefaultsService } from './userDefaultsService.js';
import { loadAppState } from './appState.js';
import { graphManager } from './projectGraphManager.js';
import { logger } from '../logger.js';

/**
 * 이 요청이 어느 프로젝트 것인가 (§5.11 v4.54).
 *
 * 켬/끔이 프로젝트별이므로 관문도 프로젝트를 알아야 한다. 명시(`?projectId=`)가 우선이고, 없으면
 * 사용자가 마지막으로 보던 프로젝트(`appState.lastActiveProject`)로 본다 — 화면이 그 프로젝트를
 * 보고 있을 때 나가는 요청이기 때문. 새 상태·새 채널을 만들지 않고 이미 있는 값만 읽는다.
 */
function requestProjectId(req: Request): string | null {
  const raw = req.query?.projectId ?? req.get?.('x-vibisual-project');
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return loadAppState().lastActiveProject;
}

/**
 * 비활성 플러그인의 라우트를 409 로 끊는 미들웨어.
 * 활성 판정 SSOT 는 `UserDefaults.enabledPluginsByProject`(프로젝트별) — 창·클라 호스트와 같은 함수를 쓴다.
 */
export function requirePluginEnabled(id: string): RequestHandler {
  return (req, res, next) => {
    const projectId = requestProjectId(req);
    if (!isPluginEnabledFor(id, userDefaultsService.get(), projectId)) {
      res.status(409).json({ ok: false, error: 'plugin disabled', pluginId: id, projectId });
      return;
    }
    next();
  };
}

/**
 * 플러그인에게 넘길 파일 전문의 상한.
 *
 * ⚠ 여기서 두 번 틀렸다. ① "앞 64KB 면 헤딩 탐색은 충분하다" — 이 저장소의 SSOT 문서는 868KB 라
 * 앞부분만 보면 없는 절을 "없다"고 오판한다. ② "그럼 머리와 꼬리를" — 그 문서의 `## 11. Change Log`
 * 헤딩은 **정중앙(460KB 지점)** 에 있고 그 뒤로 이력 표가 429KB 이어진다. 즉 문서에서 무엇을 찾을지는
 * 호스트가 미리 알 수 없다. **자르지 말고 전문을 준다.**
 *
 * 대신 상한을 두고(그 위는 앞부분만) **mtime 캐시**로 같은 파일을 매 턴 다시 읽지 않게 한다 —
 * 서버가 메인 프로세스와 한 몸이라 큰 동기 읽기를 반복하면 그대로 UI 가 멎는다.
 */
const PLUGIN_READ_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 같은 파일을 다시 읽지 않는 최소 간격 (§5.11 v4.65).
 *
 * mtime 키만으로는 **실시간으로 append 되는 문서**에서 매번 빗나간다 — 이 저장소의 SSOT 문서가 정확히
 * 그렇고(외부 도구가 이력을 계속 덧붙인다), v4.65 에서 집행을 **이어지는 턴에도** 싣기 시작하면 그
 * 900KB 동기 읽기가 턴마다·세션마다 곱해진다(실측 1회 4ms). 집행이 보는 것은 "문서가 있는가 · 절이
 * 있는가"라 초 단위로 뒤집히지 않으므로, 이 창 안에서는 직전 내용을 그대로 쓴다.
 */
const PLUGIN_READ_TTL_MS = 10_000;

/**
 * 마지막으로 읽은 파일 몇 개 — 경로별 1칸.
 *
 * 키(mtime·size)가 같으면 당연히 재사용하고, **키가 달라졌어도 TTL 안이면** 재사용한다.
 * 경로를 키로 쓰는 이유: 내용이 계속 바뀌는 파일을 mtime 별로 쌓으면 같은 파일이 캐시를 다 차지한다.
 */
const readCache = new Map<string, { key: string; text: string; at: number }>();
const READ_CACHE_MAX = 8;

/**
 * §5.11 정독 게이트 — 폴더 훑기의 **호스트 쪽 상한**.
 *
 * 플러그인이 `opts` 로 더 큰 값을 불러도 여기서 잘린다. 훑는 양을 플러그인의 성실성에 맡기면 깊은 트리
 * 하나로 색인 한 번이 곧 UI 정지가 된다 — 서버가 메인 프로세스와 한 몸이기 때문이다.
 */
const PLUGIN_LIST_DEPTH_MAX = 6;
const PLUGIN_LIST_LIMIT_MAX = 500;
const PLUGIN_LIST_ENTRIES_MAX = 4_000;

/**
 * 훑을 때 아예 내려가지 않는 폴더.
 *
 * 산출물·의존성 폴더에는 마크다운이 수천 장 있고(패키지마다 README 가 있다) 그중 기획 문서는 하나도
 * 없다. 상한으로 자르면 **진짜 기획 문서가 그 뒤로 밀려** 색인에서 빠지므로, 자르기 전에 걸러야 한다.
 */
const PLUGIN_LIST_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'release', 'coverage',
  '.next', '.turbo', '.cache', '.vite', 'vendor', '__pycache__',
]);

/** 같은 폴더를 한 턴에 두 번 훑지 않는다(읽기 캐시와 같은 규율·같은 창). */
const listCache = new Map<string, { files: string[]; at: number }>();
const LIST_CACHE_MAX = 16;

/**
 * 플러그인에게 넘길 **좁은 파일 탐침** (§5.11 v4.57).
 *
 * 플러그인이 `node:fs` 를 직접 물면 "프로젝트 안"이라는 경계가 각 플러그인의 성실성에 달리게 된다.
 * 그래서 경로 정규화와 루트 이탈 차단을 여기서 한 번만 하고, 플러그인에는 함수 두 개만 준다.
 * 절대경로·`..` 탈출·심링크로 루트를 벗어나는 경로는 **존재하지 않는 것으로 취급**한다(던지지 않는다 —
 * 프롬프트 조립이 파일 하나 때문에 실패하면 그 턴 전체가 막힌다).
 */
function makeProjectProbe(
  projectPath: string,
): Pick<PluginPromptContext, 'fileExists' | 'readFile' | 'fileMtimeMs' | 'listFiles' | 'platform'> {
  const root = path.resolve(projectPath);
  const resolveInside = (relPath: string): string | null => {
    if (typeof relPath !== 'string' || relPath.trim() === '') return null;
    if (path.isAbsolute(relPath)) return null;
    const abs = path.resolve(root, relPath);
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return abs;
  };
  return {
    /**
     * §5.11 정독 게이트 — 경로를 **키로 쓸 때만** 이 값이 필요하다(멀티플랫폼 1축).
     *
     * 색인이 든 문서 경로와 훅이 남긴 열람 경로를 맞춰 보려면 케이스 정책이 있어야 하는데, 플러그인
     * 패키지는 클라에서도 로드되므로 `process.platform` 을 스스로 읽을 수 없다. 그래서 호스트가 넘긴다.
     */
    platform: process.platform,
    /**
     * §5.11 정독 게이트 — 폴더 하나를 훑어 **루트 기준 상대경로** 목록을 준다.
     *
     * `fileExists`/`readFile` 만으로는 "기획 문서가 어디에 몇 개 있는가"를 물을 수 없다. 후보 경로를
     * 손으로 나열하는 방식은 `docs/기획/전투.md` 처럼 프로젝트마다 다른 이름 앞에서 그대로 헛돈다
     * (`ssot-drift` 가 v4.67 에 후보 8개 하드코딩으로 겪은 실패가 그것이다).
     *
     * 경계는 다른 탐침과 같다 — 루트 밖은 존재하지 않는 것으로 취급하고, **심링크 폴더에는 안 내려간다**
     * (링크를 따라가면 루트 밖으로 나가거나 순환에 빠진다). 던지지 않는다.
     */
    listFiles: (relDir, opts) => {
      const abs = resolveInside(relDir);
      if (!abs) return [];
      const depthMax = Math.min(Math.max(1, Math.trunc(opts?.maxDepth ?? PLUGIN_LIST_DEPTH_MAX)), PLUGIN_LIST_DEPTH_MAX);
      const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? PLUGIN_LIST_LIMIT_MAX)), PLUGIN_LIST_LIMIT_MAX);
      const exts = (opts?.extensions ?? []).map((e) => e.toLowerCase());
      const cacheKey = `${abs}|${depthMax}|${limit}|${exts.join(',')}`;
      const hit = listCache.get(cacheKey);
      if (hit && Date.now() - hit.at < PLUGIN_READ_TTL_MS) return hit.files;

      const out: string[] = [];
      let seen = 0;
      const walk = (dir: string, depth: number): void => {
        if (out.length >= limit || seen >= PLUGIN_LIST_ENTRIES_MAX || depth > depthMax) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return; // 권한이 없는 폴더 하나 때문에 색인이 통째로 빠지면 안 된다
        }
        // 파일시스템마다 다른 `readdir` 순서를 고정한다 — 순서가 흔들리면 상한에 걸리는 문서가 매번 달라진다.
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const subDirs: string[] = [];
        for (const entry of entries) {
          if (out.length >= limit || seen >= PLUGIN_LIST_ENTRIES_MAX) return;
          seen++;
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (PLUGIN_LIST_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            subDirs.push(path.join(dir, entry.name));
            continue;
          }
          if (!entry.isFile()) continue;
          if (exts.length > 0 && !exts.some((e) => entry.name.toLowerCase().endsWith(e))) continue;
          out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
        }
        // 같은 층의 파일을 먼저 담고 그다음에 내려간다 — 얕은 문서가 상한 밖으로 밀리지 않게.
        for (const sub of subDirs) walk(sub, depth + 1);
      };
      try {
        if (!fs.statSync(abs).isDirectory()) return [];
        walk(abs, 1);
      } catch {
        return [];
      }

      if (!listCache.has(cacheKey) && listCache.size >= LIST_CACHE_MAX) {
        const oldest = listCache.keys().next();
        if (!oldest.done) listCache.delete(oldest.value);
      }
      listCache.set(cacheKey, { files: out, at: Date.now() });
      return out;
    },
    fileExists: (relPath) => {
      const abs = resolveInside(relPath);
      if (!abs) return false;
      try {
        return fs.statSync(abs).isFile();
      } catch {
        return false;
      }
    },
    /**
     * §5.11 v4.67 — 파일 시각만 주는 가장 좁은 탐침.
     *
     * 어긋남(drift)은 "언제 고쳤는가"의 문제라 내용만으로는 못 잰다. 여기서 시각 하나만 넘기면
     * 플러그인이 `git log` 같은 서브프로세스를 부를 이유가 사라진다(그것을 열면 플러그인이 임의
     * 명령을 실행하는 길이 생긴다 — §5.11 "슬롯 경유만"이 그 자리에서 무너진다).
     * 내용을 안 읽으므로 위 읽기 캐시와 무관하고, 비용은 `statSync` 한 번이다.
     */
    fileMtimeMs: (relPath) => {
      const abs = resolveInside(relPath);
      if (!abs) return null;
      try {
        const stat = fs.statSync(abs);
        return stat.isFile() ? stat.mtimeMs : null;
      } catch {
        return null;
      }
    },
    readFile: (relPath) => {
      const abs = resolveInside(relPath);
      if (!abs) return null;
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return null;
        const key = `${stat.mtimeMs}|${stat.size}`;
        const hit = readCache.get(abs);
        // 같은 판(키 일치)이거나, 바뀌었어도 아직 TTL 안이면 다시 읽지 않는다.
        if (hit && (hit.key === key || Date.now() - hit.at < PLUGIN_READ_TTL_MS)) return hit.text;

        const fd = fs.openSync(abs, 'r');
        let text: string;
        try {
          const length = Math.min(stat.size, PLUGIN_READ_MAX_BYTES);
          const buf = Buffer.alloc(length);
          const read = fs.readSync(fd, buf, 0, length, 0);
          text = buf.subarray(0, read).toString('utf-8');
          // 잘렸으면 본문에 남긴다 — 플러그인이 "전문을 봤다"고 착각하지 않게.
          if (stat.size > length) text += `\n\n[... ${stat.size - length} bytes omitted by host ...]`;
        } finally {
          fs.closeSync(fd);
        }

        // 오래된 것부터 버린다(Map 은 삽입 순서를 지킨다). 프로젝트당 후보 문서가 몇 개 안 되므로 8이면 넉넉.
        if (!readCache.has(abs) && readCache.size >= READ_CACHE_MAX) {
          const oldest = readCache.keys().next();
          if (!oldest.done) readCache.delete(oldest.value);
        }
        readCache.set(abs, { key, text, at: Date.now() });
        return text;
      } catch {
        return null;
      }
    },
  };
}

/** `buildPluginPromptSection` 이 받는 것 — 파일 탐침은 호스트가 채우므로 호출부는 몰라도 된다. */
export type PluginPromptRequest = Omit<
  PluginPromptContext,
  'fileExists' | 'readFile' | 'listFiles' | 'platform' | 'promptText' | 'touchedPaths' | 'readingSpans' | 'readingCitations' | 'specSettings'
> & {
  /**
   * §5.11 정독 게이트 — 이 턴을 내는 세션(`SubAgent.id` = 원장 키).
   *
   * 있으면 호스트가 그 세션의 **읽기 영수증·이번 턴 프롬프트·건드린 경로**를 컨텍스트에 채운다.
   * 호출부가 원장을 직접 만지지 않게 하는 것이 요점이다 — 만지기 시작하면 프롬프트 조립 경로마다
   * 조금씩 다른 재료가 실려 같은 세션이 자리마다 다른 판정을 받는다.
   */
  subAgentId?: string;
};

/**
 * §5.11 정독 게이트 — 이 세션의 원장·설정을 컨텍스트 필드로 옮긴다.
 *
 * 원장은 `specReadingService`(휘발), 설정은 체크포인트(영속)에 있고 둘 다 플러그인이 닿을 수 없는
 * 자리다. 여기서 한 번만 모아 넘기므로 판정 함수는 "누가 채워 줬는지" 를 몰라도 된다.
 */
function readingFieldsFor(
  projectPath: string,
  subAgentId: string | undefined,
): Pick<PluginPromptContext, 'promptText' | 'touchedPaths' | 'readingSpans' | 'readingCitations' | 'specSettings'> {
  // 이 축이 못 서더라도 **나머지 집행은 그대로 실려야 한다** — 설정 조회 하나가 실패해서 켠 카드
  //   전부가 프롬프트에서 사라지면, 사용자는 켰는데 아무 일도 안 일어나는 상태를 보게 된다.
  let settings: SpecReadingSettings | undefined;
  let ledger: ReturnType<typeof specReadingService.contextFieldsFor>;
  try {
    settings = graphManager.getSpecReadingSettings?.(projectPath);
    ledger = subAgentId ? specReadingService.contextFieldsFor(subAgentId) : undefined;
  } catch {
    settings = undefined;
    ledger = undefined;
  }
  return {
    ...(settings ? { specSettings: settings } : {}),
    ...(ledger
      ? {
          promptText: ledger.promptText,
          touchedPaths: ledger.touchedPaths,
          readingSpans: ledger.readingSpans,
          readingCitations: ledger.readingCitations,
        }
      : {}),
  };
}

/**
 * §5.11 v4.57 — 이 프로젝트에서 **켜진 집행 플러그인들의 지시 블록**을 조립한다.
 *
 * 코어(`index.ts`)는 이 함수 한 줄만 안다. 켠 것이 없으면 **빈 문자열**이라 프롬프트가 한 글자도 늘지
 * 않는다 — 플러그인을 안 쓰는 프로젝트는 이 기능이 없던 때와 완전히 같아야 하기 때문이다.
 *
 * ⚠ 매 턴 호출된다(§5.11 "재시작 불필요"). 그래서 판정도 매번 다시 하며, 창에서 방금 끈 것은 **다음
 * 턴부터 즉시** 빠진다. 결과를 캐시하면 그 즉시성이 조용히 사라진다.
 */
export function buildPluginPromptSection(req: PluginPromptRequest): string {
  return buildPluginPromptSectionParts(req).map((p) => p.block).join('');
}

/**
 * §5.5 #17-28 — 같은 조립을 **플러그인별 조각**으로. 주입원 통제 화면이 한 줄씩 보여 주고 개별로 끄려면
 * 합쳐지기 전의 조각이 필요하다. 이어 붙이면 `buildPluginPromptSection` 과 같은 문자열이다.
 */
export function buildPluginPromptSectionParts(req: PluginPromptRequest): { id: string; block: string }[] {
  if (!req.projectPath) return [];
  try {
    const ctx: PluginPromptContext = {
      ...req,
      ...readingFieldsFor(req.projectPath, req.subAgentId),
      ...makeProjectProbe(req.projectPath),
    };
    const parts = buildPluginPromptParts(userDefaultsService.get(), req.projectPath, ctx, (id, err) =>
      logger.warn(`[plugins] prompt block failed: ${id} — ${err instanceof Error ? err.message : String(err)}`),
      process.platform,
    );
    // v4.65 — 방금 판단한 근거를 그대로 남긴다(같은 탐침을 쓰므로 파일 재읽기 없음). 카드가 이 값을
    //   그리기 때문에, 화면은 "에이전트가 실제로 받은 것"과 어긋날 수 없다.
    recordPluginFacts(req.projectPath, collectPluginFacts(userDefaultsService.get(), req.projectPath, ctx, (id, err) =>
      logger.warn(`[plugins] survey failed: ${id} — ${err instanceof Error ? err.message : String(err)}`),
      process.platform,
    ));
    return parts;
  } catch (err) {
    // 프롬프트 조립은 실행 경로 한복판이다 — 여기서 던지면 그 턴 자체가 안 나간다.
    logger.warn(`[plugins] prompt section failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * §5.11 v4.65 — 프로젝트별 **집행 실측** 저장고.
 *
 * 카드는 클라에 있어 파일을 못 본다. 그래서 서버가 집행을 조립하는 그 순간의 실측을 여기 남기고,
 * 스냅샷이 그 값을 그대로 내려보낸다 — **화면이 프롬프트와 같은 것을 말하게** 하는 유일한 통로다.
 *
 * 값은 파일에서 언제든 다시 구할 수 있으므로 **영속하지 않는다**(체크포인트 4지점 무관, 재시작하면
 * 다음 턴·다음 조회에서 다시 채워진다).
 */
const factsStore = new Map<string, { facts: Record<string, PluginFactMap>; at: number; enabledKey: string }>();

/** 조회 시 다시 재는 최소 간격 — 켠 집합이 바뀌면 이 창을 무시하고 즉시 다시 잰다(토글 즉시성). */
const FACTS_TTL_MS = 30_000;

/**
 * §5.5 #17-44 ⑧(d) — 켬 목록을 묻지 않는 카드가 **하나라도** 등록돼 있는가.
 *
 * 있으면 "이 프로젝트에서 켠 것이 0개"여도 실측을 낼 것이 남아 있다. 등록부에서 뽑으므로
 * 그 축을 쓰는 카드가 늘거나 없어져도 이 판정이 따라온다(손으로 적으면 여기만 조용히 낡는다).
 */
const HAS_OWN_TOGGLE = PLUGIN_MANIFESTS.some(hasOwnToggle);

/** 켬/끔 상태의 지문 — 이 값이 바뀌면 캐시를 버린다. */
function enabledFingerprint(projectPath: string): string {
  return [...resolveEnabledPluginsFor(userDefaultsService.get(), projectPath, process.platform)].sort().join(',');
}

/** 프로젝트 키 정규화 — 창·서버가 표기만 다른 같은 폴더를 두 칸으로 갈라 보지 않게 한다.
 *  대소문자는 그 플랫폼이 실제로 무시할 때만 접는다 — linux 에서 접으면 케이스만 다른 두
 *  프로젝트가 서로의 집행 실측을 보게 된다. */
function factsKey(projectPath: string): string {
  return pathKey(path.resolve(projectPath));
}

/**
 * 집행을 조립한 쪽이 그때의 실측을 신고한다. 프롬프트 경로에서 이미 읽은 값을 재사용하므로 **추가
 * 파일 읽기가 0** 이고, 카드는 "에이전트가 실제로 받은 것"과 같은 값을 보게 된다.
 */
function recordPluginFacts(projectPath: string, facts: Record<string, PluginFactMap>): void {
  factsStore.set(factsKey(projectPath), { facts, at: Date.now(), enabledKey: enabledFingerprint(projectPath) });
}

/**
 * 이 프로젝트의 집행 실측 — 스냅샷 조립이 쓴다.
 *
 * 턴이 한 번이라도 돌았으면 그때의 값을 그대로 주고, 없으면(켜 두고 아직 아무것도 안 시킨 경우)
 * 여기서 한 번 잰다 — 카드를 열자마자 값이 보이게 하려는 것이고, 파일 읽기는 위 TTL 캐시가 막는다.
 * 켠 집행 모듈이 하나도 없으면 **빈 객체**라 스냅샷에 필드가 생기지 않는다.
 */
export function getPluginFactsFor(projectPath: string): Record<string, PluginFactMap> {
  if (!projectPath) return {};
  try {
    const key = factsKey(projectPath);
    const enabledKey = enabledFingerprint(projectPath);
    const hit = factsStore.get(key);
    if (hit && hit.enabledKey === enabledKey && Date.now() - hit.at < FACTS_TTL_MS) return hit.facts;
    // §5.5 #17-44 ⑧(d) — 켠 것이 하나도 없어도 손잡이가 자기 화면에 있는 카드는 실측을 낸다.
    //   여기서 조기 반환하면 그 카드의 계기판이 "측정 전"에 영영 머물러, 꺼져 있다는 사실조차 못 그린다.
    if (enabledKey === '' && !HAS_OWN_TOGGLE) return {};

    const ctx: PluginPromptContext = {
      projectPath,
      cwd: projectPath,
      // 실측은 **프로젝트 단위**다(어느 에이전트가 물었는지에 따라 달라지는 값은 카드가 자기 컨텍스트로
      // 계산한다). 그래서 여기서는 에이전트 자리를 비워 두고, 이 계약을 타입 주석에도 적어 두었다.
      agentId: '',
      agentLabel: '',
      customCreated: true,
      ...makeProjectProbe(projectPath),
    };
    const facts = collectPluginFacts(userDefaultsService.get(), projectPath, ctx, (id, err) =>
      logger.warn(`[plugins] survey failed: ${id} — ${err instanceof Error ? err.message : String(err)}`),
      process.platform,
    );
    factsStore.set(key, { facts, at: Date.now(), enabledKey });
    return facts;
  } catch (err) {
    logger.warn(`[plugins] facts failed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * 여러 프로젝트의 실측을 한 벌로 — `graph_snapshot` 이 프로젝트 여럿을 담기 때문이다.
 * 값이 있는 프로젝트만 담고, 하나도 없으면 `undefined` 를 준다(필드 자체가 안 생기게).
 */
export function getPluginFactsForProjects(projectPaths: readonly string[]): Record<string, Record<string, PluginFactMap>> | undefined {
  const out: Record<string, Record<string, PluginFactMap>> = {};
  for (const p of projectPaths) {
    if (!p) continue;
    const facts = getPluginFactsFor(p);
    if (Object.keys(facts).length > 0) out[p] = facts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * §5.11 v4.65 — CMD(인터랙티브 터미널) 세션에 실을 집행 블록.
 *
 * 그 경로는 프롬프트를 우리가 조립하지 않는다(사람이 REPL 을 직접 몬다). 대신 rules 를 넘기는 통로가
 * 이미 있다 — `~/.vibisual/cmd-agents/<agentId>/CLAUDE.md` + `--add-dir`. 집행도 **같은 통로**로 간다.
 * 새 채널을 만들지 않는 것이 요점이고, 이미 떠 있는 세션에는 소급되지 않는다(rules 와 같은 규칙).
 */
export function buildInteractivePluginBlock(projectPath: string, agentId: string, agentLabel: string): string {
  return buildPluginPromptSection({ projectPath, cwd: projectPath, agentId, agentLabel, customCreated: true });
}

/**
 * CMD 버블 하나의 집행 블록 — 터미널 매니저(desktop main)가 세션을 띄우기 직전에 부른다.
 *
 * 프로젝트 해결을 여기서 하는 이유: 켬/끔 키는 **프로젝트 루트 절대경로**인데 터미널이 아는 것은 그
 * 터미널의 cwd 다(워크트리·하위 폴더면 키가 어긋나 켠 것이 안 걸린다). 에이전트 → 프로젝트는 그래프가
 * 권위 있게 알고 있으므로 그 답을 쓴다. 프로젝트를 못 찾으면 빈 문자열(= 종전과 동일).
 */
export function buildInteractivePluginBlockForAgent(agentId: string): string {
  try {
    const projectPath = graphManager.getProjectPathForAgent(agentId);
    if (!projectPath) return '';
    // 라벨 자리에 id 를 쓴다 — 집행 블록은 프로젝트 사실만 말하고 에이전트 이름을 문구에 넣지 않는다.
    return buildInteractivePluginBlock(projectPath, agentId, agentId);
  } catch (err) {
    logger.warn(`[plugins] cmd enforcement block failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * 방금 쓴 파일이 곧바로 화면에 반영되게 캐시를 비운다.
 *
 * 읽기 캐시는 **10초 TTL** 이라(§5.11 v4.65 — 실시간 append 되는 큰 문서 때문에 넣은 창), 지우지 않으면
 * 사용자가 지정을 바꾼 직후 최대 10초 동안 옛 답이 그대로 나온다. "저장했는데 안 바뀌네"가 거기서 난다.
 */
function invalidateProjectCaches(projectPath: string): void {
  // 경로 접두 비교 — linux 에서 접으면 남의 프로젝트 캐시까지 함께 지운다(불필요한 재읽기).
  const root = pathKey(path.resolve(projectPath));
  for (const key of [...readCache.keys()]) {
    if (pathKey(key).startsWith(root)) readCache.delete(key);
  }
  factsStore.delete(factsKey(projectPath));
}

/**
 * §5.11 자립 규약 ⑥ — **서버측 플러그인에게 여는 창구.**
 *
 * 클라이언트의 `ctx.call` 과 같은 원칙이다 — 플러그인은 `node:fs` 도 서버 내부 서비스도 모르고,
 * 프로젝트 루트를 벗어나는 길이 없다. 경로 정규화·이탈 차단·원자적 쓰기는 여기서 한 번만 한다.
 */
function makeServerHost(): PluginServerHost {
  return {
    probe: (projectPath) => makeProjectProbe(projectPath),
    writeProjectFile: (projectPath, relPath, text) => {
      if (typeof relPath !== 'string' || relPath.trim() === '' || path.isAbsolute(relPath)) return false;
      const root = path.resolve(projectPath);
      const abs = path.resolve(root, relPath);
      const rel = path.relative(root, abs);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
      try {
        atomicWriteFileSync(abs, text);
        return true;
      } catch (err) {
        logger.warn(`[plugins] write failed (${relPath}): ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    facts: (projectPath, pluginId) => getPluginFactsFor(projectPath)[pluginId] ?? null,
    invalidate: (projectPath) => invalidateProjectCaches(projectPath),
    log: (message) => logger.warn(`[plugins] ${message}`),
  };
}

/**
 * 배럴에 실린 카드의 경로를 붙인다 — **경로 하나하나를 `app.get/put/post` 로** 등록한다.
 *
 * `app.use(라우터)` 로 묶지 않는 이유: 그러면 어떤 경로가 열렸는지 이 파일에서도, 검사에서도 안 보인다.
 * 관문(`requirePluginEnabled`)은 경로마다 붙으므로 켬/끔이 재시작 없이 즉시 유효하다.
 */
function mountModuleRoutes(app: Express, mod: PluginServerModule, host: PluginServerHost): void {
  for (const route of mod.routes ?? []) {
    const full = `${PLUGIN_API_PREFIX}/${mod.manifest.id}/${route.path}`;
    app[route.method](full, requirePluginEnabled(mod.manifest.id), (req: Request, res: Response) => {
      const projectPath = requestProjectId(req);
      try {
        const out = route.handle(
          {
            projectPath,
            projectName: projectPath ? path.basename(path.resolve(projectPath)) : null,
            // 신뢰할 수 없는 입력을 형태만 좁히는 일은 **경계에 선 호스트가 한 번만** 한다 —
            // 값은 전부 `unknown` 이라 카드가 하나씩 확인해야 하고, 카드 쪽에 캐스트가 남지 않는다.
            body: (req.body ?? {}) as Record<string, unknown>,
            // 헤더가 없으면 빈 문자열 — 플러그인이 본문의 locale 로 폴백할 수 있게 남겨 둔다.
            locale: req.get?.('x-vibisual-locale') ?? '',
          },
          host,
        );
        res.status(out.status ?? 200).json(out.body);
      } catch (err) {
        // 카드 하나가 던져도 서버는 살아야 한다 — 그 경로만 500 으로 끊는다.
        logger.warn(`[plugins] ${mod.manifest.id} ${route.method} ${route.path} failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ ok: false, error: 'plugin route failed' });
      }
    });
  }
}

export function mountPluginRoutes(app: Express): void {
  const problems = validateRegistry();
  for (const problem of problems) logger.warn(`[plugins] ${problem}`);

  // 목록 조회 — 활성 상태는 user-defaults 가 SSOT 이므로 여기서는 매니페스트 + 계산된 enabled 만 준다.
  // v4.54: 켬/끔이 프로젝트별이라 "어느 프로젝트 기준인가"를 응답에 함께 실어야 호출자가 오해하지 않는다.
  app.get(PLUGIN_API_PREFIX, (req, res) => {
    const projectId = requestProjectId(req);
    // 플랫폼을 넘겨 linux 에서 케이스만 다른 두 프로젝트가 활성 목록을 공유하지 않게 한다.
    const enabled = resolveEnabledPluginsFor(userDefaultsService.get(), projectId, process.platform);
    res.json({
      projectId,
      plugins: PLUGIN_MANIFESTS.map((m) => ({ ...m, enabled: enabled.has(m.id) })),
    });
  });

  // 자립 규약 ⑥ — 카드의 REST 창구는 전부 **배럴을 통해서만** 붙는다. v4.67 의 SSOT 지정 창구가 이 파일에
  //   손으로 붙어 있던 것을 그 카드 폴더(`ssot-drift/server.ts`)로 옮겼다 — 폴더를 복사하면 서버 쪽도 간다.
  const host = makeServerHost();
  for (const mod of PLUGIN_SERVER_MODULES) {
    mountModuleRoutes(app, mod, host);
    if (mod.createRouter) {
      const router = mod.createRouter() as Router;
      app.use(`${PLUGIN_API_PREFIX}/${mod.manifest.id}`, requirePluginEnabled(mod.manifest.id), router);
    }
    logger.info(`[plugins] mounted ${PLUGIN_API_PREFIX}/${mod.manifest.id} (${(mod.routes ?? []).length} route(s))`);
  }

  logger.info(`[plugins] registry: ${PLUGIN_MANIFESTS.length} manifest(s), ${PLUGIN_SERVER_MODULES.length} server module(s)`);
}

// ─── §5.11 정독 게이트 — 판정·게이트 창구 ────────────────────────────────────

/**
 * 이 세션의 정독 상태 한 벌.
 *
 * 판정은 플러그인의 `evaluateSpecReading` **하나**가 하고, 여기서는 파일 탐침과 원장을 붙여 주기만
 * 한다. 서버가 자기 판정을 따로 들면 프롬프트에 실린 판단과 게이트가 막는 근거가 갈리고, 그러면
 * "화면은 초록인데 막힌다"가 만들어진다 — 사용자가 이 기능을 못 믿게 되는 정확한 경로다.
 *
 * 이 카드를 안 켠 프로젝트에서는 **아무것도 계산하지 않는다**(끈 프로젝트는 이 기능이 없던 때와 같아야 한다).
 */
/**
 * 히트맵을 **전선 크기로** 줄인다 — 원장이 드는 양과 화면에 싣는 양은 다른 문제다.
 *
 * 원장은 판정 재료라 파일 60개 x 구간 200개까지 든다. 그것을 그대로 실으면 세션 하나가 매
 * 브로드캐스트(16~250ms)마다 수백 KB 를 밀어낸다(§9 전선 예산). 사용자가 실제로 보는 것은 **필수 절이
 * 가리키는 문서**와 방금 연 몇 개다 — 필수 절 쪽은 상한과 무관하게 항상 싣고, 나머지는 최근 순으로 채운다.
 *
 * 원장의 배열을 그대로 넘기지 않고 **복사**한다. 같은 배열을 스냅샷에 실으면 다음 `Read` 가 그 배열을
 * 밀어 넣는 순간 이미 보낸 스냅샷의 내용까지 뒤에서 바뀐다(증분 비교의 기준점이 흔들린다).
 */
function shapeSpansForWire(
  spans: Readonly<Record<string, readonly SpecReadSpan[]>>,
  required: readonly SpecRequiredEntry[],
  fileLines: Record<string, number>,
): { spans: Record<string, SpecReadSpan[]>; fileLines: Record<string, number> } {
  const pinned = new Set(required.map((r) => r.file));
  const rest = Object.keys(spans)
    .filter((f) => !pinned.has(f))
    .sort((a, b) => lastSpanAt(spans[b]) - lastSpanAt(spans[a]));
  const keep = [
    ...Object.keys(spans).filter((f) => pinned.has(f)),
    ...rest.slice(0, Math.max(0, SPEC_WIRE_FILE_MAX - pinned.size)),
  ].sort();

  const outSpans: Record<string, SpecReadSpan[]> = {};
  const outLines: Record<string, number> = {};
  for (const file of keep) {
    const list = spans[file] ?? [];
    // 넘치면 **오래된 구간**을 버린다 — 남길 것은 방금 연 쪽이다. 정렬은 줄 번호 순이어야 히트맵이
    //   매번 같은 모양으로 그려지고, 그래야 증분 비교도 내용이 같을 때 같다고 판정한다.
    const trimmed = list.length > SPEC_WIRE_SPANS_PER_FILE
      ? list.slice(list.length - SPEC_WIRE_SPANS_PER_FILE)
      : list;
    outSpans[file] = [...trimmed].sort((a, b) => a.fromLine - b.fromLine);
    const total = fileLines[file];
    if (typeof total === 'number') outLines[file] = total;
  }
  return { spans: outSpans, fileLines: outLines };
}

/** 이 파일에서 마지막으로 연 시각 — 최근 순 정렬의 자다. */
function lastSpanAt(list: readonly SpecReadSpan[] | undefined): number {
  let at = 0;
  for (const s of list ?? []) if (s.at > at) at = s.at;
  return at;
}

/**
 * 세션별 마지막 정독 상태 — **참조를 지키기 위한 자리**다.
 *
 * 이 슬라이스는 증분(`DELTA_SLICE_KEYS`)을 타는데, 매 스냅샷마다 새 객체를 지으면 증분이 "전부 바뀜"으로
 * 잡혀 부피가 줄기는커녕 `changed` 사본만 한 벌 더 든다. 원장 판 번호가 그대로면 **직전 객체를 그대로**
 * 돌려주는 것이 그 조건을 세우는 방법이다(`ProjectGraph.stableCopy` 와 같은 수법).
 */
const specStateCache = new Map<string, { key: string; builtAt: number; state: SpecReadingState | undefined }>();

/**
 * §5.5 #17-44 ⑧ — 이 세션의 소속 에이전트 버블 id. 못 찾으면 빈 문자열이다.
 *
 * 켬/끔 3층의 가운데 칸을 고르는 열쇠다. 못 찾았다고 판정을 멈추지 않는다 — 그 층만 조용히 접히고
 * 프로젝트 층이 그대로 답한다(§5.11 선택 탐침과 같은 규율).
 */
function ownerAgentIdOf(subAgentId: string): string {
  for (const sub of subAgentManager.getAllSubsFlat()) if (sub.id === subAgentId) return sub.parentAgentId;
  return '';
}

export function getSpecReadingState(subAgentId: string, projectPath?: string): SpecReadingState | undefined {
  const project = projectPath ?? specReadingService.projectOf(subAgentId);
  if (!subAgentId || !project) return undefined;
  // §5.5 #17-44 ⑧(d) — 플러그인 켬/끔은 더 묻지 않는다. 이 카드는 목록에서 내렸으므로 그 판정이
  //   영원히 false 가 되고, 남겨 두면 계측·게이트가 통째로 죽는다. 관문은 아래 3층 하나다.
  try {
    const version = specReadingService.versionOf(subAgentId);
    const fields = readingFieldsFor(project, subAgentId);
    // 설정은 원장과 **따로** 바뀐다(사용자가 강도를 바꾼 순간). 판 번호에 같이 묶지 않으면 바꾼 설정이
    //   다음 도구 호출 때까지 화면에 안 나타난다 — 읽히지 않는 설정 스위치가 되는 자리다.
    const key = `${version}|${JSON.stringify(fields.specSettings ?? null)}`;
    const hit = specStateCache.get(subAgentId);
    // 파일 쪽 근거(`.vibisual/spec.json`·문서 mtime)는 판 번호가 없다. 색인 캐시와 **같은 수명**으로
    //   다시 재어 그 변화가 늦어도 한 주기 안에는 반영되게 한다.
    if (hit && hit.key === key && Date.now() - hit.builtAt < SPEC_INDEX_TTL_MS) return hit.state;

    const ctx: PluginPromptContext = {
      projectPath: project,
      cwd: project,
      // §5.5 #17-44 ⑧ — 켬/끔 3층이 이 둘로 칸을 고른다. 종전에는 빈 문자열이라 에이전트·세션 층을
      //   물어볼 수조차 없었다.
      agentId: ownerAgentIdOf(subAgentId),
      subAgentId,
      agentLabel: '',
      customCreated: true,
      ...fields,
      ...makeProjectProbe(project),
    };
    /*
     * §5.5 #17-44 ⑧ — 3층 스위치. 꺼져 있으면 **계측 자체를 세우지 않는다**(배지·뷰·게이트가 함께 조용).
     *
     * 판정에 파일 설정(`.vibisual/spec.json`)까지 넣으려고 ctx 를 만든 **뒤에** 묻는다 — 체크포인트만
     * 보면 팀이 그 파일로 켠 프로젝트에서 프롬프트는 실리는데 화면만 비는 어긋남이 생긴다(v4.65 규율).
     * 꺼짐도 **같은 메모에 담는다** — 안 담으면 스냅샷마다(16~250ms) 그 파일을 다시 읽게 된다.
     */
    if (!resolveSpecReadingEnabled(readSpecSettings(ctx), { agentId: ctx.agentId, subAgentId })) {
      specStateCache.set(subAgentId, { key, builtAt: Date.now(), state: undefined });
      return undefined;
    }
    const evaluation = evaluateSpecReading(ctx);
    const view = specReadingService.viewFieldsFor(subAgentId);
    const shaped = shapeSpansForWire(fields.readingSpans ?? {}, evaluation.required, view?.fileLines ?? {});
    const state: SpecReadingState = {
      strength: evaluation.settings.strength,
      indexUnits: evaluation.index.units.length,
      indexDocs: evaluation.index.docCount,
      indexTruncated: evaluation.index.truncated,
      indexedAt: evaluation.index.builtAt,
      required: evaluation.required,
      spans: shaped.spans,
      fileLines: shaped.fileLines,
      trust: evaluation.trust,
      gate: view?.gate ?? [],
      stopRetries: view?.stopRetries ?? 0,
      // 재는 시각이 아니라 **원장의 판 번호**다. 여기에 `Date.now()` 를 쓰면 내용이 같아도 매번 다른
      //   객체가 되어 위 캐시가 무의미해진다.
      updatedAt: version,
      // §5.5 #17-44 ③-1 — 무엇이 색인 밖으로 밀렸는지·어디를 훑었는지. "문서 120개를 색인했다"만으로는 알 수 없다.
      indexSkipped: evaluation.index.skippedCount,
      indexSkippedDocs: evaluation.index.skippedDocs,
      indexExcluded: evaluation.index.excludedCount,
      roots: evaluation.index.roots,
    };
    // 다시 계산했는데 내용이 같으면(색인만 다시 세운 경우 등) 직전 객체를 그대로 쓴다.
    const same = hit && JSON.stringify(hit.state) === JSON.stringify(state) ? hit.state : state;
    specStateCache.set(subAgentId, { key, builtAt: Date.now(), state: same });
    return same;
  } catch (err) {
    logger.warn(`[spec] state failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** 스냅샷에 실을 세션별 정독 상태. 원장을 든 세션만 담고, 하나도 없으면 `undefined`(필드 자체가 안 생긴다). */
export function getSpecReadingStates(): Record<string, SpecReadingState> | undefined {
  const out: Record<string, SpecReadingState> = {};
  const live = new Set<string>();
  for (const subAgentId of specReadingService.sessionIds()) {
    live.add(subAgentId);
    const state = getSpecReadingState(subAgentId);
    if (state) out[subAgentId] = state;
  }
  // 원장이 사라진 세션의 메모까지 남겨 두면 그 자리가 §3.2.4 의 "키 개수엔 캡이 없다" 그대로가 된다.
  for (const id of [...specStateCache.keys()]) if (!live.has(id)) specStateCache.delete(id);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 테스트 전용 — 정독 상태 메모를 비운다. */
export function resetSpecReadingStateCache(): void {
  specStateCache.clear();
}

/**
 * 에이전트가 낸 글에서 인용을 뽑아 **원문과 대조**하고 원장에 남긴다.
 *
 * 뽑는 형식은 프롬프트가 시키는 형식과 같은 파일(`spec.ts`)에 있다 — 둘이 갈리면 에이전트는 시킨 대로
 * 적었는데 우리는 못 알아보고 "인용 없음"으로 판정하게 되고, 그러면 게이트가 성실한 쪽을 벌한다.
 */
export function verifySpecCitationsFrom(subAgentId: string, text: string, projectPath?: string): void {
  const project = projectPath ?? specReadingService.projectOf(subAgentId);
  if (!subAgentId || !project || typeof text !== 'string' || text.trim() === '') return;
  try {
    const ctx: PluginPromptContext = {
      projectPath: project,
      cwd: project,
      agentId: ownerAgentIdOf(subAgentId),
      subAgentId,
      agentLabel: '',
      customCreated: true,
      ...readingFieldsFor(project, subAgentId),
      ...makeProjectProbe(project),
    };
    const settings = readSpecSettings(ctx);
    // §5.5 #17-44 ⑧ — 꺼져 있으면 인용도 대조하지 않는다. 대조 결과가 원장에 쌓이면 나중에 켰을 때
    //   **끄고 있던 동안의 판정**이 화면에 뜬다 — 그때 사용자는 자기가 안 켠 것이 어디서 왔는지 모른다.
    if (!resolveSpecReadingEnabled(settings, { agentId: ctx.agentId, subAgentId })) return;
    const index = buildSpecIndexCached(ctx, settings);
    if (index.units.length === 0) return;
    const found = extractCitations(text, index, process.platform);
    if (found.length === 0) return;
    specReadingService.setCitations(subAgentId, project, found.map((c) => verifyCitation(ctx, c)));
  } catch (err) {
    logger.warn(`[spec] citation check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 턴을 끝내려는 지금, **안 연 필수 절이 남았는가**(강도 `warn` 이상).
 *
 * 되돌릴 이유가 있으면 그 이유 문장을 준다. 되돌림 횟수가 상한에 닿으면 **더 막지 않는다** —
 * 막힌 채 끝나지 못하는 세션이 이 기능이 낼 수 있는 최악의 결과이기 때문이다.
 */
export function specStopGate(subAgentId: string, projectPath?: string): { block: boolean; reason?: string } {
  const project = projectPath ?? specReadingService.projectOf(subAgentId);
  if (!subAgentId || !project) return { block: false };
  const state = getSpecReadingState(subAgentId, project);
  if (!state || state.strength === 'observe') return { block: false };
  const open = state.required.filter((r) => r.status === 'open');
  const badCitations = state.trust.citationsFailed;
  if (open.length === 0 && badCitations === 0) return { block: false };

  const settings = graphManager.getSpecReadingSettings(project);
  const limit = settings?.stopRetries ?? DEFAULT_SPEC_READING_SETTINGS.stopRetries;
  if (state.stopRetries >= limit) {
    specReadingService.noteGate(subAgentId, project, {
      at: Date.now(),
      kind: 'retry-exhausted',
      unitIds: open.map((r) => r.unitId),
    });
    return { block: false };
  }

  specReadingService.bumpStopRetry(subAgentId, project);
  specReadingService.noteGate(subAgentId, project, {
    at: Date.now(),
    kind: 'stop-block',
    unitIds: open.map((r) => r.unitId),
  });
  const lines = open.map((r) => `- \`${r.unitId}\` ${r.title} — \`${r.file}:${r.startLine}-${r.endLine}\``);
  const citationLine = badCitations > 0
    ? `\n인용 ${badCitations}건이 원문과 달랐다. 그 줄을 다시 열어 실제 문장으로 고쳐 적어라.`
    : '';
  return {
    block: true,
    reason: [
      '기획 정독이 아직 안 끝났다. 아래 절을 `Read` 의 `offset`·`limit` 으로 끝까지 열고, 절마다 `파일:줄` "원문 한 문장" 을 적어라.',
      ...lines,
      citationLine,
    ].filter((l) => l !== '').join('\n'),
  };
}

/**
 * 이 편집을 지금 허용할 것인가(강도 `enforce`).
 *
 * **커스텀 에이전트에만 선다.** 외부 훅으로 붙은 세션의 편집을 우리가 거부하면 사용자가 자기 터미널에서
 * 하던 일이 우리 설정 때문에 막히는 셈이고, 그 경계는 §5.3 #12-1 이 이미 그어 둔 것이다.
 */
export function specWriteGate(
  subAgentId: string,
  filePath: string,
  opts: { customCreated: boolean; projectPath?: string },
): { deny: boolean; reason?: string } {
  if (!opts.customCreated) return { deny: false };
  const project = opts.projectPath ?? specReadingService.projectOf(subAgentId);
  if (!subAgentId || !project) return { deny: false };
  const state = getSpecReadingState(subAgentId, project);
  if (!state || state.strength !== 'enforce') return { deny: false };
  const open = state.required.filter((r) => r.status === 'open');
  if (open.length === 0) return { deny: false };
  specReadingService.noteGate(subAgentId, project, {
    at: Date.now(),
    kind: 'write-deny',
    unitIds: open.map((r) => r.unitId),
    detail: filePath,
  });
  return {
    deny: true,
    reason: `기획 정독 미완 — ${open.map((r) => `${r.unitId}(${r.file}:${r.startLine}-${r.endLine})`).join(' · ')} 을(를) 먼저 열어라.`,
  };
}
