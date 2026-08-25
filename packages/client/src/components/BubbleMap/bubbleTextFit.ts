/**
 * §2.4 **버블 타이포 오토핏** — 원 안의 글자가 서로 밟지 않게 하는 순수 기하 모듈.
 *
 * 종전 규칙은 "하단 블록 높이만큼 바디에 `paddingBottom` 을 예약한다"였지만 그 예약값이
 * **고정 3줄치**(`6+9+8+7+6`·ts)로 굳어 있었다. 하단 블록은 상황에 따라 1~5줄(모델명 ·
 * 컨텍스트 · 잠듦/대기 · 토큰 합산)까지 자라므로, 4줄이 되는 순간 중앙 열의 배지·라벨이
 * 모델명 줄 위에 그대로 얹혔다(`All Model` 배지가 `Qwen3.8-27B-UD-Q4_K_M` 을 덮은 신고).
 *
 * 그래서 높이를 **그릴 줄에서 계산**한다. 값 하나를 키우는 땜질은 다음 줄이 늘어나면 또
 * 깨지지만, 줄에서 높이를 얻으면 몇 줄이 되든 깨질 수 없다.
 *
 * 그러고도 원 안에 다 안 들어가면 **축약 사다리**를 순서대로 내려간다:
 *
 *  1. **간격 밀기** — 중앙 열 gap `4 → 2 → 1 → 0`·ts. 가장 싸고 정보 손실이 없다.
 *  2. **줄 병합 요약** — 성격이 같은 하단 줄(`mergeGroup`)을 가운뎃점으로 한 줄에 합친다
 *     (`15K/16K` + `대기` → `15K/16K · 대기`). 줄 수가 줄어도 읽을 내용은 그대로 남는다.
 *  3. **라벨 2줄 → 1줄 + 가운데 줄임** — 꼬리를 살려 자른다(`Qwen3.8-27B…Q4_K_M`).
 *     모델 파일명은 **꼬리에 정체가 있다**(양자화 표기) — 뒤를 버리면 무엇인지 알 수 없다.
 *  4. **최하 우선순위 줄 접기** — 그래도 안 되면 덜 중요한 줄부터 접는다. 접힌 내용은
 *     `foldedText` 로 돌려주므로 호출부가 툴팁에 남긴다(정보를 지우지 않는다).
 *  5. **배지 숨김** — 마지막 수단. 배지 글자는 버블 색·아이콘이 이미 말하고 있다.
 *
 * 가로도 원의 **현(chord)** 으로 잡는다. 원 안에서는 중심에서 멀어질수록 쓸 수 있는 가로가
 * 좁아지는데 종전 하단 줄은 `size × 0.82` 고정이라 맨 아랫줄이 원 밖으로 삐져나갔다.
 *
 * ⚠ **DOM 측정을 쓰지 않는다.** `getBoundingClientRect` 는 리플로를 부르고 화면의 버블 수만큼
 * 곱해진다. 대신 글자 폭을 표로 추정하는 순수 함수로 계산하고 단위 테스트로 고정한다
 * (`bubbleTextFit.test.ts`). 최종 안전망은 그대로 CSS(`truncate` · `line-clamp`)가 맡는다.
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
  /**
   * 넘칠 때 줄이는 방식. `middle` 이면 **꼬리를 살려** 가운데를 줄인다(모델 파일명처럼 뒤에
   * 정체가 있는 줄). 지정하지 않으면 CSS `truncate`(꼬리 자르기)에 맡긴다.
   */
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
  /**
   * 중앙 열이 쓸 수 있는 세로 최대(px) — **마지막 안전망**.
   * `overflow-hidden` 은 padding box 에서 자르므로, 사다리를 다 내려가고도 안 들어가는 극단
   * (아주 작은 버블)에서는 중앙 열이 예약 영역으로 흘러들어 하단 블록을 다시 밟는다. 이 값을
   * `maxHeight` 로 씌우면 그때 **겹치는 대신 잘린다** — 겹친 글자는 둘 다 못 읽지만 잘린 글자는
   * 남은 부분이라도 읽힌다. 들어가는 경우엔 `centerHeight ≤ 이 값` 이라 아무 효과가 없다.
   */
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

/**
 * 문자 하나의 폭(em 단위 근사).
 *
 * 한글·한자·가나는 라틴의 두 배 가까이 넓다. 여기서 이 차이를 무시하면 `대기` 같은 짧은 한글
 * 줄을 안전하다고 오판한다.
 */
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

/**
 * 지름 `size` 인 원에서, 중심으로부터 세로 `dyFromCenter` 떨어진 높이의 **현(chord) 길이**.
 * 원 안에 글자를 놓을 때 그 높이에서 쓸 수 있는 최대 가로다.
 */
export function chordWidthAt(size: number, dyFromCenter: number, inset = 0): number {
  const r = Math.max(0, size / 2 - inset);
  const dy = Math.min(Math.abs(dyFromCenter), r);
  return 2 * Math.sqrt(Math.max(0, r * r - dy * dy));
}

/**
 * 가운데를 줄여 폭 안에 넣는다 — **꼬리를 살린다**.
 *
 * 모델 파일명(`Qwen3.8-27B-UD-Q4_K_M`)은 꼬리의 양자화 표기가 정체의 절반이라, 뒤를 버리는
 * 보통의 말줄임(`truncate`)은 서로 다른 모델을 같은 이름으로 보이게 만든다.
 */
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

/**
 * 바디에 예약할 하단 높이 — **이것이 겹침을 막는 유일한 값**이다.
 * 하단 블록은 `absolute` 라 padding 에 밀리지 않으므로, 중앙 열이 그 위에서만 중앙정렬되도록
 * 같은 높이를 padding 으로 되돌려 준다.
 */
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

/**
 * 버블 하나의 글자 배치를 정한다.
 *
 * 반환값만 그대로 렌더에 꽂으면 **어떤 줄 수·어떤 버블 크기에서도** 하단 블록과 중앙 열이
 * 겹치지 않는다(예약이 실제 높이에서 나오므로).
 */
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

  // 하단 줄 가로 — **글자 상자의 세로 한가운데** 높이에서의 현.
  //   줄의 아래 모서리로 재면 원의 맨 밑을 스치는 값이 나와(맨 아랫줄에서 0) 멀쩡한 줄이 통째로
  //   사라진다. 글리프는 행 상자 가운데에 앉으므로 가운데가 실제에 맞다.
  //   바닥값을 두는 것은 안전하다 — 바디가 `overflow-hidden rounded-full` 이라 원 밖은 어차피
  //   잘리고, 여기서 0 을 주면 잘리는 게 아니라 아무것도 안 보인다.
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
