/**
 * promptStamp — 내 명령 말풍선이 "언제 보낸 글인가"를 말한다.
 *
 * 스트림에는 시각이 붙어 있는 줄이 여럿인데(도구 잔줄·시스템 칩) **정작 내가 보낸 명령에는 없었다.**
 * 며칠에 걸친 세션을 되감으면 `/release` 라고 적힌 말풍선이 오늘 친 것인지 그저께 친 것인지 화면에서
 * 알 길이 없다(사용자 보고 — "여기 명령에 날짜가 없으니 내가 언제 했는지 알 수가 없네").
 *
 * 그래서 **날짜를 숨기지 않는다**: 오늘 것도 `오늘 14:32` 라고 말한다. 시각만 적어 두면 "날짜가
 * 안 붙은 건 오늘이겠지"를 사용자가 추론해야 하는데, 그 추론이 바로 지금 안 되고 있는 일이다.
 *
 *  - 오늘      → `오늘 14:32`
 *  - 어제      → `어제 09:07`
 *  - 올해      → `9월 2일 14:32`
 *  - 그 전 해  → `2025년 9월 2일 14:32`
 *  - 호버 툴팁 → `2026년 9월 2일 수요일 14:32:07` (요일·초까지)
 *
 * **새 i18n 키를 만들지 않는다.** "오늘/어제"는 `Intl.RelativeTimeFormat`, 날짜 표기는
 * `Intl.DateTimeFormat` 이 로케일 그대로 돌려준다 — 12개 로케일 파일에 같은 말을 12번 적어 두고
 * 한 곳이 어긋나기를 기다릴 이유가 없다(§5.5 i18n 규칙의 취지: 사람이 쓸 말만 사람이 쓴다).
 *
 * ⚠ **하루 차이는 시간 차가 아니라 달력 차다.** `23:59` 에 보낸 글을 `00:01` 에 보면 `2분 전`이지만
 * "어제"다. 그래서 `now - at` 을 24시간으로 나누지 않고 **자정 기준 날짜**를 뺀다(서머타임으로 하루가
 * 23/25시간이 되는 날에도 답이 흔들리지 않는다).
 *
 * ⚠ **말풍선 자리를 잡는 `timestamp` 와 다른 값을 쓴다.** 그쪽은 §5.5 #17-18 ⑥ 대로 **나간 시각**
 * (대기 중이면 `PENDING_COMMAND_TS` = `Number.MAX_SAFE_INTEGER` 라는 꼬리 표식)이라, 그대로 찍으면
 * 대기 중 덧말이 서기 275760년에 보낸 글이 된다. 여기 들어오는 값은 **내가 보낸 시각**(`QueuedCommand.
 * timestamp`)이고, 그래도 이상한 값이 오면 조용히 `null`(= 표기 없음)로 떨어진다.
 *
 * 렌더마다 불리므로 `Intl.*` 인스턴스는 **로케일별로 한 번만** 짓고 모듈에 붙들어 둔다(생성이 비싸다).
 * 대신 결과를 캐시하지 않는다 — 캐시하면 자정을 넘겨도 `오늘` 이 그대로 남는다.
 */

/** 말풍선 머리에 붙는 시각 표기 한 벌. */
export interface PromptStamp {
  /** 늘 보이는 짧은 표기 — `오늘 14:32` / `어제 09:07` / `9월 2일 14:32`. */
  text: string;
  /** 호버 툴팁 — 요일·초까지 있는 로케일 전체 표기. */
  title: string;
  /** `<time dateTime>` 에 넣을 기계 판독용 값. */
  iso: string;
  /** 오늘이 아닌가 — 날짜가 붙은 표기는 되감을 때 눈에 걸리도록 한 단계 굵게 그린다. */
  aged: boolean;
}

const DAY_MS = 86_400_000;

/** `Date` 로 못 만드는 값(대기 꼬리 표식·0·NaN)을 여기서 걸러 낸다. */
function toValidDate(at: number | undefined): Date | null {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 자정 기준 며칠 차이인가(`0` = 오늘, `1` = 어제). 하루가 23/25시간인 날이 있어 `Math.round` 로 접는다.
 */
export function calendarDayDiff(at: Date, now: Date): number {
  const a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * 로케일 태그가 이상해도 화면이 죽지 않게 — 못 알아듣는 값이면 브라우저 기본 로케일(`undefined`)로.
 * `Intl.*` 생성자는 잘못된 태그에 `RangeError` 를 던지고, 그건 말풍선 하나가 아니라 스트림 전체를
 * 무너뜨린다.
 */
function safeLocale(locale: string): string | undefined {
  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return undefined;
  }
}

/** 로케일별 `Intl` 인스턴스 창고 — 키는 정규화 실패 시의 `undefined` 까지 구분하려고 원문 그대로 쓴다. */
const relCache = new Map<string, Intl.RelativeTimeFormat>();
const timeCache = new Map<string, Intl.DateTimeFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();
const dateYearCache = new Map<string, Intl.DateTimeFormat>();
const fullCache = new Map<string, Intl.DateTimeFormat>();

function cached<T>(store: Map<string, T>, key: string, make: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  store.set(key, made);
  return made;
}

/** `0` → "오늘", `-1` → "어제". `numeric: 'auto'` 라야 "0일 전"이 아니라 낱말이 나온다. */
function relativeDayWord(key: string, loc: string | undefined, days: 0 | -1): string {
  return cached(relCache, key, () => new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })).format(days, 'day');
}

/**
 * 시:분. `hour12` 대신 `hourCycle: 'h23'` 을 쓴다 — 옛 V8 은 `hour12: false` 를 h24 로 읽어 자정을
 * `24:00` 으로 찍었다. IDE 의 다른 시각 표기(24시간제)와 같은 모양을 어느 로케일에서나 보장한다.
 */
function timeText(key: string, loc: string | undefined, d: Date): string {
  return cached(timeCache, key, () => new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).format(d);
}

/** 올해 안이면 월·일만, 해가 다르면 연도까지. */
function dateText(key: string, loc: string | undefined, d: Date, withYear: boolean): string {
  const store = withYear ? dateYearCache : dateCache;
  return cached(store, key, () => new Intl.DateTimeFormat(loc, {
    ...(withYear ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
  })).format(d);
}

/** 툴팁 — 짧은 표기에서 접은 것(요일·초·연도)이 전부 여기 남는다. */
function fullText(key: string, loc: string | undefined, d: Date): string {
  return cached(fullCache, key, () => new Intl.DateTimeFormat(loc, { dateStyle: 'full', timeStyle: 'medium' })).format(d);
}

/**
 * 보낸 시각 → 말풍선 표기. 값이 없거나 시각으로 읽을 수 없으면 `null`(표기를 그리지 않는다).
 *
 * @param at     내가 보낸 시각(ms). 말풍선 정렬용 anchor 가 아니라 **큐 투입 시각**.
 * @param locale i18n 현재 언어(`i18n.language`).
 * @param now    비교 기준(테스트에서 고정). 기본값은 지금.
 */
export function formatPromptStamp(at: number | undefined, locale: string, now: number = Date.now()): PromptStamp | null {
  const d = toValidDate(at);
  if (!d) return null;
  const ref = new Date(now);
  const loc = safeLocale(locale);
  const key = loc ?? '';

  const time = timeText(key, loc, d);
  const title = fullText(key, loc, d);
  const iso = d.toISOString();
  const days = calendarDayDiff(d, ref);

  if (days === 0) return { text: `${relativeDayWord(key, loc, 0)} ${time}`, title, iso, aged: false };
  if (days === 1) return { text: `${relativeDayWord(key, loc, -1)} ${time}`, title, iso, aged: true };
  // 그 밖(과거의 다른 날 · 시계가 앞선 미래)은 전부 날짜를 적는다.
  return { text: `${dateText(key, loc, d, d.getFullYear() !== ref.getFullYear())} ${time}`, title, iso, aged: true };
}
