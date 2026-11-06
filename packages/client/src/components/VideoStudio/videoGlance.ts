import {
  chapterThumbWants,
  resolveTimeline,
  type ChapterThumbWant,
  type DiffLine,
  type PassRecord,
  type ResolvedTimeline,
  type VideoDoc,
} from '@vibisual/video';

import { readDoc, readDocVersion, type DocVersion } from './videoApi.js';
import { readPasses } from './studioApi.js';
import { loadPassStartDoc, passChangeOf, passOfActivity, type PassChangeTargets } from './passChange.js';

/**
 * §5.4 #36 (J) — 캔버스 영상 노드의 훑어보기 재료(문서 · 바퀴 · 이번에 바뀐 것) 한 벌. 노드 화면(`VideoGlanceFace`)과 구슬 줄 읽기
 * (`readVibistudioLinkedItems`)가 같은 기억을 쓴다 — 따로 읽으면 판본마다 문서·바퀴·시작 판을 두 번 받는다.
 * 판본만 먼저 묻고(싸다) 판본이 바뀔 때만 문서를, 판본이나 지금 하는 일이 바뀔 때만 바퀴를 다시 읽는다. 같은 문서를 동시에 두 번 묻지 않는다.
 * 기억은 다시 받을 수 있는 파생이라 문서 수로 묶는다(구독 중인 것은 남긴다 — §3.2.4 F′).
 */

export interface VideoGlance {
  readonly info: DocVersion;
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  /** 장면 대표 프레임 열쇠(§5.13 39-4 — 서버·스튜디오와 같은 열쇠). */
  readonly wants: readonly ChapterThumbWant[];
  readonly passes: readonly PassRecord[];
  /** 보일 바퀴(지금 하는 일 → 가장 최근). */
  readonly pass: PassRecord | null;
  /** 그 바퀴 시작 판 ↔ 지금(`passChange.ts`). */
  readonly lines: readonly DiffLine[];
  readonly targets: PassChangeTargets;
  /** 지금 판본이 어느 바퀴의 것인가(AI 가 낸 판). */
  readonly byAi: boolean;
  /** 지금까지 AI 가 낸 마지막 판본(없으면 `null`) — 머리줄의 "안 본 변경"은 이것이 바뀔 때만 켠다(사람이 고친 판은 본 것이다). */
  readonly lastAiVersion: number | null;
}

export interface VideoGlanceView {
  readonly glance: VideoGlance | null;
  /** 마지막 물음이 실패했다(앞 결과는 그대로 둔다). */
  readonly failed: boolean;
}

interface Slot {
  view: VideoGlanceView;
  inflight: Promise<VideoGlance | null> | null;
  readonly listeners: Set<() => void>;
  usedAt: number;
}

const GLANCE_MAX = 12;
const EMPTY_VIEW: VideoGlanceView = { glance: null, failed: false };
const slots = new Map<string, Slot>();
let clock = 0;

export function glanceKey(project: string, docId: string): string {
  return JSON.stringify([project, docId]);
}

function slotOf(key: string): Slot {
  let slot = slots.get(key);
  if (!slot) {
    slot = { view: EMPTY_VIEW, inflight: null, listeners: new Set(), usedAt: (clock += 1) };
    slots.set(key, slot);
    evict();
  }
  slot.usedAt = clock += 1;
  return slot;
}

function evict(): void {
  if (slots.size <= GLANCE_MAX) return;
  const idle = [...slots.entries()].filter(([, s]) => s.listeners.size === 0 && s.inflight === null).sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [key] of idle) {
    if (slots.size <= GLANCE_MAX) break;
    slots.delete(key);
  }
}

function setView(slot: Slot, view: VideoGlanceView): void {
  if (slot.view.glance === view.glance && slot.view.failed === view.failed) return;
  slot.view = view;
  for (const listener of [...slot.listeners]) listener();
}

export function peekGlance(project: string, docId: string): VideoGlanceView {
  return slots.get(glanceKey(project, docId))?.view ?? EMPTY_VIEW;
}

export function subscribeGlance(project: string, docId: string, listener: () => void): () => void {
  const slot = slotOf(glanceKey(project, docId));
  slot.listeners.add(listener);
  return () => {
    slot.listeners.delete(listener);
    evict();
  };
}

/** 지금 판본까지 AI(바퀴)가 낸 마지막 판본. */
export function lastAiVersionOf(passes: readonly PassRecord[], current: number): number | null {
  let best: number | null = null;
  for (const p of passes) for (const v of p.versions) if (v <= current && (best === null || v > best)) best = v;
  return best;
}

function activityKey(info: DocVersion): string {
  return JSON.stringify(info.activity ?? null);
}

/** 판본을 묻고 바뀐 것만 다시 읽는다. 못 읽으면 앞 결과를 그대로 두고 `failed` 를 켠다. */
export function refreshGlance(project: string, docId: string): Promise<VideoGlance | null> {
  const slot = slotOf(glanceKey(project, docId));
  if (slot.inflight) return slot.inflight;
  const run = (async (): Promise<VideoGlance | null> => {
    const prev = slot.view.glance;
    try {
      const info = await readDocVersion(project, docId);
      const sameDoc = prev !== null && prev.doc.version === info.version && prev.doc.updatedAt === info.updatedAt;
      const doc = sameDoc ? prev.doc : (await readDoc(project, docId)).doc;
      const timeline = sameDoc ? prev.timeline : resolveTimeline(doc);
      const wants = sameDoc ? prev.wants : chapterThumbWants(doc, timeline);
      const samePasses = sameDoc && activityKey(prev.info) === activityKey(info);
      const passes = samePasses ? prev.passes : (await readPasses(project, docId).catch(() => ({ passes: prev?.passes ?? [] }))).passes;
      const pass = passOfActivity(info.activity, passes);
      const sameChange = samePasses && prev.pass?.startRev === pass?.startRev;
      let change: { readonly lines: readonly DiffLine[]; readonly targets: PassChangeTargets } = sameChange ? prev : passChangeOf(null, null);
      if (!sameChange && pass?.startRev) {
        const start = await loadPassStartDoc(project, docId, pass.startRev).catch(() => null);
        change = passChangeOf(start, doc);
      }
      const lastAiVersion = lastAiVersionOf(passes, info.version);
      const byAi = lastAiVersion === info.version;
      const unchanged = prev !== null && sameChange && prev.info.title === info.title && prev.info.duration === info.duration
        && activityKey(prev.info) === activityKey(info) && prev.lastAiVersion === lastAiVersion;
      const glance: VideoGlance = unchanged
        ? prev
        : { info, doc, timeline, wants, passes, pass, lines: change.lines, targets: change.targets, byAi, lastAiVersion };
      setView(slot, { glance, failed: false });
      return glance;
    } catch {
      setView(slot, { glance: prev, failed: true });
      return prev;
    } finally {
      slot.inflight = null;
    }
  })();
  slot.inflight = run;
  return run;
}

/** 시험 전용 — 모듈 상태를 처음으로. */
export function __resetGlanceForTest(): void {
  slots.clear();
}
