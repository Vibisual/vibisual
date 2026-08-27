/**
 * §5.5 #17-33 — Claude Code 자신의 플러그인(`claude plugin`) 인벤토리 + 마켓플레이스.
 *
 * **우리 관측 플러그인(`packages/plugins`, §5.11)과 다른 물건이다.** 그쪽은 Vibisual 이 만든
 * 것이고 이쪽은 명령·에이전트·스킬·훅·MCP 를 한 묶음으로 배포하는 Claude Code 의 그 단위다.
 *
 * 진실의 출처는 **Claude Code 자신의 답**이다 — `claude plugin list --json --available` 한 번이
 * 설치본과 마켓 목록을 함께 준다(실측 461ms / 159KB). #17-31·#17-32 가 세운 "새 설정 포맷을
 * 발명하지 않는다" 규율의 세 번째 적용이고, 여기서는 한 걸음 더 간다: `installed_plugins.json` 을
 * 우리가 직접 해석하지 않는다. 그 파일 포맷은 CLI 의 내부 사정이라 바뀌는 날 조용히 어긋난다.
 *
 * 바꾸는 일(켜기·끄기·설치·제거·마켓 추가)도 전부 **CLI 에 위임**한다 — 우리가 git clone 과
 * 설치 상태 파일 쓰기를 흉내 내기 시작하면 CLI 의 상태와 두 갈래로 갈린다. 우리는 이미 있는
 * 스폰 경로(`getClaudeBin`)를 쓸 뿐이다.
 *
 * 상태를 들지 않는다 — 캐시·broadcast·checkpoint 미관여(매 조회가 곧 새로고침).
 */
import { spawn } from 'node:child_process';

import type {
  ClaudeMarketPlugin,
  ClaudeMarketplaceEntry,
  ClaudePluginEntry,
  ClaudePluginInventory,
  ClaudePluginScope,
} from '@vibisual/shared';
import { resolvePluginPlacement, splitPluginId } from '@vibisual/shared';

import { logger } from '../logger.js';

import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { buildCliInvocation } from './claudeCliRun.js';

/** 조회 타임아웃 — 실측 461ms 라 넉넉하다(마켓 캐시가 비어 네트워크를 타면 더 걸릴 수 있다). */
const LIST_TIMEOUT_MS = 20_000;

/**
 * 바꾸는 명령의 타임아웃. 설치는 git clone 을 타므로 조회보다 훨씬 길게 잡는다.
 * (그래도 무한정 기다리지는 않는다 — 화면이 영영 "설치 중" 으로 남으면 그게 더 나쁘다.)
 */
const MUTATE_TIMEOUT_MS = 180_000;

/** CLI 가 뱉는 JSON 상한 — 마켓 전체가 실려도 이보다 크면 우리가 아는 그 응답이 아니다. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  /** 스폰 자체가 안 된 경우(실행본 없음 등). */
  spawnError?: string;
}

/**
 * `claude` 를 그 프로젝트에서 실행한다. `cwd` 를 넘기는 것이 중요하다 — CLI 가 `project`/`local`
 * 범위를 그 폴더 기준으로 해석하므로, 아무 데서나 띄우면 다른 프로젝트의 답을 받는다.
 */
function execClaude(args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  let binPath: string | undefined;
  try {
    binPath = getClaudeBin()?.binPath;
  } catch {
    /* PATH 미발견 — 아래에서 사유를 담아 돌려준다 */
  }
  if (!binPath) {
    return Promise.resolve({ ok: false, stdout: '', stderr: '', code: null, spawnError: 'claude binary not found' });
  }

  return new Promise<ExecResult>((resolve) => {
    let done = false;
    let stdout = '';
    let stderr = '';
    const finish = (r: ExecResult): void => { if (!done) { done = true; resolve(r); } };

    let child: ReturnType<typeof spawn>;
    try {
      // 셸 경유 여부는 공용 창구(`claudeCliRun.buildCliInvocation`) 한 곳이 정한다.
      //   무조건 `shell: win32` 로 두면 네이티브 `claude.exe` 까지 셸을 타는데, 그때 설치 경로에
      //   공백이 있으면(Program Files 아래 설치 등) 명령이 두 동강 난다. shim(.cmd/.bat)일 때만 셸 + 따옴표.
      const invocation = buildCliInvocation(binPath, args, process.platform);
      child = spawn(invocation.file, invocation.args, {
        cwd,
        shell: invocation.shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return finish({ ok: false, stdout: '', stderr: '', code: null, spawnError: String(err) });
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 이미 죽었으면 그만 */ }
      finish({ ok: false, stdout, stderr, code: null, spawnError: 'timeout' });
    }, timeoutMs);

    child.stdout?.on('data', (c) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += c.toString();
    });
    child.stderr?.on('data', (c) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += c.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      noteClaudeSpawnFailure(err);
      finish({ ok: false, stdout, stderr, code: null, spawnError: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, code });
    });
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * CLI 가 앞뒤에 붙일 수 있는 잡음을 걷고 JSON 본문만 파싱한다.
 * (경고 한 줄이 섞였다는 이유로 목록 전체를 잃지 않도록 — 첫 `{`/`[` 부터 끝까지 본다.)
 */
function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 아래에서 본문만 잘라 다시 시도 */
  }
  const start = Math.min(
    ...[trimmed.indexOf('{'), trimmed.indexOf('[')].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER]),
  );
  if (start === Number.MAX_SAFE_INTEGER) return null;
  const endBrace = trimmed.lastIndexOf('}');
  const endBracket = trimmed.lastIndexOf(']');
  const end = Math.max(endBrace, endBracket);
  if (end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toScope(v: unknown): ClaudePluginScope {
  return v === 'project' || v === 'local' ? v : 'user';
}

/** `claude plugin list --json` 의 항목 하나 → 화면 한 줄. */
function toEntry(raw: Record<string, unknown>, projectPath: string): ClaudePluginEntry | null {
  const id = str(raw['id']);
  if (!id) return null;
  const { name, marketplace } = splitPluginId(id);
  const scope = toScope(raw['scope']);
  const entryPath = str(raw['projectPath']);

  return {
    id,
    name,
    marketplace,
    version: str(raw['version']) ?? 'unknown',
    scope,
    // process.platform 을 넘겨야 Linux 에서 경로 키가 소문자로 접히지 않는다
    // (접히면 케이스만 다른 남의 프로젝트 플러그인이 "이 프로젝트 것"으로 표시된다).
    placement: resolvePluginPlacement(scope, entryPath, projectPath, process.platform),
    enabled: raw['enabled'] === true,
    ...(str(raw['installPath']) ? { installPath: str(raw['installPath']) as string } : {}),
    ...(entryPath ? { projectPath: entryPath } : {}),
    ...(str(raw['installedAt']) ? { installedAt: str(raw['installedAt']) as string } : {}),
    ...(str(raw['lastUpdated']) ? { lastUpdated: str(raw['lastUpdated']) as string } : {}),
  };
}

/** `available[]` 의 항목 하나 → 마켓 한 줄. */
function toMarketPlugin(raw: Record<string, unknown>, installedIds: Set<string>): ClaudeMarketPlugin | null {
  const id = str(raw['pluginId']) ?? str(raw['id']);
  if (!id) return null;
  const split = splitPluginId(id);
  return {
    id,
    name: str(raw['name']) ?? split.name,
    ...(str(raw['description']) ? { description: str(raw['description']) as string } : {}),
    marketplace: str(raw['marketplaceName']) ?? split.marketplace,
    ...(str(raw['version']) ? { version: str(raw['version']) as string } : {}),
    ...(typeof raw['installCount'] === 'number' ? { installCount: raw['installCount'] } : {}),
    installed: installedIds.has(id),
  };
}

/** 마켓 목록은 `available[]` 을 접어서 세운다 — 마켓마다 CLI 를 또 부르지 않는다. */
function collectMarketplaces(market: ClaudeMarketPlugin[]): ClaudeMarketplaceEntry[] {
  const counts = new Map<string, number>();
  for (const p of market) {
    if (!p.marketplace) continue;
    counts.set(p.marketplace, (counts.get(p.marketplace) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, pluginCount]) => ({ name, pluginCount }))
    .sort((a, b) => b.pluginCount - a.pluginCount);
}

/**
 * CLI 가 뱉은 JSON 본문 → 인벤토리. **스폰과 분리한 순수 함수**라 실제 CLI 출력 모양으로
 * 테스트할 수 있다(이 층에서 깨지면 목록이 통째로 비는데, 그건 "플러그인이 없다" 와 구별이 안 된다).
 */
export function parsePluginListOutput(stdout: string, projectPath: string): ClaudePluginInventory {
  const base = { projectPath, installed: [], market: [], marketplaces: [], scannedAt: Date.now() };
  const parsed = parseJsonLoose(stdout);
  const root = asRecord(parsed);
  // `--available` 없이 부르면 배열이 오므로 두 모양을 모두 받는다(CLI 판본이 갈려도 안 깨지게).
  const installedRaw: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.['installed']) ? (root['installed'] as unknown[]) : [];
  const availableRaw: unknown[] = Array.isArray(root?.['available']) ? (root['available'] as unknown[]) : [];

  if (!Array.isArray(parsed) && !root) {
    return { ...base, unavailable: 'could not parse CLI output' };
  }

  const installed: ClaudePluginEntry[] = [];
  for (const item of installedRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const entry = toEntry(rec, projectPath);
    if (entry) installed.push(entry);
  }

  const installedIds = new Set(installed.map((p) => p.id));
  const market: ClaudeMarketPlugin[] = [];
  for (const item of availableRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const entry = toMarketPlugin(rec, installedIds);
    if (entry) market.push(entry);
  }

  // 이름순이 아니라 **많이 쓰는 것 먼저** — 277개 중에서 무엇을 고를지의 유일한 단서다.
  market.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0) || a.name.localeCompare(b.name));

  return {
    projectPath,
    installed,
    market,
    marketplaces: collectMarketplaces(market),
    scannedAt: Date.now(),
  };
}

/**
 * 이 프로젝트(=이 세션)에서 본 Claude Code 플러그인 전부 + 마켓.
 *
 * 매 호출마다 CLI 에 다시 묻는다(캐시 ❌ — 화면의 새로고침이 곧 이 호출이다).
 * CLI 에 닿지 못하면 **빈 목록이 아니라 사유**를 담아 돌려준다 — "없다" 와 "묻지 못했다" 는 다르다.
 */
export async function scanClaudePlugins(projectPath: string): Promise<ClaudePluginInventory> {
  const res = await execClaude(['plugin', 'list', '--json', '--available'], projectPath, LIST_TIMEOUT_MS);

  if (!res.ok) {
    const reason = res.spawnError ?? (res.stderr.trim() || `exit ${res.code ?? '?'}`);
    logger.warn(`[claude-plugins] list failed: ${reason}`);
    return { projectPath, installed: [], market: [], marketplaces: [], scannedAt: Date.now(), unavailable: reason };
  }

  return parsePluginListOutput(res.stdout, projectPath);
}

/** 바꾸는 명령의 공통 결과 — 실패 사유는 화면이 그대로 띄운다(우리가 요약하면 원인이 지워진다). */
export type PluginMutationResult = { ok: true } | { ok: false; reason: string };

function toResult(res: ExecResult, what: string): PluginMutationResult {
  if (res.ok) return { ok: true };
  const reason = res.spawnError ?? (res.stderr.trim() || res.stdout.trim() || `exit ${res.code ?? '?'}`);
  logger.warn(`[claude-plugins] ${what} failed: ${reason}`);
  // 화면 한 줄에 CLI 출력 전문을 쏟지 않는다.
  return { ok: false, reason: reason.slice(0, 400) };
}

/**
 * 켜기/끄기 — `claude plugin enable|disable <id> --scope <범위>`.
 *
 * 진실은 `settings.json` 의 `enabledPlugins` 이지만 **우리가 직접 쓰지 않는다**. 그 키를 어느
 * 파일에 쓸지(사용자·프로젝트·로컬)를 정하는 규칙이 CLI 안에 있고, 우리가 그 규칙을 흉내 내면
 * 화면과 실제가 갈릴 수 있다 — 같은 판단을 #17-31 이 MCP 에서 이미 했다.
 */
export function setClaudePluginEnabled(
  projectPath: string,
  id: string,
  scope: ClaudePluginScope,
  enabled: boolean,
): Promise<PluginMutationResult> {
  const verb = enabled ? 'enable' : 'disable';
  return execClaude(['plugin', verb, id, '--scope', scope], projectPath, MUTATE_TIMEOUT_MS)
    .then((res) => toResult(res, `${verb} ${id}`));
}

/**
 * 마켓에서 설치 — `claude plugin install <id> --scope <범위> --yes`.
 *
 * `--yes` 가 없으면 TTY 가 아닌 우리 스폰에서 확인 프롬프트에 걸려 멈춘다(CLI 도움말이 그렇게 못 박고 있다).
 */
export function installClaudePlugin(
  projectPath: string,
  id: string,
  scope: ClaudePluginScope,
): Promise<PluginMutationResult> {
  return execClaude(['plugin', 'install', id, '--scope', scope, '--yes'], projectPath, MUTATE_TIMEOUT_MS)
    .then((res) => toResult(res, `install ${id}`));
}

/** 제거 — `claude plugin uninstall <id> --scope <범위> --yes`. 데이터 폴더는 CLI 기본값을 따른다. */
export function uninstallClaudePlugin(
  projectPath: string,
  id: string,
  scope: ClaudePluginScope,
): Promise<PluginMutationResult> {
  return execClaude(['plugin', 'uninstall', id, '--scope', scope, '--yes'], projectPath, MUTATE_TIMEOUT_MS)
    .then((res) => toResult(res, `uninstall ${id}`));
}

/** 마켓플레이스 추가 — `claude plugin marketplace add <source>`(GitHub `owner/repo` · URL · 경로). */
export function addClaudeMarketplace(projectPath: string, source: string): Promise<PluginMutationResult> {
  return execClaude(['plugin', 'marketplace', 'add', source], projectPath, MUTATE_TIMEOUT_MS)
    .then((res) => toResult(res, `marketplace add ${source}`));
}

/** 마켓플레이스 제거 — 우리가 넣은 것을 되돌리는 길이 없으면 추가 단추는 함정이 된다. */
export function removeClaudeMarketplace(projectPath: string, name: string): Promise<PluginMutationResult> {
  return execClaude(['plugin', 'marketplace', 'remove', name], projectPath, MUTATE_TIMEOUT_MS)
    .then((res) => toResult(res, `marketplace remove ${name}`));
}
