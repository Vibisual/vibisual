import { describe, it, expect } from 'vitest';
import {
  planBubbleText,
  reserveBottomHeight,
  bottomBlockHeight,
  chordWidthAt,
  estimateTextWidth,
  summarizeMiddle,
  BUBBLE_LINE_HEIGHT,
  type BubbleBottomLine,
  type BubbleFitInput,
} from './bubbleTextFit.js';

/**
 * §2.4 **버블 타이포 오토핏** 회귀 시험.
 *
 * 겹침은 눈으로만 잡히는 결함이라 한 번 고쳐도 다음 줄이 늘면 조용히 되돌아온다. 그래서
 * "예약 ≥ 실제 하단 높이" 라는 **불변식**을 여기 못 박는다 — 이게 깨지면 화면에서 글자가
 * 서로 밟는다는 뜻이고, 시험이 먼저 운다.
 *
 * 폰트 크기 식은 `BubbleNode` 의 것을 그대로 옮겨 적는다(그쪽이 바뀌면 이쪽도 같이 바꿔야
 * 실제와 시험이 어긋나지 않는다).
 */

/** BubbleNode 와 같은 스케일. */
const REF_SIZE = 150;

function scaled(size: number) {
  const ts = size / REF_SIZE;
  return { ts, px: (n: number, floor: number) => Math.max(floor, Math.round(n * ts)) };
}

/** 사용자 신고 그대로의 조합 — 로컬(All Model) 버블: 모델명 · 컨텍스트 · 대기 · 토큰 4줄 + 배지. */
function reportedCaseLines(size: number): BubbleBottomLine[] {
  const { px } = scaled(size);
  return [
    { key: 'model', text: 'Qwen3.8-27B-UD-Q4_K_M', fontSize: px(9, 5), cls: '', priority: 100 },
    { key: 'context', text: '15K/16K', fontSize: px(8, 5), cls: '', priority: 80, mergeGroup: 'status' },
    { key: 'idle', text: '대기', fontSize: px(8, 5), cls: '', priority: 60, mergeGroup: 'status' },
    { key: 'tokens', text: '227K+5K', fontSize: px(7, 5), cls: '', priority: 40 },
  ];
}

function inputFor(size: number, lines: BubbleBottomLine[], label = 'ornith-1.0-9b-Q4_K_M #2'): BubbleFitInput {
  const { ts } = scaled(size);
  return {
    size,
    ts,
    borderWidth: 2,
    iconPx: Math.max(12, Math.round(32 * ts)),
    label,
    labelFontSize: Math.max(7, Math.round(13 * ts)),
    labelMaxLines: 2,
    labelWidthRatio: 0.7,
    badge: { text: 'All Model', fontSize: Math.max(5, Math.round(8 * ts)) },
    bottomLines: lines,
    bottomOffset: Math.max(3, Math.round(6 * ts)),
  };
}

/** 종전 구현의 고정 예약값 — 이게 실제 블록보다 작았던 것이 겹침의 원인이다. */
function legacyReserve(size: number): number {
  const { ts } = scaled(size);
  return Math.max(
    16,
    Math.round(6 * ts) + Math.round(9 * ts) + Math.round(8 * ts) + Math.round(7 * ts) + Math.round(6 * ts),
  );
}

describe('bubbleTextFit — 예약 높이(겹침 방지의 핵심)', () => {
  it('신고된 4줄 조합에서 종전 고정 예약은 실제 블록보다 작았다(= 겹쳤다)', () => {
    const size = 150;
    const lines = reportedCaseLines(size);
    const actual = reserveBottomHeight(lines, scaled(size).px(6, 3));
    expect(legacyReserve(size)).toBeLessThan(actual);
  });

  it('예약은 언제나 실제 하단 블록 높이 이상이다 — 이 불변식이 겹침을 막는다', () => {
    for (const size of [40, 55, 70, 90, 110, 130, 150, 180, 220]) {
      for (let n = 1; n <= 5; n++) {
        const lines = reportedCaseLines(size).slice(0, Math.min(n, 4));
        if (n === 5) lines.push({ key: 'extra', text: 'x', fontSize: 6, cls: '', priority: 20 });
        const input = inputFor(size, lines);
        const plan = planBubbleText(input);
        const rendered = input.bottomOffset + bottomBlockHeight(plan.bottomLines);
        expect(plan.paddingBottom).toBeGreaterThanOrEqual(rendered);
      }
    }
  });

  it('줄이 늘면 예약도 는다(고정 상수라면 그대로였을 자리)', () => {
    const size = 150;
    const lines = reportedCaseLines(size);
    const offset = scaled(size).px(6, 3);
    const grown = [1, 2, 3, 4].map((n) => reserveBottomHeight(lines.slice(0, n), offset));
    for (let i = 1; i < grown.length; i++) {
      expect(grown[i]!).toBeGreaterThan(grown[i - 1]!);
    }
  });

  it('하단 줄이 없으면 예약도 0 이다(브레인·휴지통처럼 하단 블록이 없는 버블)', () => {
    expect(reserveBottomHeight([], 6)).toBe(0);
    const plan = planBubbleText(inputFor(150, []));
    expect(plan.paddingBottom).toBe(0);
  });

  it('중앙 열 최대 높이 + 예약이 원의 세로 예산을 넘지 않는다(마지막 안전망)', () => {
    for (let size = 30; size <= 240; size += 6) {
      const input = inputFor(size, reportedCaseLines(size));
      const plan = planBubbleText(input);
      const budget = size - 2 * (Math.max(2, Math.round(2 * input.ts)) + input.borderWidth);
      expect(plan.centerMaxHeight + plan.paddingBottom).toBeLessThanOrEqual(budget);
      expect(plan.centerMaxHeight).toBeGreaterThanOrEqual(0);
    }
  });

  it('칩처럼 세로 padding 이 붙는 줄은 그 높이까지 예약에 들어간다', () => {
    const plain: BubbleBottomLine = { key: 'k', text: 'FE', fontSize: 9, cls: '', priority: 100 };
    const chip: BubbleBottomLine = { ...plain, extraHeight: 4 };
    expect(bottomBlockHeight([chip]) - bottomBlockHeight([plain])).toBe(4);
  });
});

describe('bubbleTextFit — 신고된 화면이 실제로 들어간다', () => {
  it('150px 버블: 4줄 + 배지 + 2줄 라벨이 원 안에 들어가고 아무것도 접히지 않는다', () => {
    const plan = planBubbleText(inputFor(150, reportedCaseLines(150)));
    expect(plan.bottomLines).toHaveLength(4);
    expect(plan.showBadge).toBe(true);
    expect(plan.labelLines).toBe(2);
    expect(plan.foldedText).toBe('');
  });

  it('중앙 열 + 예약이 원의 세로 예산을 넘지 않는다', () => {
    const size = 150;
    const input = inputFor(size, reportedCaseLines(size));
    const plan = planBubbleText(input);
    const centerHeight =
      input.iconPx +
      plan.centerGap + plan.labelLines * input.labelFontSize * 1.25 +
      (plan.showBadge ? plan.centerGap + input.badge!.fontSize * BUBBLE_LINE_HEIGHT : 0);
    const budget = size - 2 * (Math.max(2, Math.round(2 * input.ts)) + input.borderWidth);
    expect(centerHeight + plan.paddingBottom).toBeLessThanOrEqual(budget);
  });
});

describe('bubbleTextFit — 축약 사다리', () => {
  it('작아지면 먼저 간격부터 민다(정보 손실 없는 단계가 앞선다)', () => {
    const big = planBubbleText(inputFor(150, reportedCaseLines(150)));
    const small = planBubbleText(inputFor(112, reportedCaseLines(112)));
    expect(small.centerGap).toBeLessThan(big.centerGap);
    // 간격만으로 해결되는 크기라면 줄은 그대로 남아 있어야 한다.
    expect(small.bottomLines.length).toBe(big.bottomLines.length);
  });

  it('더 작아지면 같은 성격의 줄을 한 줄로 합쳐 요약한다(내용은 남는다)', () => {
    let merged: ReturnType<typeof planBubbleText> | null = null;
    for (const size of [100, 90, 80, 70, 60]) {
      const plan = planBubbleText(inputFor(size, reportedCaseLines(size)));
      const line = plan.bottomLines.find((l) => l.text.includes(' · '));
      if (line) {
        merged = plan;
        expect(line.text).toContain('15K/16K');
        expect(line.text).toContain('대기');
        break;
      }
    }
    expect(merged, '어느 크기에서도 병합이 일어나지 않았다').not.toBeNull();
  });

  it('아주 작아지면 라벨이 1줄로 접히고 배지가 사라진다 — 그래도 하단 줄은 남는다', () => {
    const size = 44;
    const plan = planBubbleText(inputFor(size, reportedCaseLines(size)));
    expect(plan.labelLines).toBe(1);
    expect(plan.showBadge).toBe(false);
    expect(plan.bottomLines.length).toBeGreaterThanOrEqual(1);
  });

  it('접을 때는 가장 덜 중요한 줄부터 접고, 접힌 내용은 툴팁 문자열로 남는다', () => {
    const size = 40;
    const plan = planBubbleText(inputFor(size, reportedCaseLines(size)));
    if (plan.bottomLines.length < 4) {
      // 남은 줄 중 가장 낮은 우선순위가, 접힌 것 중 가장 높은 우선순위보다 크거나 같아야 한다.
      const keptMin = Math.min(...plan.bottomLines.map((l) => l.priority));
      expect(plan.foldedText.length).toBeGreaterThan(0);
      expect(keptMin).toBeGreaterThanOrEqual(40);
    }
    // 모델명(최우선)은 어떤 크기에서도 마지막까지 남는다.
    expect(plan.bottomLines.some((l) => l.text.includes('Qwen') || l.text.includes('…'))).toBe(true);
  });

  it('사다리를 다 내려가도 예약 불변식은 유지된다(모든 크기)', () => {
    for (let size = 30; size <= 240; size += 2) {
      const input = inputFor(size, reportedCaseLines(size));
      const plan = planBubbleText(input);
      expect(plan.paddingBottom).toBeGreaterThanOrEqual(
        input.bottomOffset + bottomBlockHeight(plan.bottomLines),
      );
      expect(plan.bottomLines.length).toBeGreaterThanOrEqual(1);
      expect(plan.centerGap).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('bubbleTextFit — 가로(현) 와 요약', () => {
  it('현 길이: 중심에서 지름, 가장자리에서 0, 그 사이는 단조 감소', () => {
    expect(chordWidthAt(150, 0)).toBeCloseTo(150, 5);
    expect(chordWidthAt(150, 75)).toBeCloseTo(0, 5);
    let prev = Infinity;
    for (let dy = 0; dy <= 75; dy += 5) {
      const w = chordWidthAt(150, dy);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });

  it('아래쪽 줄일수록 쓸 수 있는 가로가 좁다 — 원 밖으로 삐져나가지 않는다', () => {
    const plan = planBubbleText(inputFor(150, reportedCaseLines(150)));
    for (let i = 1; i < plan.bottomMaxWidths.length; i++) {
      expect(plan.bottomMaxWidths[i]!).toBeLessThanOrEqual(plan.bottomMaxWidths[i - 1]!);
    }
    expect(plan.bottomMaxWidths.at(-1)!).toBeLessThan(150);
  });

  it('어떤 크기·어느 줄이든 가로가 0 이 되지 않는다 — 0 이면 줄이 통째로 사라진다', () => {
    // 회귀: 현을 "줄의 아래 모서리"에서 재던 구현은 맨 아랫줄에서 0 을 돌려줬다.
    for (let size = 30; size <= 240; size += 2) {
      const plan = planBubbleText(inputFor(size, reportedCaseLines(size)));
      for (const w of plan.bottomMaxWidths) expect(w).toBeGreaterThanOrEqual(16);
    }
  });

  it("summarize:'middle' 인 줄은 넘칠 때 가운데가 줄고 원문이 툴팁으로 남는다", () => {
    const long = 'Qwen3.8-27B-UD-Q4_K_M-really-long-name';
    const plan = planBubbleText(
      inputFor(90, [{ key: 'model', text: long, fontSize: 6, cls: '', priority: 100, summarize: 'middle' }]),
    );
    const line = plan.bottomLines[0]!;
    expect(line.text).not.toBe(long);
    expect(line.text).toContain('…');
    expect(line.title).toBe(long);
  });

  it('summarize 를 지정하지 않은 줄은 원문 그대로 두고 CSS truncate 에 맡긴다', () => {
    const long = '1234567890123456789012345678901234567890';
    const plan = planBubbleText(
      inputFor(90, [{ key: 'x', text: long, fontSize: 6, cls: '', priority: 100 }]),
    );
    expect(plan.bottomLines[0]!.text).toBe(long);
  });

  it('한글은 라틴보다 넓게 센다(짧은 한글 줄을 안전하다고 오판하지 않는다)', () => {
    expect(estimateTextWidth('대기', 10)).toBeGreaterThan(estimateTextWidth('ab', 10));
    expect(estimateTextWidth('', 10)).toBe(0);
  });

  it('가운데 줄임은 꼬리(양자화 표기)를 살린다', () => {
    const text = 'Qwen3.8-27B-UD-Q4_K_M';
    const out = summarizeMiddle(text, 60, 9);
    expect(out).not.toBe(text);
    expect(out).toContain('…');
    expect(out.startsWith('Q')).toBe(true);
    expect(out.endsWith('M')).toBe(true);
    expect(estimateTextWidth(out, 9)).toBeLessThanOrEqual(60);
  });

  it('들어가는 문자열은 건드리지 않는다', () => {
    expect(summarizeMiddle('opus', 999, 9)).toBe('opus');
  });

  it('라벨은 확실히 넘칠 때만 줄인다 — 짧은 이름은 원문 그대로', () => {
    const short = planBubbleText(inputFor(150, reportedCaseLines(150), 'Custom Agent 3'));
    expect(short.labelText).toBe('Custom Agent 3');

    const long = planBubbleText(
      inputFor(70, reportedCaseLines(70), 'ornithocheirus-1.0-9b-instruct-Q4_K_M #2'),
    );
    expect(long.labelText.length).toBeLessThan('ornithocheirus-1.0-9b-instruct-Q4_K_M #2'.length);
    expect(long.labelText).toContain('…');
  });
});

/**
 * §5.10 **메모리 버블** — 중앙 열은 카드 수 **하나**이고 이름은 하단 블록이 맡는다.
 *
 * 이름이 중앙에 있던 종전 구현은 127px 원에서 `11×ts` = **9px 한글**로 렌더돼 획이 제 색에
 * 도달하지 못했다(§9 실측 7.7%). 자리를 옮기면서 하한을 12px 로 못 박았으므로, 그 줄이
 * 오토핏 사다리에 접혀 사라지지 않는다는 것을 여기서 고정한다.
 *
 * 값은 `BubbleNode` 가 넘기는 것을 그대로 옮겨 적는다(그쪽이 바뀌면 이쪽도 같이).
 */
function memoryBubbleInput(size: number): BubbleFitInput {
  const { ts } = scaled(size);
  return {
    size,
    ts,
    borderWidth: 2,
    iconPx: 0,        // 카드 실루엣은 배경 워터마크라 중앙 열에 없다
    label: '',        // 이름은 하단 블록으로 내려갔다
    labelFontSize: 0,
    labelMaxLines: 1,
    labelWidthRatio: 0.7,
    badge: null,
    centerExtras: [{ fontSize: Math.max(20, Math.round(34 * ts)), lineHeight: 1 }],
    bottomLines: [
      { key: 'brainLabel', text: '메모리', fontSize: Math.max(12, Math.round(12 * ts)), cls: '', priority: 100 },
    ],
    bottomOffset: Math.max(3, Math.round(6 * ts)),
  };
}

describe('§5.10 메모리 버블 배치', () => {
  /** `calcBubbleSize` 의 brain 분기(`NODE_MIN + (MAX-MIN)×0.52`)와 같은 지름. */
  const MEMORY_SIZE = Math.round(70 + (180 - 70) * 0.52);

  it('이름 줄이 접히지 않고 하단에 남는다 — 12px 하한 그대로', () => {
    const plan = planBubbleText(memoryBubbleInput(MEMORY_SIZE));
    expect(plan.bottomLines).toHaveLength(1);
    expect(plan.bottomLines[0]?.text).toBe('메모리');
    expect(plan.bottomLines[0]?.fontSize).toBeGreaterThanOrEqual(12);
    expect(plan.foldedText).toBe('');
  });

  it('이름 줄이 그 높이의 현 안에 들어간다(원 밖으로 삐져나가지 않는다)', () => {
    const plan = planBubbleText(memoryBubbleInput(MEMORY_SIZE));
    const fontSize = plan.bottomLines[0]?.fontSize ?? 0;
    expect(estimateTextWidth('메모리', fontSize)).toBeLessThanOrEqual(plan.bottomMaxWidths[0] ?? 0);
  });

  it('중앙에 남은 카드 수가 예약된 세로 안에 들어간다 — 사다리를 내려갈 일이 없다', () => {
    const { ts } = scaled(MEMORY_SIZE);
    const plan = planBubbleText(memoryBubbleInput(MEMORY_SIZE));
    expect(plan.centerMaxHeight).toBeGreaterThanOrEqual(Math.max(20, Math.round(34 * ts)));
    expect(plan.step).toBe(0);
  });

  it('예약이 실제 하단 높이보다 작지 않다(겹침 불변식은 메모리 버블에도 그대로)', () => {
    const input = memoryBubbleInput(MEMORY_SIZE);
    const plan = planBubbleText(input);
    expect(plan.paddingBottom).toBeGreaterThanOrEqual(bottomBlockHeight(plan.bottomLines) + input.bottomOffset);
  });
});
