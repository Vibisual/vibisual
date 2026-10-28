/**
 * §5.13 (V) 37-12 — 단어 강조 자막(순수, 캔버스·DOM 무대 공용): `props.highlight: 'word'` 면 지금 낱말을 강조색으로.
 * 낱말 시각은 큐 `words`(문서 시각), 없으면 공백 뺀 글자 수 비례로 추정하고 `estimated` 로 알린다(인스펙터가 적는다).
 */

import type { CaptionCue } from '../types.js';

export interface CaptionWordSpan {
  readonly text: string;
  /** 지금 말하는 낱말. */
  readonly active: boolean;
  /** 이미 지나간 낱말. */
  readonly spoken: boolean;
}

export interface CaptionWordLayout {
  readonly words: CaptionWordSpan[];
  readonly estimated: boolean;
}

/** 낱말 나누기 — 공백 기준. 공백 없는 긴 글(한자·가나)은 두 글자씩 나눠 강조가 한 덩어리로 멈추지 않게. */
export function splitCaptionWords(text: string): string[] {
  const parts = text.split(/\s+/).filter((w) => w.length > 0);
  if (parts.length === 1 && (parts[0]?.length ?? 0) > 6 && /[぀-ヿ㐀-鿿]/.test(parts[0] ?? '')) {
    const only = parts[0] ?? '';
    const out: string[] = [];
    for (let i = 0; i < only.length; i += 2) out.push(only.slice(i, i + 2));
    return out;
  }
  return parts;
}

/** 큐 하나를 문서 시각 `t` 에서 낱말로 펼친다. */
export function captionWordSpans(cue: CaptionCue, t: number): CaptionWordLayout {
  const timed = (cue.words ?? []).filter((w) => w.text.trim() !== '' && Number.isFinite(w.t));
  if (timed.length > 0) {
    const sorted = [...timed].sort((a, b) => a.t - b.t);
    let active = -1;
    for (let i = 0; i < sorted.length; i += 1) if ((sorted[i]?.t ?? Infinity) <= t) active = i;
    if (t >= cue.end) active = -1;
    return {
      words: sorted.map((w, i) => ({ text: w.text.trim(), active: i === active, spoken: active >= 0 && i < active })),
      estimated: false,
    };
  }
  const words = splitCaptionWords(cue.text);
  const total = words.reduce((sum, w) => sum + w.length, 0);
  const span = Math.max(0, cue.end - cue.start);
  let acc = 0;
  let active = -1;
  if (total > 0 && span > 0 && t >= cue.start && t < cue.end) {
    for (let i = 0; i < words.length; i += 1) {
      const startAt = cue.start + (acc / total) * span;
      if (t >= startAt) active = i;
      acc += words[i]?.length ?? 0;
    }
  }
  return {
    words: words.map((w, i) => ({ text: w, active: i === active, spoken: active >= 0 && i < active })),
    estimated: true,
  };
}

/** 자막 아이템이 단어 강조를 켰는가. */
export function wantsWordHighlight(props: Readonly<Record<string, unknown>> | undefined): boolean {
  return props?.['highlight'] === 'word';
}
