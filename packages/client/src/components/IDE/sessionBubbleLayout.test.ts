import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REDUCED_MOTION_LOOP_SLOWDOWN, type QueuedCommand, type SubAgentStreamEvent } from '@vibisual/shared';
import { buildSessionBubbles, type SessionBubbleModel } from './sessionBubbles.js';
import {
  SESSION_BUBBLE_MAP,
  SESSION_BUBBLE_MOTION,
  fitTransform,
  layoutSessionBubbles,
  orbitRingCapacity,
  orbitRingRadius,
  orbitSlotPosition,
  pickVisible,
  radiusFor,
  satelliteOffset,
  zoomAround,
} from './sessionBubbleLayout.js';

/** §5.5 #17-50 [버블] 배치 — 원 · 궤도 · 위성. 자리는 처음 닿은 순서로 고정, 넘치면 접는다. */

const ROOT = 'C:/work/proj';
let seq = 0;
const use = (ts: number, toolName: string, input: unknown, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent =>
  ({
    id: `e${String(++seq)}`, subAgentId: 's', parentAgentId: 'a', timestamp: ts, eventType: 'tool_use',
    toolName, content: JSON.stringify(input), ...extra,
  }) as SubAgentStreamEvent;
const model = (events: SubAgentStreamEvent[]): SessionBubbleModel =>
  buildSessionBubbles({ streams: [{ events, commands: [] as QueuedCommand[] }], rootPath: ROOT, platform: 'win32' });
/** 폴더 `n` 개 — 폴더마다 파일 하나. */
const folders = (n: number, start = 0): SubAgentStreamEvent[] =>
  Array.from({ length: n }, (_, i) => use(100 + start + i, 'Read', { file_path: `${ROOT}/d${String(start + i)}/f.ts` }));

describe('§5.5 #17-50 — 궤도 칸은 고정 간격, 12시부터 시계 방향', () => {
  it('첫 칸은 12시(바로 위), 둘째 칸은 시계 방향으로 한 칸', () => {
    const r0 = orbitRingRadius(0);
    expect(orbitSlotPosition(0)).toEqual({ x: 0, y: -r0, ring: 0 });
    const second = orbitSlotPosition(1);
    expect(second.x).toBeGreaterThan(0); // 시계 방향 = 오른쪽으로
    expect(Math.round(Math.hypot(second.x, second.y))).toBe(r0);
  });

  it('궤도가 차면 바깥 궤도를 연다 — 칸 수는 둘레 ÷ 칸 지름', () => {
    const cap0 = orbitRingCapacity(0);
    expect(cap0).toBe(Math.floor((2 * Math.PI * orbitRingRadius(0)) / SESSION_BUBBLE_MAP.slot));
    expect(orbitSlotPosition(cap0 - 1).ring).toBe(0);
    expect(orbitSlotPosition(cap0).ring).toBe(1);
    expect(orbitRingRadius(1) - orbitRingRadius(0)).toBe(SESSION_BUBBLE_MAP.slot);
  });

  it('칸끼리 겹치지 않는다(같은 궤도 이웃 칸의 중심 거리 ≥ 칸 지름 근처)', () => {
    for (let ring = 0; ring < 3; ring += 1) {
      let base = 0;
      for (let r = 0; r < ring; r += 1) base += orbitRingCapacity(r);
      const a = orbitSlotPosition(base);
      const b = orbitSlotPosition(base + 1);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(SESSION_BUBBLE_MAP.slot * 0.95);
    }
  });

  it('새 버블이 늘어도 앞 버블의 자리는 그대로다', () => {
    const before = layoutSessionBubbles(model(folders(3)));
    const after = layoutSessionBubbles(model([...folders(3), ...folders(5, 3)]));
    for (const b of before.bubbles) {
      const same = after.bubbles.find((x) => x.id === b.id);
      expect(same && [same.x, same.y]).toEqual([b.x, b.y]);
    }
  });
});

describe('§5.5 #17-50 — 위성 · 넘침', () => {
  it('파일은 폴더 둘레 고정 칸(12시부터) — 13개 이상이면 최근 11개 + `+N`', () => {
    const many = Array.from({ length: 14 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/src/f${String(i)}.ts` }));
    const layout = layoutSessionBubbles(model(many));
    const folder = layout.bubbles.find((b) => b.kind === 'folder')!;
    const sats = layout.bubbles.filter((b) => b.kind === 'file');
    expect(sats).toHaveLength(SESSION_BUBBLE_MAP.satellites - 1);
    // 남는 것은 최근에 닿은 것 — 가장 오래된 f0·f1·f2 가 접힌다.
    expect(sats.map((s) => s.file!.name)).not.toContain('f0.ts');
    expect(sats[0]!.file!.name).toBe('f3.ts');
    const more = layout.bubbles.find((b) => b.kind === 'more')!;
    expect(more.hiddenCount).toBe(3);
    const off = satelliteOffset(0);
    expect([sats[0]!.x - folder.x, sats[0]!.y - folder.y]).toEqual([off.dx, off.dy]);
    expect(sats.every((s) => s.parentId === folder.id && !s.labelAlways)).toBe(true);
  });

  it('pickVisible — 한도 안이면 그대로, 넘치면 최근 것(limit-1)을 처음 닿은 순서로', () => {
    const items = [1, 2, 3, 4].map((n) => ({ reads: 1, writes: 0, firstAt: n, lastAt: n === 1 ? 99 : n } as never));
    expect(pickVisible(items, 4).hidden).toBe(0);
    const { visible, hidden } = pickVisible(items, 3);
    expect(hidden).toBe(2);
    expect(visible.map((v: { firstAt: number }) => v.firstAt)).toEqual([1, 4]);
  });

  it('궤도가 상한을 넘으면 가장 식은 것부터 「그 밖 N곳」 한 점으로 접는다', () => {
    const n = SESSION_BUBBLE_MAP.orbitMax + 5;
    const layout = layoutSessionBubbles(model(folders(n)));
    const orbit = layout.bubbles.filter((b) => b.kind === 'folder');
    expect(orbit).toHaveLength(SESSION_BUBBLE_MAP.orbitMax - 1);
    const overflow = layout.bubbles.find((b) => b.kind === 'overflow')!;
    expect(overflow.hiddenCount).toBe(n - (SESSION_BUBBLE_MAP.orbitMax - 1));
    // 가장 오래 전에 닿은 d0 이 접힌 쪽에 있다.
    expect(overflow.overflowNames).toContain('d0');
  });

  it('지름은 접촉 횟수의 자릿수 — 1회는 아래 끝, 1000회는 위 끝', () => {
    expect(radiusFor(1, SESSION_BUBBLE_MAP.fileR)).toBeGreaterThanOrEqual(SESSION_BUBBLE_MAP.fileR[0]);
    expect(radiusFor(999, SESSION_BUBBLE_MAP.fileR)).toBe(SESSION_BUBBLE_MAP.fileR[1]);
    expect(radiusFor(10, SESSION_BUBBLE_MAP.fileR)).toBeLessThan(radiusFor(100, SESSION_BUBBLE_MAP.fileR));
  });
});

describe('§5.5 #17-50 — 선의 방향(§2.1 #3 한 쌍에 방향은 하나)', () => {
  it('읽기 = 버블 → 가운데, 쓰기 = 가운데 → 버블 · 위성 선은 폴더와 파일 사이', () => {
    const layout = layoutSessionBubbles(model([
      use(10, 'Read', { file_path: `${ROOT}/a/x.ts` }),
      use(20, 'Write', { file_path: `${ROOT}/b/y.ts`, content: '' }),
    ]));
    const folderA = layout.bubbles.find((b) => b.folder?.relPath === 'a')!;
    const folderB = layout.bubbles.find((b) => b.folder?.relPath === 'b')!;
    const toA = layout.edges.find((e) => e.target === folderA.id)!;
    const toB = layout.edges.find((e) => e.target === folderB.id)!;
    expect([toA.from, toA.to, toA.tone]).toEqual([folderA.id, 'center', 'read']);
    expect([toB.from, toB.to, toB.tone]).toEqual(['center', folderB.id, 'write']);
    const sat = layout.edges.find((e) => e.satellite && e.target.endsWith('y.ts'))!;
    expect([sat.from, sat.tone]).toEqual([folderB.id, 'write']);
  });

  it('중첩 서브에이전트로만 닿은 버블의 선은 그 서브에이전트에서 나온다', () => {
    const layout = layoutSessionBubbles(model([
      use(10, 'Task', { description: 'scan' }, { toolUseId: 'T' }),
      use(20, 'WebFetch', { url: 'https://example.com/x' }, { nestedUnderToolUseId: 'T' }),
    ]));
    const task = layout.bubbles.find((b) => b.kind === 'task')!;
    const web = layout.bubbles.find((b) => b.kind === 'web')!;
    const edge = layout.edges.find((e) => e.target === web.id)!;
    expect([edge.from, edge.to]).toEqual([web.id, task.id]);
  });
});

describe('§5.5 #17-50 — 폴더 안(들어가기)', () => {
  it('폴더가 가운데, 그 폴더의 파일 전부가 둘레 · 이름은 늘 보인다', () => {
    const m = model(Array.from({ length: 15 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/src/f${String(i)}.ts` })));
    const key = m.folders[0]!.key;
    const layout = layoutSessionBubbles(m, key);
    expect(layout.focus?.key).toBe(key);
    const center = layout.bubbles.find((b) => b.center)!;
    expect([center.kind, center.x, center.y]).toEqual(['folder', 0, 0]);
    const files = layout.bubbles.filter((b) => b.kind === 'file');
    expect(files).toHaveLength(15);
    expect(files.every((f) => f.labelAlways)).toBe(true);
    expect(layout.edges.every((e) => e.from === center.id || e.to === center.id)).toBe(true);
  });

  it('없는 폴더 열쇠면 세션 지도로 돌아온다(focus = null)', () => {
    const layout = layoutSessionBubbles(model(folders(2)), 'nope');
    expect(layout.focus).toBeNull();
    expect(layout.bubbles[0]!.kind).toBe('center');
  });
});

describe('§5.5 #17-50 — 맞추기 · 배율', () => {
  it('fitTransform 은 경계의 가운데를 화면 가운데에 놓고 배율을 묶는다', () => {
    const t = fitTransform({ minX: -100, minY: -50, maxX: 100, maxY: 50 }, { width: 400, height: 200 }, { pad: 0, max: 10 });
    expect(t.k).toBe(2);
    expect([t.x, t.y]).toEqual([200, 100]);
    expect(fitTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 1000, height: 1000 }).k).toBe(1.4);
  });

  it('zoomAround 은 커서 아래 세계 좌표를 붙든다', () => {
    const t0 = { k: 1, x: 10, y: 20 };
    const t1 = zoomAround(t0, 2, 110, 120);
    const world0 = [(110 - t0.x) / t0.k, (120 - t0.y) / t0.k];
    const world1 = [(110 - t1.x) / t1.k, (120 - t1.y) / t1.k];
    expect(world1).toEqual(world0);
  });
});

describe('§5.5 #17-50 — 움직임 줄이기에서도 멈추지 않는다(§5.4 #31 (K) 규약)', () => {
  const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const seconds = (ms: number): string => `${ms / 1000}s`;

  it('평소 주기는 상수와 같다', () => {
    expect(css).toContain(`animation: session-bubble-pulse ${seconds(SESSION_BUBBLE_MAP.pulseMs)} ease-out infinite;`);
    expect(css).toContain(`animation: session-bubble-flow ${seconds(SESSION_BUBBLE_MAP.flowMs)} linear infinite;`);
  });

  it('줄이기 주기는 공유 배율만큼 느리고, 끄는 규칙이 없다', () => {
    expect(SESSION_BUBBLE_MOTION.pulseReducedMs).toBe(SESSION_BUBBLE_MAP.pulseMs * REDUCED_MOTION_LOOP_SLOWDOWN);
    const blocks: string[] = [];
    const head = '@media (prefers-reduced-motion: reduce)';
    for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + head.length)) {
      const open = css.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}' && --depth === 0) { blocks.push(css.slice(open + 1, i)); break; }
      }
    }
    const reduced = blocks.join('\n');
    expect(reduced).toContain(`.session-bubble-pulse { animation-duration: ${seconds(SESSION_BUBBLE_MOTION.pulseReducedMs)}; }`);
    expect(reduced).toContain(`.session-bubble-flow { animation-duration: ${seconds(SESSION_BUBBLE_MOTION.flowReducedMs)}; }`);
    expect(reduced).not.toMatch(/\.session-bubble-(pulse|flow)\s*\{[^}]*animation\s*:\s*none/);
  });
});
