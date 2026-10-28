import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT } from '@vibisual/shared';
import type {
  ClaudeUsageError,
  ClaudeUsageInfo,
  ClaudeUsageLimit,
  ClaudeUsageSource,
  RateLimitInfo,
} from '@vibisual/shared';
import type {
  UsageProbeFailure,
  UsageProbeSnapshot,
  UsageWindowSnapshot,
} from './claudeUsageProbe.js';

/**
 * §4 — Claude 사용량 표시값 조립. **원천 둘 중 더 최근 것을 고른다.**
 * ① `claude -p "/usage"` probe(`claudeUsageProbe`) — 대화형 세션 없이 오는 1차 원천, 모델 0턴이라 과금 없음(실측). 5분 주기 + 부팅 직후 + 팝업 새로고침.
 * ② statusLine — 대화형 세션이 밀어 주는 값(`hooks/handler.mjs --statusline` → `POST /api/rate-limits` → `graphManager.rateLimits`). 세션이 떠 있으면 probe 보다 빨라 버리지 않고 최신성으로 겨룬다.
 * 네트워크로 직접 조회하지 않는다 — `.credentials.json` 의 OAuth 토큰으로 문서에 없는 `api/oauth/usage` 를 자동 호출하면 Anthropic 소비자 약관 §3(자동화 접속 금지)에 걸린다. statusLine 은 모델별 주간 한도(`weekly_scoped`)·사용 크레딧(`extra_usage`)을 주지 않는다.
 * 자격증명 파일은 플랜 표시명(`Max (20x)`)용 `subscriptionType`·`rateLimitTier` 두 값만 읽는다 — **accessToken 은 읽지도 싣지도 않고**, 쓰기는 절대 하지 않는다(토큰 갱신은 Claude Code 의 일).
 */

/** 플랜 표시명 재료 — 자격증명 파일에서 **토큰이 아닌** 두 값만 집는다. */
interface PlanHints {
  subscriptionType?: string;
  rateLimitTier?: string;
}

function credentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/**
 * 플랜 표시명 재료 읽기. 없거나 형식이 다르면 null(mac 키체인 저장 환경 포함).
 * `accessToken` 은 의도적으로 건드리지 않는다 — 이 앱은 그 토큰을 쓸 일이 없다.
 */
function readPlanHints(): PlanHints | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const oauth = parsed['claudeAiOauth'] as Record<string, unknown> | undefined;
    if (!oauth) return null;
    const hints: PlanHints = {};
    if (typeof oauth['subscriptionType'] === 'string') hints.subscriptionType = oauth['subscriptionType'];
    if (typeof oauth['rateLimitTier'] === 'string') hints.rateLimitTier = oauth['rateLimitTier'];
    return hints.subscriptionType || hints.rateLimitTier ? hints : null;
  } catch {
    return null;
  }
}

/**
 * 플랜 표시명 조립 — `subscriptionType='max'` + `rateLimitTier='default_claude_max_20x'`
 * → `"Max (20x)"`. 배수 표기가 없으면 타입만("Pro"). 알 수 없으면 undefined.
 */
export function buildPlanLabel(subscriptionType?: string, rateLimitTier?: string): string | undefined {
  if (!subscriptionType) return undefined;
  const name = subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
  const multiplier = rateLimitTier?.match(/(\d+x)\b/i)?.[1];
  return multiplier ? `${name} (${multiplier})` : name;
}

/** 사용률 → 심각도. 임계는 화면과 같은 shared 상수를 쓴다(자체 하드코딩 ❌). */
export function severityForPercent(percent: number): string {
  if (percent >= USAGE_LIMIT_DANGER_PCT) return 'critical';
  if (percent >= USAGE_LIMIT_WARN_PCT) return 'warning';
  return 'normal';
}

/** 창 하나를 `ClaudeUsageLimit` 로. 리셋 시각이 이미 지났으면 그 창은 새로 시작됐다고 본다. */
function toLimit(
  kind: string,
  group: string,
  percent: number | undefined,
  resetsAt: number | undefined,
  now: number,
): ClaudeUsageLimit | null {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  // 리셋 시각을 지난 값은 **옛 창의 값**이라 0 으로 본다 — 그대로 두면 시간이 지나도 화면이 100% 에 머문다. 다음 statusLine 갱신이 실제 값을 덮어쓴다(지어내기가 아니라 만료 반영).
  const expired = resetsAt !== undefined && resetsAt <= now;
  const pct = expired ? 0 : Math.max(0, Math.min(100, percent));
  return {
    kind,
    group,
    percent: pct,
    severity: severityForPercent(pct),
    ...(resetsAt !== undefined && !expired ? { resetsAt } : {}),
    isActive: true,
  };
}


/** 창 하나의 최종 채택값 — 어느 원천에서 왔는지까지 들고 다닌다(표시용 `source` 판정에 쓴다). */
interface PickedWindow {
  percent: number;
  resetsAt?: number;
  fromCli: boolean;
}

/**
 * 같은 창(5시간·7일)을 두 원천이 모두 보고했으면 **더 최근 것**을 고른다.
 * 우열을 고정하지 않는다 — 대화형 세션이 있으면 statusLine 이 초 단위로 최신이고, 없으면 probe 만 갱신된다. 시각이 같으면 probe(리셋 시각까지 오는 쪽).
 */
function pickWindow(
  statusPercent: number | undefined,
  statusResetsAt: number | undefined,
  statusAt: number | undefined,
  cli: UsageWindowSnapshot | undefined,
  cliAt: number,
): PickedWindow | null {
  const hasStatus = typeof statusPercent === 'number' && Number.isFinite(statusPercent);
  const hasCli = cli !== undefined;
  if (!hasStatus && !hasCli) return null;
  if (hasStatus && hasCli) {
    const statusWins = (statusAt ?? 0) > cliAt;
    if (statusWins) {
      return {
        percent: statusPercent,
        ...(statusResetsAt !== undefined ? { resetsAt: statusResetsAt } : {}),
        fromCli: false,
      };
    }
  }
  if (hasCli) {
    return {
      percent: cli.percent,
      ...(cli.resetsAt !== undefined ? { resetsAt: cli.resetsAt } : {}),
      fromCli: true,
    };
  }
  return {
    percent: statusPercent as number,
    ...(statusResetsAt !== undefined ? { resetsAt: statusResetsAt } : {}),
    fromCli: false,
  };
}

/**
 * 두 원천(`/usage` probe · statusLine)의 창들 → 팝업이 읽는 `ClaudeUsageInfo`. 값이 없으면 **왜 없는지**를 싣는다:
 * `cli-unavailable` — 실행본을 못 찾았거나 probe 실패/타임아웃(켜고 끌 문제가 아니라 화면이 다르게 말한다) · `awaiting-statusline` — probe 는 아직, 수집기는 켜짐 · `no-credentials` — 아직 어느 경로로도 값을 받은 적이 없다.
 */
export function buildClaudeUsage(
  rate: RateLimitInfo | undefined,
  now: number,
  collectorInstalled = false,
  probe?: UsageProbeSnapshot | null,
  probeFailure?: UsageProbeFailure,
): ClaudeUsageInfo {
  const limits: ClaudeUsageLimit[] = [];
  const cliAt = probe?.fetchedAt ?? 0;

  const sessionPick = pickWindow(rate?.used5h, rate?.resetAt5h, rate?.updatedAt, probe?.session, cliAt);
  const weeklyPick = pickWindow(rate?.used7d, rate?.resetAt7d, rate?.updatedAt, probe?.weekly, cliAt);

  const session = sessionPick ? toLimit('session', 'session', sessionPick.percent, sessionPick.resetsAt, now) : null;
  if (session) limits.push(session);
  const weekly = weeklyPick ? toLimit('weekly_all', 'weekly', weeklyPick.percent, weeklyPick.resetsAt, now) : null;
  if (weekly) limits.push(weekly);

  // 모델별 주간 한도 — probe 출력에만 있는 표시명이 붙는다(§ claudeUsageProbe 주석).
  for (const row of probe?.scoped ?? []) {
    const scoped = toLimit('weekly_scoped', 'weekly', row.percent, undefined, now);
    if (scoped) limits.push({ ...scoped, scopeLabel: row.label });
  }

  const hints = readPlanHints();
  const plan = buildPlanLabel(hints?.subscriptionType, hints?.rateLimitTier);

  const usedCli = Boolean(sessionPick?.fromCli || weeklyPick?.fromCli || (probe?.scoped.length ?? 0) > 0);
  const source: ClaudeUsageSource = usedCli ? 'cli' : 'statusline';

  const emptyReason: ClaudeUsageError = probeFailure
    ? 'cli-unavailable'
    : collectorInstalled
      ? 'awaiting-statusline'
      : 'no-credentials';

  return {
    ...(plan ? { plan } : {}),
    limits,
    ...(probe?.extraCredits ? { extraCredits: probe.extraCredits } : {}),
    source,
    // 값을 실제로 받아온 시각 — probe 가 이겼으면 그 시각, 아니면 statusLine 이 보고한 시각.
    fetchedAt: usedCli ? (probe?.fetchedAt ?? now) : (rate?.updatedAt ?? now),
    ...(limits.length === 0 ? { error: emptyReason } : {}),
  };
}
