import { parseStreamPathCandidate, type StreamPathCandidate } from './streamPathLinks.js';

/**
 * §5.5 #17-27 ⑬ (l) — 카드 평문에서 경로 후보를 뽑는다(순수). 카드는 마크다운이 아니라 인라인 코드 경로(⑬ (a))를 지나지 않는다.
 * 모양은 후보일 뿐이다 — 손잡이가 되는지는 1차 체(`parseStreamPathCandidate`)와 디스크가 정한다((b)).
 */

export type CardTextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'path';
      readonly text: string;
      /** 글자 통째로 본 후보. 통째로는 경로 모양이 아니면 null. */
      readonly candidate: StreamPathCandidate | null;
      /** 끝에 조사가 붙어 있으면 뗀 경로. 통째로 디스크에 없을 때만 쓰인다 — 조사처럼 끝나는 실제 이름이 이긴다. */
      readonly core: { readonly text: string; readonly tail: string; readonly candidate: StreamPathCandidate } | null;
    };

/** 한 글에서 손잡이로 물어볼 후보 상한 — 붙여 넣은 로그가 디스크 문의를 끝없이 만들지 않게. 넘는 부분은 평문이다. */
const MAX_CARD_PATH_CANDIDATES = 64;

/** 묶인 조각(백틱·큰따옴표·낫표)은 안의 공백까지 한 덩어리, 그 밖은 공백·괄호·구두점에서 끊는다. `:` 는 드라이브·줄 표기라 끊지 않는다. */
const TOKEN = /`([^`\n]+)`|"([^"\n]+)"|「([^」\n]+)」|『([^』\n]+)』|([^\s`"'「」『』()[\]{}<>,;，、*|]+)/g;

/** 낱말 끝의 문장부호 — 경로의 일부가 아니다(`…/listen.` · `a.ts:`). */
const TRAILING_PUNCT = /[.:!?…·。！？]+$/;

/** 경로 뒤에 바로 붙는 조사. 끝에 고정돼 있어 왼쪽부터 찾으면 긴 것(`에서`)이 짧은 것(`서`)보다 먼저 걸린다. */
const PARTICLE_TAIL = /(?:으로부터|에서부터|에서는|에서도|으로는|으로도|으로|에서|에게|까지|부터|에는|에도|에만|이나|와|과|은|는|이|가|을|를|의|에|로|도|만|엔)$/;

function particleCore(body: string, rootPath: string): { text: string; tail: string; candidate: StreamPathCandidate } | null {
  const m = PARTICLE_TAIL.exec(body);
  if (!m || m.index === 0) return null;
  const text = body.slice(0, m.index);
  const candidate = parseStreamPathCandidate(text, rootPath);
  return candidate ? { text, tail: m[0], candidate } : null;
}

/** 글 한 토막을 평문과 경로 후보로 쪼갠다. 이어 붙이면 원문 그대로다 — 후보가 아닌 글자는 한 글자도 바뀌지 않는다. */
export function splitCardTextPaths(text: string, rootPath: string | null): CardTextSegment[] {
  if (!rootPath) return [{ kind: 'text', text }];

  const segments: CardTextSegment[] = [];
  let cursor = 0;
  let found = 0;

  for (const match of text.matchAll(TOKEN)) {
    if (found >= MAX_CARD_PATH_CANDIDATES) break;
    const quoted = match[1] ?? match[2] ?? match[3] ?? match[4];
    const body = quoted ?? (match[5] ?? '').replace(TRAILING_PUNCT, '');
    if (!body) continue;

    const candidate = parseStreamPathCandidate(body, rootPath);
    // 묶인 조각은 글쓴이가 끝을 정했다 — 조사를 떼지 않는다.
    const core = quoted === undefined ? particleCore(body, rootPath) : null;
    if (!candidate && !core) continue;

    const start = match.index + (quoted === undefined ? 0 : 1);
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'path', text: body, candidate, core });
    cursor = start + body.length;
    found += 1;
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}
