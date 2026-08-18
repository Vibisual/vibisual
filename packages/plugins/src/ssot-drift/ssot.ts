/**
 * §5.11 v4.57 → v4.67 — SSOT 플러그인의 **집행** 로직.
 *
 * 이 카드는 오랫동안 "진실 공급원이 몇 개인가"를 0~3 으로 세어 한 줄 그리는 것이 전부였다. 세어 봐야
 * 아무 일도 안 일어나므로 사용자가 그대로 지적했다 — "SSOT 를 켜면 **지금 이 프로젝트에서 쓰는 SSOT 가
 * 똑같이 켜져야** 한다". 그래서 이 파일은 두 가지를 한다.
 *
 *  ① **실측** — 이 프로젝트에 기획 SSOT 로 볼 문서가 실제로 있는지, 그 문서에 **내용이 있는지**, 같은
 *     역할을 하는 문서가 몇 개나 더 있는지, 그리고 그 문서가 **코드보다 뒤처졌는지**를 파일로 확인한다.
 *  ② **집행** — 그 결과로 지시 블록을 만들어 **에이전트의 매 턴 프롬프트에 싣는다**. 켜면 에이전트가
 *     실제로 SSOT 를 먼저 읽고, 재설계 전에 묻고, 문서를 먼저 고친 뒤 구현하게 된다.
 *
 * v4.67 에서 고친 것 — 전부 "실측이 현실을 못 따라가던" 자리다.
 *  - **후보 경로가 하드코딩 8개**였다. `docs/GDD.md` 가 정본인 프로젝트는 문서가 있어도 "없음(warn)" 이
 *    떴다. 후보를 넓히고, 그 위에 **프로젝트가 직접 지정하는 길**(`.vibisual/ssot.json`)을 열었다.
 *  - **빈 문서도 통과**했다. `fileExists` 만 봤으므로 0바이트·제목 한 줄짜리 파일도 SSOT 로 인정돼
 *    규율 여섯 줄이 실렸다. 이제 본문 분량·헤딩 수를 재서 "문서는 있으나 내용 없음"을 따로 가른다.
 *  - **문서가 없을 때 경쟁 문서를 말하지 않았다.** SSOT 가 없을수록 `CLAUDE.md` 같은 사실상의 지시서가
 *    유일 권위가 되므로, 그때야말로 경고가 필요하다.
 *  - **경쟁 문서를 해소할 길이 없었다.** `CLAUDE.md` 에 "기획 SSOT = docs/SSOT.md" 라고 종속을 적어도
 *    영원히 rival(warn) 이었다. 본문이 SSOT 경로를 가리키면 **정렬됨**으로 낮춘다 — 사용자가 경고를 끌
 *    수 있는 길이 있어야 경고가 신호로 남는다.
 *  - **이름은 Drift 인데 어긋남을 안 쟀다.** 세던 것은 "지시 문서가 몇 개인가" 뿐이었다. 문서 갱신 시각을
 *    저장소의 최근 활동과 비교해 **문서가 코드보다 뒤처짐**을 잰다(이것이 이름값이다).
 *
 * 파일 접근은 호스트가 넘긴 탐침(`fileExists`/`readFile`/`fileMtimeMs`)만 쓴다 — 이 패키지는 `node:fs` 를 모른다.
 */
import type { PluginPromptContext } from '../sdk/index.js';

/**
 * 기획 SSOT 후보 — **권위 순서**다. 위에 있는 것이 먼저 잡히면 그것이 그 프로젝트의 SSOT.
 *
 * 순서를 바꾸면 같은 저장소에서 다른 문서가 SSOT 가 되어 버리므로, 추가는 뒤에 붙이는 것이 기본이다.
 * v4.67 에서 게임·기획 계열(`GDD`)과 흔한 요구사항 문서 이름을 뒤에 더했다 — 그 이름을 쓰는 프로젝트는
 * 문서를 제대로 들고 있어도 "없음" 으로 떨어져 **집행이 통째로 헛돌았다**.
 */
export const SSOT_DOC_CANDIDATES: readonly string[] = [
  'docs/SCENARIO.md',
  'docs/SSOT.md',
  'SSOT.md',
  'docs/SPEC.md',
  'SPEC.md',
  'docs/PRD.md',
  'PRD.md',
  'docs/DESIGN.md',
  'docs/GDD.md',
  'GDD.md',
  'docs/GAME_DESIGN.md',
  'GAME_DESIGN.md',
  'docs/REQUIREMENTS.md',
  'DESIGN.md',
];

/**
 * SSOT 는 아니지만 **같은 자리에서 지시를 내는** 문서들 — 어긋남(drift)의 실제 원천.
 *
 * 사람은 "이건 옛날 거네" 하고 넘기지만 모델은 둘 다 그럴듯하게 인용한다. 그래서 세는 데서 그치지 않고,
 * 충돌 시 누가 이기는지를 프롬프트에 못 박는다.
 */
export const RIVAL_DIRECTION_SOURCES: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'docs/rules/README.md',
  'CONTRIBUTING.md',
];

/**
 * 프로젝트가 **자기 SSOT 를 직접 지정하는** 파일 (v4.67).
 *
 * 앱 설정(사용자 기기)에 두지 않고 **프로젝트 안**에 두는 이유: SSOT 가 무엇인지는 그 저장소의 사실이지
 * 이 컴퓨터의 취향이 아니다. 저장소와 함께 옮겨 다녀야 하고, 팀원·다른 기기·다른 앱에서도 같은 답이
 * 나와야 한다. 형식도 그래서 **평범한 JSON 한 장**이다(플러그인 폴더를 복사해 가도 계약이 따라온다).
 *
 * ```json
 * { "doc": "docs/GDD.md", "candidates": ["docs/DESIGN_v2.md"], "rivals": ["docs/OLD_RULES.md"] }
 * ```
 */
export const SSOT_CONFIG_PATH = '.vibisual/ssot.json';

/** `Change Log` 절이 있는지 — 갱신 규칙(④)의 문구가 갈린다. */
const CHANGE_LOG_HEADING = /^#{1,6}\s*.*(change\s*log|changelog|변경\s*이력|변경\s*기록)/im;

/** 마크다운 헤딩 — "제목만 있는 파일"과 "내용이 있는 문서"를 가르는 두 자 중 하나. */
const HEADING_LINE = /^#{1,6}\s+\S/gm;

/** 문서 앞머리의 YAML frontmatter — 분량을 셀 때 본문으로 치지 않는다. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * "문서는 있으나 내용이 없다"의 문턱.
 *
 * 0바이트·제목 한 줄짜리 파일이 SSOT 로 인정되면 규율 여섯 줄이 실리고, 에이전트는 **없는 기획을 읽으러
 * 갔다가 아무것도 못 찾은 채** 작업을 시작한다. 그 상태는 "SSOT 있음"보다 오히려 위험하다 — 화면은
 * 초록인데 실제로는 아무 근거가 없기 때문이다. 그래서 분량과 헤딩 수 둘 다 본다(둘 중 하나만 보면
 * "제목 30개 목차 파일"이나 "헤딩 없는 긴 잡문"이 그대로 통과한다).
 */
export const SSOT_MIN_BODY_CHARS = 400;
export const SSOT_MIN_HEADINGS = 2;

/** 문서가 저장소 활동보다 이만큼 뒤처지면 "뒤처짐"으로 본다. */
export const SSOT_STALE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 저장소의 **최근 활동 시각**을 알려 주는 자리들 — 앞에 있는 것이 더 정확하다.
 *
 * git 로그(`.git/logs/HEAD`)는 커밋할 때마다 한 줄이 붙으므로 그 파일의 갱신 시각이 곧 **마지막 커밋
 * 시각**이다. 서브프로세스(`git log`)를 부르지 않고 같은 답을 얻는 길이라 호스트 탐침만으로 닿는다.
 */
const REPO_ACTIVITY_FILES: readonly string[] = ['.git/logs/HEAD', '.git/index', '.git/HEAD'];

/** `2026-08-04` 꼴 날짜 — Change Log 의 마지막 줄이 언제인지 재는 데 쓴다. */
const ISO_DATE = /(20\d{2})-(\d{2})-(\d{2})/g;

/** 프로젝트가 지정한 SSOT 설정. 파일이 없거나 깨졌으면 전부 비어 있다. */
export interface SsotConfig {
  /** 이 프로젝트의 SSOT 문서 경로(루트 기준 상대). 지정되면 후보 탐색보다 **먼저** 이긴다. */
  doc: string | null;
  /** 후보 목록에 **앞쪽으로** 더할 경로들. 여러 문서를 돌려 쓰는 프로젝트용. */
  candidates: string[];
  /** 이 프로젝트에서 지시를 내는 문서로 함께 셀 경로들(기본 목록에 더한다). */
  rivals: string[];
}

const EMPTY_CONFIG: SsotConfig = { doc: null, candidates: [], rivals: [] };

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];

/**
 * 프로젝트가 지정한 설정을 읽는다.
 *
 * 깨진 JSON·이상한 타입은 **없는 것으로 취급**한다(던지지 않는다). 설정 한 장 때문에 집행이 통째로
 * 빠지면, 사용자는 "켰는데 아무 일도 안 일어난다"만 보고 원인을 영영 못 찾는다.
 */
export function readSsotConfig(ctx: PluginPromptContext): SsotConfig {
  let raw: string | null = null;
  try {
    raw = ctx.readFile(SSOT_CONFIG_PATH);
  } catch {
    return EMPTY_CONFIG;
  }
  if (!raw) return EMPTY_CONFIG;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_CONFIG;
    const obj = parsed as Record<string, unknown>;
    const doc = typeof obj['doc'] === 'string' && obj['doc'].trim() !== '' ? obj['doc'].trim() : null;
    return { doc, candidates: strList(obj['candidates']), rivals: strList(obj['rivals']) };
  } catch {
    return EMPTY_CONFIG;
  }
}

/** 이 프로젝트에서 실제로 훑을 후보 목록 — 지정한 것이 앞, 기본 후보가 뒤. */
export function resolveCandidates(config: SsotConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...(config.doc ? [config.doc] : []), ...config.candidates, ...SSOT_DOC_CANDIDATES]) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * SSOT 문서의 상태 — "있다/없다"의 두 칸으로는 실제 상황을 못 담는다.
 *
 * - `ok`            내용이 있는 문서를 잡았다.
 * - `thin`          문서는 있는데 **거의 비어 있다**(0바이트·제목만).
 * - `configMissing` 프로젝트가 경로를 지정했는데 **그 자리에 파일이 없다**(오타·이동·미생성).
 * - `none`          후보를 하나도 못 찾았다.
 */
export type SsotDocState = 'ok' | 'thin' | 'configMissing' | 'none';

export interface SsotSurvey {
  /** 잡힌 SSOT 문서(프로젝트 루트 기준 상대경로). 없으면 null. */
  doc: string | null;
  /** 프로젝트가 `.vibisual/ssot.json` 으로 지정한 경로. 지정 안 했으면 null. */
  configured: string | null;
  /** 문서 상태 — 빈 문서를 "있음"으로 세지 않기 위한 축. */
  docState: SsotDocState;
  /** 그 문서에 Change Log 절이 있는가. 문서가 없으면 false. */
  hasChangeLog: boolean;
  /** 본문 글자 수(frontmatter 제외). 문서가 없으면 0. */
  bodyChars: number;
  /** 마크다운 헤딩 수. 문서가 없으면 0. */
  headings: number;
  /** SSOT 말고도 지시를 내는 문서들 — **아직 정렬되지 않은 것만**. */
  rivals: string[];
  /** 본문이 SSOT 를 가리켜 **종속이 명시된** 문서들. 경고에서 빠진다. */
  alignedRivals: string[];
  /** 지시 공급원 총수 = (SSOT 있으면 1) + 정렬 안 된 rivals. 카드의 "몇 군데인가"가 이 실측값이다. */
  sources: number;
  /** 저장소 최근 활동보다 문서가 며칠 뒤처졌나. 잴 수 없으면 null(음수는 0으로 본다). */
  driftDays: number | null;
  /** Change Log 마지막 날짜가 며칠 지났나. 날짜를 못 찾으면 null. */
  changeLogAgeDays: number | null;
  /** 문서가 문턱(`SSOT_STALE_DAYS`)을 넘겨 뒤처졌는가. */
  stale: boolean;
}

/** 본문에서 frontmatter 를 걷어낸 알맹이. */
function bodyOf(text: string): string {
  return text.replace(FRONTMATTER, '').trim();
}

function countHeadings(text: string): number {
  return text.match(HEADING_LINE)?.length ?? 0;
}

/** 이 문서가 SSOT 노릇을 할 만큼 내용이 있는가. */
export function hasSubstance(text: string): boolean {
  const body = bodyOf(text);
  return body.length >= SSOT_MIN_BODY_CHARS && countHeadings(body) >= SSOT_MIN_HEADINGS;
}

/**
 * 경쟁 문서가 SSOT 에 **종속을 명시했는가**.
 *
 * `CLAUDE.md` 본문에 "기획 SSOT = docs/SCENARIO.md" 라고 적어 두면 그 문서는 더 이상 경쟁자가 아니라
 * **SSOT 를 가리키는 이정표**다. 그런데도 계속 warn 으로 남으면 사용자는 경고를 끌 방법이 없고, 끌 수
 * 없는 경고는 곧 무시된다. 판정은 문자열 한 줄이면 충분하다 — 경로가 본문 어딘가에 있으면 정렬로 본다
 * (경로를 적어 놓고 딴소리하는 문서까지 잡아내는 것은 이 카드의 일이 아니다).
 */
export function mentionsDoc(text: string, doc: string): boolean {
  const hay = text.replace(/\\/g, '/').toLowerCase();
  const needle = doc.replace(/\\/g, '/').toLowerCase();
  if (hay.includes(needle)) return true;
  // `docs/SCENARIO.md` 를 `SCENARIO.md` 로만 적는 문서도 흔하다 — 파일 이름만으로도 인정한다.
  const base = needle.split('/').pop() ?? needle;
  return base.length >= 5 && hay.includes(base);
}

/** 저장소의 마지막 활동 시각(ms). 탐침이 없거나 git 저장소가 아니면 null. */
function repoActivityAt(ctx: PluginPromptContext): number | null {
  const mtime = ctx.fileMtimeMs;
  if (!mtime) return null;
  let newest: number | null = null;
  for (const p of REPO_ACTIVITY_FILES) {
    let at: number | null = null;
    try {
      at = mtime(p);
    } catch {
      at = null;
    }
    if (typeof at === 'number' && at > 0 && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/** 본문에서 가장 늦은 `YYYY-MM-DD` — Change Log 의 마지막 줄이 언제인지. */
export function latestDateIn(text: string): number | null {
  let newest: number | null = null;
  for (const m of text.matchAll(ISO_DATE)) {
    const at = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/** 프로젝트를 실제로 훑어 SSOT 상태를 확정한다. */
export function surveySsot(ctx: PluginPromptContext): SsotSurvey {
  const config = readSsotConfig(ctx);
  const candidates = resolveCandidates(config);
  const doc = candidates.find((p) => ctx.fileExists(p)) ?? null;
  const body = doc ? ctx.readFile(doc) : null;

  const bodyChars = body ? bodyOf(body).length : 0;
  const headings = body ? countHeadings(bodyOf(body)) : 0;

  const docState: SsotDocState = doc === null
    // 지정해 놓고 그 자리에 파일이 없는 것과, 애초에 아무것도 없는 것은 다른 화면이다.
    ? (config.doc ? 'configMissing' : 'none')
    : (body !== null && hasSubstance(body) ? 'ok' : 'thin');

  const rivalPaths = [...new Set([...RIVAL_DIRECTION_SOURCES, ...config.rivals])];
  const present = rivalPaths.filter((p) => ctx.fileExists(p));
  const rivals: string[] = [];
  const alignedRivals: string[] = [];
  for (const p of present) {
    const text = doc ? ctx.readFile(p) : null;
    if (doc && text && mentionsDoc(text, doc)) alignedRivals.push(p);
    else rivals.push(p);
  }

  const repoAt = repoActivityAt(ctx);
  const docAt = doc && ctx.fileMtimeMs ? ctx.fileMtimeMs(doc) : null;
  const driftDays = repoAt !== null && docAt !== null && docAt > 0
    ? Math.max(0, Math.floor((repoAt - docAt) / DAY_MS))
    : null;

  const changeLogDate = body ? latestDateIn(body) : null;
  const changeLogAgeDays = changeLogDate !== null && repoAt !== null
    ? Math.max(0, Math.floor((repoAt - changeLogDate) / DAY_MS))
    : null;

  return {
    doc,
    configured: config.doc,
    docState,
    hasChangeLog: body !== null && CHANGE_LOG_HEADING.test(body),
    bodyChars,
    headings,
    rivals,
    alignedRivals,
    sources: (doc ? 1 : 0) + rivals.length,
    driftDays,
    changeLogAgeDays,
    stale: driftDays !== null && driftDays >= SSOT_STALE_DAYS,
  };
}

/**
 * §5.11 v4.65 — 같은 실측을 **카드가 그릴 수 있는 얕은 값**으로 옮긴다.
 *
 * `buildSsotPromptBlock` 과 같은 `surveySsot` 하나에서 파생시키는 것이 요점이다. 카드용으로 따로 세면
 * 그 순간 화면과 프롬프트가 갈라지고, 그것이 v4.57~v4.63 에서 실제로 벌어진 일이다(프롬프트는 문서를
 * 잡아 싣는데 카드는 rules·skills·기억 수를 "진실 공급원"이라 표시했다).
 *
 * ⚠ **못 잰 값은 키를 넣지 않는다**(`driftDays` 등). 0 으로 채우면 카드가 "오늘 고쳤다"고 그리는데
 * 실제로는 잰 적이 없는 상태가 된다 — 없는 값을 판정으로 바꾸는 것이 곧 거짓말이다.
 */
export function surveySsotFacts(ctx: PluginPromptContext): Record<string, string | number | boolean | string[]> {
  const survey = surveySsot(ctx);
  return {
    // 못 찾았을 때 빈 문자열을 주면 카드가 "없음"과 "아직 안 재봤음"을 구분할 수 없다 — 키는 항상 둔다.
    doc: survey.doc ?? '',
    configured: survey.configured ?? '',
    docState: survey.docState,
    hasChangeLog: survey.hasChangeLog,
    bodyChars: survey.bodyChars,
    headings: survey.headings,
    rivals: survey.rivals,
    alignedRivals: survey.alignedRivals,
    sources: survey.sources,
    stale: survey.stale,
    configPath: SSOT_CONFIG_PATH,
    ...(survey.driftDays !== null ? { driftDays: survey.driftDays } : {}),
    ...(survey.changeLogAgeDays !== null ? { changeLogAgeDays: survey.changeLogAgeDays } : {}),
  };
}

/** 경로 목록을 프롬프트에 적을 때 쓰는 표기 — 백틱 + 가운뎃점. */
const paths = (list: readonly string[]): string => list.map((p) => `\`${p}\``).join(' · ');

/**
 * 지시가 여러 곳에서 올 때 붙이는 경고 — **문서가 있든 없든 붙는다** (v4.67).
 *
 * 종전에는 SSOT 를 찾았을 때만 이 경고를 냈다. 그런데 SSOT 가 **없을 때**야말로 `CLAUDE.md` 같은
 * 사실상의 지시서가 유일 권위가 되므로, 침묵하면 모델은 그 문서를 기획서로 오인한 채 일한다.
 */
function rivalLines(survey: SsotSurvey): string[] {
  if (survey.rivals.length === 0) {
    // 정렬된 문서만 남았으면 그 사실을 짧게 알린다 — 사용자가 종속을 적어 경고를 끈 결과이기 때문이다.
    return survey.alignedRivals.length > 0
      ? ['', `지시 문서 ${paths(survey.alignedRivals)} 는 본문에 SSOT 를 명시해 **정렬된 상태**다. 그 문서를 따르되, 기획 판단의 근거는 SSOT 에서 확인한다.`]
      : [];
  }
  const alignedNote = survey.alignedRivals.length > 0
    ? ` (${paths(survey.alignedRivals)} 는 SSOT 를 명시해 정렬됨)`
    : '';
  return survey.doc
    ? [
      '',
      `⚠ 지시가 **${survey.sources}곳**에서 온다: \`${survey.doc}\`(SSOT) · ${paths(survey.rivals)}${alignedNote}.`,
      '   충돌하면 **SSOT 가 이긴다.** 다른 문서에서 읽은 것이 SSOT 와 다르면, 고치기 전에 어긋난 지점을 사용자에게 먼저 알린다.',
    ]
    : [
      '',
      `⚠ SSOT 가 없는데 지시 문서는 **${survey.rivals.length}개** 있다: ${paths(survey.rivals)}${alignedNote}.`,
      '   이 문서들은 작업 규칙이지 **기획서가 아니다.** 거기 적힌 것을 그 프로젝트의 기획·범위로 단정하지 말고, 기획 판단이 필요하면 사용자에게 묻는다.',
    ];
}

/** 문서가 저장소 활동보다 뒤처졌을 때만 붙는 한 줄 — 이 카드 이름(Drift)의 실제 내용. */
function driftLines(survey: SsotSurvey): string[] {
  if (!survey.stale || survey.driftDays === null) return [];
  const changeLog = survey.changeLogAgeDays !== null && survey.changeLogAgeDays > survey.driftDays
    ? ` \`Change Log\` 의 마지막 날짜는 **${survey.changeLogAgeDays}일** 전이다.`
    : '';
  return [
    '',
    `⚠ \`${survey.doc}\` 는 저장소의 최근 변경보다 **${survey.driftDays}일** 뒤처져 있다.${changeLog}`,
    '   지금 만지는 부분이 그 문서와 어긋나 있을 수 있다. 문서를 근거로 삼기 전에 **해당 절이 현재 코드와 맞는지 확인**하고, 어긋나면 사용자에게 알린 뒤 문서부터 고친다.',
  ];
}

/**
 * 매 턴 프롬프트에 실을 SSOT 규율.
 *
 * 짧게 유지한다 — 규칙 블록을 길게 쓰면 무관한 작업에도 그만큼의 소음이 매 턴 실린다(§5.10 에서
 * 규칙 카드 전량 주입이 같은 이유로 문제가 됐다). 여기서는 **여섯 줄 + 상황 경고**가 상한이다.
 */
export function buildSsotPromptBlock(ctx: PluginPromptContext): string | undefined {
  const survey = surveySsot(ctx);

  if (survey.docState === 'configMissing') {
    // 지정해 놓고 그 자리에 파일이 없는 상태 — 후보를 다시 뒤지라고 시키면 지정을 무시하는 셈이다.
    return [
      '',
      '',
      '# SSOT (단일 진실 공급원) — 지정된 문서가 그 자리에 없다',
      '',
      `이 프로젝트는 \`${SSOT_CONFIG_PATH}\` 에서 SSOT 를 \`${survey.configured}\` 로 지정했는데 그 경로에 파일이 없다.`,
      '',
      `- 기획이 걸린 작업은 시작 전에 **경로가 틀렸는지, 문서를 아직 안 만들었는지** 사용자에게 확인한다.`,
      `- 사용자가 만들라고 하면 \`${survey.configured}\` 에 만들고 \`Change Log\` 절을 함께 둔다.`,
      '- 코드에서 읽은 것을 기획으로 단정하지 않는다 — 코드는 "지금 이렇다"이지 "이래야 한다"가 아니다.',
      ...rivalLines(survey),
      '',
    ].join('\n');
  }

  if (!survey.doc) {
    // 문서가 없다고 침묵하면 플러그인을 켠 의미가 없다 — "없으면 묻는다"가 이 상태의 집행이다.
    return [
      '',
      '',
      '# SSOT (단일 진실 공급원) — 이 프로젝트에는 아직 지정된 문서가 없다',
      '',
      `찾아본 자리: ${paths(SSOT_DOC_CANDIDATES)}`,
      '',
      '- 기획·범위·동작 원칙이 걸린 작업은 **시작 전에 어느 문서가 SSOT 인지 사용자에게 묻는다.**',
      '- 사용자가 만들라고 하면 `docs/SSOT.md` 에 만들고 `Change Log` 절을 함께 둔다.',
      `- 후보 이름이 아닌 문서를 쓰는 프로젝트면 \`${SSOT_CONFIG_PATH}\` 에 \`{ "doc": "<경로>" }\` 로 지정한다.`,
      '- 코드에서 읽은 것을 기획으로 단정하지 않는다 — 코드는 "지금 이렇다"이지 "이래야 한다"가 아니다.',
      ...rivalLines(survey),
      '',
    ].join('\n');
  }

  if (survey.docState === 'thin') {
    // 빈 문서에 규율 여섯 줄을 실으면 에이전트는 없는 기획을 읽으러 갔다가 빈손으로 돌아온다.
    return [
      '',
      '',
      '# SSOT (단일 진실 공급원) — 문서는 있으나 내용이 비어 있다',
      '',
      `> \`${survey.doc}\` (본문 ${survey.bodyChars}자 · 헤딩 ${survey.headings}개)`,
      '',
      `- 이 문서를 **기획의 근거로 쓰지 않는다.** 아직 아무것도 안 적혀 있다.`,
      '- 기획·범위가 걸린 작업은 시작 전에 사용자에게 묻고, 답을 이 문서에 먼저 적은 뒤 구현한다.',
      `- 처음 적을 때 \`Change Log\` 절을 함께 만든다.`,
      ...rivalLines(survey),
      '',
    ].join('\n');
  }

  const lines = [
    '',
    '',
    '# SSOT (단일 진실 공급원) — 기획 연속성 절대 규칙',
    '',
    `> 이 프로젝트의 기획·UX·동작 원칙 SSOT = \`${survey.doc}\`${survey.configured ? ' (프로젝트가 지정)' : ''}`,
    '',
    `1. 기능 추가·변경·리팩터링 **전에** \`${survey.doc}\` 를 Read 하고, 관련 섹션을 1~2문장으로 요약한 뒤 시작한다.`,
    '2. 기존 설계는 **유지·확장이 기본**. 재설계·교체는 사용자 명시 승인 없이 하지 않는다.',
    '3. SSOT 와 충돌하는 요청이면 구현 전에 묻는다 — "기존 것을 **대체**인가, **병행**인가?"',
    survey.hasChangeLog
      ? `4. SSOT 를 고쳐야 하면 **코드보다 그 문서를 먼저** 고치고 \`Change Log\` 에 한 줄 남긴 뒤 구현한다.`
      : `4. SSOT 를 고쳐야 하면 **코드보다 그 문서를 먼저** 고친다. 그 문서에는 아직 \`Change Log\` 절이 없으니, 처음 고칠 때 절을 만들고 첫 줄을 남긴다.`,
    '5. 그 문서에 `Out of Scope` 로 적힌 항목은 사용자가 Scope 에 넣기 전까지 스스로 착수하지 않는다.',
    '6. 예외 없음 — 확인을 건너뛰는 것이 기획이 무너지는 경로다.',
    ...rivalLines(survey),
    ...driftLines(survey),
    '',
  ];

  return lines.join('\n');
}
