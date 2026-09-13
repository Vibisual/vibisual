/**
 * **한도로 끊긴 턴을 알아본다** — "You've hit your session limit · resets 10pm (Asia/Seoul)".
 *
 * **왜 필요한가.** 요금제 한도에 닿으면 CLI 는 *실패하지 않는다.* 마지막 턴 자리에 **합성
 * assistant 메시지**를 한 줄 적고(`model: "<synthetic>"` · 토큰 전부 0) 정상 종료(exit 0)한다.
 * 우리 마감 경로는 종료 코드만 보므로 그 명령은 `completed` 로 봉인되고, 세션 도트는 초록
 * "끝남", 헤더 배지는 회색으로 내려간다 — **화면 어디에도 "멈췄다"가 없다.** 사용자는 에이전트
 * 열 개가 한꺼번에 멎은 것을 한참 뒤에야 알아챈다(사용자 보고 2026-09-09).
 *
 * 실측한 원문(트랜스크립트 `~/.claude/projects/**.jsonl`):
 * ```json
 * {"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text",
 *   "text":"You've hit your session limit · resets 10pm (Asia/Seoul)"}]},
 *  "quotaLimits":{"status":"rejected","resetsAt":1788958800,"rateLimitType":"five_hour"},
 *  "error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429}
 * ```
 * 다른 모양들도 같은 자리로 온다 — 주간 한도(`weekly limit`), 옛 CLI 의
 * `Claude AI usage limit reached|<epoch>`, 코덱스의 `{"type":"error","message":"You've hit
 * your usage limit. …"}`(§5.25 (F)).
 *
 * **판정을 여기 한 곳에 둔다.** 스트림 경로가 셋(persistent stdout · legacy stdout · agent-view
 * JSONL watcher)이라, 화면마다·경로마다 따로 알아보면 한쪽만 고쳐지는 날이 온다(§2.1 셸
 * 토크나이저·`externalFolderView` 와 같은 규율). 순수 함수라 단위 테스트로 고정한다.
 *
 * **넘겨짚지 않는다.** 이 문장은 대화 본문에도 얼마든지 등장한다(지금 이 기능을 지시한 프롬프트가
 * 그 문장 자체였다). 그래서 두 관문을 함께 요구한다 — ① 원문이 **그 통지로 시작**할 것(문장
 * 가운데 인용은 통지가 아니다), ② 합성 표식(`<synthetic>`)이나 한도 증거(`rate_limit`·HTTP 429·
 * `quotaLimits`)가 함께 있거나, 그것이 없으면 **통지 길이의 짧은 한 줄**일 것.
 */

/** 어느 창이 막혔는가 — CLI 가 쓰는 낱말 그대로. */
export type UsageLimitKind =
  /** 5시간 창(세션 한도). CLI `rateLimitType: 'five_hour'`. */
  | 'session'
  /** 7일 창(주간 한도). CLI `rateLimitType: 'seven_day'`. */
  | 'weekly'
  /** 창을 특정할 수 없는 사용량 한도(옛 CLI · 코덱스). */
  | 'usage';

/** 한도로 끊긴 사실 한 건 — 세션에 붙어 화면이 그대로 읽는다. */
export interface UsageLimitStop {
  kind: UsageLimitKind;
  /** 알아본 시각(ms epoch). */
  at: number;
  /** CLI 가 쓴 원문 한 줄. **번역하지 않고** 그대로 보여준다. 없으면 화면이 자기 문장을 쓴다. */
  message?: string;
  /** 한도가 풀리는 시각(ms epoch) — `quotaLimits.resetsAt` 가 있을 때만. */
  resetsAt?: number;
  /** 원문에 적힌 리셋 표기(`10pm (Asia/Seoul)`) — 숫자 시각이 없을 때 이것이라도 보여준다. */
  resetsLabel?: string;
}

/** 원문 보관 상한 — 통지 한 줄이라 넉넉하다(툴팁 한 줄에 들어가야 한다). */
export const USAGE_LIMIT_MESSAGE_MAX = 200;

/** 리셋 표기 보관 상한(`10pm (Asia/Seoul)`). */
export const USAGE_LIMIT_RESET_LABEL_MAX = 40;

/**
 * 증거 없이 원문만으로 인정해 줄 최대 길이. 합성 통지는 55자 안팎이고, 이보다 긴 글이 그 문장으로
 * 시작하면 그것은 통지가 아니라 **통지를 인용한 사람의 글**이다(보고서·이 기획 문단 자체).
 */
export const USAGE_LIMIT_NOTICE_MAX = 200;

/** `You've hit your session limit …` — 현행 CLI. */
const LIMIT_HEAD_RE = /^(?:you(?:'|’)?ve\s+)?hit\s+your\s+(session|weekly|usage)\s+limit\b/i;

/** `Claude AI usage limit reached|<epoch>` — 옛 CLI. */
const LIMIT_REACHED_RE = /^(?:claude\s+(?:ai\s+)?)?(session|weekly|usage)\s+limit\s+reached\b/i;

/** `… · resets 10pm (Asia/Seoul)` 의 뒷부분. 꼬리의 `(error type …)` 진단문은 표기가 아니다. */
const RESET_LABEL_RE = /\bresets\s+([^\n]+?)(?:\s*\(error\s+type[^\n]*)?$/i;

/** `quotaLimits.rateLimitType` → 우리 낱말. 모르는 값은 창을 특정하지 않는다. */
const RATE_LIMIT_TYPE_KIND: Record<string, UsageLimitKind> = {
  five_hour: 'session',
  seven_day: 'weekly',
};

function clamp(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** 초 단위 epoch 를 ms 로 — 이미 ms 면 그대로 둔다(자릿수로 가른다). */
function toEpochMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

/**
 * 원문 한 덩이가 **한도 통지 그 자체**인가 — 맞으면 종류를, 아니면 `null`.
 *
 * 시작 위치를 요구하는 것이 오탐을 막는 핵심이다. 문장 가운데의 인용(`… "You've hit your
 * session limit" 이라고 떴습니다`)은 통지가 아니라 그것을 말하는 사람의 글이다.
 */
export function matchUsageLimitNotice(text: string): UsageLimitKind | null {
  const t = text.trim();
  if (t === '') return null;
  const head = LIMIT_HEAD_RE.exec(t) ?? LIMIT_REACHED_RE.exec(t);
  if (!head) return null;
  const word = (head[1] ?? 'usage').toLowerCase();
  return word === 'session' || word === 'weekly' ? word : 'usage';
}

/** 원문에서 리셋 표기(`10pm (Asia/Seoul)`)를 떼어 낸다. 없으면 `undefined`. */
export function parseUsageLimitResetLabel(text: string): string | undefined {
  const m = RESET_LABEL_RE.exec(text.trim());
  const label = m?.[1]?.trim();
  return label ? clamp(label, USAGE_LIMIT_RESET_LABEL_MAX) : undefined;
}

/**
 * 원문 한 줄만으로 판정한다 — 턴 결과(`result` 본문)처럼 봉투가 없는 자리에서 쓴다.
 *
 * 증거 봉투가 없으므로 **짧은 한 줄**만 인정한다(`USAGE_LIMIT_NOTICE_MAX`). 긴 글이 그 문장으로
 * 시작하면 그것은 통지를 인용한 글이다 — 그것까지 한도로 세면 멀쩡히 끝난 세션이 주황으로 물든다.
 */
export function detectUsageLimitInText(text: string, now: number): UsageLimitStop | null {
  const t = text.trim();
  if (t.length > USAGE_LIMIT_NOTICE_MAX) return null;
  const kind = matchUsageLimitNotice(t);
  if (!kind) return null;
  const label = parseUsageLimitResetLabel(t);
  return {
    kind,
    at: now,
    message: clamp(t, USAGE_LIMIT_MESSAGE_MAX),
    ...(label ? { resetsLabel: label } : {}),
  };
}

/** 객체에서 문자열 필드 하나를 안전하게 꺼낸다. */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

/** assistant 봉투의 `message.content[].text` 를 한 덩이로 잇는다(도구 블록은 글자가 없다). */
function textOfMessage(message: Record<string, unknown>): string {
  const direct = message['text'];
  if (typeof direct === 'string') return direct;
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const text = (block as Record<string, unknown>)['text'];
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('\n');
}

/**
 * CLI 가 뱉은 **한 줄**(stream-json stdout · agent-view JSONL)에서 한도 종료를 알아본다.
 *
 * 보는 줄은 `assistant` · `result` · `error` 셋뿐이다. **`user` 줄은 절대 보지 않는다** —
 * 사용자가 그 문장을 프롬프트에 적는 일이 실제로 있고(이 기능의 지시가 그랬다), 그것을 한도로
 * 세면 명령을 넣는 순간 그 세션이 주황이 된다.
 *
 * @param line  JSON 한 줄을 파싱한 객체.
 * @param now   지금 시각(ms) — 시간을 함수 안에서 읽지 않아야 테스트로 고정할 수 있다.
 */
export function detectUsageLimitStop(line: unknown, now: number): UsageLimitStop | null {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return null;
  const obj = line as Record<string, unknown>;
  const type = str(obj, 'type');
  if (type !== 'assistant' && type !== 'result' && type !== 'error') return null;

  // ── 한도 증거(봉투) — 있으면 원문 길이를 따지지 않는다. ──
  const quota = obj['quotaLimits'] && typeof obj['quotaLimits'] === 'object'
    ? obj['quotaLimits'] as Record<string, unknown>
    : undefined;
  const quotaRejected = quota !== undefined && str(quota, 'status') === 'rejected';
  const rateLimited = str(obj, 'error') === 'rate_limit'
    || obj['apiErrorStatus'] === 429
    || quotaRejected;

  // 합성 표식 — API 호출 없이 CLI 가 직접 적은 줄이라는 뜻이다(대화 본문이 아니다).
  const message = obj['message'] && typeof obj['message'] === 'object'
    ? obj['message'] as Record<string, unknown>
    : undefined;
  const synthetic = message !== undefined && str(message, 'model') === '<synthetic>';

  // ── 원문 — 봉투 모양이 경로마다 다르므로 아는 자리를 전부 본다. ──
  const fromMessage = message ? textOfMessage(message) : '';
  const text = (fromMessage.trim() !== '' ? fromMessage : undefined)
    ?? str(obj, 'result')
    ?? str(obj, 'message')   // 코덱스 `{"type":"error","message":"…"}`
    ?? str(obj, 'text')
    ?? '';

  const kind = matchUsageLimitNotice(text);
  if (!kind) return null;
  // 증거가 없으면 **짧은 통지 한 줄**만 인정한다(위 detectUsageLimitInText 와 같은 관문).
  if (!synthetic && !rateLimited && text.trim().length > USAGE_LIMIT_NOTICE_MAX) return null;

  const typed = quota ? RATE_LIMIT_TYPE_KIND[str(quota, 'rateLimitType') ?? ''] : undefined;
  const resetsAtRaw = quota && typeof quota['resetsAt'] === 'number'
    ? toEpochMs(quota['resetsAt'] as number)
    : undefined;
  const label = parseUsageLimitResetLabel(text);

  return {
    // 봉투가 창을 특정하면 그쪽이 정확하다(원문은 사람이 읽는 말, 봉투는 CLI 의 판정).
    kind: typed ?? kind,
    at: now,
    message: clamp(text, USAGE_LIMIT_MESSAGE_MAX),
    ...(resetsAtRaw !== undefined ? { resetsAt: resetsAtRaw } : {}),
    ...(label ? { resetsLabel: label } : {}),
  };
}
