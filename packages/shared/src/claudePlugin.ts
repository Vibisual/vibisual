/**
 * claudePlugin.ts — §5.5 #17-33: "이 플러그인이 지금 이 세션에 오는가" 를 정하는 순수 함수들.
 *
 * `claude plugin list --json` 은 **이 컴퓨터에 깔린 전부**를 돌려준다 — 다른 프로젝트에 매인 것까지
 * 섞여 있다(실측 7개 중 5개가 남의 프로젝트 것이었다). 그래서 목록을 그대로 그리면 "왜 안 먹지"
 * 가 되고, 걸러 버리면 "깔았는데 왜 없지" 가 된다. 그 판정을 한 곳에 두고 테스트로 고정한다.
 *
 * 서버와 화면이 같은 규칙을 써야 배지 수와 목록이 어긋나지 않으므로 shared 에 산다.
 */
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
 * 경로 비교용 정규화 — 구분자·끝 구분자를 지우고, **대소문자는 그 플랫폼이 실제로 무시할 때만** 접는다.
 *
 * 실측상 같은 폴더가 `c:\Users\…`(소문자 드라이브)와 `C:\Users\…` 로 함께 들어 있다.
 * 한쪽만 보면 이 프로젝트 것이 남의 것으로 밀려나 화면에서 사라진다.
 *
 * 반면 Linux 는 `Feature-X` 와 `feature-x` 가 실재하는 별개 폴더라 접으면 남의 프로젝트 플러그인이
 * 이 프로젝트 것으로 읽힌다. 그래서 `platform` 을 받아 `pathCase.ts` 정책에 위임한다.
 * shared 는 브라우저에서도 로드되므로 여기서 `process.platform` 을 읽을 수 없다 —
 * **인자를 생략하면 예전대로 접는다**(회귀 없음). 서버는 `process.platform` 을 넘긴다.
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
 * 이 플러그인이 어느 묶음에 서는가 — 사용자가 물은 "글로벌 / 우리 프로젝트 전용" 이 이 판정이다.
 *
 * @param scope       CLI 가 돌려준 설치 범위
 * @param entryPath   그 플러그인이 매여 있는 프로젝트 경로(`user` 범위면 없다)
 * @param projectPath 지금 이 세션이 열린 프로젝트 경로
 * @param platform    `process.platform`. 생략하면 예전대로 대소문자를 접는다(회귀 방지).
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
 * §5.5 #17-33 ⑦ — 스킬 한 줄의 **날것 세 칸을 화면이 읽는 한 상태로 접는다.**
 *
 * 종전엔 화면이 `installed === false || enabled === false` 로 직접 갈랐는데, 그 식은 **서로 다른
 * 두 사정을 같은 `꺼짐` 한 칸에 담았다**: 사용자가 끈 것과 남의 프로젝트에 매인 것. 앞의 처방은
 * `enable` 이고 뒤의 처방은 `install --scope user` 인데(그 자리엔 user 범위 설치본이 아예 없어
 * 켤 것이 없다) 한 칸이라 뒤쪽에 `enable` 이 나갔고 — **눌러도 아무 일이 없었다.**
 *
 * 접는 순서에 뜻이 있다: 안 깔린 것이 먼저고, 그다음이 "깔렸지만 남의 자리", 마지막이 "여기 것인데
 * 꺼둠". 뒤집으면 남의 프로젝트 것이 `꺼짐` 으로 다시 접힌다.
 *
 * `placement` 가 없으면(옛 응답) **`disabled` 로 본다** — 남의 자리라는 증거가 없으니 여기 것으로
 * 보는 쪽이 안전하다. 잘못 `install` 을 권하면 사용자가 안 시킨 설치가 일어난다.
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

/**
 * 그 상태를 고치려면 CLI 에 무엇을 보내야 하는가. `null` 이면 **고칠 것이 없다**(이미 실리거나,
 * 우리가 모른다) — 그 자리의 태그는 눌리지 않는 표시로 그린다.
 *
 * `other-project` 가 `install` 인 것이 이 함수의 핵심이다. 그 플러그인은 깔려 있지만 **user 범위엔
 * 없다** — `enable --scope user` 는 켤 대상을 못 찾는다. user 범위로 한 벌 깔면 그때부터 어느
 * 프로젝트에서 열든 실린다(⑦(e) 가 범위를 `user` 로 고정한 그 이유와 같다).
 */
export function skillFixAction(state: SkillPluginState): 'install' | 'enable' | null {
  if (state === 'not-installed' || state === 'other-project') return 'install';
  if (state === 'disabled') return 'enable';
  return null;
}

/** 그 상태의 스킬을 지금 고르면 슬래시가 실제로 풀리는가. 목록 정렬·안내 문구가 함께 읽는다. */
export function skillLoadsNow(state: SkillPluginState): boolean {
  return state === 'ready' || state === 'unknown';
}

/**
 * Anthropic 이 직접 운영하는 마켓 — **이 목록에만 추천을 준다**(§5.5 #17-42 ④).
 *
 * 남의 마켓을 우리가 골라 추천하면 그 내용을 우리가 보증하는 모양이 된다.
 * 플러그인은 사용자 컴퓨터에서 임의 코드를 도는 물건이라 그 모양을 만들지 않는다.
 *
 * `name` 은 CLI 가 돌려주는 `marketplaceName` 이고 `source` 는 `plugin marketplace add` 에
 * 그대로 넘길 인자다 — 둘이 다르다(커뮤니티는 `anthropics/claude-plugins-community` 를
 * 붙이면 `claude-community` 라는 이름으로 앉는다). 섞어 쓰면 추천이 영영 사라지지 않는다.
 */
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

/**
 * 아직 붙지 않은 알려진 마켓 — 추천 줄로 세울 것들.
 *
 * 이미 붙어 있으면 빠진다(같은 것을 두 번 붙일 자리를 주지 않는다). 마켓 이름은
 * CLI 가 정하므로 **`available[]` 에 한 개도 없는 빈 마켓은 여기 다시 뜬다** — 그 편이
 * 낫다. 붙였는데 아무것도 안 나오는 것과 안 붙은 것은 사용자에게 같은 화면이기 때문이다.
 */
export function suggestedMarketplaces(
  known: readonly { name: string }[],
): readonly { name: string; source: string; kind: ClaudeMarketplaceKind }[] {
  const have = new Set(known.map((m) => m.name));
  return KNOWN_CLAUDE_MARKETPLACES.filter((m) => !have.has(m.name));
}

// ─── §5.5 #17-33 ⑦ — 갱신 판정 (자동 갱신과 화면이 같은 규칙을 읽는다) ───

/**
 * 판 문자열을 비교한다. `a` 가 낮으면 음수, 같으면 0, 높으면 양수.
 *
 * semver 전체를 구현하지 않는다 — 마켓이 내놓는 판은 `1.2.3` · `v1.2.3` · `2026.09.01` · `unknown`
 * 처럼 제각각이라, **숫자 마디만 앞에서부터 견준다**. 마디 수가 다르면 없는 쪽을 0 으로 본다
 * (`1.2` < `1.2.1`). 숫자가 하나도 안 잡히는 판(`unknown`)은 **비교할 수 없는 것으로 두고**
 * `null` 을 돌려준다 — 모르는 것을 "낮다" 로 접으면 매 주기마다 같은 것을 끝없이 다시 올린다.
 */
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

/**
 * 마켓에 더 새 판이 있는 설치본만 골라 낸다 — **화면의 배지와 자동 갱신이 이 함수 하나를 읽는다.**
 * 두 벌로 세면 "새 판 3개" 라고 적어 놓고 실제로는 다른 것이 올라간다.
 *
 * 거르는 것 셋:
 *  - 마켓에 같은 id 가 없는 것(직접 붙인 마켓이 사라졌거나 로컬 설치) — 올릴 대상이 없다.
 *  - 판을 견줄 수 없는 것(`comparePluginVersions` 가 `null`) — 매 주기마다 헛도는 것을 막는다.
 *  - **다른 프로젝트에 매인 것** — 여기서 올려도 이 세션에는 아무 일이 없고, 남의 프로젝트 설치를
 *    우리가 말없이 건드리는 모양이 된다(#17-33 ③ 이 손잡이를 안 준 것과 같은 이유).
 */
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

/**
 * 설치본 목록에 `updateAvailable`/`latestVersion` 을 새겨 돌려준다(원본 불변).
 * 목록을 그리는 쪽과 올리는 쪽이 같은 판정을 보게 하는 자리.
 */
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

/**
 * 지금 갱신할 때가 됐는가. `lastAt` 이 없으면(한 번도 못 했으면) 항상 참 —
 * 실측 클론이 36일 멈춰 있던 것이 바로 "한 번도 없음" 상태였다.
 *
 * 미래 시각이 찍혀 있어도(시계가 뒤로 간 경우) 참으로 본다 — 안 그러면 그 컴퓨터는 영영 안 돈다.
 */
export function isPluginRefreshDue(
  now: number,
  lastAt: number | undefined,
  settings: ClaudePluginAutoRefreshSettings,
): boolean {
  if (!lastAt || lastAt <= 0) return true;
  if (lastAt > now) return true;
  return now - lastAt >= settings.intervalHours * 60 * 60 * 1000;
}
