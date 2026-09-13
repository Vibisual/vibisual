/**
 * §5.5 #17-17 ⑪(l) — **무대 블록.** 에이전트가 답 안에 **코드블록을 끼워 넣듯이** 적는 진행 신고.
 *
 * ⑪(i)(j) 까지의 신고 창구는 규약 블록이 가르쳐 주는 `curl` 두 벌이었다. 그것은 **동작하지만
 * 딱딱하다** — 모델은 문장을 쓰다 말고 셸 명령을 조립해야 하고(그 사이 말투가 끊긴다), 사용자가
 * 대화에서 보는 것은 자기 화면을 고치는 JSON 이 아니라 **자기 화면과 무관해 보이는 셸 한 덩어리**다.
 * 게다가 그 길은 도구(Bash)를 한 번 더 태우므로, Bash 를 끈 에이전트는 목표 창을 영영 못 쓴다.
 *
 * 그래서 신고를 **본문 안의 코드블록**으로 내린다. 모델이 이미 하루 종일 하는 일 —
 * 세 겹 백틱을 열고 언어 이름을 적고 몇 줄 쓰는 것 — 그대로다.
 *
 * ~~~markdown
 * 스키마까지 끝냈습니다.
 *
 * ```vibisual
 * goal: 무대를 개편한다
 * - [x] 스키마 정의 @locate
 * - [~] 서버 배선 @change ?
 * - [ ] 빌드 @build
 * note: 배선 절반
 * ```
 * ~~~
 *
 * **왜 마크다운 체크박스인가** — 모델이 배울 것이 없기 때문이다. `- [x]` 는 이미 쓰는 문법이고,
 * 화면에서도 같은 뜻(체크된 항목)이라 사람이 읽는 모양과 기계가 읽는 모양이 갈리지 않는다.
 * JSON 을 그대로 적어도 받는다(아래 `parseStageBlockBody` 의 첫 갈래) — 옛 규약을 본 세션이
 * 페이로드만 옮겨 붙여도 통한다.
 *
 * **여기는 순수 함수만 둔다** — 서버가 스트림에서 수확할 때와 클라가 대화에 그릴 때가 **같은 답**을
 * 내야 한다. 두 벌로 만들면 한쪽만 고쳐져 "화면엔 3단계인데 목표 창엔 2단계"가 된다.
 */

/** 무대 블록이 말할 수 있는 단계 상태 — `SessionGoalStepStatus` 와 같은 세 값. */
export type StageBlockStepStatus = 'pending' | 'in_progress' | 'done';

/** 무대 블록 한 줄이 말하는 단계. */
export interface StageBlockStep {
  text: string;
  status: StageBlockStepStatus;
  /** `@key` 로 붙인 종류(⑪(a)). */
  kind?: string;
  /** 꼬리의 `?`(해 봐야 안다) / `!`(될 것 같다) — ⑪(e) 의 이진 확신. */
  confidence?: 'high' | 'low';
  /**
   * ⑰(b) — 체크박스 뒤의 `∥`(또는 `||`) — **바로 앞 단계와 같은 행**(나란히 = 병렬).
   * `true` 일 때만 실린다(없으면 종전처럼 세로 한 줄).
   */
  parallel?: boolean;
}

/** 무대 블록이 만들거나 손보는 종류 카드(⑪(a)(i)). */
export interface StageBlockKind {
  key: string;
  label?: string;
  color?: string;
  /** `source`·`log`·`diff`·`web`·`terminal`·`docs`·`none` — 검증은 저장하는 쪽이 한다. */
  surface?: string;
  blurb?: string;
  glyph?: string;
  /** 96 좌표계 path 들. `scene:` 줄마다 하나씩 쌓인다. */
  scene?: string[];
  /**
   * ⑪(m) — **장면 템플릿 이름.** `from: wave` 또는 `scene: @wave`.
   * 펼치는 것은 저장하는 쪽(서버)이다 — 여기서 펴면 클라가 그리는 미리보기와 서버가 저장한
   * 카드가 서로 다른 시점의 템플릿 표를 보게 된다.
   */
  from?: string;
}

/** 무대 블록 한 덩어리가 지시하는 것 전부. 빈 지시(아무 줄도 못 읽음)는 `null` 로 돌려준다. */
export interface StageBlockDirective {
  /** 목표 한 문장. */
  goal?: string;
  /** 진행 메모 한 줄. */
  note?: string;
  /** 단계가 하나도 없을 때만 쓰이는 숫자(③ 의 우선순위 그대로). */
  percent?: number;
  steps?: StageBlockStep[];
  kinds?: StageBlockKind[];
}

/**
 * 무대 블록으로 인정하는 펜스 언어. `vibisual` 이 정본이고 나머지는 별칭이다 —
 * 모델이 셋 중 무엇을 적든 통해야 한다(한 글자 틀렸다고 신고가 통째로 사라지면 그게 더 딱딱하다).
 */
export const STAGE_BLOCK_LANGS = ['vibisual', 'vibe', 'stage', 'goal'] as const;

/** 한 블록이 만들 수 있는 종류 카드 수 상한 — 한 번에 열 개를 만드는 것은 신고가 아니라 사고다. */
export const STAGE_BLOCK_KINDS_MAX = 8;

/** 한 블록이 실을 수 있는 단계 수 상한(서버가 `SESSION_GOAL_STEPS_MAX` 로 한 번 더 조인다). */
export const STAGE_BLOCK_STEPS_MAX = 64;

/** 종류 카드 속성으로만 쓰이는 키 — 최상위 키(`goal`·`note`·`percent`)와 겹치지 않는다. */
const KIND_ATTR_KEYS = ['label', 'color', 'surface', 'blurb', 'glyph', 'scene', 'from'] as const;
type KindAttrKey = (typeof KIND_ATTR_KEYS)[number];

/** 펜스 정보 문자열(``` 뒤에 적은 것)이 무대 블록인가. `vibisual json` 처럼 뒤에 뭘 더 붙여도 통한다. */
export function isStageBlockLang(info: string | null | undefined): boolean {
  if (!info) return false;
  const first = info.trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
  return (STAGE_BLOCK_LANGS as readonly string[]).includes(first);
}

/** 본문에서 찾아낸 무대 블록 한 덩어리. */
export interface StageBlockSpan {
  /** 펜스 안쪽 본문(펜스 줄 제외). */
  body: string;
  /** 펜스를 포함한 원문 — **중복 적용 방지의 열쇠**다(같은 원문은 같은 신고다). */
  raw: string;
  /** 원문에서의 시작·끝(문자 인덱스, 끝은 배타적). */
  start: number;
  end: number;
  /** 닫는 펜스를 실제로 만났는가. 스트리밍 중에는 `false` 인 것이 정상이다. */
  closed: boolean;
}

/**
 * ⑪(l) — 마크다운 본문에서 무대 블록을 전부 찾는다.
 *
 * **닫히지 않은 블록도 돌려준다**(`closed:false`) — 토큰 델타로 흘러 들어오는 도중에는 늘 그 상태이고,
 * 부르는 쪽이 "닫힌 것만 적용" 을 고르게 하는 편이 낫다. 여기서 조용히 버리면 스트리밍 경로에서는
 * 블록이 영영 안 보인다.
 *
 * 펜스는 백틱·물결 둘 다 받고, 여는 펜스보다 짧은 울타리는 닫는 것으로 치지 않는다(마크다운 규칙 그대로) —
 * 그래야 블록 **안에** 세 겹 백틱 예시를 적어도 거기서 끊기지 않는다.
 */
export function extractStageBlocks(markdown: string): StageBlockSpan[] {
  if (!markdown || markdown.indexOf('`') < 0) {
    // 물결 펜스만 쓰는 경우가 드물게 있다 — 백틱이 없다고 곧장 포기하지는 않는다.
    if (!markdown || markdown.indexOf('~') < 0) return [];
  }
  const out: StageBlockSpan[] = [];
  const lines = markdown.split('\n');
  // 각 줄의 시작 offset — span 을 원문 좌표로 돌려주기 위해 미리 센다.
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }
  // 펜스 판정용 사본 — 끝의 `\r` 만 떼어 낸다(CRLF 본문). 원본 `lines` 는 offset·`raw` 가 원문 좌표를
  //   그대로 가리켜야 하므로 건드리지 않는다. 이걸 안 하면 여는 펜스의 `$` 가 `\r` 앞에서 어긋나
  //   **CRLF 로 흘러온 신고는 통째로 안 보인다** — 화면에는 아무 표시도 없어 회귀인 줄도 모른다.
  const probe = lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  const fenceRe = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/u;
  let i = 0;
  while (i < lines.length) {
    const line = probe[i] ?? '';
    const m = fenceRe.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const marker = m[1] ?? '';
    const info = (m[2] ?? '').trim();
    // 무대 블록이 아니면 그 코드블록 **전체를 건너뛴다** — 안에 적힌 예시 펜스를 여는 펜스로 오인하지 않게.
    const stage = isStageBlockLang(info);
    const closeRe = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`, 'u');
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      if (closeRe.test(probe[j] ?? '')) {
        closed = true;
        break;
      }
      j++;
    }
    if (stage) {
      const bodyLines = lines.slice(i + 1, closed ? j : lines.length);
      const start = offsets[i] ?? 0;
      const endLine = closed ? j : lines.length - 1;
      const end = (offsets[endLine] ?? 0) + (lines[endLine]?.length ?? 0);
      out.push({ body: bodyLines.join('\n'), raw: markdown.slice(start, end), start, end, closed });
    }
    i = closed ? j + 1 : lines.length;
  }
  return out;
}

/** `@shader` / `shader` 어느 쪽으로 적어도 같은 키로 읽는다. 종류 키에 쓸 수 없는 글자는 버린다. */
function normalizeKindKey(raw: string): string | undefined {
  const key = raw.trim().replace(/^@/u, '').slice(0, 40);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(key) ? key : undefined;
}

/** 체크박스 표식 한 글자 → 상태. 모르는 글자는 `pending`(빈 칸과 같게 읽는다). */
function statusOfMark(mark: string): StageBlockStepStatus {
  const c = mark.trim().toLowerCase();
  if (c === 'x' || c === 'v' || c === '*') return 'done';
  if (c === '~' || c === '-' || c === '>' || c === '/') return 'in_progress';
  return 'pending';
}

/**
 * 단계 본문 꼬리에 붙은 표식(`@kind` · `?` · `!`)을 떼어 낸다.
 *
 * 뒤에서부터 하나씩 벗기므로 `서버 배선 @change ?` 도 `서버 배선 ? @change` 도 같게 읽힌다 —
 * 순서를 외우게 하지 않는 것이 이 문법의 취지다.
 */
/**
 * 꼬리 표식을 떼고 본문만 남긴다 — `@종류` · `?`/`!`(⑪(e)) · `[사용자 추가]`.
 *
 * 마지막 것은 ㉑ 의 상태 블록이 사용자 단계에 붙이는 **소유 표지**다. 상태 블록이 목록을 블록 문법 그대로
 * 적으므로 세션은 그 줄을 그대로 옮겨 오는데, 표지가 본문에 섞이면 같은 단계가 다른 항목으로 갈려
 * 사용자 단계가 두 벌이 된다. 여기서 읽고 버린다 — 소유는 서버가 본문 일치로 이미 안다(⑪(d)).
 */
function stripStepMarkers(raw: string): { text: string; kind?: string; confidence?: 'high' | 'low' } {
  let text = raw.trim();
  let kind: string | undefined;
  let confidence: 'high' | 'low' | undefined;
  for (;;) {
    const m = /(?:^|\s)(@[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}|\?|!|\[사용자 추가\])$/u.exec(text);
    if (!m) break;
    const tok = m[1] ?? '';
    if (tok === '?') confidence ??= 'low';
    else if (tok === '!') confidence ??= 'high';
    else if (tok.startsWith('@')) kind ??= normalizeKindKey(tok);
    // `[사용자 추가]` — 읽고 버린다.
    text = text.slice(0, m.index).trimEnd();
    if (!text) break;
  }
  return { text, ...(kind ? { kind } : {}), ...(confidence ? { confidence } : {}) };
}

/** JSON 으로 적힌 블록 — 옛 `/progress` 페이로드를 그대로 옮겨 붙여도 통하게 한다. */
function parseJsonDirective(body: string): StageBlockDirective | null {
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const out: StageBlockDirective = {};
  if (typeof o['goal'] === 'string' && o['goal'].trim()) out.goal = o['goal'].trim();
  if (typeof o['note'] === 'string' && o['note'].trim()) out.note = o['note'].trim();
  if (typeof o['percent'] === 'number' && Number.isFinite(o['percent'])) out.percent = o['percent'];
  if (Array.isArray(o['steps'])) {
    const steps: StageBlockStep[] = [];
    for (const raw of o['steps'].slice(0, STAGE_BLOCK_STEPS_MAX)) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as Record<string, unknown>;
      const text = typeof s['text'] === 'string' ? s['text'].trim() : '';
      if (!text) continue;
      const st = s['status'];
      const status: StageBlockStepStatus =
        st === 'done' || st === 'in_progress' ? st : 'pending';
      const kind = typeof s['kind'] === 'string' ? normalizeKindKey(s['kind']) : undefined;
      const conf = s['confidence'];
      // ⑰(b) — JSON 으로 적어도 행 표식이 통한다(`parallel: true`). 문자열 `"true"` 는 받지 않는다 —
      //   느슨하게 받으면 `"false"` 가 참이 되는 자리가 함께 생긴다.
      const parallel = s['parallel'] === true;
      steps.push({
        text,
        status,
        ...(kind ? { kind } : {}),
        ...(conf === 'low' || conf === 'high' ? { confidence: conf } : {}),
        ...(parallel ? { parallel: true } : {}),
      });
    }
    if (steps.length > 0) out.steps = steps;
  }
  // 종류는 배열(`[{key,…}]`) 이나 맵(`{"shader":{…}}`) 둘 다 받는다.
  const rawKinds = o['kinds'] ?? o['kind'];
  const kinds: StageBlockKind[] = [];
  const pushKind = (key: string | undefined, v: unknown): void => {
    if (kinds.length >= STAGE_BLOCK_KINDS_MAX) return;
    if (!v || typeof v !== 'object') return;
    const k = v as Record<string, unknown>;
    const finalKey = normalizeKindKey(typeof k['key'] === 'string' ? k['key'] : (key ?? ''));
    if (!finalKey) return;
    const scene = Array.isArray(k['scene'])
      ? k['scene'].filter((p): p is string => typeof p === 'string')
      : typeof k['scene'] === 'string'
        ? [k['scene']]
        : undefined;
    kinds.push({
      key: finalKey,
      ...(typeof k['label'] === 'string' ? { label: k['label'] } : {}),
      ...(typeof k['color'] === 'string' ? { color: k['color'] } : {}),
      ...(typeof k['surface'] === 'string' ? { surface: k['surface'] } : {}),
      ...(typeof k['blurb'] === 'string' ? { blurb: k['blurb'] } : {}),
      ...(typeof k['glyph'] === 'string' ? { glyph: k['glyph'] } : {}),
      ...(scene && scene.length > 0 ? { scene } : {}),
      ...(typeof k['from'] === 'string' ? { from: k['from'] } : {}),
    });
  };
  if (Array.isArray(rawKinds)) {
    for (const v of rawKinds) pushKind(undefined, v);
  } else if (rawKinds && typeof rawKinds === 'object') {
    for (const [key, v] of Object.entries(rawKinds as Record<string, unknown>)) pushKind(key, v);
  }
  if (kinds.length > 0) out.kinds = kinds;

  return out.goal || out.note || out.percent !== undefined || out.steps || out.kinds ? out : null;
}

/**
 * ⑪(l) — 무대 블록 본문을 읽는다. 읽을 것이 하나도 없으면 `null`.
 *
 * **모르는 줄은 버리고 나머지는 살린다** — 글리프 검증(⑪(b))이 정한 규율 그대로다. 한 줄이 이상하다고
 * 신고 전체를 버리면, 모델은 무엇이 잘못됐는지 모른 채 매번 통째로 다시 쓰게 된다.
 */
export function parseStageBlockBody(body: string): StageBlockDirective | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    const json = parseJsonDirective(trimmed);
    if (json) return json;
    // JSON 처럼 시작했지만 깨진 것 — 줄 문법으로 한 번 더 읽어 본다(잘린 스트림에서 흔하다).
  }

  const out: StageBlockDirective = {};
  const steps: StageBlockStep[] = [];
  const kinds: StageBlockKind[] = [];
  let openKind: StageBlockKind | undefined;

  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\s+$/u, '');
    if (!line.trim()) continue;

    // ── 종류 카드 시작: `kind shader: Shader`
    const kindStart = /^\s*kind\s+([@A-Za-z0-9][A-Za-z0-9_.:-]{0,39})\s*(?::\s*(.*))?$/iu.exec(line);
    if (kindStart) {
      const key = normalizeKindKey(kindStart[1] ?? '');
      if (key && kinds.length < STAGE_BLOCK_KINDS_MAX) {
        const label = (kindStart[2] ?? '').trim();
        openKind = { key, ...(label ? { label } : {}) };
        kinds.push(openKind);
      } else {
        openKind = undefined;
      }
      continue;
    }

    // ── 단계: `- [x] 본문 @kind ?` (체크박스가 없는 홑 글머리도 pending 으로 받는다)
    //    ⑰(b) — 체크박스 뒤(본문 앞)의 `∥`/`||` 는 "앞 단계와 같은 행"이다. 머리에서만 읽는다 —
    //    꼬리 표식(`@kind`·`?`·`!`)과 자리가 다르니 본문 안의 `||`(셸 or 연산자 등)와 안 헷갈린다.
    const stepLine = /^\s*[-*+]\s+(?:\[([^\]]?)\]\s*)?(?:(∥|\|\|)\s*)?(.+)$/u.exec(line);
    if (stepLine) {
      const { text, kind, confidence } = stripStepMarkers(stepLine[3] ?? '');
      if (text && steps.length < STAGE_BLOCK_STEPS_MAX) {
        steps.push({
          text,
          status: statusOfMark(stepLine[1] ?? ' '),
          ...(kind ? { kind } : {}),
          ...(confidence ? { confidence } : {}),
          ...(stepLine[2] ? { parallel: true } : {}),
        });
      }
      // 단계 줄이 나오면 종류 블록은 끝난 것으로 본다(들여쓰기에 기대지 않는다).
      openKind = undefined;
      continue;
    }

    // ── `키: 값`
    const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/u.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').toLowerCase();
    const value = (kv[2] ?? '').trim();

    if ((KIND_ATTR_KEYS as readonly string[]).includes(key)) {
      // 종류 속성 — 열려 있는 카드에 붙인다. 열린 카드가 없으면 버린다(주인 없는 속성).
      if (!openKind) continue;
      const attr = key as KindAttrKey;
      if (attr === 'scene') {
        if (!value) continue;
        // `scene: @wave` 는 템플릿 지목이고, 그 밖은 path 한 줄이다(줄마다 하나씩 쌓인다).
        if (value.startsWith('@')) openKind.from = value.slice(1).trim();
        else (openKind.scene ??= []).push(value);
      } else if (value) {
        openKind[attr] = attr === 'from' ? value.replace(/^@/u, '') : value;
      }
      continue;
    }

    openKind = undefined;
    if (key === 'goal' && value) out.goal = value;
    else if (key === 'note' && value) out.note = value;
    else if ((key === 'percent' || key === 'progress') && value) {
      const n = Number.parseFloat(value.replace(/%/gu, ''));
      if (Number.isFinite(n)) out.percent = n;
    }
  }

  if (steps.length > 0) out.steps = steps;
  if (kinds.length > 0) out.kinds = kinds.filter((k) => k.label || k.glyph || k.scene || k.from || k.color || k.surface || k.blurb);
  if (out.kinds && out.kinds.length === 0) delete out.kinds;

  return out.goal || out.note || out.percent !== undefined || out.steps || out.kinds ? out : null;
}

/** ⑪(l) — 본문 한 덩어리에서 무대 블록을 읽어 지시로 바꾼다(닫힌 블록만). */
export function parseStageBlocks(markdown: string): { span: StageBlockSpan; directive: StageBlockDirective }[] {
  const out: { span: StageBlockSpan; directive: StageBlockDirective }[] = [];
  for (const span of extractStageBlocks(markdown)) {
    if (!span.closed) continue;
    const directive = parseStageBlockBody(span.body);
    if (directive) out.push({ span, directive });
  }
  return out;
}
