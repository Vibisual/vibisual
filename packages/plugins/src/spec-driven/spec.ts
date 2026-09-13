/**
 * §5.11 정독 게이트 — `spec-driven` 의 **판정 전부**(순수 함수).
 *
 * 사용자 지적 — "클로드가 기획 정보를 **끝까지 탐색하지 않고 대충 보고 끝내는** 경우가 있어서 기획대로
 * 개발을 못 하고 있다. 파일은 많은데 그 많은 파일 중에서 정확하게 데이터를 찾아서 하는 게 아니라
 * 대충 본다는 거야."
 *
 * 이 실패는 셋으로 갈린다.
 *  ① **조기 종료** — 몇 개 열어 보고 "다 봤다"로 넘어간다.
 *  ② **중간 유실** — 긴 문서를 통째로 실으면 가운데가 사실상 안 읽힌다.
 *  ③ **확인 불가능한 완료 선언** — "확인했습니다"가 참인지 거짓인지 **잴 방법이 없다.**
 *
 * 프롬프트로 부탁하는 방식은 셋 다 못 고친다(부탁은 ③ 을 만들 뿐이다). 그래서 이 파일은 ③ 을
 * **기계로 갈리는 문제**로 바꾼다 — 기획 문서를 절로 잘라 닫힌 목록을 만들고(색인), 이번 턴에 무엇이
 * 필수인지 지목하고(라우팅), 훅이 남긴 열람 구간과 대조하고(영수증), 에이전트가 낸 인용을 원문과
 * 맞춰 본다(확증). 그 넷이 화면의 신뢰도 네 성분이 된다.
 *
 * **왜 순수 함수인가.** 같은 판정을 프롬프트 조립(서버)·카드 계기판(클라)·게이트(서버)가 각자 계산하면
 * 셋이 갈린다 — 화면은 초록인데 게이트는 막는 상태가 만들어지고, 그러면 사용자는 이 기능을 못 믿는다.
 * 그래서 판정은 여기 하나뿐이고, `spec.test.ts` 가 그것을 고정한다. 파일 접근은 호스트가 넘긴 좁은
 * 탐침(`listFiles`/`readFile`/`fileExists`/`fileMtimeMs`)만 쓴다 — 이 패키지는 `node:fs` 를 모른다.
 *
 * **이 기능의 유일한 실패 방식은 오탐이다.** 안 읽어도 될 절을 필수로 걸어 매 턴 잔소리하면 사용자는
 * 기능을 꺼 버리고, 그 순간 ①②③ 이 전부 돌아온다. 그래서 지목이 없으면 **아무 말도 하지 않고**,
 * 기본 강도는 아무것도 막지 않는 `observe` 다.
 */
import {
  pathKey,
  estimateTokens,
  DEFAULT_SPEC_READING_SETTINGS,
  SPEC_CITATION_ACTUAL_MAX,
  SPEC_CITATION_MAX_CHARS,
  SPEC_CITATION_MIN_CHARS,
  SPEC_COVER_SATISFIED_RATIO,
  SPEC_DOC_EXTENSIONS,
  SPEC_DOC_FILE_MAX,
  SPEC_DOC_LIST_MAX,
  SPEC_DOC_ROOT_CANDIDATES,
  SPEC_DOC_SCAN_MAX_DEPTH,
  SPEC_DOC_SKIP_FILE_PATTERN,
  SPEC_DOC_SKIP_SEGMENTS,
  SPEC_FULL_READ_LINE_MAX,
  SPEC_GATE_STRENGTHS,
  SPEC_GREP_CONTEXT_LINES,
  SPEC_ID_PATTERN_DEFAULT,
  SPEC_INDEX_SKIPPED_LIST_MAX,
  SPEC_INDEX_TTL_MS,
  SPEC_ITEM_LABEL_MAX,
  SPEC_ITEM_PATTERN_DEFAULT,
  SPEC_RARE_TITLE_MIN_UNITS,
  SPEC_RARE_TITLE_DF_RATIO,
  SPEC_RARE_TITLE_HIT_WEIGHT,
  SPEC_REQUIRED_MAX,
  SPEC_REQUIREMENT_MARKERS,
  SPEC_RESPLIT_DEPTH_MAX,
  SPEC_SETTINGS_FILE,
  SPEC_STOP_RETRY_DEFAULT,
  SPEC_STOP_RETRY_LIMIT,
  SPEC_TITLE_HEAD_PARTS,
  SPEC_TITLE_MIN_HITS,
  SPEC_TITLE_STOPWORDS,
  SPEC_UNIT_MAX,
  SPEC_UNIT_TOKEN_MAX,
  normalizeScopeMap,
  resolveSpecReadingEnabled,
} from '../sdk/index.js';
import type {
  PlatformName,
  PluginFactMap,
  PluginPromptContext,
  SpecCitation,
  SpecGateStrength,
  SpecIndex,
  SpecReadSpan,
  SpecReadingSettings,
  SpecRequiredEntry,
  SpecTrust,
  SpecUnit,
} from '../sdk/index.js';

// ────────────────────────────────────────────────────────────────────────────
// 내부 자 — 로직 분기가 아니라 **점수 자릿수**다(§3.3 의 대상인 사용자 설정과 구분해 여기 둔다).
// ────────────────────────────────────────────────────────────────────────────

/**
 * 지목 축의 우열. 사용자가 직접 적은 매핑(`route`)이 가장 정확하고, 이번 턴 프롬프트(`prompt`)가
 * 그다음이며, 건드린 파일 이름(`path`)은 가장 약한 추측이다.
 */
const VIA_WEIGHT: Record<SpecRequiredEntry['via'], number> = { route: 3, prompt: 2, path: 1 };

/** 축 하나가 낱말 몇 개로 뒤집히지 않게 하는 자릿수 — 축이 먼저, 같은 축 안에서 점수로 겨룬다. */
const VIA_STEP = 1000;

/** 절 id 를 그대로 부른 프롬프트는 낱말 겹침과 비교가 안 되는 강한 신호다. */
const ID_HIT_SCORE = 50;

/** 프롬프트가 문서 경로를 통째로 부르면 그 문서의 절 전부가 걸린다. */
const FILE_HIT_SCORE = 20;

/** 토큰으로 세지 않는 최소 길이 — 한 글자는 아무 제목에나 걸린다. */
const TOKEN_MIN_CHARS = 2;

/** 경로 축(건드린 파일 이름)이 쓰는 최소 길이. 짧으면 `ide`·`api` 처럼 온 제목에 걸린다. */
const PATH_TOKEN_MIN_CHARS = 4;

/** 헤딩 슬러그 길이 상한 — id 는 사람이 프롬프트에 되받아 적을 수 있어야 한다. */
const SLUG_MAX_CHARS = 60;

/** 색인 캐시가 드는 프로젝트 수. 넘으면 가장 오래된 것부터 버린다. */
const INDEX_CACHE_MAX = 8;

/** 프롬프트 블록에 신뢰도를 적을 때의 소수 자리. */
const RATIO_DIGITS = 2;

/** 항목 줄 판정 — 상수표의 정규식을 한 번만 컴파일한다(줄 하나에 대고 검사). */
const ITEM_RE = new RegExp(SPEC_ITEM_PATTERN_DEFAULT);

/** 색인에서 빼는 파일 이름 꼴 — 상수표의 정규식을 한 번만 컴파일한다(소문자 basename 에 대고 검사). */
const SKIP_FILE_RE = new RegExp(SPEC_DOC_SKIP_FILE_PATTERN);

/**
 * 프롬프트 낱말 끝에 붙는 한국어 조사 — 「정독이」가 제목의 「정독」에 맞아야 한다.
 * 로직 분기가 아니라 **언어 표**다(사용자 설정으로 바꿀 값이 아니라 여기 둔다). 긴 것부터 견주고,
 * 떼고 남는 쪽이 낱말 최소 길이 이상일 때만 뗀다.
 */
const KO_PARTICLES: readonly string[] = [
  '으로', '에서', '까지', '부터', '이나', '에게', '처럼', '보다',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만',
];

/** 접착제 낱말 조회표 — 상수표의 배열을 한 번만 Set 으로 세운다(낱말마다 선형 탐색을 돌지 않게). */
const STOPWORD_SET = new Set(SPEC_TITLE_STOPWORDS);

/** 재분할한 절의 제목 사슬을 잇는 표식 — `부모 › 항목`. 짓는 쪽과 되읽는 쪽이 같은 값을 써야 한다. */
const TITLE_CHAIN_SEP = ' › ';

/** 낱말 문자 — 제목에서 낱말의 시작·끝을 가르는 부류(제목은 소문자로 접혀 온다). */
const WORD_CHAR = /[0-9a-z가-힣_]/;

/** 프롬프트 목록에 토큰 수를 적는 꼴 — `~1.2k` 처럼 짧게. */
const TOKENS_K_DIGITS = 1;
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(TOKENS_K_DIGITS)}k` : String(n));

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

const round = (n: number): number => {
  const f = 10 ** RATIO_DIGITS;
  return Math.round(n * f) / f;
};

/** 경로의 **모양**만 맞춘다(역슬래시·중복 슬래시·앞의 `./`). 케이스는 절대 건드리지 않는다. */
export function shapePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * 이 호스트의 경로 케이스 정책.
 *
 * 호스트가 알려 주면 그것을 쓰고, 안 알려 주면 `projectPath` 의 모양으로 추정한다(`C:/…` 면 Windows).
 * 추정도 못 하면 **접지 않는 쪽**으로 떨어진다 — 접어서 서로 다른 두 문서를 하나로 뭉개는 것이,
 * 안 접어서 같은 문서를 두 번 세는 것보다 나쁘다(Linux 에서는 실제로 다른 파일이다).
 */
export function specPlatform(ctx: PluginPromptContext): PlatformName {
  if (ctx.platform) return ctx.platform;
  return /^[A-Za-z]:[\\/]/.test(ctx.projectPath) ? 'win32' : 'linux';
}

// ────────────────────────────────────────────────────────────────────────────
// ① 설정 — 팀이 git 으로 공유하는 파일 + 이 사용자가 화면에서 고른 값
// ────────────────────────────────────────────────────────────────────────────

/**
 * 이 프로젝트의 정독 설정.
 *
 * **파일이 바닥이고 사용자 설정이 덮는다.** `.vibisual/spec.json` 은 저장소와 함께 옮겨 다니는 팀의
 * 약속이라 기본으로 이겨야 하고, 사용자가 화면에서 강도를 직접 고르면(체크포인트에 값이 생기면)
 * 그 사람의 기기에서는 그 선택이 이긴다 — 안 그러면 "껐는데 계속 막는다"가 된다.
 * 체크포인트에 값이 없으면 호스트가 아예 안 넘기므로 팀 설정이 그대로 산다.
 */
export function readSpecSettings(ctx: PluginPromptContext): SpecReadingSettings {
  const base: SpecReadingSettings = { ...DEFAULT_SPEC_READING_SETTINGS };
  return normalizeSpecSettings({ ...base, ...readSettingsFile(ctx), ...(ctx.specSettings ?? {}) });
}

function readSettingsFile(ctx: PluginPromptContext): Partial<SpecReadingSettings> {
  let raw: string | null = null;
  try {
    raw = ctx.readFile(SPEC_SETTINGS_FILE);
  } catch {
    raw = null;
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<SpecReadingSettings>) : {};
  } catch {
    return {}; // 깨진 설정 파일 하나 때문에 집행이 통째로 빠지면 안 된다.
  }
}

/** 바깥에서 온 값을 계약 안으로 접는다 — 손으로 적은 JSON 과 옛 체크포인트가 그대로 들어오는 자리다. */
export function normalizeSpecSettings(input: Partial<SpecReadingSettings>): SpecReadingSettings {
  const strength: SpecGateStrength = SPEC_GATE_STRENGTHS.includes(input.strength as SpecGateStrength)
    ? (input.strength as SpecGateStrength)
    : DEFAULT_SPEC_READING_SETTINGS.strength;
  const out: SpecReadingSettings = {
    strength,
    maxRequired: clamp(Math.trunc(Number(input.maxRequired ?? SPEC_REQUIRED_MAX)) || SPEC_REQUIRED_MAX, 1, SPEC_REQUIRED_MAX),
    stopRetries: clamp(Math.trunc(Number(input.stopRetries ?? SPEC_STOP_RETRY_DEFAULT)) || 0, 0, SPEC_STOP_RETRY_LIMIT),
  };
  const roots = strings(input.roots).map(shapePath).filter((r) => r !== '');
  if (roots.length > 0) out.roots = roots;
  if (typeof input.idPattern === 'string' && compilePattern(input.idPattern)) out.idPattern = input.idPattern;
  const routes = Array.isArray(input.routes)
    ? input.routes
        .filter((r): r is { glob: string; specs: string[] } => !!r && typeof r.glob === 'string')
        .map((r) => ({ glob: shapePath(r.glob), specs: strings(r.specs) }))
        .filter((r) => r.glob !== '' && r.specs.length > 0)
    : [];
  if (routes.length > 0) out.routes = routes;
  const waived = strings(input.waived);
  if (waived.length > 0) out.waived = waived;
  // §5.5 #17-44 ⑧ — 켬/끔 3층. **여기서 떨어뜨리면 전량 교체 PUT 한 번에 켜 둔 것이 통째로 꺼진다**
  //   (강도만 바꾸는 화면이 이 함수를 거쳐 저장하기 때문이다).
  if (typeof input.enabledProject === 'boolean') out.enabledProject = input.enabledProject;
  const agents = normalizeScopeMap(input.enabledAgents);
  if (agents) out.enabledAgents = agents;
  const sessions = normalizeScopeMap(input.enabledSessions);
  if (sessions) out.enabledSessions = sessions;
  if (typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)) out.updatedAt = input.updatedAt;
  return out;
}

/**
 * §5.5 #17-44 ⑧ — 이 세션에서 정독이 켜져 있는가.
 *
 * 판정은 shared 순수 함수 하나(`resolveSpecReadingEnabled`)가 소유하고, 여기서는 설정을 읽어 그 함수에
 * 넘기기만 한다. 이 카드가 자기 판정을 따로 들면 화면·게이트·프롬프트가 갈린다(v4.65 규율).
 *
 * **기본은 꺼짐이다** — 어느 층도 정하지 않은 프로젝트에서는 이 카드가 아무것도 하지 않는다.
 */
export function specReadingEnabledFor(ctx: PluginPromptContext): boolean {
  return resolveSpecReadingEnabled(readSpecSettings(ctx), {
    agentId: ctx.agentId,
    subAgentId: ctx.subAgentId ?? null,
  });
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];

/** 사용자 정규식은 **컴파일되는 것만** 받는다. 안 되면 기본 토큰으로 조용히 떨어진다. */
function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, 'g');
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ② 색인 — "다 봐야 할 목록"의 닫힌 집합
// ────────────────────────────────────────────────────────────────────────────

/**
 * 마크다운 한 장을 **겹치지 않는 절**로 자른다.
 *
 * 헤딩 하나가 절 하나를 열고 다음 헤딩 직전에서 닫는다(깊이를 따지지 않는다). 부모 절이 자식 절을
 * 품게 하면 같은 줄이 두 번 세어져 커버율이 1을 넘고, 그러면 화면의 숫자가 곧 거짓이 된다.
 *
 * 코드 울타리(``` / ~~~) 안의 `#` 은 헤딩이 아니다 — 예제 코드 한 줄이 절을 통째로 갈라 놓는다.
 * 헤딩이 하나도 없는 문서는 파일 전체가 절 하나다(자를 자리가 없다고 안 세면 그 문서는 영영 안 걸린다).
 */
export function splitUnits(file: string, text: string, idPattern?: string): SpecUnit[] {
  const rel = shapePath(file);
  const lines = text.split(/\r?\n/);
  const idRe = compilePattern(idPattern ?? SPEC_ID_PATTERN_DEFAULT) ?? compilePattern(SPEC_ID_PATTERN_DEFAULT);

  let from = 0;
  if (lines[0]?.trim() === '---') {
    let j = 1;
    while (j < lines.length && lines[j]?.trim() !== '---') j++;
    if (j < lines.length) from = j + 1; // frontmatter 는 본문이 아니다
  }

  const heads: { line: number; title: string }[] = [];
  let fence: string | null = null;
  for (let n = from; n < lines.length; n++) {
    const t = (lines[n] ?? '').replace(/^ {0,3}/, '');
    const f = /^(```|~~~)/.exec(t);
    if (f) {
      const mark = f[1] as string;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
    if (h) heads.push({ line: n + 1, title: (h[2] ?? '').trim() });
  }

  const units: SpecUnit[] = [];
  if (heads.length === 0) {
    const body = lines.slice(from).join('\n');
    if (body.trim() !== '') {
      units.push(...resplitUnit(makeUnit(rel, rel.split('/').pop() ?? rel, from + 1, lines.length, body, idRe), lines, idRe));
    }
    return dedupeIds(units);
  }

  for (let k = 0; k < heads.length; k++) {
    const head = heads[k];
    if (!head) continue;
    const end = k + 1 < heads.length ? (heads[k + 1]?.line ?? lines.length) - 1 : lines.length;
    const body = lines.slice(head.line, end).join('\n');
    const unit = makeUnit(rel, head.title, head.line, Math.max(head.line, end), body, idRe);
    // 다음 헤딩이 바로 붙은 순수 구조 헤딩은 읽을 것이 없다 — 필수로 걸면 그 자체가 오탐이다.
    if (unit.chars === 0 && unit.requirementCount === 0) continue;
    units.push(...resplitUnit(unit, lines, idRe));
  }
  return dedupeIds(units);
}

function makeUnit(
  rel: string,
  title: string,
  startLine: number,
  endLine: number,
  body: string,
  idRe: RegExp | null,
  fallbackId?: string,
  // 자르지 않은 제목 — 표시용 `title` 이 항목 표지를 잘라도 찾기는 온전해야 한다(`SpecUnit.matchText`).
  matchText?: string,
): SpecUnit {
  // id 는 **제목과 첫 줄**에서만 찾는다. 본문 전체에서 찾으면 다른 절을 언급한 `REQ-…` 한 마디가 이 절의
  //   id 를 가로채고, 그러면 열람 판정·인용이 엉뚱한 절에 붙는다(실측: 긴 절일수록 남의 id 로 서 있었다).
  const firstLine = body.split('\n').find((l) => l.trim() !== '') ?? '';
  const found = idRe ? firstMatch(idRe, `${title}\n${firstLine}`) : null;
  const full = `${title}\n${body}`;
  return {
    id: found ?? fallbackId ?? `${rel}#${slugify(title)}`,
    title: title === '' ? rel : title,
    // 자른 제목과 같으면 싣지 않는다 — 색인 절 수천 개에 같은 문자열을 두 벌 들 이유가 없다.
    ...(matchText && matchText !== title ? { matchText } : {}),
    file: rel,
    startLine,
    endLine,
    chars: body.trim().length,
    requirementCount: countRequirements(full),
    tokens: estimateTokens(full),
  };
}

/**
 * 상한(`SPEC_UNIT_TOKEN_MAX`)을 넘는 절을 **다시 자른다** — 헤딩이 성긴 문서의 한 절이 27만 토큰을 품는
 * 것이 실측이고, 그 절에 "줄 범위 전체를 열어라"를 시키는 것이 컨텍스트를 삼키던 자리다.
 *
 * 순서는 셋이다. ① **항목 줄**(`17-44.`·`①`·`(a)` — 척추 §5 목차의 찾기 정규식과 같은 꼴)에서, 들여쓰기가
 * 가장 얕은 것부터 자르고 넘는 조각은 한 단계 아래 항목으로 내려간다. ② 항목이 없으면 **문단**(빈 줄)을
 * 상한 안으로 묶는다. ③ 문단 하나가 상한을 넘으면 `oversized` 로 표시한다 — 그 절은 통째 Read 대신 Grep 으로
 * 좁혀 열라고 시킨다. 잘린 조각의 제목은 `부모 › 항목 표지`, id 는 `부모id/항목슬러그` 라 원문에서 되짚을 수 있다.
 */
function resplitUnit(
  unit: SpecUnit,
  lines: string[],
  idRe: RegExp | null,
  depth = 0,
  // 항목을 찾기 시작할 줄 — 절의 **자기 표지 줄**(헤딩·부모 항목 줄) 다음이다. 머리 조각을 첫 항목에 붙이면
  //   표지 줄이 조각 첫 줄이 아니게 되는데, 그 줄을 다시 항목으로 잡으면 같은 자리에서 영영 다시 잘린다.
  scanFrom = unit.startLine + 1,
): SpecUnit[] {
  if ((unit.tokens ?? 0) <= SPEC_UNIT_TOKEN_MAX) return [unit];
  const items = itemLinesIn(lines, scanFrom, unit.endLine);
  if (items.length > 0 && depth < SPEC_RESPLIT_DEPTH_MAX) {
    const minIndent = items.reduce((m, i) => Math.min(m, i.indent), Number.POSITIVE_INFINITY);
    const cuts = items.filter((i) => i.indent === minIndent);
    const segments: { from: number; to: number; label: string | null; own: number }[] = [];
    let from = unit.startLine;
    let label: string | null = null;
    let own = unit.startLine;
    for (const cut of cuts) {
      segments.push({ from, to: cut.line - 1, label, own });
      from = cut.line;
      label = cut.label;
      own = cut.line;
    }
    segments.push({ from, to: unit.endLine, label, own });
    // 여는 줄(헤딩·부모 항목 줄) 말고는 읽을 것이 없는 머리 조각은 첫 항목에 붙인다 — 따로 세우면 헤딩 한 줄짜리
    //   절이 오탐으로 걸리고, 버리면 그 줄이 어느 절에도 안 속해 커버율 분모가 샌다.
    const intro = segments[0];
    const firstCut = segments[1];
    if (intro && firstCut && intro.label === null && lines.slice(intro.from, intro.to).join('').trim() === '') {
      firstCut.from = intro.from;
      segments.shift();
    }
    const kept = segments.filter((s) => {
      if (s.to < s.from) return false;
      // 머리 조각(항목 앞 부분)은 여는 줄(헤딩) 아래에 읽을 것이 있을 때만 — 헤딩 한 줄짜리 절은 오탐이다.
      const bodyLines = s.label === null ? lines.slice(s.from, s.to) : lines.slice(s.from - 1, s.to);
      return bodyLines.join('').trim() !== '';
    });
    if (kept.length > 1) {
      const out: SpecUnit[] = [];
      for (const s of kept) {
        const body = lines.slice(s.from - 1, s.to).join('\n');
        // 표시는 자른 표지(`clipLabel`), 찾기는 자르지 않은 표지 — 부모의 자르지 않은 제목에 이어 붙인다.
        const parentMatch = unit.matchText ?? unit.title;
        const shown = s.label === null ? null : clipLabel(s.label);
        const sub = s.label === null || shown === null
          ? makeUnit(unit.file, unit.title, s.from, s.to, body, idRe, unit.id, parentMatch)
          : makeUnit(
            unit.file,
            `${unit.title}${TITLE_CHAIN_SEP}${shown}`,
            s.from,
            s.to,
            body,
            idRe,
            `${unit.id}/${slugify(shown)}`,
            `${parentMatch}${TITLE_CHAIN_SEP}${s.label}`,
          );
        out.push(...resplitUnit(sub, lines, idRe, depth + 1, s.own + 1));
      }
      return out;
    }
  }
  return packParagraphs(unit, lines);
}

/** 절 안의 항목 줄들(코드 울타리 안은 제외) — 줄 번호·들여쓰기·표지. */
function itemLinesIn(lines: string[], fromLine: number, toLine: number): { line: number; indent: number; label: string }[] {
  const out: { line: number; indent: number; label: string }[] = [];
  let fence: string | null = null;
  for (let n = fromLine; n <= toLine; n++) {
    const raw = lines[n - 1] ?? '';
    const f = /^ {0,3}(```|~~~)/.exec(raw);
    if (f) {
      const mark = f[1] as string;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null || !ITEM_RE.test(raw)) continue;
    out.push({ line: n, indent: raw.length - raw.trimStart().length, label: itemLabel(raw) });
  }
  return out;
}

/**
 * 항목 줄에서 제목에 붙일 표지 — 목록·굵게·코드 표식을 걷은 **전문**(자르지 않는다).
 *
 * 자르는 일은 `clipLabel` 이 따로 한다. 여기서 잘라 버리면 잘린 꼬리가 색인 어디에도 안 남아
 * 라우팅이 그 낱말을 영영 못 본다(§5.11 실측 — `활동바 정독` → `활동바 정`).
 */
function itemLabel(raw: string): string {
  const label = raw
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return label === '' ? 'item' : label;
}

/**
 * 표시용 표지 — `SPEC_ITEM_LABEL_MAX` 안으로 **낱말 경계에서** 자른다.
 *
 * 글자 수로 뚝 자르면 `정독` 이 `정` 이 되어 사람도 못 알아본다. 상한 안에 낱말 경계가 없을 때만
 * 어쩔 수 없이 글자 수로 자른다(한 낱말이 상한보다 긴 경우).
 */
function clipLabel(label: string): string {
  if (label.length <= SPEC_ITEM_LABEL_MAX) return label;
  const head = label.slice(0, SPEC_ITEM_LABEL_MAX);
  const at = head.lastIndexOf(' ');
  return (at > 0 ? head.slice(0, at) : head).trim();
}

/** 마크다운 헤딩 줄인가 — `splitUnits` 가 절을 여는 판정과 같은 꼴(들여쓰기 3칸까지). */
function isHeadingLine(raw: string): boolean {
  return /^ {0,3}#{1,6}\s+\S/.test(raw);
}

/**
 * 항목이 없는 긴 절을 **문단**으로 묶는다. 문단 하나가 상한을 넘으면 그 조각은 `oversized` 다 —
 * 억지로 문장 가운데를 자르면 인용·열람 구간이 문장과 어긋나므로 자르지 않고 표시만 한다.
 */
function packParagraphs(unit: SpecUnit, lines: string[]): SpecUnit[] {
  // 여는 줄이 헤딩이면 문단이 아니다 — 문단으로 세면 "헤딩 한 줄짜리 (1/n)" 조각이 생기고, 문단이 하나뿐인 절도
  //   둘로 갈려 oversized 표시를 놓친다. 헤딩은 첫 조각에 붙여 줄이 어느 절에도 안 속하는 일이 없게 한다.
  const headLine = isHeadingLine(lines[unit.startLine - 1] ?? '') ? unit.startLine : null;
  const paras: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  let fence: string | null = null;
  for (let n = headLine === null ? unit.startLine : unit.startLine + 1; n <= unit.endLine; n++) {
    const raw = lines[n - 1] ?? '';
    const f = /^ {0,3}(```|~~~)/.exec(raw);
    if (f) {
      const mark = f[1] as string;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
    }
    if (fence === null && raw.trim() === '') {
      cur = null;
      continue;
    }
    if (cur) cur.to = n;
    else {
      cur = { from: n, to: n };
      paras.push(cur);
    }
  }
  if (paras.length <= 1) return [{ ...unit, oversized: true }];
  const chunks: { from: number; to: number; tokens: number }[] = [];
  for (const p of paras) {
    const tokens = estimateTokens(lines.slice(p.from - 1, p.to).join('\n'));
    const last = chunks[chunks.length - 1];
    if (last && last.tokens + tokens <= SPEC_UNIT_TOKEN_MAX) {
      last.to = p.to;
      last.tokens += tokens;
    } else if (chunks.length === 0 && headLine !== null) {
      // 첫 조각은 헤딩 줄부터 — 헤딩의 토큰도 함께 센다.
      chunks.push({ from: headLine, to: p.to, tokens: tokens + estimateTokens(lines[headLine - 1] ?? '') });
    } else chunks.push({ from: p.from, to: p.to, tokens });
  }
  if (chunks.length <= 1) return [{ ...unit, oversized: true }];
  return chunks.map((c, i) => {
    const body = lines.slice(c.from - 1, c.to).join('\n');
    // 문단 조각에서는 id 토큰을 찾지 않는다 — 조각 안의 `REQ-…` 언급이 조각의 id 가 되면 같은 절이 여러 id 로 갈린다.
    const sub = makeUnit(
      unit.file,
      `${unit.title} (${i + 1}/${chunks.length})`,
      c.from,
      c.to,
      body,
      null,
      `${unit.id}/p${i + 1}`,
      `${unit.matchText ?? unit.title} (${i + 1}/${chunks.length})`,
    );
    return (sub.tokens ?? 0) > SPEC_UNIT_TOKEN_MAX ? { ...sub, oversized: true } : sub;
  });
}

function firstMatch(re: RegExp, text: string): string | null {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m ? m[0] : null;
}

/** 제목을 id 뒷부분으로 쓸 수 있게 접는다. **경로가 아니라 제목**이라 소문자로 접어도 안전하다. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS);
  return s === '' ? 'section' : s;
}

/** 절의 무게 — 요구사항 문장이 많은 절이 먼저 걸린다. 세는 대상은 상수표 하나에서만 온다. */
export function countRequirements(text: string): number {
  let n = 0;
  for (const marker of SPEC_REQUIREMENT_MARKERS) n += text.split(marker).length - 1;
  return n;
}

/**
 * 같은 id 가 두 번 나오면 뒤엣것에 꼬리를 붙인다.
 *
 * `REQ-14` 가 두 문서에서 언급되는 일은 흔하다. id 가 겹치면 열람 판정이 엉뚱한 절로 붙으므로
 * 반드시 갈라야 하고, 갈라진 사실이 id 에 그대로 보여야 사용자가 원문에서 되짚을 수 있다.
 */
function dedupeIds(units: SpecUnit[]): SpecUnit[] {
  const seen = new Map<string, number>();
  return units.map((u) => {
    const n = (seen.get(u.id) ?? 0) + 1;
    seen.set(u.id, n);
    return n === 1 ? u : { ...u, id: `${u.id}~${n}` };
  });
}

/**
 * 이 프로젝트의 기획 절 전집.
 *
 * 뿌리는 설정이 있으면 그것, 없으면 후보 표를 **권위 순서대로** 훑는다. 후보를 손으로 나열하는 방식이
 * `docs/기획/전투.md` 같은 이름 앞에서 헛도는 것은 `ssot-drift` 가 v4.67 에 이미 겪었으므로, 여기서는
 * 파일 이름이 아니라 **폴더**를 훑고(`listFiles`) 그 안의 마크다운을 전부 절로 자른다.
 *
 * `listFiles` 를 안 넘기는 호스트에서는 색인이 비고, 그러면 이 카드는 규칙만 싣는다(그 축만 접힌다).
 */
export function buildSpecIndex(ctx: PluginPromptContext, settings: SpecReadingSettings, now = Date.now()): SpecIndex {
  const platform = specPlatform(ctx);
  const roots = settings.roots?.length ? settings.roots : SPEC_DOC_ROOT_CANDIDATES;
  const list = ctx.listFiles;

  // 후보를 **상한보다 넉넉히** 모은 뒤 고른다 — 상한까지만 모으면 "무엇을 떨어뜨렸는지"를 말할 수 없고,
  //   이름순으로 앞에 선 백업 사본이 원본을 밀어낸다(실측: 문서 349개 중 229개 탈락).
  const candidates: { rel: string; root: string; mtime: number | null }[] = [];
  const seen = new Set<string>();
  let excludedCount = 0;
  if (list) {
    for (const root of roots) {
      let found: string[] = [];
      try {
        found = list(root, {
          maxDepth: SPEC_DOC_SCAN_MAX_DEPTH,
          extensions: SPEC_DOC_EXTENSIONS,
          limit: SPEC_DOC_LIST_MAX,
        });
      } catch {
        found = []; // 뿌리 하나가 없거나 못 읽어도 나머지 뿌리는 그대로 훑는다.
      }
      for (const f of found) {
        const rel = shapePath(f);
        const key = pathKey(rel, platform);
        if (seen.has(key)) continue; // `docs` 와 `docs/scenario` 가 겹쳐도 한 번만 센다
        seen.add(key);
        if (isExcludedDoc(rel)) {
          excludedCount++;
          continue;
        }
        candidates.push({ rel, root, mtime: safeMtime(ctx, rel) });
      }
    }
  }
  // 최근 수정 순 — 상한에 걸릴 때 떨어지는 것은 **오래된** 문서다. 시각을 모르는 것은 뒤로, 같으면 이름순(안정).
  candidates.sort((a, b) => (b.mtime ?? -1) - (a.mtime ?? -1) || a.rel.localeCompare(b.rel));
  const picked = candidates.slice(0, SPEC_DOC_FILE_MAX);
  const skipped = candidates.slice(SPEC_DOC_FILE_MAX).map((c) => c.rel);

  const units: SpecUnit[] = [];
  let truncated = skipped.length > 0;
  let docCount = 0;
  for (let i = 0; i < picked.length; i++) {
    const cand = picked[i];
    if (!cand) continue;
    const f = cand.rel;
    if (units.length >= SPEC_UNIT_MAX) {
      // 절 상한에 닿으면 남은 문서는 통째로 못 실은 것이다 — 목록에 적어야 화면이 그렇게 말한다.
      truncated = true;
      skipped.push(...picked.slice(i).map((c) => c.rel));
      break;
    }
    let text: string | null = null;
    try {
      text = ctx.readFile(f);
    } catch {
      text = null;
    }
    if (!text || text.trim() === '') continue;
    docCount++;
    const mtime = cand.mtime;
    for (const u of splitUnits(f, text, settings.idPattern)) {
      if (units.length >= SPEC_UNIT_MAX) {
        truncated = true;
        break;
      }
      units.push(mtime === null ? u : { ...u, mtimeMs: mtime });
    }
  }

  const usedRoots = roots.filter((r) => picked.some((c) => c.root === r));
  return {
    units: dedupeIds(units),
    docCount,
    truncated,
    roots: usedRoots,
    builtAt: now,
    skippedDocs: skipped.slice(0, SPEC_INDEX_SKIPPED_LIST_MAX),
    skippedCount: skipped.length,
    excludedCount,
  };
}

/**
 * 백업·아카이브·임시 폴더 안의 문서, `.bak/_old/-copy` 꼴의 파일은 색인하지 않는다.
 *
 * 소문자로 접는 것은 **키 비교가 아니라 이름 판정**이라 어느 OS 에서든 안전하다 — `Backup/` 과 `backup/` 은
 * 둘 다 백업 폴더다. 경로 키로는 여전히 `pathKey` 만 쓴다.
 */
function isExcludedDoc(rel: string): boolean {
  const parts = rel.toLowerCase().split('/');
  const base = parts.pop() ?? '';
  return parts.some((p) => SPEC_DOC_SKIP_SEGMENTS.includes(p)) || SKIP_FILE_RE.test(base);
}

function safeMtime(ctx: PluginPromptContext, rel: string): number | null {
  try {
    return ctx.fileMtimeMs?.(rel) ?? null;
  } catch {
    return null;
  }
}

/**
 * 색인 캐시 — 같은 턴에 `buildBlock` 과 `survey` 가 각각 부르므로 그대로 두면 문서를 두 번 읽는다.
 *
 * mtime 만으로는 안 된다(실시간으로 덧붙는 문서에서는 매 턴 빗나가 동기 읽기가 반복된다 — §5.11 v4.65).
 * 그래서 짧은 수명을 함께 쓴다. 서버는 메인 프로세스와 한 몸이라, 이 한 번의 동기 읽기가 곧 UI 정지다.
 */
const indexCache = new Map<string, { at: number; index: SpecIndex }>();

function cacheKey(ctx: PluginPromptContext, settings: SpecReadingSettings): string {
  const platform = specPlatform(ctx);
  return [
    pathKey(ctx.projectPath, platform),
    (settings.roots ?? []).join(','),
    settings.idPattern ?? '',
  ].join('|');
}

export function buildSpecIndexCached(ctx: PluginPromptContext, settings: SpecReadingSettings, now = Date.now()): SpecIndex {
  const key = cacheKey(ctx, settings);
  const hit = indexCache.get(key);
  if (hit && now - hit.at < SPEC_INDEX_TTL_MS) return hit.index;
  const index = buildSpecIndex(ctx, settings, now);
  indexCache.set(key, { at: now, index });
  while (indexCache.size > INDEX_CACHE_MAX) {
    const oldest = indexCache.keys().next().value;
    if (oldest === undefined) break;
    indexCache.delete(oldest);
  }
  return index;
}

/** 테스트와 설정 변경 직후에 쓴다 — 캐시가 옛 뿌리를 들고 있으면 사용자가 고친 것이 안 보인다. */
export function clearSpecIndexCache(): void {
  indexCache.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// ③ 라우팅 — 이번 턴에 **무엇이 필수인가**
// ────────────────────────────────────────────────────────────────────────────

/** 낱말로 자른다. `REQ-14`·`docs/전투.md` 처럼 붙어 있어야 뜻이 되는 것은 붙여 둔다. */
export function tokenize(text: string): string[] {
  return text
    .split(/[^0-9A-Za-z가-힣_/.\-]+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ''))
    .filter((t) => t.length >= TOKEN_MIN_CHARS);
}

/**
 * `packages/**\/*.tsx` 꼴 매칭. `**` 는 폴더 경계를 넘고 `*`·`?` 는 넘지 않는다.
 *
 * 라이브러리를 물지 않는 이유는 자립 규약이다 — 이 폴더는 다른 앱에 복붙돼도 그대로 컴파일돼야 한다.
 */
export function matchGlob(glob: string, relPath: string, platform: PlatformName): boolean {
  const g = pathKey(shapePath(glob), platform);
  const p = pathKey(shapePath(relPath), platform);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // `a/**/b` 는 `a/b` 도 맞는다
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  try {
    return new RegExp(`^${re}$`).test(p);
  } catch {
    return false;
  }
}

interface Hit {
  unit: SpecUnit;
  via: SpecRequiredEntry['via'];
  score: number;
}

/**
 * 이번 턴 필수 절 — 세 축에서 후보를 모아 **점수 순으로 상한까지** 자른다.
 *
 * 전집을 다 읽으라는 요구는 실패한다(서두가 이미 2만 토큰이다). 그래서 필수는 항상 짧은 목록이고,
 * 짧기 때문에 "끝까지 읽어라"가 지킬 수 있는 요구가 된다.
 *
 * **아무 축에도 안 걸리면 빈 목록을 낸다.** 그때 억지로 무거운 절을 고르면 그것이 곧 오탐이고,
 * 오탐이 이 기능의 유일한 실패 방식이다.
 */
export function routeRequiredUnits(
  index: SpecIndex,
  ctx: PluginPromptContext,
  settings: SpecReadingSettings,
): SpecRequiredEntry[] {
  const platform = specPlatform(ctx);
  const best = new Map<string, Hit>();
  const offer = (unit: SpecUnit, via: SpecRequiredEntry['via'], score: number): void => {
    if (score <= 0) return;
    const ranked = VIA_WEIGHT[via] * VIA_STEP + score;
    const cur = best.get(unit.id);
    if (!cur || ranked > cur.score) best.set(unit.id, { unit, via, score: ranked });
  };

  // (1) 명시 매핑 — 사용자가 적은 것이 가장 정확하다.
  const touched = (ctx.touchedPaths ?? []).map(shapePath);
  for (const route of settings.routes ?? []) {
    if (!touched.some((p) => matchGlob(route.glob, p, platform))) continue;
    for (const spec of route.specs) {
      const wanted = shapePath(spec);
      for (const unit of index.units) {
        if (unit.id === spec || pathKey(unit.file, platform) === pathKey(wanted, platform)) offer(unit, 'route', ID_HIT_SCORE);
      }
    }
  }

  // 낱말의 무게 — **몇 절 제목에 나오는가(df)** 로 정한다. 온 색인의 몇 절에만 있는 낱말은 그 자체로
  //   "이 절을 말한 것"이고, 어디에나 있는 낱말은 혼자선 아무것도 못 가린다. 한 번 센 값은 들고 있는다
  //   (낱말 열 개 × 절 수천 개를 축마다 다시 세면 매 턴 그만큼 늦어진다).
  // 절이 적은 색인에서는 희귀도를 아예 안 센다(0) — 모집단이 없으면 모든 낱말이 "드문 낱말"이 되어
  //   문턱이 통째로 사라진다. 그때는 낱말 둘을 요구하는 종전 문턱이 옳다.
  const rareMax = index.units.length >= SPEC_RARE_TITLE_MIN_UNITS
    ? Math.floor(index.units.length * SPEC_RARE_TITLE_DF_RATIO)
    : 0;
  const weightCache = new Map<string, number>();
  const weightOf = (token: string): number => {
    const cached = weightCache.get(token);
    if (cached !== undefined) return cached;
    let weight = 1;
    if (isStopword(token)) weight = 0;
    else {
      let df = 0;
      for (const unit of index.units) if (titleHas(matchTextOf(unit), token, false)) df++;
      if (df > 0 && df <= rareMax) weight = SPEC_RARE_TITLE_HIT_WEIGHT;
    }
    weightCache.set(token, weight);
    return weight;
  };

  // (2) 이번 턴 프롬프트 — 무슨 일을 하려는지는 파일에 없다.
  const promptTokens = new Set(tokenize(ctx.promptText ?? '').map((t) => t.toLowerCase()));
  if (promptTokens.size > 0) {
    for (const unit of index.units) offer(unit, 'prompt', scoreUnit(unit, promptTokens, platform, 'prompt', weightOf));
  }

  // (3) 건드린 파일 이름 — 가장 약한 추측이라 긴 이름만 본다.
  const pathTokens = new Set<string>();
  for (const p of touched) {
    const stem = (p.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase();
    if (stem.length >= PATH_TOKEN_MIN_CHARS) pathTokens.add(stem);
  }
  if (pathTokens.size > 0) {
    for (const unit of index.units) offer(unit, 'path', scoreUnit(unit, pathTokens, platform, 'path', weightOf));
  }

  const max = clamp(settings.maxRequired ?? SPEC_REQUIRED_MAX, 1, SPEC_REQUIRED_MAX);
  const waived = new Set(settings.waived ?? []);
  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.unit.requirementCount - a.unit.requirementCount ||
        a.unit.file.localeCompare(b.unit.file) ||
        a.unit.startLine - b.unit.startLine,
    )
    .slice(0, max)
    .map(({ unit, via }) => ({
      unitId: unit.id,
      title: unit.title,
      file: unit.file,
      startLine: unit.startLine,
      endLine: unit.endLine,
      status: waived.has(unit.id) ? 'waived' : 'open',
      covered: 0,
      partial: false,
      via,
      ...(typeof unit.tokens === 'number' ? { tokens: unit.tokens } : {}),
      ...(unit.oversized ? { oversized: true } : {}),
    }));
}

/** 라우팅이 낱말을 견주는 글 — 자르지 않은 제목이 있으면 그것, 없으면 표시 제목(소문자). */
function matchTextOf(unit: SpecUnit): string {
  return (unit.matchText ?? unit.title).toLowerCase();
}

/**
 * 제목 사슬의 **머리** — `문서 › 절` 까지. 이 절이 **무엇에 대한 절인가**를 말하는 칸이다.
 *
 * 말단 항목 표지는 그 절 **안의 세부**라, 거기 스친 낱말은 절의 주제가 아니다. 드문 낱말이 혼자
 * 절을 세울 수 있는가는 이 구분으로 가른다(`SPEC_TITLE_HEAD_PARTS`).
 */
function headTextOf(unit: SpecUnit): string {
  const full = matchTextOf(unit);
  const parts = full.split(TITLE_CHAIN_SEP);
  return parts.length <= SPEC_TITLE_HEAD_PARTS ? full : parts.slice(0, SPEC_TITLE_HEAD_PARTS).join(TITLE_CHAIN_SEP);
}

/** 산문 접착제인가 — 조사를 뗀 꼴도 함께 본다(`기능을` → `기능`). */
function isStopword(token: string): boolean {
  if (STOPWORD_SET.has(token)) return true;
  for (const p of KO_PARTICLES) {
    if (token.endsWith(p) && token.length - p.length >= TOKEN_MIN_CHARS && STOPWORD_SET.has(token.slice(0, -p.length))) return true;
  }
  return false;
}

/**
 * 절 하나가 이 낱말들과 얼마나 맞물리는가. id 를 그대로 부르거나 문서를 통째로 부르면 크게 이긴다.
 *
 * 제목 겹침은 **문턱**이 있다 — 프롬프트 축은 겹침 무게가 `SPEC_TITLE_MIN_HITS` 이상이어야 하고
 * (부분 문자열 ❌ · 조사 붙은 낱말은 떼고 봄), 경로 축은 파일 이름 하나가 **통낱말**로 서야 한다.
 * 낱말 하나로 걸리게 두면 `정독`·`문서` 같은 낱말에 온 제목이 걸려 매 턴 무관한 절이 선다(실측 8개).
 *
 * 무게는 `weightOf` 가 낸다 — 접착제 0 · 드문 낱말 `SPEC_RARE_TITLE_HIT_WEIGHT` · 나머지 1.
 * **개수**만 세면 `지금`+`기능` 둘로 문턱이 뚫리고, 정작 기능 이름을 콕 집은 한 낱말이 떨어진다(실측).
 *
 * 견주는 글은 `title` 이 아니라 `matchTextOf` 다 — 표시 제목은 표지를 잘라 꼬리 낱말이 없다.
 */
function scoreUnit(
  unit: SpecUnit,
  tokens: Set<string>,
  platform: PlatformName,
  axis: 'prompt' | 'path',
  weightOf: (token: string) => number,
): number {
  const idLower = unit.id.toLowerCase();
  const localId = idLower.includes('#') ? idLower.slice(idLower.indexOf('#') + 1) : idLower;
  const title = matchTextOf(unit);
  const whole = axis === 'path';
  const fileKey = pathKey(unit.file, platform);
  let score = 0;
  let titleHits = 0;
  for (const t of tokens) {
    if (t === idLower || t === localId) score += ID_HIT_SCORE;
    else if (t.includes('/') || /\.(md|markdown|mdx)$/.test(t)) {
      if (fileKey === pathKey(t, platform) || fileKey.endsWith(`/${pathKey(t, platform)}`)) score += FILE_HIT_SCORE;
    } else if (titleHas(title, t, whole)) {
      // 드문 낱말의 가중은 **절 제목에 섰을 때만** 준다. 말단 표지에 스친 것은 그 절의 주제가 아니다
      //   — 그것까지 혼자 서게 두면 「안녕 오늘 뭐 할까」가 `오늘`(df 4) 하나로 절 넷을 세운다(실측).
      const weight = weightOf(t);
      const boosted = weight === SPEC_RARE_TITLE_HIT_WEIGHT && !titleHas(headTextOf(unit), t, whole);
      titleHits += boosted ? 1 : weight;
    }
  }
  const minHits = axis === 'path' ? 1 : SPEC_TITLE_MIN_HITS;
  if (titleHits >= minHits) score += titleHits;
  return score;
}

/**
 * 제목에 이 낱말이 **낱말 시작**에서 서는가(`whole` 이면 끝도 낱말 경계여야 한다).
 *
 * `정독 게이트` 에 `정독` 은 서지만 `기획정독` 에는 서지 않는다. 프롬프트 낱말 `정독이` 는 조사를 떼고
 * 다시 본다 — 그래야 한국어 문장에서 나온 낱말이 제목의 같은 낱말에 붙는다.
 */
function titleHas(title: string, token: string, whole: boolean): boolean {
  const at = (t: string): boolean => {
    if (t.length < TOKEN_MIN_CHARS) return false;
    let i = title.indexOf(t);
    while (i >= 0) {
      const startOk = i === 0 || !WORD_CHAR.test(title[i - 1] ?? '');
      const endOk = !whole || i + t.length >= title.length || !WORD_CHAR.test(title[i + t.length] ?? '');
      if (startOk && endOk) return true;
      i = title.indexOf(t, i + 1);
    }
    return false;
  };
  if (at(token)) return true;
  if (whole) return false;
  for (const p of KO_PARTICLES) {
    if (token.endsWith(p) && token.length - p.length >= TOKEN_MIN_CHARS && at(token.slice(0, -p.length))) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// ④ 영수증 — 훅이 남긴 **열람 구간**과 대조
// ────────────────────────────────────────────────────────────────────────────

/** 겹치는 구간을 합친다 — 같은 줄을 두 번 세면 커버율이 1을 넘고, 그 순간 숫자가 거짓이 된다. */
function mergeSpans(ranges: [number, number][]): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curFrom = 0;
  let curTo = -1;
  for (const [f, t] of sorted) {
    if (t < f) continue;
    if (curTo < curFrom) {
      curFrom = f;
      curTo = t;
    } else if (f <= curTo + 1) curTo = Math.max(curTo, t);
    else {
      total += curTo - curFrom + 1;
      curFrom = f;
      curTo = t;
    }
  }
  if (curTo >= curFrom) total += curTo - curFrom + 1;
  return total;
}

/**
 * 절 하나가 **어디까지 실제로 열렸는가**.
 *
 * `covered` 는 정독으로 인정된 줄만 센다. 통째 Read 강등·Grep 문맥은 "봤다"에 가깝지 "읽었다"가
 * 아니어서 여기에 들지 않고, 그것뿐이면 `partial` 로 따로 말한다 — 화면이 "열긴 열었다"와
 * "끝까지 읽었다"를 구분해 보여 줄 수 있어야 사용자가 이 숫자를 믿는다.
 */
export function classifySpans(
  unit: Pick<SpecUnit, 'file' | 'startLine' | 'endLine'>,
  spans: Readonly<Record<string, readonly SpecReadSpan[]>> | undefined,
  platform: PlatformName,
): { covered: number; partial: boolean } {
  const total = Math.max(1, unit.endLine - unit.startLine + 1);
  if (!spans) return { covered: 0, partial: false };
  const want = pathKey(unit.file, platform);
  const strict: [number, number][] = [];
  const loose: [number, number][] = [];
  for (const [file, list] of Object.entries(spans)) {
    if (pathKey(shapePath(file), platform) !== want) continue;
    for (const s of list ?? []) {
      const from = Math.max(unit.startLine, s.fromLine);
      const to = Math.min(unit.endLine, s.toLine);
      if (to < from) continue;
      loose.push([from, to]);
      if (!s.partial) strict.push([from, to]);
    }
  }
  const strictLines = mergeSpans(strict);
  const looseLines = mergeSpans(loose);
  return {
    covered: clamp(strictLines / total, 0, 1),
    partial: strictLines === 0 && looseLines > 0,
  };
}

/**
 * 훅의 도구 호출 하나를 열람 구간으로 옮긴다 — **여기가 "대충 봤다"를 기계로 가르는 자리**다.
 *
 * `offset` 없이 긴 파일을 통째로 Read 하면 도구가 앞부분만 돌려주고 나머지는 잘린다. 그것을 열람으로
 * 인정하면 이 게이트는 막으려던 실패(중간 유실)를 그대로 통과시킨다. 그래서 **부분 열람으로 강등**한다.
 * `Grep` 은 매치 앞뒤 몇 줄이라 애초에 정독이 아니다. `Glob` 은 파일 이름만 보는 것이라 열람이 아니다.
 */
export function spanFromRead(
  file: string,
  at: number,
  opts: { offset?: number; limit?: number; totalLines?: number; returnedFrom?: number; returnedCount?: number },
): SpecReadSpan {
  const total = opts.totalLines ?? 0;
  const explicit = typeof opts.offset === 'number' || typeof opts.limit === 'number';
  // 도구가 **실제로 돌려준 줄 범위**(훅 응답 `file.startLine`·`numLines`)를 알면 그것이 열람 구간이다 —
  //   통째 Read 는 도구 상한(2,000줄)에서 잘려 돌아오므로 입력(offset/limit)만 믿으면 안 읽은 뒷부분을
  //   읽은 것으로 세게 된다. 강등 판정(`partial`)은 종전대로 "통째 + 긴 파일" 이다.
  const returned = typeof opts.returnedFrom === 'number' && typeof opts.returnedCount === 'number' && opts.returnedCount > 0
    ? { from: Math.max(1, Math.trunc(opts.returnedFrom)), count: Math.trunc(opts.returnedCount) }
    : null;
  const from = returned ? returned.from : Math.max(1, Math.trunc(opts.offset ?? 1));
  const to = returned
    ? returned.from + returned.count - 1
    : typeof opts.limit === 'number' ? from + Math.max(0, Math.trunc(opts.limit)) - 1 : Math.max(from, total || from);
  return {
    file: shapePath(file),
    fromLine: from,
    toLine: Math.max(from, to),
    tool: 'Read',
    partial: !explicit && total > SPEC_FULL_READ_LINE_MAX,
    at,
  };
}

/** `Grep` 매치 한 줄이 덮는 것으로 치는 범위. 문맥 인자를 줬으면 그만큼, 안 줬으면 상수표의 기본값. */
export function spanFromGrep(file: string, line: number, at: number, contextLines?: number): SpecReadSpan {
  const ctxLines = Math.max(0, Math.trunc(contextLines ?? SPEC_GREP_CONTEXT_LINES));
  return {
    file: shapePath(file),
    fromLine: Math.max(1, line - ctxLines),
    toLine: line + ctxLines,
    tool: 'Grep',
    partial: true,
    at,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ⑤ 확증 — 인용을 원문과 맞춰 본다(이 기능에서 유일하게 참·거짓이 갈리는 축)
// ────────────────────────────────────────────────────────────────────────────

/** 공백만 접는다 — 줄바꿈·들여쓰기 때문에 참인 인용이 거짓으로 떨어지면 안 된다. */
const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * 인용 한 건을 파일과 대조한다.
 *
 * 여기서 거짓이 나오면 그것은 **지어낸 근거**다. 프롬프트로 "인용하라"고만 하면 인용도 지어낼 수 있으니,
 * 요구와 대조는 반드시 한 벌이어야 한다. 너무 짧은 인용은 아무 문장에나 걸리므로 근거로 세지 않는다.
 */
export function verifyCitation(ctx: PluginPromptContext, citation: SpecCitation, now = Date.now()): SpecCitation {
  const fail = (failure: NonNullable<SpecCitation['failure']>): SpecCitation => ({
    ...citation,
    verified: false,
    checkedAt: now,
    failure,
  });

  let text: string | null = null;
  try {
    text = ctx.readFile(shapePath(citation.file));
  } catch {
    text = null;
  }
  if (text === null) return fail('file-missing');

  const lines = text.split(/\r?\n/);
  const from = Math.trunc(citation.fromLine);
  const to = Math.trunc(citation.toLine);
  if (from < 1 || to < from || from > lines.length) return fail('out-of-range');

  const quote = squeeze(citation.quote).slice(0, SPEC_CITATION_MAX_CHARS);
  const body = squeeze(lines.slice(from - 1, Math.min(to, lines.length)).join('\n'));
  if (quote.length < SPEC_CITATION_MIN_CHARS) return { ...fail('not-found'), actual: excerpt(body, -1) };

  // 파일 원문을 **함께** 돌려준다 — 화면이 인용과 나란히 놓아야 어긋남이 왜 어긋났는지 보인다(#17-44 ③(b)).
  const hit = body.indexOf(quote);
  const actual = excerpt(body, hit);
  if (hit < 0) return { ...fail('not-found'), actual };

  const out: SpecCitation = { ...citation, verified: true, checkedAt: now, actual };
  delete out.failure;
  return out;
}

/** 원문 한 토막 — 맞은 자리가 있으면 그 자리를 가운데로, 없으면 앞부분. */
function excerpt(body: string, hitAt: number): string {
  if (body.length <= SPEC_CITATION_ACTUAL_MAX) return body;
  const half = Math.floor(SPEC_CITATION_ACTUAL_MAX / 2);
  const start = hitAt < 0 ? 0 : clamp(hitAt - half, 0, Math.max(0, body.length - SPEC_CITATION_ACTUAL_MAX));
  const cut = body.slice(start, start + SPEC_CITATION_ACTUAL_MAX);
  return `${start > 0 ? '…' : ''}${cut}${start + SPEC_CITATION_ACTUAL_MAX < body.length ? '…' : ''}`;
}

/**
 * 에이전트가 낸 글에서 **인용을 뽑는다.**
 *
 * 뽑는 형식은 프롬프트가 시키는 형식과 **같은 파일 안에** 있어야 한다. 둘이 갈리면 에이전트는 시킨 대로
 * 적었는데 우리는 못 알아보고 "인용 없음"으로 판정한다 — 그러면 게이트가 성실한 쪽을 벌한다.
 *
 * 두 순서를 다 받는다(`위치 "인용"` · `"인용" 위치`). 모델은 문장 흐름에 따라 순서를 바꿔 쓰고,
 * 그 차이로 근거가 버려지면 안 된다. 따옴표는 곧은 것과 둥근 것을 함께 본다.
 */
export function extractCitations(text: string, index: SpecIndex, platform: PlatformName, now = Date.now()): SpecCitation[] {
  const LOC_FIRST = /`([^`\n]{1,200}?):(\d+)(?:\s*[-–~]\s*(\d+))?`[\s:—·,]*["“”']([^"“”'\n]{1,800})["“”']/g;
  const QUOTE_FIRST = /["“”]([^"“”\n]{1,800})["“”][\s—·,(]*`?([^`\n)]{1,200}?):(\d+)(?:\s*[-–~]\s*(\d+))?`?\)?/g;
  const out: SpecCitation[] = [];
  const seen = new Set<string>();

  const add = (file: string, from: number, to: number | undefined, quote: string): void => {
    const rel = shapePath(file.trim());
    const fromLine = Math.trunc(from);
    const toLine = to === undefined || Number.isNaN(to) ? fromLine : Math.trunc(to);
    const unit = unitAt(index, rel, fromLine, toLine, platform);
    if (!unit) return; // 색인에 없는 파일·줄은 이 게이트가 말하는 근거가 아니다
    const key = `${unit.id}|${fromLine}|${toLine}|${quote.trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      unitId: unit.id,
      file: unit.file,
      fromLine,
      toLine,
      quote: quote.trim(),
      verified: false,
      checkedAt: now,
    });
  };

  for (const m of text.matchAll(LOC_FIRST)) add(m[1] ?? '', Number(m[2]), m[3] ? Number(m[3]) : undefined, m[4] ?? '');
  for (const m of text.matchAll(QUOTE_FIRST)) add(m[2] ?? '', Number(m[3]), m[4] ? Number(m[4]) : undefined, m[1] ?? '');
  return out;
}

/** 그 줄 범위를 품는 절. 여러 절에 걸치면 **가장 많이 겹치는** 절로 붙인다. */
export function unitAt(index: SpecIndex, file: string, fromLine: number, toLine: number, platform: PlatformName): SpecUnit | null {
  const want = pathKey(shapePath(file), platform);
  let best: SpecUnit | null = null;
  let bestOverlap = 0;
  for (const unit of index.units) {
    if (pathKey(unit.file, platform) !== want) continue;
    const overlap = Math.min(unit.endLine, toLine) - Math.max(unit.startLine, fromLine) + 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = unit;
    }
  }
  return bestOverlap > 0 ? best : null;
}

// ────────────────────────────────────────────────────────────────────────────
// ⑥ 신뢰도 — 하나의 점수로 뭉개지 않는다
// ────────────────────────────────────────────────────────────────────────────

/**
 * 넷을 따로 낸다.
 *
 * 단일 점수는 **무엇이 부족한지** 말하지 못한다. "신뢰도 62%" 는 사용자에게 아무 행동도 시키지 못하지만,
 * "필수 5절 중 3절 열람 · 인용 2건 중 1건 불일치" 는 어디를 다시 보라고 말한다. 신뢰는 하나의 숫자가
 * 아니라 **반증 가능한 분모**에서 온다.
 */
export function computeTrust(
  required: readonly SpecRequiredEntry[],
  citations: readonly SpecCitation[],
  staleDocs: number,
): SpecTrust {
  const live = required.filter((r) => r.status !== 'waived');
  const satisfied = required.filter((r) => r.status === 'satisfied').length;
  const verified = citations.filter((c) => c.verified).length;
  const failed = citations.length - verified;
  const docs = new Set(required.map((r) => r.file)).size;
  return {
    coverage: live.length === 0 ? 1 : round(satisfied / live.length),
    citation: citations.length === 0 ? 0 : round(verified / citations.length),
    depth: live.length === 0 ? 1 : round(live.reduce((s, r) => s + r.covered, 0) / live.length),
    freshness: docs === 0 ? 1 : round(clamp(1 - staleDocs / docs, 0, 1)),
    requiredTotal: required.length,
    satisfied,
    citationsVerified: verified,
    citationsFailed: failed,
    staleDocs,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ⑦ 한데 묶기 — 프롬프트·카드·게이트가 **같은 한 번의 판정**에서 나온다
// ────────────────────────────────────────────────────────────────────────────

export interface SpecReadingEvaluation {
  settings: SpecReadingSettings;
  index: SpecIndex;
  required: SpecRequiredEntry[];
  citations: SpecCitation[];
  trust: SpecTrust;
}

/**
 * 이번 턴의 정독 판정 한 벌.
 *
 * 프롬프트 블록도, 카드 실측도, 서버의 게이트도 전부 이것을 부른다. 두 번 계산하면 두 답이 나오고,
 * 그러면 "화면은 초록인데 게이트가 막는" 상태가 만들어진다 — 그 순간 사용자는 이 기능을 못 믿는다.
 */
export function evaluateSpecReading(ctx: PluginPromptContext, now = Date.now()): SpecReadingEvaluation {
  const settings = readSpecSettings(ctx);
  const index = buildSpecIndexCached(ctx, settings, now);
  const platform = specPlatform(ctx);
  const citations = (ctx.readingCitations ?? []).map((c) => ({ ...c }));
  const byUnit = new Map<string, SpecCitation>();
  for (const c of citations) if (c.verified || !byUnit.has(c.unitId)) byUnit.set(c.unitId, c);

  const required = routeRequiredUnits(index, ctx, settings).map((entry) => {
    if (entry.status === 'waived') return entry;
    const { covered, partial } = classifySpans(entry, ctx.readingSpans, platform);
    const citation = byUnit.get(entry.unitId);
    const status: SpecRequiredEntry['status'] = covered >= SPEC_COVER_SATISFIED_RATIO ? 'satisfied' : 'open';
    return { ...entry, covered, partial, status, ...(citation ? { citation } : {}) };
  });

  return { settings, index, required, citations, trust: computeTrust(required, citations, staleDocsOf(ctx, required, platform)) };
}

/**
 * 열람한 뒤에 고쳐진 문서 수.
 *
 * 읽고 나서 문서가 바뀌면 그 열람은 **이미 낡았다.** 화면이 초록인 채로 낡은 근거를 들고 있는 것이
 * 가장 위험한 상태라, 신뢰도 넷 중 하나를 통째로 여기에 쓴다.
 */
function staleDocsOf(
  ctx: PluginPromptContext,
  required: readonly SpecRequiredEntry[],
  platform: PlatformName,
): number {
  if (!ctx.fileMtimeMs || !ctx.readingSpans) return 0;
  const lastRead = new Map<string, number>();
  for (const [file, list] of Object.entries(ctx.readingSpans)) {
    const key = pathKey(shapePath(file), platform);
    for (const s of list ?? []) lastRead.set(key, Math.max(lastRead.get(key) ?? 0, s.at));
  }
  const stale = new Set<string>();
  for (const r of required) {
    const key = pathKey(r.file, platform);
    const read = lastRead.get(key);
    if (read === undefined) continue;
    const mtime = safeMtime(ctx, r.file);
    if (mtime !== null && mtime > read) stale.add(key);
  }
  return stale.size;
}

// ────────────────────────────────────────────────────────────────────────────
// ⑧ 집행 — 매 턴 프롬프트에 실리는 블록
// ────────────────────────────────────────────────────────────────────────────

const STRENGTH_LINE: Record<SpecGateStrength, string> = {
  observe: '이 절들을 안 열고 끝내도 막지 않는다. 대신 무엇을 안 열었는지 사용자 화면에 그대로 남는다.',
  warn: '필수 절을 안 연 채로 턴을 끝내면 되돌려 보낸다 — 끝내기 전에 남은 절을 열어라.',
  enforce: '필수 절을 안 연 채로 코드를 고치려 하면 그 편집이 거부된다 — 먼저 열어라.',
};

const STATUS_MARK: Record<SpecRequiredEntry['status'], string> = {
  satisfied: '[x]',
  waived: '[면제]',
  blocked: '[!]',
  open: '[ ]',
};

/**
 * 안 변하는 규칙 줄 — 시스템 프롬프트(`buildSpecSystemRules`)와 매 턴 블록(규칙을 시스템에 못 실은 경로)이
 * **같은 한 벌**을 쓴다. 두 벌이면 에이전트가 자리마다 다른 규칙을 받는다.
 */
const SPEC_RULE_LINES: readonly string[] = [
  // 셸 경고는 줄을 늘리지 않고 첫 줄에 붙인다 — `- ` 줄 여섯이 상한이고, 늘리면 규칙 전체가 안 읽힌다.
  '- 목록의 절은 `Read` 에 `offset`·`limit` 을 주어 그 줄 범위를 열어라(셸 `cat`·`sed` 로 읽은 것은 열람으로 안 쳐 준다). 통째 Read 는 부분 열람으로 강등된다.',
  '- 큰 절(상한 초과 표시)은 `Grep` 으로 필요한 줄을 먼저 찾고 그 자리만 열어라 — 전체를 싣지 마라.',
  '- 절마다 근거를 `파일:줄` "원문 한 문장" 꼴로 적어라 — 그 줄을 열어 문장이 실제로 있는지 대조한다.',
  '- 다 열기 전에 "확인했다"고 쓰지 마라. 못 찾았으면 못 찾았다고 적어라.',
  '- 필수 목록이 이번 일과 무관하면 그 사실을 말하고 넘어가라 — 억지로 끼워 맞추지 마라.',
];

/**
 * 시스템 프롬프트(`--append-system-prompt`)에 한 번 실을 정독 규칙 — §5.5 #17-28 ⑧(c) 목표 규약과 같은 자리.
 *
 * 매 턴 사용자 메시지에 규칙 다섯 줄을 되풀이하면 턴 수만큼 이력에 쌓이고 압축에 쓸려 나간다. 여기 실으면
 * 캐시 앞머리 한 벌이고 압축에도 남는다. 호스트는 이것을 실을 때 `ctx.promptRulesInSystem` 을 켜서
 * 매 턴 블록이 목록·강도만 싣게 한다 — 둘은 한 벌이다(하나만 하면 규칙이 두 번 실리거나 아예 없다).
 */
export function buildSpecSystemRules(): string {
  return [
    '',
    '',
    '# 기획 정독 규칙',
    '이번 턴 프롬프트의 「기획 정독」 목록이 이번 턴에 열어야 할 기획 절이다.',
    ...SPEC_RULE_LINES,
    '',
  ].join('\n');
}

/**
 * 매 턴 프롬프트에 실을 정독 규율.
 *
 * 규칙은 짧게(`- ` 줄 여섯이 상한 — §5.11 v4.59). 이번 턴 필수 절은 규칙이 아니라 **자료**라
 * 번호 목록으로 따로 싣는다. 목록이 길어지면 규칙까지 안 읽히므로 상한 안에서만 지목한다.
 * 호스트가 규칙을 시스템 프롬프트에 실었으면(`promptRulesInSystem`) 목록·강도 한 줄만 싣는다.
 */
export function buildSpecPromptBlock(ctx: PluginPromptContext): string | undefined {
  // §5.5 #17-44 ⑧ — 꺼진 층이면 **여기서 끝난다.** 아래 `evaluateSpecReading` 은 색인을 세우려고
  //   `docs/**` 를 훑으므로, 꺼 둔 프로젝트가 매 턴 그것을 도는 것만으로 서버가 멈칫한다.
  if (!specReadingEnabledFor(ctx)) return undefined;
  const evaluation = evaluateSpecReading(ctx);
  const { settings, index, required, trust } = evaluation;
  const rulesElsewhere = ctx.promptRulesInSystem === true;
  const indexNote = index.skippedCount > 0
    ? ` · 상한 밖 문서 ${index.skippedCount}장`
    : index.truncated ? ' (상한에서 잘림)' : '';

  if (index.units.length === 0) {
    // 색인이 비었을 때 침묵하면 켠 뜻이 없다 — "어디를 훑을지 알려 달라"가 이 상태의 집행이다.
    return [
      '',
      '',
      '# 기획 정독 — 훑지 말고 끝까지 열어라',
      '',
      `기획 문서를 찾지 못했다. 훑어본 자리: ${(settings.roots?.length ? settings.roots : SPEC_DOC_ROOT_CANDIDATES).map((r) => `\`${r}\``).join(' · ')}`,
      '',
      '- 기획이 걸린 작업은 시작 전에 **어느 폴더가 기획 문서 자리인지** 사용자에게 물어라.',
      `- 자리를 들으면 \`${SPEC_SETTINGS_FILE}\` 의 \`roots\` 에 적어 다음 턴부터 색인되게 하라.`,
      '- 근거는 `파일:줄` "원문 한 문장" 꼴로 적어라 — 그 줄을 열어 문장이 실제로 있는지 대조한다.',
      '- 원문을 못 찾았으면 못 찾았다고 적어라. 짐작으로 메우지 마라.',
      '',
    ].join('\n');
  }

  if (required.length === 0) {
    // 지목이 없는 턴에 잔소리하면 그것이 오탐이고, 오탐이 이 기능의 유일한 실패 방식이다.
    // 규칙이 시스템에 있으면 한 줄로 충분하다 — 색인이 살아 있고 이번 턴에 걸린 절이 없다는 사실만.
    if (rulesElsewhere) {
      return `\n\n> 기획 정독 — 이번 턴 필수 절 없음 · 문서 ${index.docCount}장 · 절 ${index.units.length}개${indexNote}\n`;
    }
    return [
      '',
      '',
      '# 기획 정독',
      '',
      `> 색인: 문서 ${index.docCount}장 · 절 ${index.units.length}개${indexNote}`,
      '',
      '- 기획을 근거로 들 때는 그 절의 줄 범위를 `Read` 의 `offset`·`limit` 으로 열어라(셸 `cat`·`sed` 는 열람으로 안 쳐 준다). 큰 절은 `Grep` 으로 좁혀 그 자리만.',
      '- 근거는 `파일:줄` "원문 한 문장" 꼴로 적어라 — 그 줄을 열어 문장이 실제로 있는지 대조한다.',
      '- 안 연 절을 "확인했다"고 쓰지 마라. 못 찾았으면 못 찾았다고 적어라.',
      '',
    ].join('\n');
  }

  const done = required.filter((r) => r.status === 'satisfied').length;
  // 절 id 는 싣지 않는다 — 인용은 `파일:줄` 로 붙고, 60자 id 여덟 개는 토큰만 먹는다. 대신 절마다 **비용**을 적는다.
  const items = required.map((r, i) => {
    const mark = STATUS_MARK[r.status];
    const size = typeof r.tokens === 'number' ? ` ~${fmtTokens(r.tokens)} 토큰` : '';
    const big = r.oversized ? ' · 큰 절 — `Grep` 으로 좁혀 그 자리만 `Read`' : '';
    const pct = r.status === 'satisfied' ? '' : r.partial ? ' (부분 열람 — 정독으로 안 침)' : r.covered > 0 ? ` (${Math.round(r.covered * 100)}% 열람)` : '';
    const cite = r.citation ? (r.citation.verified ? ' · 인용 대조 통과' : ' · 인용 불일치 — 다시 확인하라') : '';
    return `${i + 1}. ${mark} ${r.title} — \`${r.file}:${r.startLine}-${r.endLine}\`${size}${big}${pct}${cite}`;
  });

  const head = [
    '',
    '',
    `# 기획 정독 — 이번 턴 필수 절 ${done}/${required.length}`,
    '',
    `> 색인: 문서 ${index.docCount}장 · 절 ${index.units.length}개${indexNote} · 인용 대조 ${trust.citationsVerified}/${trust.citationsVerified + trust.citationsFailed}`,
    '',
    ...items,
    '',
  ];
  // 강도는 사용자가 턴 사이에 바꿀 수 있어 매 턴 블록에 남는다(한 줄).
  if (rulesElsewhere) return [...head, `- ${STRENGTH_LINE[settings.strength]}`, ''].join('\n');
  return [...head, ...SPEC_RULE_LINES, `- ${STRENGTH_LINE[settings.strength]}`, ''].join('\n');
}

/** 프롬프트에 실은 판단을 카드가 **같은 값으로** 그리게 한다(둘 다 `evaluateSpecReading` 하나에서 나온다). */
export function surveySpecFacts(ctx: PluginPromptContext): PluginFactMap {
  // §5.5 #17-44 ⑧ — 꺼져 있으면 **실측을 내지 않는다**(색인도 안 세운다). 카드는 `indexUnits` 가 없는
  //   것을 보고 "측정 전"이라 적는다 — 0 으로 그리면 "기획이 없는 저장소"와 구분이 안 된다.
  if (!specReadingEnabledFor(ctx)) return { specEnabled: false };
  const { settings, index, required, trust } = evaluateSpecReading(ctx);
  return {
    specEnabled: true,
    strength: settings.strength,
    indexDocs: index.docCount,
    indexUnits: index.units.length,
    indexTruncated: index.truncated,
    indexSkipped: index.skippedCount,
    indexExcluded: index.excludedCount,
    oversizedRequired: required.filter((r) => r.oversized).length,
    requiredTotal: trust.requiredTotal,
    satisfied: trust.satisfied,
    citationsVerified: trust.citationsVerified,
    citationsFailed: trust.citationsFailed,
    coverage: trust.coverage,
    citation: trust.citation,
    depth: trust.depth,
    freshness: trust.freshness,
    staleDocs: trust.staleDocs,
    roots: index.roots.length > 0 ? index.roots : [...(settings.roots ?? SPEC_DOC_ROOT_CANDIDATES)],
    openUnits: required.filter((r) => r.status === 'open').map((r) => r.unitId),
  };
}
