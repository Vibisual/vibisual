// §5.4 #14 — 고른 탭이 커지는 움직임의 계산 한 벌(순수 함수 — DOM 을 모른다).
//
// 탭을 고르면 그 탭은 이름만큼 넓어지고 앞서 고른 탭은 한 칸으로 줄어든다. 종전에는 그 폭(`width`)을
// 메인 스레드에서 바꿔 가며 움직였는데, 프로젝트를 바꾸는 그 순간이 캔버스를 통째로 다시 그리는 때라
// 메인 스레드가 막혀 움직임이 화면에 거의 안 남았다(실측: 멈춤 아래에서 그림 2~3장). 그래서 폭은 그
// 자리에서 끝 값으로 바꾸고, 보이는 쪽만 **옛 모양에서 새 모양으로 되돌려 놓았다가 풀어 준다**(FLIP).
// 움직이는 것은 transform·opacity 뿐이라 합성 스레드가 돌린다 — 메인 스레드가 막혀도 끊기지 않는다.
//
//   · 탭 본체      — 이웃 탭이 넓어지거나 줄어 밀린 만큼 옆으로 미끄러진다(translateX).
//   · 판(배경)     — 옛 크기에서 새 크기로 늘거나 준다(scale, 좌상단 기준).
//   · 이름 칸      — 바깥은 늘고(scaleX) 안은 그 반대로 펴서(1/scaleX) 글자는 그대로 둔 채 커튼처럼 드러난다.
//   · 그 밖의 칸   — 배지·닫기는 오른쪽 끝을 타고, 모두 높이 차이만큼 위아래로 옮겨 간다(translate).
//
// 곡선은 아이폰식 스프링이다(응답·감쇠) — 시간 위에 표본을 찍어 키프레임으로 넘기므로 합성 스레드도 같은
// 곡선을 그린다. 움직임 줄이기(OS 설정)에서는 **끄지 않고 누그러뜨린다** — 튐 없는 감쇠·흐림 없음
// (iOS 의 동작 줄이기와 같은 결론). 종전 구현은 그때 움직임을 통째로 꺼서, 그 설정이 켜진 PC 에서는
// "그냥 커진다"로 되돌아가 보였다(사용자 보고 2026-10-22).

/** 스프링 — `responseMs` 는 감쇠 없는 진동 한 주기, `damping` 은 감쇠비(1 = 튐 없음). */
export interface TabSpring {
  readonly responseMs: number;
  readonly damping: number;
}

/** 이름이 나타나는 연출 — 한 번 옅고 흐려졌다가(옛 이름이 물러나고) 또렷하게 앉는다. */
export interface TabLabelReveal {
  readonly durationMs: number;
  /** 가장 옅은 순간의 자리(0~1). */
  readonly dipAt: number;
  /** 시작 불투명도 — 고르지 않은 탭 글자(gray-400)의 밝기와 같아 첫 프레임에서 튀지 않는다. */
  readonly fromOpacity: number;
  readonly dipOpacity: number;
  /** 가장 옅은 순간의 흐림(px). 0 이면 흐림을 걸지 않는다. */
  readonly dipBlurPx: number;
  /** 가장 옅은 순간 아래로 내려앉는 거리(px). */
  readonly dipRisePx: number;
}

export const TAB_SELECTION_FLIP = {
  /** 아이폰식 스프링 — 살짝(약 1.5%) 넘쳤다가 앉는다. */
  spring: { responseMs: 400, damping: 0.8 } satisfies TabSpring,
  /** 움직임 줄이기 — 넘치지 않고(임계 감쇠) 더 짧게. */
  reducedSpring: { responseMs: 280, damping: 1 } satisfies TabSpring,
  /** 키프레임 표본 간격(ms) — 한 프레임 남짓이라 사이를 직선으로 이어도 곡선이 꺾여 보이지 않는다. */
  sampleMs: 16,
  /** 남은 거리가 이만큼(전체 = 1) 아래로 머물면 앉았다고 본다. */
  settle: 0.001,
  /** 스프링 길이 상한(ms) — 설정이 어떻든 이보다 오래 끌지 않는다. */
  maxMs: 900,
  /** 이보다 덜 움직인 칸은 움직임을 만들지 않는다(px). */
  minDeltaPx: 0.5,
  /** 이보다 덜 변한 배율은 1 로 본다. */
  minScaleDelta: 0.002,
  reveal: { durationMs: 560, dipAt: 0.2, fromOpacity: 0.66, dipOpacity: 0.3, dipBlurPx: 2, dipRisePx: 1.5 } satisfies TabLabelReveal,
  reducedReveal: { durationMs: 300, dipAt: 0.3, fromOpacity: 0.66, dipOpacity: 0.5, dipBlurPx: 0, dipRisePx: 0 } satisfies TabLabelReveal,
  /** 첫 구간(옅어짐)은 빠르게 들어가고, 둘째 구간(또렷해짐)은 길게 내려앉는다. */
  revealEasing: { out: 'cubic-bezier(0.4, 0, 1, 1)', in: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  /**
   * 고른 탭이 줄 밖이면 보이게 당기는 손이 따라가는 시간(ms). 폭은 고르는 순간 끝 값이 되므로(움직임은
   * 보이는 쪽만 돈다) 늦게 앉는 글꼴·배지 몇 프레임만 따라가면 된다.
   */
  followMs: 120,
} as const;

/** 고른 탭의 키 — 탭바와 움직임 훅이 같은 규칙으로 읽는다(iframe 탭이 고른 프로젝트보다 앞선다). */
export function tabSelectionKey(activeIframeId: string | null, activeProject: string | null): string | null {
  if (activeIframeId) return `i:${activeIframeId}`;
  if (activeProject) return `p:${activeProject}`;
  return null;
}

/** 스프링이 `tMs` 에 와 있는 자리(0 → 1, 감쇠비 < 1 이면 잠깐 1 을 넘는다). */
export function springProgress(tMs: number, spring: TabSpring): number {
  if (!(tMs > 0)) return 0;
  const t = tMs / 1000;
  const omega = (2 * Math.PI) / (Math.max(1, spring.responseMs) / 1000);
  const zeta = Math.max(0, spring.damping);
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
  }
  // 임계 감쇠 이상은 임계 감쇠로 본다(더 무거운 스프링은 굼떠 보일 뿐이다).
  return 1 - Math.exp(-omega * t) * (1 + omega * t);
}

/** 남은 거리의 상한(진동이 0 을 지나는 순간을 "앉음"으로 오판하지 않게 감쇠 봉투로 잰다). */
function settleBound(tMs: number, spring: TabSpring): number {
  const t = tMs / 1000;
  const omega = (2 * Math.PI) / (Math.max(1, spring.responseMs) / 1000);
  const zeta = Math.max(0, spring.damping);
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * omega * t) * (1 + (zeta * omega) / wd);
  }
  return Math.exp(-omega * t) * (1 + omega * t);
}

/** 시간 위에 같은 간격으로 찍은 스프링 표본 — 첫 값 0, 끝 값은 정확히 1. */
export interface TabSpringCurve {
  readonly durationMs: number;
  readonly samples: readonly number[];
}

export function springCurve(spring: TabSpring): TabSpringCurve {
  const step = TAB_SELECTION_FLIP.sampleMs;
  const maxSteps = Math.ceil(TAB_SELECTION_FLIP.maxMs / step);
  let steps = 1;
  while (steps < maxSteps && settleBound(steps * step, spring) > TAB_SELECTION_FLIP.settle) steps++;
  const samples: number[] = [];
  for (let i = 0; i < steps; i++) samples.push(springProgress(i * step, spring));
  samples.push(1);
  return { durationMs: steps * step, samples };
}

/** 키프레임 숫자는 짧게 — 소수 넷째 자리면 화면에서 차이가 없다. */
function num(v: number): string {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** 표본마다 한 장 — 시간 간격이 같으므로 offset 도 같은 간격이다(사이는 직선 `linear`). */
function sampled(curve: TabSpringCurve, frame: (p: number) => Keyframe): Keyframe[] {
  const last = curve.samples.length - 1;
  return curve.samples.map((p, i) => ({ ...frame(p), offset: last > 0 ? i / last : 1 }));
}

/** 옛 자리(dx, dy)에서 제자리로 미끄러진다. */
export function translateKeyframes(dx: number, dy: number, curve: TabSpringCurve): Keyframe[] {
  return sampled(curve, (p) => ({ transform: `translate(${num(dx * (1 - p))}px, ${num(dy * (1 - p))}px)` }));
}

/** 판 — 옛 자리·크기에서 새 자리·크기로(좌상단 기준 `origin-top-left` 이어야 한다). */
export function boxKeyframes(part: Pick<TabPartFlip, 'dx' | 'dy' | 'sx' | 'sy'>, curve: TabSpringCurve): Keyframe[] {
  return sampled(curve, (p) => ({
    transform: `translate(${num(part.dx * (1 - p))}px, ${num(part.dy * (1 - p))}px) scale(${num(part.sx + (1 - part.sx) * p)}, ${num(part.sy + (1 - part.sy) * p)})`,
  }));
}

/**
 * 이름 칸 — 바깥(잘라 보이는 칸)은 옛 폭에서 새 폭으로 늘고, 안(글자)은 매 표본 **정확히 그 역수**로 편다.
 * 두 움직임이 같은 표본·같은 시작 시각을 쓰므로 글자는 늘어나 보이지 않고 칸의 오른쪽 끝만 움직인다.
 */
export function labelClipKeyframes(part: Pick<TabPartFlip, 'dx' | 'dy' | 'sx'>, curve: TabSpringCurve): { outer: Keyframe[]; inner: Keyframe[] } {
  const scaleAt = (p: number): number => part.sx + (1 - part.sx) * p;
  return {
    outer: sampled(curve, (p) => ({ transform: `translate(${num(part.dx * (1 - p))}px, ${num(part.dy * (1 - p))}px) scaleX(${num(scaleAt(p))})` })),
    inner: sampled(curve, (p) => ({ transform: `scaleX(${num(1 / scaleAt(p))})` })),
  };
}

/**
 * 이름이 나타나는 연출 — 합성 스레드가 돌릴 수 있는 불투명도·위치(`main`)와, 메인 스레드에서 도는
 * 흐림(`blur` — 픽셀을 움직이는 필터는 합성기가 맡지 않는다)을 **따로** 준다. 한 움직임에 섞으면
 * 흐림 하나 때문에 불투명도·위치까지 메인 스레드로 떨어진다.
 */
export function labelRevealKeyframes(reveal: TabLabelReveal): { main: Keyframe[]; blur: Keyframe[] | null } {
  const { out, in: settle } = TAB_SELECTION_FLIP.revealEasing;
  const main: Keyframe[] = [
    { offset: 0, opacity: num(reveal.fromOpacity), transform: 'translateY(0px)', easing: out },
    { offset: reveal.dipAt, opacity: num(reveal.dipOpacity), transform: `translateY(${num(reveal.dipRisePx)}px)`, easing: settle },
    { offset: 1, opacity: '1', transform: 'translateY(0px)' },
  ];
  const blur: Keyframe[] | null = reveal.dipBlurPx > 0
    ? [
        { offset: 0, filter: 'blur(0px)', easing: out },
        { offset: reveal.dipAt, filter: `blur(${num(reveal.dipBlurPx)}px)`, easing: settle },
        { offset: 1, filter: 'blur(0px)' },
      ]
    : null;
  return { main, blur };
}

/** 사각형 — 탭 본체는 스크롤 칸 내용 좌표(스크롤과 무관), 그 안의 칸은 본체 좌상단 기준. */
export interface TabRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 탭 하나의 모양 — 본체와 그 직속 자식 칸들(판·아이콘·이름·배지·닫기)의 사각형. */
export interface TabGeom {
  readonly key: string;
  readonly active: boolean;
  readonly surface: TabRect;
  readonly parts: readonly TabRect[];
  /** parts 중 판의 순번(-1 = 없음). */
  readonly plateIndex: number;
  /** parts 중 이름 칸의 순번(-1 = 없음). */
  readonly labelIndex: number;
}

export type TabPartKind = 'plate' | 'label' | 'item';

/** 칸 하나를 옛 모양으로 되돌려 놓을 값 — 판은 이동+배율, 이름은 이동+가로 배율, 나머지는 이동만. */
export interface TabPartFlip {
  readonly index: number;
  readonly kind: TabPartKind;
  readonly dx: number;
  readonly dy: number;
  readonly sx: number;
  readonly sy: number;
}

export interface TabFlip {
  readonly key: string;
  /** 본체가 옛 자리로 되돌아가 있을 가로 거리. 순서가 바뀐 판이면 0 — 그때는 밀림 재생이 겉칸을 옮긴다. */
  readonly surfaceDx: number;
  readonly parts: readonly TabPartFlip[];
  /** 이번에 고른 탭이다 — 이름이 나타나는 연출을 건다. */
  readonly reveal: boolean;
}

function moved(v: number): boolean {
  return Math.abs(v) >= TAB_SELECTION_FLIP.minDeltaPx;
}

function scaled(v: number): boolean {
  return Number.isFinite(v) && v > 0 && Math.abs(v - 1) >= TAB_SELECTION_FLIP.minScaleDelta;
}

/**
 * 고른 탭이 바뀐 커밋에서, 바뀌기 전에 잰 모양(`before` — 그때 화면에 보이던 그대로)과 바뀐 뒤의 모양
 * (`after` — 움직임을 걷은 레이아웃)으로 탭마다 되돌려 놓을 값을 정한다.
 *
 * @param slideSurfaces 줄 순서가 그대로인가. 순서가 바뀐 커밋에서는 밀림 재생(`useTabPushAnimation`)이
 *   겉칸을 옮기므로 본체까지 옮기면 같은 거리를 두 번 민다.
 */
export function planTabSelectionFlip(
  before: ReadonlyMap<string, TabGeom>,
  after: readonly TabGeom[],
  opts: { readonly slideSurfaces: boolean },
): TabFlip[] {
  const steps: TabFlip[] = [];
  for (const next of after) {
    const prev = before.get(next.key);
    if (!prev) continue;
    const slide = opts.slideSurfaces ? prev.surface.x - next.surface.x : 0;
    const surfaceDx = moved(slide) ? slide : 0;
    const parts: TabPartFlip[] = [];
    // 칸 구성이 그 사이 바뀌었으면(배지가 새로 붙었다 등) 칸끼리 짝을 지을 수 없다 — 본체만 옮긴다.
    const sameShape = prev.parts.length === next.parts.length
      && prev.plateIndex === next.plateIndex
      && prev.labelIndex === next.labelIndex;
    if (sameShape) {
      next.parts.forEach((to, index) => {
        const from = prev.parts[index];
        if (!from) return;
        const kind: TabPartKind = index === next.plateIndex ? 'plate' : index === next.labelIndex ? 'label' : 'item';
        // 가로는 본체 안에서의 차이(본체 자신의 미끄러짐은 surfaceDx 가 맡는다), 세로는 본체 높이가 바뀐
        //   만큼까지 더한 절대 차이(고른 탭은 위로 5px 들어 올려 꽉 차고, 본체는 세로로 옮기지 않는다).
        const dx = from.x - to.x;
        const dy = (prev.surface.y + from.y) - (next.surface.y + to.y);
        const sx = kind === 'item' || to.w <= 0 ? 1 : from.w / to.w;
        const sy = kind !== 'plate' || to.h <= 0 ? 1 : from.h / to.h;
        if (!moved(dx) && !moved(dy) && !scaled(sx) && !scaled(sy)) return;
        parts.push({
          index,
          kind,
          dx: moved(dx) ? dx : 0,
          dy: moved(dy) ? dy : 0,
          sx: scaled(sx) ? sx : 1,
          sy: scaled(sy) ? sy : 1,
        });
      });
    }
    const reveal = !prev.active && next.active && next.labelIndex >= 0;
    if (surfaceDx === 0 && parts.length === 0 && !reveal) continue;
    steps.push({ key: next.key, surfaceDx, parts, reveal });
  }
  return steps;
}
