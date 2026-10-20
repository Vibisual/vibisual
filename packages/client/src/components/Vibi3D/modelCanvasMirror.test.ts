import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createModelCanvasMirrorPublisher, modelCanvasMirrorKey, modelCanvasMirrorTarget,
  readModelCanvasMirror, subscribeModelCanvasMirror,
  type ModelCanvasMirrorPublisher, type ModelCanvasMirrorTarget,
} from './modelCanvasMirror.js';

const a = { projectId: 'C:/project', workRef: 'a' };
const b = { projectId: 'C:/project', workRef: 'b' };
const source = { width: 1920, height: 1080 } as HTMLCanvasElement;
const publishers: ModelCanvasMirrorPublisher[] = [];
const subscriptions: (() => void)[] = [];
let now = 0;
let scratch: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toDataURL: ReturnType<typeof vi.fn> };
let draw: ReturnType<typeof vi.fn>;
let createCanvas: ReturnType<typeof vi.fn>;
function publisher(): ModelCanvasMirrorPublisher {
  const value = createModelCanvasMirrorPublisher(); publishers.push(value); return value;
}
function subscribe(target: ModelCanvasMirrorTarget, listener = vi.fn()): () => void {
  const off = subscribeModelCanvasMirror(modelCanvasMirrorKey(target), listener); subscriptions.push(off); return off;
}
function read(target: ModelCanvasMirrorTarget = a) { return readModelCanvasMirror(modelCanvasMirrorKey(target)); }

beforeEach(() => {
  now = 0; draw = vi.fn();
  scratch = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: draw })), toDataURL: vi.fn(() => `data:image/jpeg;base64,frame-${now}`) };
  createCanvas = vi.fn(() => scratch);
  vi.stubGlobal('document', { createElement: createCanvas });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  subscriptions.splice(0).forEach(off => off());
  publishers.splice(0).forEach(value => value.dispose());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('same-window model canvas mirror', () => {
  it('isolates project, document and file identities while accepting equivalent path shapes', () => {
    expect(modelCanvasMirrorKey(a)).toBe(modelCanvasMirrorKey({ ...a, projectId: 'C:\\project' }));
    expect(modelCanvasMirrorKey(a)).not.toBe(modelCanvasMirrorKey({ ...a, projectId: 'C:/other' }));
    expect(modelCanvasMirrorKey(a)).not.toBe(modelCanvasMirrorKey({ projectId: a.projectId, file: 'a' }));
    expect(modelCanvasMirrorKey(a)).toBe(modelCanvasMirrorKey({ ...a, file: 'unused-output.glb' }));
    expect(modelCanvasMirrorKey({ projectId: a.projectId })).toBeNull();
    expect(modelCanvasMirrorKey({ projectId: '', workRef: 'a' })).toBeNull();
  });

  it('rejects a loading/conflicted scene or a scene left behind by a route change', () => {
    expect(modelCanvasMirrorTarget(a, a, false)).toEqual(a);
    expect(modelCanvasMirrorTarget(a, a, true)).toBeNull();
    expect(modelCanvasMirrorTarget(b, a, false)).toBeNull();
    expect(modelCanvasMirrorTarget({ ...a, projectId: 'elsewhere' }, a, false)).toBeNull();
    expect(modelCanvasMirrorTarget({ projectId: a.projectId, file: 'next.glb' }, { projectId: a.projectId, file: 'old.glb' }, false)).toBeNull();
    expect(modelCanvasMirrorTarget(a, null, false)).toBeNull();
  });

  it('captures only for subscribers, bounds both dimensions and throttles repeated renders', () => {
    const pub = publisher(); pub.publish(a, source);
    expect(createCanvas).not.toHaveBeenCalled();
    const updated = vi.fn(); const off = subscribe(a, updated);
    pub.publish(a, source);
    expect(draw).toHaveBeenLastCalledWith(source, 0, 0, 480, 270);
    expect(scratch.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.78);
    expect(read()).toMatchObject({ width: 480, height: 270 });
    now = 499; pub.publish(a, source); expect(draw).toHaveBeenCalledOnce();
    now = 500; pub.publish(a, source); expect(draw).toHaveBeenCalledTimes(2);
    expect(updated).toHaveBeenCalledTimes(2);
    off(); expect(read()).toBeNull();
    now = 1000; pub.publish(a, source); expect(draw).toHaveBeenCalledTimes(2);
    expect(scratch.width).toBe(0);
    subscribe(a); pub.publish(a, source); expect(draw).toHaveBeenCalledTimes(3);
    now = 1500; pub.publish(a, { width: 500, height: 1000 } as HTMLCanvasElement);
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 160, 320);
  });

  it('clears dirty frames on a target change and never publishes after disposal', () => {
    const pub = publisher(); const changedA = vi.fn(); subscribe(a, changedA); subscribe(b);
    pub.publish(a, source); expect(read()).not.toBeNull();
    now = 1; pub.publish(b, source);
    expect(read(a)).toBeNull(); expect(read(b)).not.toBeNull(); expect(changedA).toHaveBeenCalledTimes(2);
    pub.dispose(); expect(read(b)).toBeNull(); expect(scratch.width).toBe(0);
    now = 1000; pub.publish(a, source); expect(read(a)).toBeNull();
  });

  it('does not let an old publisher clear a newer publisher of the same document', () => {
    subscribe(a); const old = publisher(), current = publisher();
    old.publish(a, source); now = 1; current.publish(a, source);
    const frame = read(); old.dispose(); expect(read()).toBe(frame);
    current.dispose(); expect(read()).toBeNull();
  });

  it('drops a stale frame when the drawing buffer fails and recovers on a later frame', () => {
    subscribe(a); const pub = publisher(); pub.publish(a, source);
    draw.mockImplementationOnce(() => { throw new Error('context lost'); });
    now = 500; pub.publish(a, source); expect(read()).toBeNull();
    now = 1000; pub.publish(a, source); expect(read()).not.toBeNull();
    pub.publish(null, source); expect(read()).toBeNull();
  });
});
