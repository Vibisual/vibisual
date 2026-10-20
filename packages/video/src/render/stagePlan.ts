/**
 * §5.13 (Z) 41-3 — **합성기 예약** (순수 — 시험이 고정한다).
 *
 * 재생 중 무대의 상자(아이템 하나 = 상자 하나)가 시간에 따라 바뀌는 것 — 장면 컷, 전환(`push`·`zoom`·`dissolve`·`flash`),
 * 아이템 페이드, 키프레임의 이동·배율·회전·불투명도 — 을 앞 `horizonS` 초 동안 **프레임마다 같은 그리기 목록 함수**
 * (`buildDrawList`)로 뽑아, 상자마다 Web Animations 키프레임으로 만든다. 무대가 그것을 상자에 걸면 합성기가 돌리므로
 * 화면 스레드가 막혀도 컷·전환이 제때 일어난다(41 실측 — 종전에는 상자 배치가 화면 스레드의 프레임마다였다).
 *
 * 합성기가 돌릴 수 있는 값은 `transform`·`opacity` 뿐이다. 그래서 **예약할 수 있는 상자**는 예약 구간 동안 크기(폭·높이)가
 * 그대로이고 잘라 보이기(`wipe` 의 clip)가 걸리지 않은 상자다 — 그 밖의 상자는 종전처럼 화면 스레드가 맞춘다(`plannable:false`).
 * 상자의 자리(left·top)는 예약 동안 기준 자리(`base`)에 고정하고, 움직임은 그 기준에서의 이동(`translate`)으로 적는다.
 */
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import { buildDrawList, type DrawOp } from './drawList.js';
import { fadeFactor } from './canvas2d.js';
import { STAGE_WARM_PRIME_OPACITY } from './stageWarm.js';

/** 한 프레임의 상자 값(보이지 않는 프레임은 `null`). */
export interface StagePlanFrame {
  readonly opacity: number;
  readonly dx: number;
  readonly dy: number;
  readonly rotation: number;
  readonly scale: number;
}

export interface StagePlanItem {
  readonly id: string;
  readonly kind: DrawOp['kind'];
  /** 예약 구간에서 처음 보이는 프레임 번호와 그때의 그리기(슬롯을 세울 때 쓴다). */
  readonly firstIndex: number;
  readonly first: DrawOp;
  /** 마지막으로 보이는 프레임 번호. */
  readonly lastIndex: number;
  /** 예약 동안 상자의 기준 자리·크기(left·top·width·height 로 쓴다). */
  readonly base: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** 합성기가 돌릴 수 있는가 — 크기가 그대로이고 잘라 보이기가 없을 때만. */
  readonly plannable: boolean;
  /** 프레임마다의 값(`times` 와 같은 길이). */
  readonly frames: readonly (StagePlanFrame | null)[];
}

export interface StagePlan {
  /** 예약 시작 시각(초 — 문서 프레임 격자 위). */
  readonly from: number;
  readonly fps: number;
  /** 프레임마다의 문서 시각(초). */
  readonly times: readonly number[];
  readonly items: ReadonlyMap<string, StagePlanItem>;
}

/** 상자 하나의 그 프레임 불투명도 — DOM 무대 `placeSlot` 과 같은 곱(배치의 불투명도 × 페이드). */
export function planOpacity(op: DrawOp): number {
  return op.transform.opacity * fadeFactor(op);
}

const EPS = 1e-6;

/**
 * `from` 부터 `horizonS` 초 동안(양 끝 포함) 프레임마다 그리기 목록을 뽑아 상자별로 모은다. `from` 은 문서 프레임 격자로 맞춘다
 * (재생 시계가 이미 격자 위에 있다 — 그래도 한 번 더 접는다).
 */
export function planStage(doc: VideoDoc, timeline: ResolvedTimeline, from: number, horizonS: number, fps: number): StagePlan {
  const rate = fps > 0 ? fps : 30;
  const start = Math.round(from * rate) / rate;
  const count = Math.max(1, Math.round(Math.max(0, horizonS) * rate)) + 1;
  const times: number[] = [];
  const collected = new Map<string, { first: DrawOp; firstIndex: number; lastIndex: number; ops: (DrawOp | null)[] }>();
  for (let k = 0; k < count; k += 1) {
    const t = start + k / rate;
    times.push(t);
    for (const op of buildDrawList(doc, timeline, Math.min(t, Math.max(0, timeline.duration - EPS)))) {
      let entry = collected.get(op.itemId);
      if (!entry) {
        entry = { first: op, firstIndex: k, lastIndex: k, ops: new Array<DrawOp | null>(count).fill(null) };
        collected.set(op.itemId, entry);
      }
      entry.ops[k] = op;
      entry.lastIndex = k;
    }
  }
  const items = new Map<string, StagePlanItem>();
  for (const [id, entry] of collected) {
    const base = { x: entry.first.transform.x, y: entry.first.transform.y, width: entry.first.transform.width, height: entry.first.transform.height };
    let plannable = true;
    const frames = entry.ops.map((op): StagePlanFrame | null => {
      if (!op) return null;
      if (op.clip || Math.abs(op.transform.width - base.width) > EPS || Math.abs(op.transform.height - base.height) > EPS) plannable = false;
      return { opacity: planOpacity(op), dx: op.transform.x - base.x, dy: op.transform.y - base.y, rotation: op.transform.rotation, scale: op.transform.scale };
    });
    items.set(id, { id, kind: entry.first.kind, firstIndex: entry.firstIndex, first: entry.first, lastIndex: entry.lastIndex, base, plannable, frames });
  }
  return { from: start, fps: rate, times, items };
}

/** 소수 세 자리(키프레임 글자를 짧게 — 0.001px · 0.001° 는 화면에서 구별되지 않는다). */
function n3(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** 상자 값 → CSS transform(기준 자리에서의 이동 → 가운데 기준 회전·배율 — `placeSlot` 의 `rotate() scale()` 과 같은 순서). */
export function planTransform(frame: Pick<StagePlanFrame, 'dx' | 'dy' | 'rotation' | 'scale'>): string {
  return `translate(${n3(frame.dx)}px, ${n3(frame.dy)}px) rotate(${n3(frame.rotation)}deg) scale(${n3(frame.scale)})`;
}

/** Web Animations 키프레임 하나(시험이 DOM 없이 본다). */
export interface StagePlanKeyframe {
  readonly offset: number;
  readonly opacity: string;
  readonly transform: string;
  readonly easing: 'linear' | 'step-end';
}

/**
 * 예약 항목 → 키프레임. 보이지 않는 프레임은 불투명도 0 — 다만 **곧 보일 컴포지션**(`primeBefore`)은 처음 보이기 전까지
 * `STAGE_WARM_PRIME_OPACITY` 로 둔다(거의 안 보이게 그리게 해 두어야 컷 순간에 첫 그림이 늦지 않는다 — 39-5·40-8 ① 깨움과 같다).
 * 보임이 바뀌는 자리(컷)는 한 프레임에 걸쳐 녹이지 않고 그 프레임에서 바로 바뀐다(`step-end`). 자리 값은 보이지 않는 프레임에서
 * 가장 가까운 보이는 프레임의 값을 이어 쓴다(보일 때 튀지 않게).
 */
export function planKeyframes(item: StagePlanItem, opts: { readonly primeBefore?: boolean } = {}): StagePlanKeyframe[] {
  const frames = item.frames;
  const count = frames.length;
  const out: StagePlanKeyframe[] = [];
  const nearest = (k: number): StagePlanFrame | null => {
    for (let d = 0; d < count; d += 1) {
      const a = frames[k - d];
      if (a) return a;
      const b = frames[k + d];
      if (b) return b;
    }
    return null;
  };
  for (let k = 0; k < count; k += 1) {
    const f = frames[k] ?? null;
    const shown = f ?? nearest(k);
    const absent = opts.primeBefore === true && k < item.firstIndex ? STAGE_WARM_PRIME_OPACITY : 0;
    const next = k + 1 < count ? frames[k + 1] ?? null : f;
    const cut = k + 1 < count && (f === null) !== (next === null);
    out.push({
      offset: count > 1 ? k / (count - 1) : 0,
      opacity: n3(f ? f.opacity : absent),
      transform: planTransform(shown ?? { dx: 0, dy: 0, rotation: 0, scale: 1 }),
      easing: cut ? 'step-end' : 'linear',
    });
  }
  return out;
}

/** 예약 구간의 길이(ms) — 키프레임의 처음과 끝 사이. */
export function planDurationMs(plan: Pick<StagePlan, 'times' | 'fps'>): number {
  return Math.max(1, ((plan.times.length - 1) / plan.fps) * 1000);
}
