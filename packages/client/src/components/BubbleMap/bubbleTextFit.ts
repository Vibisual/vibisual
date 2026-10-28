/**
 * §2.4 버블 타이포 오토핏 — 원 안 글자가 서로 밟지 않게 하는 순수 기하. 하단 예약 높이를 그릴 줄에서 낸다(고정값이면 줄이 늘 때 겹친다).
 * 안 들어가면 사다리: ① gap `4→2→1→0`·ts ② 같은 `mergeGroup` 줄 병합 ③ 라벨 1줄 + 가운데 줄임(모델 파일명은 꼬리에 정체)
 * ④ 낮은 우선순위 줄 접기(`foldedText` → 툴팁) ⑤ 배지 숨김. 가로는 원의 현(chord)으로 — 고정 비율이면 맨 아랫줄이 원 밖으로 나간다.
 * ⚠ DOM 측정 ❌(리플로 × 버블 수) — 글자 폭 표로 추정하고 시험으로 고정. 최종 안전망은 CSS `truncate`·`line-clamp`.
 */

/** 하단 줄의 행 높이 배수 — 렌더에서 인라인 `lineHeight` 로 같은 값을 주어 계산과 실제를 맞춘다. */
export const BUBBLE_LINE_HEIGHT = 1.5;

/** 라벨의 행 높이 배수 — Tailwind `leading-tight`. */
export const BUBBLE_LABEL_LINE_HEIGHT = 1.25;

/** 하단 줄이 원 안에서 차지할 수 있는 가로 상한(지름 대비) — 현(chord)보다 좁을 때만 이 값이 쓰인다. */
const BOTTOM_WIDTH_CAP_RATIO = 0.86;

/** 하단 줄 가로의 바닥(지름 대비) — 원이 아무리 좁아지는 높이라도 줄을 통째로 없애지 않는다. */
const BOTTOM_WIDTH_FLOOR_RATIO = 0.3;

/** 현을 잴 때 빼는 좌우 여유(px) — 테두리·글리프 여백. */
const CHORD_SAFETY_INSET = 2;

/** 현 계산에 쓰는 가장자리 여유(px) — 테두리·안티에일리어싱이 먹는 만큼. */
const EDGE_INSET_MIN = 2;

/** 병합 요약에 쓰는 구분자. */
const MERGE_SEPARATOR = ' · ';

/** 가운데 줄임 표식. */
const ELLIPSIS = '…';

/** 하단 블록의 한 줄. */
export interface BubbleBottomLine {
  /** React key + 접기/병합 판정용 식별자. */
  key: string;
  /** 표시 문자열. */
  text: string;
  /** 이미 `ts` 가 반영된 px. */
  fontSize: number;
  /** 색·굵기 클래스 — 오토핏은 크기만 다루고 톤 체계는 건드리지 않는다. */
  cls: string;
  /** 클수록 중요 — 접을 때 작은 것부터 사라진다. */
  priority: number;
  /** 같은 그룹끼리는 한 줄로 병합될 수 있다(없으면 병합 대상 아님). */
  mergeGroup?: string;
  /** hover 툴팁(줄 자체가 잘릴 수 있는 경우 원문). */
  title?: string;
  /** 칩처럼 세로 padding 이 붙는 줄의 추가 높이(px) — 예약에 함께 더한다. */
  extraHeight?: number;
  /** `middle` = 꼬리를 살려 가운데를 줄인다(모델 파일명). 없으면 CSS `truncate`. */
  summarize?: 'middle';
}

/** 중앙 열에 라벨·배지 말고 더 얹히는 줄(마지막 도구, 카드 수 등). */
export interface BubbleCenterExtra {
  fontSize: number;
  /** 기본 `BUBBLE_LINE_HEIGHT`. */
  lineHeight?: number;
}

export interface BubbleFitInput {
  /** 버블 지름(px). */
  size: number;
  /** 텍스트 스케일(`size / BUBBLE_TEXT_REF_SIZE`). */
  ts: number;
  /** 테두리 두께(px). */
  borderWidth: number;
  /** 아이콘 변 길이(px). */
  iconPx: number;
  /** 라벨 원문. */
  label: string;
  labelFontSize: number;
  /** 라벨이 최대 몇 줄까지 허용되는가(에이전트 2, 그 외 1). */
  labelMaxLines: number;
  /** 라벨 가로 상한(지름 대비). */
  labelWidthRatio: number;
  /** 배지(없으면 null). */
  badge: { text: string; fontSize: number } | null;
  /** 중앙 열 추가 줄. */
  centerExtras?: BubbleCenterExtra[];
  /** 하단 블록 줄들(위→아래 순서). */
  bottomLines: BubbleBottomLine[];
  /** 하단 블록의 바닥 여백(px). */
  bottomOffset: number;
}

export interface BubbleFitPlan {
  /** 바디에 예약할 하단 높이(px) — 이 값이 실제 하단 블록보다 작으면 겹친다. */
  paddingBottom: number;
  /** 실제로 그릴 하단 줄들(병합·접기 적용 후). */
  bottomLines: BubbleBottomLine[];
  /** `bottomLines` 와 같은 순서의 가로 상한(px) — 그 높이에서의 현 길이. */
  bottomMaxWidths: number[];
  /** 라벨 최종 텍스트(필요하면 가운데 줄임). */
  labelText: string;
  /** 라벨 줄 수(1 또는 `labelMaxLines`). */
  labelLines: number;
  /** 라벨 가로 상한(px). */
  labelMaxWidth: number;
  /** 중앙 열 gap(px). */
  centerGap: number;
  /** 마지막 안전망 — 극단(아주 작은 버블)에서 중앙 열이 예약 영역을 밟지 않게 `maxHeight` 로 자른다(겹치면 둘 다 못 읽는다). 들어가면 효과 없음. */
  centerMaxHeight: number;
  /** 배지를 그릴지. */
  showBadge: boolean;
  /** 접힌 줄의 원문(툴팁용, 없으면 ''). */
  foldedText: string;
  /** 사다리를 몇 칸 내려갔는가 — 0 = 손대지 않음(테스트·디버그용). */
  step: number;
}

/* ------------------------------------------------------------------ *
 * 글자 폭 추정 — DOM 없이, 문자 부류별 평균 폭(em)으로.
 * ------------------------------------------------------------------ */

/** 한글·한자·가나는 라틴의 두 배 가까이 넓다 — 무시하면 짧은 한글 줄을 안전하다고 오판한다. */
function charWidthUnits(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  // CJK(한글 음절·한자·가나) + 전각 — 사실상 정사각형.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  if (ch === ' ') return 0.28;
  if ('iljtIfr.,:;\'"`|!()[]{}/\\-'.includes(ch)) return 0.32;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch === ELLIPSIS) return 1;
  if (ch === 'm' || ch === 'w' || ch === 'M' || ch === 'W') return 0.85;
  return 0.53;
}

/** 문자열의 렌더 폭 추정(px). */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += charWidthUnits(ch);
  return units * fontSize;
}

/* ------------------------------------------------------------------ *
 * 원 기하
 * ------------------------------------------------------------------ */

/** 중심에서 `dyFromCenter` 떨어진 높이의 현 길이 = 그 높이에서 쓸 수 있는 최대 가로. */
export function chordWidthAt(size: number, dyFromCenter: number, inset = 0): number {
  const r = Math.max(0, size / 2 - inset);
  const dy = Math.min(Math.abs(dyFromCenter), r);
  return 2 * Math.sqrt(Math.max(0, r * r - dy * dy));
}

/** 꼬리를 살린다 — 양자화 표기가 정체의 절반이라 보통 말줄임은 서로 다른 모델을 같은 이름으로 만든다. */
export function summarizeMiddle(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0 || fontSize <= 0) return text;
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;

  const chars = Array.from(text);
  // 말줄임표조차 못 넣을 폭이면 앞에서부터 넣을 수 있는 만큼만.
  const ellipsisWidth = estimateTextWidth(ELLIPSIS, fontSize);
  if (ellipsisWidth > maxWidth) {
    let acc = '';
    let w = 0;
    for (const ch of chars) {
      const cw = charWidthUnits(ch) * fontSize;
      if (w + cw > maxWidth) break;
      acc += ch;
      w += cw;
    }
    return acc;
  }

  // 앞 6 : 뒤 4 비율로 남긴다 — 사람은 앞을 보고 찾고, 꼬리를 보고 구분한다.
  let head = chars.length;
  let tail = 0;
  let best = ELLIPSIS;
  for (let keep = chars.length - 1; keep >= 1; keep--) {
    tail = Math.max(1, Math.round(keep * 0.4));
    head = keep - tail;
    if (head < 1) {
      head = 1;
      tail = keep - 1;
    }
    const candidate = chars.slice(0, head).join('') + ELLIPSIS + (tail > 0 ? chars.slice(chars.length - tail).join('') : '');
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      best = candidate;
      break;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 사다리
 * ------------------------------------------------------------------ */

/** 하단 블록의 실제 높이(px) — 줄마다 `fontSize × 행높이` 를 더한다. */
export function bottomBlockHeight(lines: BubbleBottomLine[]): number {
  return lines.reduce((h, l) => h + l.fontSize * BUBBLE_LINE_HEIGHT + (l.extraHeight ?? 0), 0);
}

/** 겹침을 막는 유일한 값 — 하단 블록은 `absolute` 라 padding 에 밀리지 않으므로 같은 높이를 padding 으로 돌려준다. */
export function reserveBottomHeight(lines: BubbleBottomLine[], bottomOffset: number): number {
  if (lines.length === 0) return 0;
  return Math.ceil(bottomOffset + bottomBlockHeight(lines) + 2);
}

/** 같은 `mergeGroup` 인 이웃 줄을 한 줄로 합친다(줄 수를 줄이되 내용은 남긴다). */
function mergeLines(lines: BubbleBottomLine[]): BubbleBottomLine[] {
  const out: BubbleBottomLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && line.mergeGroup && prev.mergeGroup === line.mergeGroup) {
      out[out.length - 1] = {
        ...prev,
        key: `${prev.key}+${line.key}`,
        text: `${prev.text}${MERGE_SEPARATOR}${line.text}`,
        // 합친 줄은 둘 중 큰 글자에 맞춘다 — 작은 쪽에 맞추면 원래 크던 정보가 작아진다.
        fontSize: Math.max(prev.fontSize, line.fontSize),
        priority: Math.max(prev.priority, line.priority),
        title: prev.title ?? line.title,
      };
      continue;
    }
    out.push(line);
  }
  return out;
}

/** 중앙 열이 차지하는 높이. */
function centerHeight(input: BubbleFitInput, gap: number, labelLines: number, showBadge: boolean): number {
  const extras = input.centerExtras ?? [];
  let h = input.iconPx;
  h += gap + labelLines * input.labelFontSize * BUBBLE_LABEL_LINE_HEIGHT;
  if (showBadge && input.badge) h += gap + input.badge.fontSize * BUBBLE_LINE_HEIGHT;
  for (const e of extras) h += gap + e.fontSize * (e.lineHeight ?? BUBBLE_LINE_HEIGHT);
  return h;
}

/** 예약이 실제 높이에서 나오므로 결과를 그대로 꽂으면 어떤 줄 수·크기에서도 겹치지 않는다. */
export function planBubbleText(input: BubbleFitInput): BubbleFitPlan {
  const { size, ts, borderWidth, bottomOffset } = input;
  const edgeInset = Math.max(EDGE_INSET_MIN, Math.round(2 * ts)) + borderWidth;
  // 원 안에서 세로로 쓸 수 있는 높이 — 지름에서 위아래 가장자리 여유를 뺀다.
  const budget = Math.max(0, size - 2 * edgeInset);

  const gapLadder = [Math.round(4 * ts), Math.round(2 * ts), Math.round(1 * ts), 0];

  let gap = gapLadder[0] ?? 0;
  let lines = input.bottomLines.slice();
  let labelLines = Math.max(1, input.labelMaxLines);
  let showBadge = Boolean(input.badge);
  const folded: BubbleBottomLine[] = [];
  let step = 0;

  const fits = () =>
    centerHeight(input, gap, labelLines, showBadge) + reserveBottomHeight(lines, bottomOffset) <= budget;

  // 사다리 — 위에서부터 한 칸씩 내려가며 들어갈 때까지.
  const rungs: (() => boolean)[] = [
    // 1~3. 간격 밀기(정보 손실 0).
    () => nextGap(1),
    () => nextGap(2),
    () => nextGap(3),
    // 4. 줄 병합 요약.
    () => {
      const merged = mergeLines(lines);
      if (merged.length === lines.length) return false;
      lines = merged;
      return true;
    },
    // 5. 라벨 2줄 → 1줄.
    () => {
      if (labelLines <= 1) return false;
      labelLines = 1;
      return true;
    },
    // 6. 배지 숨김.
    () => {
      if (!showBadge) return false;
      showBadge = false;
      return true;
    },
  ];

  function nextGap(index: number): boolean {
    const next = gapLadder[index];
    if (next === undefined || next >= gap) return false;
    gap = next;
    return true;
  }

  for (const rung of rungs) {
    if (fits()) break;
    if (rung()) step += 1;
  }

  // 7. 그래도 넘치면 낮은 우선순위 줄부터 접는다(최소 1줄은 남긴다).
  while (!fits() && lines.length > 1) {
    let weakest = 0;
    for (let i = 1; i < lines.length; i++) {
      if ((lines[i]?.priority ?? 0) < (lines[weakest]?.priority ?? 0)) weakest = i;
    }
    const dropped = lines[weakest];
    if (dropped) folded.push(dropped);
    lines = lines.filter((_, i) => i !== weakest);
    step += 1;
  }

  // 현은 글자 상자 세로 가운데에서 잰다 — 아래 모서리로 재면 맨 아랫줄이 0 이 돼 사라진다. 바닥값은 안전하다(바디가 `overflow-hidden rounded-full` 이라 어차피 잘린다).
  const heights = lines.map((l) => l.fontSize * BUBBLE_LINE_HEIGHT + (l.extraHeight ?? 0));
  const widthCap = size * BOTTOM_WIDTH_CAP_RATIO;
  const widthFloor = Math.max(16, size * BOTTOM_WIDTH_FLOOR_RATIO);
  const r = size / 2;
  const bottomMaxWidths = lines.map((_, i) => {
    let below = 0;
    for (let j = i + 1; j < lines.length; j++) below += heights[j] ?? 0;
    const centerFromBottom = bottomOffset + below + (heights[i] ?? 0) / 2;
    const chord = chordWidthAt(size, r - centerFromBottom, CHORD_SAFETY_INSET);
    return Math.round(Math.max(widthFloor, Math.min(widthCap, chord)));
  });

  // 넘치는 줄 요약 — `summarize: 'middle'` 인 줄만. 원문은 툴팁으로 남긴다(정보 손실 ❌).
  //   높이는 글자 수와 무관(폰트 크기로만 정해진다)이라 위에서 잡은 예약이 그대로 유효하다.
  const fittedLines = lines.map((line, i) => {
    if (line.summarize !== 'middle') return line;
    const shortened = summarizeMiddle(line.text, bottomMaxWidths[i] ?? 0, line.fontSize);
    return shortened === line.text ? line : { ...line, text: shortened, title: line.title ?? line.text };
  });

  // 라벨 — 원의 중앙 근처라 현이 거의 지름이므로 기존 비율 상한을 그대로 쓴다.
  const labelMaxWidth = Math.round(size * input.labelWidthRatio);
  const labelBudget = labelMaxWidth * labelLines;
  const labelWidth = estimateTextWidth(input.label, input.labelFontSize);
  // CSS 줄바꿈은 단어 경계에서 여유를 남기므로, 확실히 넘칠 때만(5% 초과) 손을 댄다 —
  // 추정만 믿고 자르면 멀쩡히 들어가던 이름이 줄어든다.
  const labelText =
    labelWidth > labelBudget * 1.05
      ? summarizeMiddle(input.label, labelBudget * 0.98, input.labelFontSize)
      : input.label;

  const paddingBottom = reserveBottomHeight(lines, bottomOffset);

  return {
    paddingBottom,
    centerMaxHeight: Math.max(0, Math.floor(budget - paddingBottom)),
    bottomLines: fittedLines,
    bottomMaxWidths,
    labelText,
    labelLines,
    labelMaxWidth,
    centerGap: Math.max(0, gap),
    showBadge,
    foldedText: folded.map((l) => l.text).join(MERGE_SEPARATOR),
    step,
  };
}
