/**
 * §5.13 (T-1) — 컴포지션의 자기 선언 읽기 (순수).
 *
 * 컴포지션은 `<head>` 의 meta 셋으로 자기를 말한다.
 *   `<meta name="vibi:duration" content="6">`      — 길이(초). `duration:'auto'` 가 이 값으로 풀린다.
 *   `<meta name="vibi:size" content="1920x1080">`  — 그리도록 짠 픽셀 크기(없으면 문서 판형).
 *   `<meta name="vibi:libs" content="a, b">`       — 쓰는 라이브러리 이름(T-6, 이름만 읽어 둔다).
 *
 * 브라우저 없이 문자열로 읽는다 — 서버 탐침이 창을 띄우지 않고 이 값을 채우게 하기 위해서다. 정규식으로 meta 태그만
 * 집어내며, 속성 순서·따옴표 종류(큰/작은)·대소문자에 관대하다.
 */

import type { CompositionPropDecl, CompositionPropType } from '../types.js';

export interface CompositionDeclared {
  /** 초. 없거나 0 이하면 비운다. */
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly libs?: readonly string[];
  /** §5.13 (V) 37-15 — `<meta name="vibi:responsive" content="true">` — 선언 크기 대신 아이템 상자 크기로 짠다. */
  readonly responsive?: boolean;
}

/** 태그 하나의 속성 값(따옴표 없는 값도 받는다). */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

/** `1920x1080`·`1920×1080`·`1920 x 1080` → 크기. 못 읽으면 null. */
export function parseCompositionSize(raw: string): { width: number; height: number } | null {
  const m = /^\s*(\d{1,5})\s*[x×X*]\s*(\d{1,5})\s*$/.exec(raw);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!(width > 0 && height > 0)) return null;
  return { width, height };
}

export function parseCompositionMeta(html: string): CompositionDeclared {
  const out: { duration?: number; width?: number; height?: number; libs?: string[]; responsive?: boolean } = {};
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = attr(tag, 'name')?.toLowerCase();
    const content = attr(tag, 'content');
    if (!name || content === null) continue;
    if (name === 'vibi:duration') {
      const n = Number(content);
      if (Number.isFinite(n) && n > 0) out.duration = n;
    } else if (name === 'vibi:size') {
      const size = parseCompositionSize(content);
      if (size) {
        out.width = size.width;
        out.height = size.height;
      }
    } else if (name === 'vibi:libs') {
      const libs = content.split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (libs.length > 0) out.libs = libs;
    } else if (name === 'vibi:responsive') {
      if (/^(?:true|1|yes)$/i.test(content.trim())) out.responsive = true;
    }
  }
  return out;
}

// ─── §5.13 (V) 37-5 값 선언 ───

const PROP_TYPES: readonly CompositionPropType[] = ['text', 'number', 'color', 'font', 'image', 'time', 'choice'];
/** 값 이름 — `props` 열쇠이자 `--vibi-prop-<이름>` CSS 변수 이름이라 글자를 좁힌다. */
const PROP_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** 한 컴포지션이 선언하는 값 수 상한(화면이 그릴 수 있는 만큼). */
const PROPS_DECL_MAX = 64;

export interface PropsDeclParse {
  /** 선언 `<script>` 가 있었나. */
  readonly found: boolean;
  /** 읽은 선언(순서 보존). 틀린 항목은 빠진다. */
  readonly decl: readonly CompositionPropDecl[];
  /** 틀린 곳(영문 — 에이전트가 읽는다). 없으면 빈 배열. */
  readonly errors: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * `<script type="application/json" id="vibi-props">{ "<이름>": { "type": …, "default": …, … } }</script>` 를 읽는다.
 * 속성 순서·따옴표에 관대하다(meta 와 같은 규칙). 사람이 바꿀 만한 값을 코드 밖으로 꺼낸 선언이다 — 스튜디오가 종류별 손잡이를
 * 그리고, 값은 아이템 `props[name]` 에 산다.
 */
export function parsePropsDecl(html: string): PropsDeclParse {
  let body: string | null = null;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = `<script${m[1] ?? ''}>`;
    if ((attr(tag, 'id') ?? '') !== 'vibi-props') continue;
    body = m[2] ?? '';
    break;
  }
  if (body === null) return { found: false, decl: [], errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return { found: true, decl: [], errors: [`vibi-props is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!isRecord(parsed)) return { found: true, decl: [], errors: ['vibi-props must be a JSON object { "<name>": { "type": … } }.'] };
  const decl: CompositionPropDecl[] = [];
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(parsed)) {
    if (decl.length >= PROPS_DECL_MAX) { errors.push(`Only the first ${PROPS_DECL_MAX} props are read.`); break; }
    if (!PROP_NAME.test(name)) { errors.push(`Prop name "${name}" must match [A-Za-z_][A-Za-z0-9_-]*.`); continue; }
    if (!isRecord(raw)) { errors.push(`Prop "${name}" must be an object with a "type".`); continue; }
    const type = raw['type'];
    if (typeof type !== 'string' || !PROP_TYPES.includes(type as CompositionPropType)) {
      errors.push(`Prop "${name}" has an unknown type "${String(type)}" (use ${PROP_TYPES.join('|')}).`);
      continue;
    }
    const num = (k: string): number | undefined => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : undefined);
    const str = (k: string, max: number): string | undefined => (typeof raw[k] === 'string' && (raw[k] as string).trim() !== '' ? (raw[k] as string).slice(0, max) : undefined);
    const dflt = raw['default'];
    const options = Array.isArray(raw['options']) ? (raw['options'] as unknown[]).filter((o): o is string => typeof o === 'string').slice(0, 24) : undefined;
    if (type === 'choice' && (!options || options.length === 0)) { errors.push(`Prop "${name}" (choice) needs "options": [ … ].`); continue; }
    const min = num('min');
    const max = num('max');
    const step = num('step');
    const label = str('label', 80);
    const description = str('description', 300);
    decl.push({
      name,
      type: type as CompositionPropType,
      ...(typeof dflt === 'string' || (typeof dflt === 'number' && Number.isFinite(dflt)) ? { default: dflt } : {}),
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined && step > 0 ? { step } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(raw['multiline'] === true ? { multiline: true } : {}),
    });
  }
  return { found: true, decl, errors };
}

/**
 * 문서 안의 **로컬** 스크립트·스타일 참조(`<script src>`·`<link rel=stylesheet href>`) — 결정성 검사가 함께 훑을 파일들.
 * 바깥 주소(`http:`·`https:`·`//`)·`data:` 는 돌려주지 않는다(그것은 검사가 따로 오류로 잡는다).
 */
export function localReferences(html: string): string[] {
  const refs: string[] = [];
  const push = (raw: string | null): void => {
    if (!raw) return;
    const v = raw.trim();
    if (v === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v)) return;
    refs.push(v.split(/[?#]/)[0] ?? v);
  };
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) push(attr(tag, 'src'));
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? '';
    if (rel.includes('stylesheet') || rel.includes('modulepreload') || rel.includes('preload')) push(attr(tag, 'href'));
  }
  return refs;
}
