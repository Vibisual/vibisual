import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_USAGE_PROBE_TIMEOUT_MS } from '@vibisual/shared';
import type { ClaudeUsageExtraCredits } from '@vibisual/shared';
import { runClaudeCli } from './claudeCliRun.js';
import { logger } from '../logger.js';

/**
 * §4 — 사용량 값을 **대화형 세션 없이** 받아오는 경로. statusLine 은 대화형 세션이 화면을 그릴 때만 돌아, 헤드리스 에이전트만 쓰면 헤더 사용량 필이 종일 `-` 다.
 * 공개 인터페이스 하나만 부른다: `claude -p "/usage"`(print 모드 + 내장 슬래시). 사용자 자신의 인증으로 공식 CLI 를 돌리므로 문서에 없는 엔드포인트·화면 긁기·토큰 추출이 아니다(법적 안전선 — `.credentials.json` 토큰으로 `api/oauth/usage` 를 부르지 않는다).
 * 공짜다(실측): `num_turns: 0`·`total_cost_usd: 0`·토큰 0 — 모델을 안 불러 5분 주기로 돌려도 한도를 안 갉는다.
 * ⚠ Git Bash 에서 손으로 재현하면 `/usage` 가 경로로 바뀌어 모델이 불린다 — `MSYS_NO_PATHCONV=1` 을 붙인다(앱의 spawn 은 셸을 안 거쳐 무관).
 * 값은 stream-json 의 공식 구조 `usage_report`(Agent SDK `SDKUsageReport`, 2.1.317 실측)가 먼저다. 그것이 없는 옛 판은 CLI 가 `~/.claude.json` 에 적은 캐시로 내려가고,
 * 크레딧 금액·플랜 표시명은 그 구조에 없거나 단위가 없어 캐시에서 읽는다 — §4 v3.60 ⑦⑧.
 */

/** 한 창(5시간·7일)의 사용률 스냅샷. */
export interface UsageWindowSnapshot {
  /** 0~100 */
  percent: number;
  /** 한도 리셋 epoch ms (CLI 가 안 주면 없음) */
  resetsAt?: number;
}

/** 모델별 주간 한도 한 줄 — 표시명은 CLI 표시 목록(옛 판은 `/usage` 출력)에서 온다. */
export interface ScopedUsageSnapshot {
  label: string;
  /** 0~100 */
  percent: number;
  resetsAt?: number;
  /** 표시 목록의 `is_active`(옛 판엔 없다). */
  isActive?: boolean;
}

/** probe 1회의 결과 — 서버가 표시값을 조립할 때 쓰는 원재료. */
export interface UsageProbeSnapshot {
  /** CLI 가 이 값을 받아온 시각(epoch ms). statusLine 값과 어느 쪽이 최신인지 가릴 때 쓴다. */
  fetchedAt: number;
  /** 없으면 이 계정에 5시간 한도가 없다(인증된 Ultra) — 0% 로 지어내지 않는다. */
  session?: UsageWindowSnapshot;
  weekly?: UsageWindowSnapshot;
  scoped: ScopedUsageSnapshot[];
  /** CLI 표시 목록(`limits[]`)에서 읽었다 — 출력 문장으로 모델별 줄을 다시 집지 않는다. */
  listed?: boolean;
  extraCredits?: ClaudeUsageExtraCredits;
  /** CLI 가 적어 둔 공식 플랜 표시명(`oauthAccount.planDisplayName`, 예: Ultra). */
  planName?: string;
}

export type UsageProbeFailure = 'cli-missing' | 'timeout' | 'no-data';

export interface UsageProbeResult {
  snapshot: UsageProbeSnapshot | null;
  failure?: UsageProbeFailure;
}

/**
 * `~/.claude.json` 경로. `CLAUDE_CONFIG_DIR` 를 쓰는 설치본은 그 안에 있으므로 먼저 본다.
 * 홈 디렉터리는 win/mac/linux 가 각각 다르지만 `os.homedir()` 가 그 차이를 흡수한다.
 */
export function claudeConfigJsonPaths(homeDir: string, configDir?: string): string[] {
  const list: string[] = [];
  if (configDir && configDir.trim().length > 0) list.push(path.join(configDir.trim(), '.claude.json'));
  list.push(path.join(homeDir, '.claude.json'));
  return list;
}

/** ISO8601(`2026-08-25T22:00:00.057325+00:00`) → epoch ms. 형식이 아니면 undefined. */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function toWindow(raw: unknown): UsageWindowSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pct = o['utilization'];
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined;
  const resetsAt = toEpochMs(o['resets_at']);
  return { percent: Math.max(0, Math.min(100, pct)), ...(resetsAt !== undefined ? { resetsAt } : {}) };
}

/**
 * 사용 크레딧(한도 초과분 과금). 금액은 CLI 가 **최소 단위 정수 + `decimal_places`** 로 주므로
 * (`monthly_limit: 5000`, `decimal_places: 2` → 50.00) 표시 단위로 되돌려 담는다.
 */
function toExtraCredits(raw: unknown): ClaudeUsageExtraCredits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const enabled = o['is_enabled'] === true;
  const decimals = typeof o['decimal_places'] === 'number' ? o['decimal_places'] : 0;
  const scale = 10 ** decimals;
  const num = (key: string): number | undefined =>
    typeof o[key] === 'number' && Number.isFinite(o[key] as number) ? (o[key] as number) : undefined;
  const used = num('used_credits');
  const limit = num('monthly_limit');
  const utilization = num('utilization');
  const currency = typeof o['currency'] === 'string' ? o['currency'] : undefined;
  if (utilization === undefined && used === undefined && limit === undefined) {
    return enabled ? { enabled } : undefined;
  }
  return {
    enabled,
    ...(utilization !== undefined ? { utilization: Math.max(0, Math.min(100, utilization)) } : {}),
    ...(used !== undefined ? { usedCredits: used / scale } : {}),
    ...(limit !== undefined ? { monthlyLimit: limit / scale } : {}),
    ...(currency ? { currency } : {}),
  };
}

/** 금액 꼴 `{ amount_minor, exponent, currency }` → 표시 단위. 그 꼴이 아니면 undefined(모양을 모르는 값을 금액으로 읽지 않는다). */
function toMoney(raw: unknown): { amount: number; currency?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const minor = o['amount_minor'];
  const exponent = o['exponent'];
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return undefined;
  if (typeof exponent !== 'number' || !Number.isInteger(exponent) || exponent < 0 || exponent > 6) return undefined;
  const currency = typeof o['currency'] === 'string' && o['currency'] ? o['currency'] : undefined;
  return { amount: minor / 10 ** exponent, ...(currency ? { currency } : {}) };
}

/** 자동 충전 켬/끔 — 불리언이거나 `enabled` 를 가진 객체일 때만. null·다른 꼴은 모름. */
function toAutoReload(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o['enabled'] === 'boolean') return o['enabled'];
  if (typeof o['is_enabled'] === 'boolean') return o['is_enabled'];
  return undefined;
}

/**
 * 사용 크레딧 `spend`(2.1.317 실측 — `extra_usage` 를 잇는 새 블록). 금액 꼴이 확인된 칸만 담는다.
 * 사용률은 한도 금액을 알 때만 — 한도가 없으면(무제한·미설정) "예산의 몇 %" 가 성립하지 않는다.
 */
function toSpendCredits(raw: unknown): ClaudeUsageExtraCredits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o['enabled'] !== 'boolean') return undefined;
  const used = toMoney(o['used']);
  const limit = toMoney(o['limit']);
  const balance = toMoney(o['balance']);
  const autoReload = toAutoReload(o['auto_reload']);
  const percent = typeof o['percent'] === 'number' && Number.isFinite(o['percent']) ? (o['percent'] as number) : undefined;
  const currency = used?.currency ?? limit?.currency ?? balance?.currency;
  return {
    enabled: o['enabled'],
    ...(limit && percent !== undefined ? { utilization: Math.max(0, Math.min(100, percent)) } : {}),
    ...(used ? { usedCredits: used.amount } : {}),
    ...(limit ? { monthlyLimit: limit.amount } : {}),
    ...(balance ? { balance: balance.amount } : {}),
    ...(autoReload !== undefined ? { autoReload } : {}),
    ...(currency ? { currency } : {}),
  };
}

/** `limits[]` 한 줄의 표시명 — 모델(예: Fable) 또는 제품면 범위. 없으면 계정 전체 한도다. */
function scopeLabelOf(scope: unknown): string | undefined {
  if (!scope || typeof scope !== 'object') return undefined;
  const s = scope as Record<string, unknown>;
  for (const key of ['model', 'surface']) {
    const part = s[key];
    if (!part || typeof part !== 'object') continue;
    const name = (part as Record<string, unknown>)['display_name'];
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}

interface ListedLimits {
  session?: UsageWindowSnapshot;
  weekly?: UsageWindowSnapshot;
  scoped: ScopedUsageSnapshot[];
}

/**
 * CLI 표시 목록 `limits[]` → 창들. `/usage` 가 그리는 줄과 같은 목록이라, 여기 없는 창은 그 계정에 없는 창이다.
 * 아는 줄이 하나도 없으면 null — 옛 창 키로 폴백한다(모르는 꼴을 "한도 없음" 으로 읽지 않는다).
 */
function parseLimitList(raw: unknown): ListedLimits | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ListedLimits = { scoped: [] };
  let recognized = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const pct = o['percent'];
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    const kind = typeof o['kind'] === 'string' ? o['kind'] : '';
    const group = typeof o['group'] === 'string' ? o['group'] : '';
    const percent = Math.max(0, Math.min(100, pct));
    const resetsAt = toEpochMs(o['resets_at']);
    const window: UsageWindowSnapshot = { percent, ...(resetsAt !== undefined ? { resetsAt } : {}) };
    const label = scopeLabelOf(o['scope']);
    if (label) {
      out.scoped.push({ label, ...window, ...(typeof o['is_active'] === 'boolean' ? { isActive: o['is_active'] } : {}) });
      recognized++;
    } else if (kind === 'session' || kind === 'five_hour' || group === 'session') {
      out.session ??= window;
      recognized++;
    } else if (kind === 'weekly_all' || (group === 'weekly' && kind !== 'weekly_scoped')) {
      out.weekly ??= window;
      recognized++;
    }
  }
  return recognized > 0 ? out : null;
}

/** 공식 플랜 표시명. 같은 객체의 이메일·식별자는 읽지 않는다. */
function readPlanName(root: Record<string, unknown>): string | undefined {
  const account = root['oauthAccount'];
  if (!account || typeof account !== 'object') return undefined;
  const name = (account as Record<string, unknown>)['planDisplayName'];
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 40 ? trimmed : undefined;
}

/**
 * `.claude.json` 본문 → 스냅샷. CLI 가 적어 둔 `cachedUsageUtilization` 과 `oauthAccount.planDisplayName` 만 본다
 * (같은 파일의 다른 값 — 특히 인증·계정 식별 — 은 읽지 않는다).
 */
export function parseCachedUsageUtilization(rawJson: string): UsageProbeSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const cached = root['cachedUsageUtilization'];
  if (!cached || typeof cached !== 'object') return null;
  const c = cached as Record<string, unknown>;
  const util = c['utilization'];
  if (!util || typeof util !== 'object') return null;
  const u = util as Record<string, unknown>;

  const fetchedAt = typeof c['fetchedAtMs'] === 'number' && Number.isFinite(c['fetchedAtMs'])
    ? (c['fetchedAtMs'] as number)
    : 0;
  const listed = parseLimitList(u['limits']);
  const session = listed ? listed.session : toWindow(u['five_hour']);
  const weekly = listed ? listed.weekly : toWindow(u['seven_day']);
  const scoped = listed?.scoped ?? [];
  const extraCredits = toSpendCredits(u['spend']) ?? toExtraCredits(u['extra_usage']);
  if (!session && !weekly && scoped.length === 0 && !extraCredits) return null;
  const planName = readPlanName(root);

  return {
    fetchedAt,
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    scoped,
    ...(listed ? { listed: true } : {}),
    ...(extraCredits ? { extraCredits } : {}),
    ...(planName ? { planName } : {}),
  };
}

/**
 * `limits[]` 가 없는 옛 판의 폴백 — `/usage` 출력에서 **모델별 주간 한도 줄**(`Current week (Fable): 0% used`)만 집는다.
 * 그 판의 JSON 엔 내부 코드명(`nimbus_quill` 등)뿐이라 표시명을 여기서만 얻는다. 문구가 바뀌면 이 줄들만 빠진다.
 */
export function parseScopedWeeklyRows(text: string): ScopedUsageSnapshot[] {
  const rows: ScopedUsageSnapshot[] = [];
  const re = /Current week \(([^)]+)\):\s*(\d+(?:\.\d+)?)%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = (m[1] ?? '').trim();
    const percent = Number(m[2]);
    if (!label || !Number.isFinite(percent)) continue;
    if (/^all models$/i.test(label)) continue;
    rows.push({ label, percent: Math.max(0, Math.min(100, percent)) });
  }
  return rows;
}

/** stream-json 출력에서 `/usage` 의 공식 구조(`usage_report` — assistant 줄)와 결과 본문을 꺼낸다. 못 읽는 줄은 건너뛴다. */
export function readUsageStream(out: string): { report?: unknown; resultText: string } {
  let report: unknown;
  let resultText = '';
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const o = parsed as Record<string, unknown>;
    if (o['type'] === 'assistant' && o['usage_report'] !== undefined) report = o['usage_report'];
    else if (o['type'] === 'result' && typeof o['result'] === 'string') resultText = o['result'];
  }
  return { ...(report !== undefined ? { report } : {}), resultText };
}

/** `usage_report.extra_usage` — 금액 칸은 단위가 적혀 있지 않아 담지 않는다(켬/끔·사용률만). */
function toReportExtraCredits(raw: unknown): ClaudeUsageExtraCredits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o['is_enabled'] !== 'boolean') return undefined;
  const util = o['utilization'];
  const currency = typeof o['currency'] === 'string' && o['currency'] ? o['currency'] : undefined;
  return {
    enabled: o['is_enabled'],
    ...(typeof util === 'number' && Number.isFinite(util) ? { utilization: Math.max(0, Math.min(100, util)) } : {}),
    ...(currency ? { currency } : {}),
  };
}

/**
 * `usage_report` → 스냅샷. `rate_limits.limits[]` 는 캐시의 `limits[]` 와 같은 줄이라 같은 분류 함수를 쓴다.
 * `rate_limits: null`(토큰에 `user:profile` 범위 없음)·빈 목록·아는 줄 없음이면 null — 캐시로 내려간다.
 */
export function parseUsageReport(report: unknown, fetchedAt: number): UsageProbeSnapshot | null {
  if (!report || typeof report !== 'object') return null;
  const rateLimits = (report as Record<string, unknown>)['rate_limits'];
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const r = rateLimits as Record<string, unknown>;
  const listed = parseLimitList(r['limits']);
  if (!listed) return null;
  const extraCredits = toReportExtraCredits(r['extra_usage']);
  return {
    fetchedAt,
    ...(listed.session ? { session: listed.session } : {}),
    ...(listed.weekly ? { weekly: listed.weekly } : {}),
    scoped: listed.scoped,
    listed: true,
    ...(extraCredits ? { extraCredits } : {}),
  };
}

/**
 * probe 출력 + 캐시 → 스냅샷. 공식 구조가 있으면 그 줄이 한도 원천이고 크레딧·플랜명은 캐시의 것을 잇는다(캐시 크레딧은 금액 꼴이 확인된 값).
 * 없으면 캐시 그대로, 캐시에 표시 목록도 없는 옛 판은 결과 본문에서 모델별 줄을 집는다.
 */
export function assembleProbeSnapshot(out: string, cached: UsageProbeSnapshot | null, now: number): UsageProbeSnapshot | null {
  const stream = readUsageStream(out);
  const reported = parseUsageReport(stream.report, now);
  if (reported) {
    const extraCredits = cached?.extraCredits ?? reported.extraCredits;
    return {
      ...reported,
      ...(extraCredits ? { extraCredits } : {}),
      ...(cached?.planName ? { planName: cached.planName } : {}),
    };
  }
  if (!cached) return null;
  if (cached.listed) return cached;
  const scoped = parseScopedWeeklyRows(stream.resultText || out);
  return scoped.length > 0 ? { ...cached, scoped } : cached;
}

/** `.claude.json` 을 읽어 스냅샷으로. 파일이 없거나 형식이 다르면 null. */
export function readCachedUsageSnapshot(
  homeDir: string = os.homedir(),
  configDir: string | undefined = process.env['CLAUDE_CONFIG_DIR'],
): UsageProbeSnapshot | null {
  for (const file of claudeConfigJsonPaths(homeDir, configDir)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const snapshot = parseCachedUsageUtilization(raw);
    if (snapshot) return snapshot;
  }
  return null;
}

/**
 * probe 1회 — `claude -p "/usage"` 실행 → 공식 구조(없으면 CLI 가 갱신한 캐시)를 스냅샷으로.
 * - 실행 디렉터리는 홈이다(프로젝트에 세션 흔적을 남길 이유가 없다).
 * - `VIBISUAL_USAGE_PROBE=1` 을 싣는다 — 훅(`hooks/handler.mjs`)이 보고 즉시 빠져, 캔버스에 버블·활동이 생기지 않는다.
 * - throw 하지 않는다. 실패해도 마지막으로 성공한 캐시가 있으면 그 값을 돌려준다.
 */
export async function probeClaudeUsage(): Promise<UsageProbeResult> {
  const before = readCachedUsageSnapshot();
  // stream-json 은 --print 에서 --verbose 를 요구한다. `usage_report` 는 이 출력에만 실린다(json 은 결과 한 줄뿐).
  const res = await runClaudeCli(['-p', '/usage', '--output-format', 'stream-json', '--verbose'], CLAUDE_USAGE_PROBE_TIMEOUT_MS, {
    cwd: os.homedir(),
    extraEnv: { VIBISUAL_USAGE_PROBE: '1' },
  });

  if (res.failure === 'spawn') {
    logger.warn('[claudeUsage] /usage probe 실패 — claude 실행본을 찾지 못했습니다');
    return before ? { snapshot: before, failure: 'cli-missing' } : { snapshot: null, failure: 'cli-missing' };
  }
  if (res.failure === 'timeout') {
    logger.warn('[claudeUsage] /usage probe 타임아웃');
    return before ? { snapshot: before, failure: 'timeout' } : { snapshot: null, failure: 'timeout' };
  }

  const snapshot = assembleProbeSnapshot(res.out, readCachedUsageSnapshot() ?? before, Date.now());
  if (!snapshot) {
    logger.warn(`[claudeUsage] /usage probe 가 값을 남기지 않았습니다 (exit=${String(res.code)})`);
    return { snapshot: null, failure: 'no-data' };
  }
  return { snapshot };
}
