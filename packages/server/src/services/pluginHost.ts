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
  PLUGIN_MANIFESTS, isPluginEnabledFor, resolveEnabledPluginsFor, validateRegistry,
} from '@vibisual/plugins';
import { PLUGIN_SERVER_MODULES } from '@vibisual/plugins/server';
import { buildPluginPromptParts, collectPluginFacts } from '@vibisual/plugins/prompt';
import { atomicWriteFileSync } from './statePersistence.js';
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
 * 플러그인에게 넘길 **좁은 파일 탐침** (§5.11 v4.57).
 *
 * 플러그인이 `node:fs` 를 직접 물면 "프로젝트 안"이라는 경계가 각 플러그인의 성실성에 달리게 된다.
 * 그래서 경로 정규화와 루트 이탈 차단을 여기서 한 번만 하고, 플러그인에는 함수 두 개만 준다.
 * 절대경로·`..` 탈출·심링크로 루트를 벗어나는 경로는 **존재하지 않는 것으로 취급**한다(던지지 않는다 —
 * 프롬프트 조립이 파일 하나 때문에 실패하면 그 턴 전체가 막힌다).
 */
function makeProjectProbe(projectPath: string): Pick<PluginPromptContext, 'fileExists' | 'readFile' | 'fileMtimeMs'> {
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
export type PluginPromptRequest = Omit<PluginPromptContext, 'fileExists' | 'readFile'>;

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
    const ctx: PluginPromptContext = { ...req, ...makeProjectProbe(req.projectPath) };
    const parts = buildPluginPromptParts(userDefaultsService.get(), req.projectPath, ctx, (id, err) =>
      logger.warn(`[plugins] prompt block failed: ${id} — ${err instanceof Error ? err.message : String(err)}`),
    );
    // v4.65 — 방금 판단한 근거를 그대로 남긴다(같은 탐침을 쓰므로 파일 재읽기 없음). 카드가 이 값을
    //   그리기 때문에, 화면은 "에이전트가 실제로 받은 것"과 어긋날 수 없다.
    recordPluginFacts(req.projectPath, collectPluginFacts(userDefaultsService.get(), req.projectPath, ctx, (id, err) =>
      logger.warn(`[plugins] survey failed: ${id} — ${err instanceof Error ? err.message : String(err)}`),
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

/** 켬/끔 상태의 지문 — 이 값이 바뀌면 캐시를 버린다. */
function enabledFingerprint(projectPath: string): string {
  return [...resolveEnabledPluginsFor(userDefaultsService.get(), projectPath)].sort().join(',');
}

/** 프로젝트 키 정규화 — 창·서버가 표기만 다른 같은 폴더를 두 칸으로 갈라 보지 않게 한다. */
function factsKey(projectPath: string): string {
  return path.resolve(projectPath).replace(/\\/g, '/').toLowerCase();
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
    if (enabledKey === '') return {};

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
  const root = path.resolve(projectPath).replace(/\\/g, '/').toLowerCase();
  for (const key of [...readCache.keys()]) {
    if (key.replace(/\\/g, '/').toLowerCase().startsWith(root)) readCache.delete(key);
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
    const enabled = resolveEnabledPluginsFor(userDefaultsService.get(), projectId);
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
