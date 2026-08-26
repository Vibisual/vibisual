import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_USAGE_PROBE_TIMEOUT_MS } from '@vibisual/shared';
import type { ClaudeUsageExtraCredits } from '@vibisual/shared';
import { runClaudeCli } from './claudeCliRun.js';
import { logger } from '../logger.js';

/**
 * §4 — 사용량 값을 **대화형 세션 없이** 받아오는 경로.
 *
 * ## 왜 필요한가
 * 종전의 유일한 원천은 statusLine 이었다(§4 v3.60). 그런데 statusLine 은 **대화형 Claude Code
 * 세션이 화면을 그릴 때만** 실행된다 — Vibisual 이 띄우는 에이전트는 전부 헤드리스라 상태줄이
 * 없다. 그래서 앱만 켜 두고 하루 종일 일해도 헤더 사용량 필은 `-` 인 채였다(사용자 보고).
 * 수집기를 켜 두었는데도 값이 안 온다는 것은, 켤 자리는 있으나 **채워질 길이 없었다**는 뜻이다.
 *
 * ## 무엇을 부르나 — 공개 인터페이스 하나
 * `claude -p "/usage"` (print 모드 + 내장 슬래시 명령). 공식 CLI 를 사용자 자신의 인증으로
 * 실행하는 것이라 **문서에 없는 엔드포인트 호출도, 남의 화면 긁기도, 토큰 추출도 아니다**
 * (§ 법적 안전선). 구 v3.62 가 `~/.claude/.credentials.json` 의 accessToken 으로
 * `api/oauth/usage` 를 직접 두드리다 걷어낸 그 자리를, 공개 인터페이스로 대신 채운다.
 *
 * ## 왜 공짜인가 — 실측
 * `--output-format json` 으로 재 보면 `num_turns: 0`, `total_cost_usd: 0`, 입출력 토큰 전부 0,
 * `duration_api_ms: 0` 이다(2.3초). 슬래시 명령이 CLI 안에서 끝나 **모델을 부르지 않는다.**
 * 그래서 5분 주기로 돌려도 사용자의 한도를 갉아먹지 않는다.
 *
 * ## 값은 어디서 읽나 — 출력 파싱이 아니라 CLI 자신의 캐시
 * `/usage` 를 돌리면 Claude Code 가 그 결과를 **자기 설정 파일**(`~/.claude.json` 의
 * `cachedUsageUtilization`)에 구조화된 채로 적어 둔다. 사람이 읽는 표를 정규식으로 뜯는 것보다
 * 훨씬 안정적이라, 5시간·7일 창과 리셋 시각·사용 크레딧은 **그 JSON** 에서 읽는다.
 * 모델별 주간 한도의 **표시명**(예: `Fable`)만 JSON 에 없어서(내부 코드명 키뿐) 출력 문장에서
 * 집는다 — 못 집으면 그 줄만 빠지고 나머지는 그대로 나온다.
 */

/** 한 창(5시간·7일)의 사용률 스냅샷. */
export interface UsageWindowSnapshot {
  /** 0~100 */
  percent: number;
  /** 한도 리셋 epoch ms (CLI 가 안 주면 없음) */
  resetsAt?: number;
}

/** 모델별 주간 한도 한 줄 — 표시명은 `/usage` 출력에서 온다. */
export interface ScopedUsageSnapshot {
  label: string;
  /** 0~100 */
  percent: number;
}

/** probe 1회의 결과 — 서버가 표시값을 조립할 때 쓰는 원재료. */
export interface UsageProbeSnapshot {
  /** CLI 가 이 값을 받아온 시각(epoch ms). statusLine 값과 어느 쪽이 최신인지 가릴 때 쓴다. */
  fetchedAt: number;
  session?: UsageWindowSnapshot;
  weekly?: UsageWindowSnapshot;
  scoped: ScopedUsageSnapshot[];
  extraCredits?: ClaudeUsageExtraCredits;
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

/**
 * `.claude.json` 본문 → 스냅샷. Claude Code 가 적어 둔 `cachedUsageUtilization` 만 본다
 * (같은 파일의 다른 값 — 특히 인증 관련 — 은 읽지 않는다).
 */
export function parseCachedUsageUtilization(rawJson: string): UsageProbeSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const cached = (parsed as Record<string, unknown>)['cachedUsageUtilization'];
  if (!cached || typeof cached !== 'object') return null;
  const c = cached as Record<string, unknown>;
  const util = c['utilization'];
  if (!util || typeof util !== 'object') return null;
  const u = util as Record<string, unknown>;

  const fetchedAt = typeof c['fetchedAtMs'] === 'number' && Number.isFinite(c['fetchedAtMs'])
    ? (c['fetchedAtMs'] as number)
    : 0;
  const session = toWindow(u['five_hour']);
  const weekly = toWindow(u['seven_day']);
  const extraCredits = toExtraCredits(u['extra_usage']);
  if (!session && !weekly && !extraCredits) return null;

  return {
    fetchedAt,
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    scoped: [],
    ...(extraCredits ? { extraCredits } : {}),
  };
}

/**
 * `/usage` 출력에서 **모델별 주간 한도 줄**만 집는다.
 *
 *   Current week (all models): 15% used · resets Sep 2, 2:59am   ← 전체 창(이미 JSON 에 있다)
 *   Current week (Fable): 0% used                                ← 이 줄들
 *
 * 표시명이 JSON 에는 내부 코드명(`nimbus_quill` 등)으로만 있어 여기서만 얻을 수 있다.
 * 문구가 바뀌면 이 줄들만 빠지고 5시간·7일 창은 JSON 에서 그대로 나온다(고장 반경을 좁게).
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
 * probe 1회 — `claude -p "/usage"` 실행 → CLI 가 갱신한 캐시를 읽어 스냅샷으로.
 *
 * - 실행 디렉터리는 홈이다. 프로젝트 안에서 돌리면 그 프로젝트에 세션 흔적이 남을 이유가 없다.
 * - `VIBISUAL_USAGE_PROBE=1` 을 실어 보낸다 — 이 세션의 훅(`hooks/handler.mjs`)이 그 표시를 보고
 *   즉시 빠져나가 캔버스에 버블·활동이 생기지 않는다(사용량을 재는 일이 화면을 어지럽히면 안 된다).
 * - 실패해도 throw 하지 않는다. 마지막으로 성공한 캐시가 있으면 그 값이라도 돌려준다.
 */
export async function probeClaudeUsage(): Promise<UsageProbeResult> {
  const before = readCachedUsageSnapshot();
  const res = await runClaudeCli(['-p', '/usage', '--output-format', 'json'], CLAUDE_USAGE_PROBE_TIMEOUT_MS, {
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

  const after = readCachedUsageSnapshot();
  const snapshot = after ?? before;
  if (!snapshot) {
    logger.warn(`[claudeUsage] /usage probe 가 값을 남기지 않았습니다 (exit=${String(res.code)})`);
    return { snapshot: null, failure: 'no-data' };
  }
  const scoped = parseScopedWeeklyRows(res.out);
  return { snapshot: scoped.length > 0 ? { ...snapshot, scoped } : snapshot };
}
