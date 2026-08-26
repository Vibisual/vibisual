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
 * §4 — Claude 사용량 표시값 조립.
 *
 * **원천은 둘이고, 이 모듈은 둘 중 더 최근 것을 골라 담는다.**
 *   ① `claude -p "/usage"` probe(`claudeUsageProbe`) — 대화형 세션이 없어도 값이 들어오는 1차
 *      원천. 모델 호출 0턴이라 과금이 없다(실측). 5분 주기 + 부팅 직후 + 팝업 새로고침에 돈다.
 *   ② statusLine(§4 v3.60) — 대화형 세션이 상태줄을 그릴 때 밀어 주는 값. `hooks/handler.mjs
 *      --statusline` → `POST /api/rate-limits` → `graphManager.rateLimits`. 세션이 떠 있는
 *      동안에는 probe 주기보다 빨리 도착하므로 폐기하지 않고 **최신성으로** 겨룬다.
 *
 * ②만 있던 시절에는 헤드리스 에이전트만 돌리는 사용자의 필이 영영 `-` 였다 — 수집기를 켜도
 * 채워질 길이 없었기 때문이다. ①을 더해 그 구멍을 막는다.
 *
 * **왜 직접 조회를 걷어냈나** — 종전(구 v3.62)에는 `~/.claude/.credentials.json` 의 OAuth
 * accessToken 으로 `GET https://api.anthropic.com/api/oauth/usage` 를 5분마다 직접 호출했다.
 * 문서화되지 않은 내부 엔드포인트를 공식 클라이언트용 토큰으로 자동 조회하는 것이라, Anthropic
 * 소비자 약관 §3 "API 키를 통하거나 명시적으로 허용된 경우를 제외한 자동화된 접속 금지" 에
 * 정면으로 걸린다. 배포되는 제품이므로 그 위험은 사용자 계정 전체에 걸린다 — 그래서 네트워크
 * 호출을 없애고 공식 경로 하나만 남겼다.
 *
 * **그래서 잃은 것** — 모델별 주간 한도(`weekly_scoped`)와 사용 크레딧(`extra_usage`)은
 * statusLine 이 주지 않으므로 더 이상 표시하지 않는다. 남는 것은 5시간·7일 두 창의 사용률과
 * 리셋 시각, 그리고 플랜 표시명이다.
 *
 * **자격증명 파일 취급** — 플랜 표시명(`Max (20x)`)을 만들려면 `subscriptionType`·`rateLimitTier`
 * 두 값이 필요해 파일을 읽지만, **accessToken 은 읽지도 실어 보내지도 않는다**. 쓰기는 절대 하지
 * 않는다(토큰 갱신은 Claude Code 자신의 일이다).
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
  // 리셋 시각을 지난 값은 **옛 창의 값**이다. 그대로 두면 "시간이 지났는데 화면은 아직 100%"
  // 가 되므로(v3.63 사용자 보고와 같은 증상) 0 으로 본다 — 다음 statusLine 갱신이 실제 값을
  // 덮어쓴다. 값을 지어내는 것이 아니라 **만료를 반영**하는 것이다.
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
 * 같은 창(5시간·7일)을 두 원천이 모두 보고했을 때 **더 최근 것**을 고른다.
 *
 * 우열을 고정하지 않는 이유 — 대화형 세션이 떠 있으면 statusLine 이 초 단위로 최신이고,
 * 그런 세션이 없으면 probe 만 갱신된다. 어느 한쪽을 항상 이기게 하면 나머지 상황에서 낡은 값이
 * 화면에 박힌다. 시각이 같으면 probe 를 택한다(리셋 시각까지 함께 오는 쪽).
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
 * 두 원천(`/usage` probe · statusLine)의 창들 → 팝업이 읽는 `ClaudeUsageInfo`.
 *
 * 값이 하나도 없을 때 **왜 없는지**를 구분해 실어 보낸다 —
 *   - `cli-unavailable`: `claude` 실행본을 못 찾았거나 probe 가 실패/타임아웃. 켜고 끌 문제가
 *     아니라 실행 경로 문제라 화면이 다르게 말해야 한다.
 *   - `awaiting-statusline`: probe 는 아직인데 수집기는 켜져 있다 — 곧 들어온다.
 *   - `no-credentials`: 아직 아무 경로로도 값을 받은 적이 없다.
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
