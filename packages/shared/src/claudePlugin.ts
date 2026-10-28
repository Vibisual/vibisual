/** §5.5 #17-33 — 이 플러그인이 이 세션에 오는가(순수). `plugin list --json` 은 남의 프로젝트 것까지 다 준다(실측 7개 중 5개) — 서버·화면이 같은 규칙을 써야 배지와 목록이 맞는다. */
import type {
  AvailableSkill,
  ClaudeMarketPlugin,
  ClaudeMarketplaceKind,
  ClaudePluginAutoRefreshSettings,
  ClaudePluginEntry,
  ClaudePluginPlacement,
  ClaudePluginScope,
  SkillPluginState,
} from './types.js';
import {
  CLAUDE_PLUGIN_REFRESH_DEFAULTS,
  CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS,
  CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS,
} from './constants.js';
import { pathKey, type PlatformName } from './pathCase.js';

/**
 * 경로 비교 키 — 구분자를 접고 대소문자는 그 플랫폼이 무시할 때만 접는다(`pathCase.ts`). 실측상 `c:\Users`·`C:\Users` 가 섞여 오고, linux 는 `Feature-X` ≠ `feature-x`.
 * `platform` 생략 = 늘 접는다(브라우저용). 서버는 `process.platform` 을 넘긴다.
 */
export function normalizePluginPath(p: string, platform?: PlatformName): string {
  if (platform === undefined) return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  return pathKey(p, platform);
}

/** `<이름>@<마켓플레이스>` 를 가른다. `@` 가 없으면 마켓은 빈 문자열(이름만 있는 것도 유효하다). */
export function splitPluginId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  if (at <= 0) return { name: id, marketplace: '' };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/**
 * 어느 묶음("글로벌 / 이 프로젝트 전용")에 서는가.
 * @param entryPath 매인 프로젝트 경로(`user` 범위면 없다)
 * @param platform 생략하면 대소문자를 접는다.
 */
export function resolvePluginPlacement(
  scope: ClaudePluginScope,
  entryPath: string | undefined,
  projectPath: string,
  platform?: PlatformName,
): ClaudePluginPlacement {
  if (scope === 'user') return 'global';
  // 프로젝트 범위인데 경로가 안 적혀 있으면, CLI 를 이 프로젝트에서 물었으므로 이곳 것으로 본다.
  if (!entryPath) return 'this-project';
  return normalizePluginPath(entryPath, platform) === normalizePluginPath(projectPath, platform)
    ? 'this-project'
    : 'other-project';
}

/** 이 세션에 실제로 실리는 자리인가(= 배지가 세는 대상). */
export function placementAppliesHere(placement: ClaudePluginPlacement): boolean {
  return placement !== 'other-project';
}

/**
 * §5.5 #17-33 ⑦ — 스킬의 날것 세 칸을 한 상태로 접는다. "끈 것"(처방 `enable`)과 "남의 프로젝트 것"(처방 `install --scope user`)을 같은 `꺼짐` 으로 접지 마라 — `enable` 이 헛돈다.
 * 순서: 안 깔림 → 남의 자리 → 꺼둠(뒤집으면 남의 것이 `꺼짐` 으로 접힌다). `placement` 없음(옛 응답) = `disabled`(시키지 않은 설치를 권하지 않게).
 */
export function resolveSkillPluginState(
  skill: Pick<AvailableSkill, 'source' | 'installed' | 'enabled' | 'placement'>,
): SkillPluginState {
  // 프로젝트·글로벌 스킬은 디스크에 있는 파일이라 이 축이 없다 — 태그를 달지 않는다.
  if (skill.source !== 'plugin') return 'unknown';
  // CLI 에 못 물었으면 두 칸이 통째로 비어 온다. 그때도 태그 ❌(⑦(f)).
  if (skill.installed === undefined || skill.enabled === undefined) return 'unknown';
  if (!skill.installed) return 'not-installed';
  if (skill.placement === 'other-project') return 'other-project';
  if (!skill.enabled) return 'disabled';
  return 'ready';
}

/** 고치려면 CLI 에 무엇을 보내나(`null` = 고칠 것 없음, 태그는 눌리지 않게). `other-project` 는 `install` — user 범위엔 없어 `enable --scope user` 가 대상을 못 찾는다. */
export function skillFixAction(state: SkillPluginState): 'install' | 'enable' | null {
  if (state === 'not-installed' || state === 'other-project') return 'install';
  if (state === 'disabled') return 'enable';
  return null;
}

/** 그 상태의 스킬을 지금 고르면 슬래시가 실제로 풀리는가. 목록 정렬·안내 문구가 함께 읽는다. */
export function skillLoadsNow(state: SkillPluginState): boolean {
  return state === 'ready' || state === 'unknown';
}

/** Anthropic 직영 마켓 — 추천은 이 목록에만(§5.5 #17-42 ④ — 남의 마켓 추천은 임의 코드 보증이 된다). `name`(CLI `marketplaceName`) ≠ `source`(`marketplace add` 인자) — 섞으면 추천이 안 사라진다. */
export const KNOWN_CLAUDE_MARKETPLACES: readonly {
  name: string;
  source: string;
  kind: ClaudeMarketplaceKind;
}[] = [
  // Claude Code 가 첫 실행 때 스스로 붙인다 — 그래도 목록에 둔다(못 붙인 사용자가 있다).
  { name: 'claude-plugins-official', source: 'anthropics/claude-plugins-official', kind: 'official' },
  // 자동으로 붙지 않는다. 이 한 줄이 없으면 사용자는 주소를 외워 쳐야 한다.
  { name: 'claude-community', source: 'anthropics/claude-plugins-community', kind: 'community' },
];

/** 이 마켓이 어느 갈래인가 — 화면과 서버가 같은 규칙을 써야 칩과 목록이 어긋나지 않는다. */
export function classifyMarketplace(name: string): ClaudeMarketplaceKind {
  const found = KNOWN_CLAUDE_MARKETPLACES.find((m) => m.name === name);
  return found ? found.kind : 'custom';
}

/** 아직 안 붙은 알려진 마켓(추천 줄). 빈 마켓은 붙어 있어도 다시 뜬다 — 일부러다(사용자에게는 안 붙은 것과 같은 화면). */
export function suggestedMarketplaces(
  known: readonly { name: string }[],
): readonly { name: string; source: string; kind: ClaudeMarketplaceKind }[] {
  const have = new Set(known.map((m) => m.name));
  return KNOWN_CLAUDE_MARKETPLACES.filter((m) => !have.has(m.name));
}

// ─── §5.5 #17-33 ⑦ — 갱신 판정 (자동 갱신과 화면이 같은 규칙을 읽는다) ───

/** 판 비교(음수/0/양수) — semver 가 아니라 숫자 마디만 견준다(없는 마디 = 0). 숫자가 없는 판(`unknown`)은 `null` — "낮다"로 접으면 매 주기 다시 올린다. */
export function comparePluginVersions(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const nums = (v ?? '').match(/\d+/g);
    if (!nums || nums.length === 0) return null;
    return nums.map((n) => Number.parseInt(n, 10));
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 새 판이 있는 설치본 — 배지와 자동 갱신이 이 함수 하나를 읽는다. 거른다: 마켓에 id 없음 · 판 비교 불가(`null`) · 다른 프로젝트에 매인 것(#17-33 ③ — 남의 설치를 건드리지 않는다). */
export function pluginsNeedingUpdate(
  installed: readonly ClaudePluginEntry[],
  market: readonly ClaudeMarketPlugin[],
): ClaudePluginEntry[] {
  const latest = new Map<string, string>();
  for (const m of market) {
    if (typeof m.version === 'string' && m.version.length > 0) latest.set(m.id, m.version);
  }
  const out: ClaudePluginEntry[] = [];
  for (const p of installed) {
    if (p.placement === 'other-project') continue;
    const newest = latest.get(p.id);
    if (!newest) continue;
    const cmp = comparePluginVersions(p.version, newest);
    if (cmp === null || cmp >= 0) continue;
    out.push({ ...p, updateAvailable: true, latestVersion: newest });
  }
  return out;
}

/** 설치본에 `updateAvailable`/`latestVersion` 을 새긴 사본 — 그리는 쪽과 올리는 쪽이 같은 판정을 본다. */
export function annotatePluginUpdates(
  installed: readonly ClaudePluginEntry[],
  market: readonly ClaudeMarketPlugin[],
): ClaudePluginEntry[] {
  const need = new Map(pluginsNeedingUpdate(installed, market).map((p) => [p.id, p]));
  return installed.map((p) => {
    const hit = need.get(p.id);
    if (!hit) return p;
    return { ...p, updateAvailable: true, ...(hit.latestVersion ? { latestVersion: hit.latestVersion } : {}) };
  });
}

/** 저장값·전선값을 안전한 설정으로 접는다(구버전 AppState·손으로 고친 값 대비). */
export function normalizePluginRefreshSettings(raw: unknown): ClaudePluginAutoRefreshSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ClaudePluginAutoRefreshSettings>;
  const hours = typeof r.intervalHours === 'number' && Number.isFinite(r.intervalHours)
    ? Math.round(r.intervalHours)
    : CLAUDE_PLUGIN_REFRESH_DEFAULTS.intervalHours;
  return {
    market: typeof r.market === 'boolean' ? r.market : CLAUDE_PLUGIN_REFRESH_DEFAULTS.market,
    plugins: typeof r.plugins === 'boolean' ? r.plugins : CLAUDE_PLUGIN_REFRESH_DEFAULTS.plugins,
    intervalHours: Math.min(
      CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS,
      Math.max(CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS, hours),
    ),
  };
}

/** `lastAt` 없음(한 번도 못 함)·미래 시각(시계 역행)도 참 — 아니면 그 컴퓨터는 영영 안 돈다. */
export function isPluginRefreshDue(
  now: number,
  lastAt: number | undefined,
  settings: ClaudePluginAutoRefreshSettings,
): boolean {
  if (!lastAt || lastAt <= 0) return true;
  if (lastAt > now) return true;
  return now - lastAt >= settings.intervalHours * 60 * 60 * 1000;
}
