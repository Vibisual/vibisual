import fs from 'node:fs';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_GUIDE, MOTION_CRAFT_GUIDE, VIBISTUDIO_AGENT_GUIDE, VIBISTUDIO_GUIDE_TOPICS, compositionGuideFor, fullGuideFor, guideTopicFor,
} from './guide.js';
import { mountGuideRoutes } from '../server/guideRoutes.js';

/**
 * §5.13 37-16 (A)~(C) — 규약 글을 핵심 + 주제로 나눈 뒤에도 내용이 하나도 빠지지 않았는가.
 * 대조 기준은 나누기 전 글을 줄 단위로 떠 둔 시험 전용 스냅숏이다(정본은 guide.ts 하나 — 이 파일은 내주지 않는다).
 * 글을 의도해 고치면 스냅숏의 그 줄도 함께 고친다.
 */
interface BeforeSplit {
  readonly agentGuide: readonly string[];
  readonly compositionGuide: readonly string[];
  readonly compositionGuideEngine120: readonly string[];
  readonly craftGuide: readonly string[];
}
const before = JSON.parse(
  fs.readFileSync(new URL('./__fixtures__/guideBeforeSplit.json', import.meta.url), 'utf8'),
) as BeforeSplit;

/** 첫 바퀴 핵심 글 상한 — 3KB. */
const CORE_MAX_BYTES = 3 * 1024;

/** `before` 의 줄이 모두 `text` 에 같은 순서로 있는가(사이에 새 줄이 더해지는 것은 허용) — 없으면 처음 못 찾은 줄. */
function firstMissingInOrder(text: string, before: readonly string[]): string | null {
  const lines = text.split('\n');
  let at = 0;
  for (const line of before) {
    while (at < lines.length && lines[at] !== line) at += 1;
    if (at >= lines.length) return line;
    at += 1;
  }
  return null;
}

const servedLines = (): Set<string> =>
  new Set([VIBISTUDIO_AGENT_GUIDE, ...VIBISTUDIO_GUIDE_TOPICS.map((t) => guideTopicFor(t.id)!)].join('\n').split('\n'));

describe('§5.13 37-16 — core guide and topics', () => {
  it('the core read on the first pass stays within 3KB', () => {
    expect(Buffer.byteLength(VIBISTUDIO_AGENT_GUIDE, 'utf8')).toBeLessThanOrEqual(CORE_MAX_BYTES);
  });

  it('the core carries the hard rules, how to call, the model summary, the work order and every topic with its address', () => {
    for (const heading of ['## Hard rules', '## Calling the API', '## Document model', '## Work order', '## Topics']) {
      expect(VIBISTUDIO_AGENT_GUIDE).toContain(heading);
    }
    // 주제 주소는 핵심 글이 정의한 Base 에 기대어 적는다 — 둘이 함께 있어야 주소가 된다.
    expect(VIBISTUDIO_AGENT_GUIDE).toContain('Base: $VIBISUAL_BASE/api/app/vibistudio ');
    expect(VIBISTUDIO_AGENT_GUIDE).toContain('GET <Base>/guide/<topic>');
    for (const topic of VIBISTUDIO_GUIDE_TOPICS) {
      expect(VIBISTUDIO_AGENT_GUIDE).toContain(`- ${topic.id}: ${topic.what} (${topic.when})`);
    }
  });

  it('every non-blank line of the pre-split guides is still served, unchanged, by the core or a topic', () => {
    const served = servedLines();
    const all = [...before.agentGuide, ...before.compositionGuide, ...before.compositionGuideEngine120, ...before.craftGuide];
    const engineLines = before.compositionGuideEngine120.slice(before.compositionGuide.length);
    const missing = all.filter((line) => line.trim() !== '' && !served.has(line) && !engineLines.includes(line));
    expect(missing).toEqual([]);
    expect(guideTopicFor('composition', 120)).toContain(engineLines.filter((l) => l !== '').join('\n'));
  });

  it('/composition/guide keeps every pre-split line in order (new lines may be added between); /craft serves the same bytes', () => {
    expect(firstMissingInOrder(COMPOSITION_GUIDE, before.compositionGuide)).toBeNull();
    expect(firstMissingInOrder(compositionGuideFor(), before.compositionGuide)).toBeNull();
    expect(firstMissingInOrder(compositionGuideFor(120), before.compositionGuideEngine120)).toBeNull();
    // 엔진 줄은 끝에 그대로 붙는다.
    const engineTail = before.compositionGuideEngine120.slice(before.compositionGuide.length).join('\n');
    expect(compositionGuideFor(120).endsWith(engineTail)).toBe(true);
    expect(MOTION_CRAFT_GUIDE).toBe(before.craftGuide.join('\n'));
    expect(guideTopicFor('craft')).toBe(MOTION_CRAFT_GUIDE);
  });

  it('topic ids are unique, every topic has text, unknown ids have none, and /guide/all holds the core and every topic', () => {
    const ids = VIBISTUDIO_GUIDE_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('all');
    const all = fullGuideFor(120);
    expect(all.startsWith(VIBISTUDIO_AGENT_GUIDE)).toBe(true);
    for (const id of ids) {
      const text = guideTopicFor(id, 120)!;
      expect(text.startsWith('# ')).toBe(true);
      expect(all).toContain(text);
    }
    expect(guideTopicFor('nope')).toBeUndefined();
  });
});

describe('§5.13 37-16 (B) — the guide routes', () => {
  type Handler = (req: { params: Record<string, string> }, res: FakeRes) => void;
  interface FakeRes { code: number; body: string; status(c: number): FakeRes; type(t: string): FakeRes; send(b: string): FakeRes }
  const handlers = new Map<string, Handler>();
  mountGuideRoutes({ get: (path: string, h: Handler) => { handlers.set(path, h); } } as unknown as Express);
  const call = (path: string, params: Record<string, string> = {}): FakeRes => {
    const res: FakeRes = {
      code: 200, body: '',
      status(c) { this.code = c; return this; },
      type() { return this; },
      send(b) { this.body = b; return this; },
    };
    handlers.get(path)!({ params }, res);
    return res;
  };

  it('/guide is the core, /guide/:topic a topic, /guide/all everything, an unknown topic 404 with the list', () => {
    expect(call('/guide').body).toBe(VIBISTUDIO_AGENT_GUIDE);
    expect(call('/guide/:topic', { topic: 'values' }).body).toBe(guideTopicFor('values'));
    expect(call('/guide/:topic', { topic: 'all' }).body).toBe(fullGuideFor());
    const unknown = call('/guide/:topic', { topic: 'nope' });
    expect(unknown.code).toBe(404);
    for (const t of VIBISTUDIO_GUIDE_TOPICS) expect(unknown.body).toContain(t.id);
  });

  it('/composition/guide and /craft keep answering as before', () => {
    expect(firstMissingInOrder(call('/composition/guide').body, before.compositionGuide)).toBeNull();
    expect(call('/craft').body).toBe(before.craftGuide.join('\n'));
  });
});
