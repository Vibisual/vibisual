import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem } from '../types.js';
import type { Ctx2D, SceneEnv } from './canvas2d.js';
import { buildDrawList, type DrawOp } from './drawList.js';
import { hitTest, opBounds, opRect, type HitRect } from './hitTest.js';
import {
  BUILTIN_SCENE_LAYOUTS,
  estimateTextMeasure,
  parsePropIndex,
  sceneFootprint,
  sceneLayout,
  scenePartAt,
  scenePropText,
} from './sceneParts.js';
import { BUILTIN_SCENES } from './scenes.js';

/**
 * §5.13 (V) 37-6 — 기본 씬 안쪽 자리(`sceneParts.ts`)는 그리기(`scenes.ts`)와 **같은 계산**이어야 한다.
 * 실제 그리기 함수를 기록용 캔버스에 돌려, 글자가 찍힌 자리마다 그 글자의 값 상자 안에 드는지 대조한다 — 한쪽만 고치면 여기서 깨진다.
 */

const SIZE = { width: 1920, height: 1080 };

function sceneDoc(items: readonly VideoItem[]): VideoDoc {
  return { ...createEmptyDoc('d', 'D'), size: SIZE, tracks: [{ id: 'v', kind: 'visual', items: [...items] }] };
}

function opAt(doc: VideoDoc, itemId: string, t: number): DrawOp {
  const op = buildDrawList(doc, resolveTimeline(doc), t).find((o) => o.itemId === itemId);
  if (!op) throw new Error(`no op for ${itemId} at ${t}`);
  return op;
}

interface Stamp { readonly text: string; readonly x: number; readonly y: number }

/** 그리기 함수가 쓰는 만큼만 흉내 낸 캔버스 — 글자를 찍은 자리(이동 반영)를 남긴다. 폭은 시험의 재는 함수와 같다. */
function recordingCtx(): { ctx: Ctx2D; stamps: Stamp[] } {
  const stamps: Stamp[] = [];
  const stack: Array<{ tx: number; ty: number }> = [];
  let tx = 0;
  let ty = 0;
  const ctx = {
    font: '10px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic',
    save: () => { stack.push({ tx, ty }); },
    restore: () => { const s = stack.pop(); if (s) { tx = s.tx; ty = s.ty; } },
    translate: (x: number, y: number) => { tx += x; ty += y; },
    measureText(text: string) { return { width: estimateTextMeasure(this.font, text) }; },
    fillText: (text: string, x: number, y: number) => { stamps.push({ text, x: x + tx, y: y + ty }); },
    beginPath: () => undefined, arc: () => undefined, fill: () => undefined, rect: () => undefined, roundRect: () => undefined,
    fillRect: () => undefined, stroke: () => undefined,
  };
  return { ctx: ctx as unknown as Ctx2D, stamps };
}

function inside(r: HitRect, x: number, y: number): boolean {
  return x >= r.x - 0.5 && x <= r.x + r.width + 0.5 && y >= r.y - 0.5 && y <= r.y + r.height + 0.5;
}

const env: SceneEnv = { doc: sceneDoc([]), size: SIZE };

const CASES: Record<string, Readonly<Record<string, unknown>>> = {
  title: { title: 'See your AI agents think.', subtitle: 'Vibisual · Vibistudio' },
  lowerThird: { name: 'Vibistudio', role: '프로그래머블 영상 제작 내부 앱' },
  bulletList: { heading: '이 앱이 하는 일', items: ['코드로 그린 씬과 실사 푸티지를 한 타임라인에', '에이전트가 문서를 직접 고치고 스틸로 검수', '렌더는 전부 이 컴퓨터 안에서'] },
  codeBlock: { lines: ['const a = 1;', 'console.log(a);'] },
  quote: { text: '영상의 진실은 코드가 아니라 문서에 있다.', by: 'SCENARIO.md §5.13' },
};

describe('§5.13 (V) 37-6 기본 씬 안쪽 자리 = 그리기와 같은 계산', () => {
  for (const [sceneId, props] of Object.entries(CASES)) {
    it(`${sceneId}: 찍힌 글자마다 그 값의 상자(또는 장식) 안이고, 상자마다 찍힌 글자가 있다`, () => {
      const doc = sceneDoc([{ id: 's', kind: 'scene', sceneId, at: 0, duration: 8, props }]);
      const op = opAt(doc, 's', 6); // 등장 애니메이션이 끝난 시각
      const { ctx, stamps } = recordingCtx();
      BUILTIN_SCENES[sceneId]!(ctx, op, { doc, size: SIZE });
      const layout = sceneLayout(op, { doc, size: SIZE }, estimateTextMeasure)!;
      expect(layout.parts.length).toBeGreaterThan(0);
      for (const stamp of stamps) {
        const owner = layout.parts.find((p) => inside(p.rect, stamp.x, stamp.y));
        const decor = layout.decor.some((d) => inside(d, stamp.x, stamp.y));
        expect(owner !== undefined || decor, `"${stamp.text}" @${stamp.x.toFixed(0)},${stamp.y.toFixed(0)} 이 어느 상자에도 없다`).toBe(true);
        // 줄 번호(코드)·따옴표(인용)·"— 출처" 장식 말고는 그 값의 글자가 찍힌 것이어야 한다.
        if (owner && !/^\s*\d+$/.test(stamp.text)) expect(`— ${owner.text} ${owner.text}`).toContain(stamp.text.replace(/^— /, ''));
      }
      for (const part of layout.parts) {
        expect(stamps.some((s) => inside(part.rect, s.x, s.y)), `${part.prop} 상자에 찍힌 글자가 없다`).toBe(true);
      }
    });
  }

  it('등장 중이면 움직인 자리(제목은 아래에서 올라온다)를 따라간다', () => {
    const doc = sceneDoc([{ id: 's', kind: 'scene', sceneId: 'title', at: 0, duration: 8, props: CASES['title'] }]);
    const early = sceneLayout(opAt(doc, 's', 0.1), { doc, size: SIZE })!.parts[0]!.rect;
    const settled = sceneLayout(opAt(doc, 's', 6), { doc, size: SIZE })!.parts[0]!.rect;
    expect(early.y).toBeGreaterThan(settled.y);
  });

  it('아직 나오지 않은 목록 줄은 자리가 없다(그리기도 건너뛴다)', () => {
    const doc = sceneDoc([{ id: 's', kind: 'scene', sceneId: 'bulletList', at: 0, duration: 8, props: CASES['bulletList'] }]);
    const props = sceneLayout(opAt(doc, 's', 0.5), { doc, size: SIZE })!.parts.map((p) => p.prop);
    expect(props).toEqual(['heading', 'items[0]']);
  });

  it('모르는 씬(호스트 씬)과 단색 배경은 안쪽을 모른다 — 아이템 상자 그대로', () => {
    expect(Object.keys(BUILTIN_SCENE_LAYOUTS)).not.toContain('solid');
    const doc = sceneDoc([{ id: 'bg', kind: 'scene', sceneId: 'solid', at: 0, duration: 8 }, { id: 'h', kind: 'scene', sceneId: 'myHostScene', at: 0, duration: 8 }]);
    expect(sceneLayout(opAt(doc, 'bg', 1), env)).toBeNull();
    expect(sceneFootprint(opAt(doc, 'h', 1), env)).toBeNull();
  });
});

describe('§5.13 (V) 37-6 한 점 아래 씬의 글자 — 가리키기·Alt 인스펙터가 쓰는 답', () => {
  const items: VideoItem[] = [
    { id: 'bg', kind: 'scene', sceneId: 'solid', at: 0, duration: 16 },
    { id: 'intro', kind: 'scene', sceneId: 'title', at: 0, duration: 4, label: '제목', props: CASES['title'] },
    { id: 'points', kind: 'scene', sceneId: 'bulletList', at: 4, duration: 6, label: '목록', props: CASES['bulletList'] },
  ];

  it('부제 위를 가리키면 부제 값(자리·글자·상자)이 나온다', () => {
    const doc = sceneDoc(items);
    const op = opAt(doc, 'intro', 2);
    const sub = sceneLayout(op, { doc, size: SIZE })!.parts.find((p) => p.prop === 'subtitle')!;
    const cx = sub.rect.x + sub.rect.width / 2;
    const cy = sub.rect.y + sub.rect.height / 2;
    expect(scenePartAt(op, { doc, size: SIZE }, cx, cy)).toMatchObject({ prop: 'subtitle', path: 'props.subtitle', text: 'Vibisual · Vibistudio', tag: 'scene' });
    // 제목 줄과 부제 사이·화면 구석은 글자가 아니다.
    expect(scenePartAt(op, { doc, size: SIZE }, 10, 10)).toBeNull();
  });

  it('목록 줄은 배열 칸 자리로 나온다 — 머리점을 가리켜도 그 줄', () => {
    const doc = sceneDoc(items);
    const op = opAt(doc, 'points', 9);
    const second = sceneLayout(op, { doc, size: SIZE })!.parts.find((p) => p.prop === 'items[1]')!;
    expect(scenePartAt(op, { doc, size: SIZE }, second.rect.x + 2, second.rect.y + second.rect.height / 2)).toMatchObject({ prop: 'items[1]', text: '에이전트가 문서를 직접 고치고 스틸로 검수' });
  });

  it('아이템 배치·크기 배율을 따라 문서 좌표로 옮긴다', () => {
    const doc = sceneDoc([{ id: 'small', kind: 'scene', sceneId: 'title', at: 0, duration: 4, props: CASES['title'], transform: { x: 960, y: 0, width: 960, height: 540, scale: 0.5 } } as VideoItem]);
    const op = opAt(doc, 'small', 2);
    const local = sceneLayout(op, { doc, size: SIZE })!.parts.find((p) => p.prop === 'title')!.rect;
    const t = op.transform;
    const docX = t.x + t.width / 2 + (local.x + local.width / 2 - t.width / 2) * t.scale;
    const docY = t.y + t.height / 2 + (local.y + local.height / 2 - t.height / 2) * t.scale;
    expect(scenePartAt(op, { doc, size: SIZE }, docX, docY)?.prop).toBe('title');
    // 옮기기 전 자리(씬 상자 안 좌표 그대로)는 그 글자가 아니다.
    expect(scenePartAt(op, { doc, size: SIZE }, local.x + local.width / 2, local.y + local.height / 2)?.prop).not.toBe('title');
  });

  it('재는 함수를 준 고르기는 씬 위 빈 곳을 아래 배경에게 넘기고, 글자 위는 그 씬 — 칠한 자리 상자로', () => {
    const doc = sceneDoc(items);
    const timeline = resolveTimeline(doc);
    const measure = { measure: estimateTextMeasure };
    expect(hitTest(doc, timeline, 2, 10, 10, measure)?.op.itemId).toBe('bg');
    const op = opAt(doc, 'intro', 2);
    const sub = sceneLayout(op, { doc, size: SIZE })!.parts.find((p) => p.prop === 'subtitle')!.rect;
    const hit = hitTest(doc, timeline, 2, sub.x + sub.width / 2, sub.y + sub.height / 2, measure)!;
    expect(hit.op.itemId).toBe('intro');
    expect(hit.rect.width).toBeLessThan(SIZE.width);
    expect(opBounds(doc, op, measure)).toEqual(hit.rect);
  });

  it('재는 함수가 없으면 종전 그대로(무대 모드) — 씬 상자 전체', () => {
    const doc = sceneDoc(items);
    const hit = hitTest(doc, resolveTimeline(doc), 2, 10, 10)!;
    expect(hit.op.itemId).toBe('intro');
    expect(hit.rect).toEqual(opRect(hit.op));
    expect(opBounds(doc, hit.op)).toEqual(opRect(hit.op));
  });
});

describe('§5.13 (V) 37-6 값 자리 읽기', () => {
  it('배열 칸 자리를 가르고, 그 자리의 값 글자를 읽는다(장식 글자가 아니라 값)', () => {
    expect(parsePropIndex('items[12]')).toEqual({ key: 'items', index: 12 });
    expect(parsePropIndex('subtitle')).toBeNull();
    const doc = sceneDoc([{ id: 'q', kind: 'scene', sceneId: 'quote', at: 0, duration: 4, props: { ...CASES['quote'], items: ['a', 'b'] } }]);
    const op = opAt(doc, 'q', 2);
    expect(scenePropText(op, 'by')).toBe('SCENARIO.md §5.13');
    expect(scenePropText(op, 'items[1]')).toBe('b');
    expect(scenePropText(op, 'items[5]')).toBeNull();
  });
});
