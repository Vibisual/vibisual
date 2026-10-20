import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelCanvasMirrorPublisher, type ModelCanvasMirrorPublisher, type ModelCanvasMirrorTarget } from './modelCanvasMirror.js';
import { useModelCanvasMirror } from './useModelCanvasMirror.js';

const target = { projectId: 'project', workRef: 'a' };
const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
let seen: ReturnType<typeof useModelCanvasMirror>;
let component: ReactTestRenderer | undefined;
let publisher: ModelCanvasMirrorPublisher;
let draw: ReturnType<typeof vi.fn>;
function Probe(props: ModelCanvasMirrorTarget & { enabled: boolean }): null { seen = useModelCanvasMirror(props); return null; }
function render(props = { ...target, enabled: true }): void {
  act(() => { if (component) component.update(createElement(Probe, props)); else component = create(createElement(Probe, props)); });
}
beforeEach(() => {
  draw = vi.fn(); publisher = createModelCanvasMirrorPublisher();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage: draw }), toDataURL: () => 'data:image/jpeg;base64,live' }) });
});
afterEach(() => { act(() => component?.unmount()); component = undefined; publisher.dispose(); vi.unstubAllGlobals(); });

describe('model canvas mirror subscription', () => {
  it('stops captures when disabled or unmounted and starts from no stale dirty frame when re-enabled', () => {
    render(); expect(seen).toBeNull();
    act(() => publisher.publish(target, canvas)); expect(seen?.url).toContain('data:image/jpeg');
    render({ ...target, enabled: false }); expect(seen).toBeNull();
    act(() => publisher.publish(target, canvas)); expect(draw).toHaveBeenCalledOnce();
    render(); expect(seen).toBeNull();
    act(() => publisher.publish(target, canvas)); expect(draw).toHaveBeenCalledTimes(2);
    expect(seen).not.toBeNull();
    act(() => component!.unmount()); component = undefined;
    publisher.publish(target, canvas); expect(draw).toHaveBeenCalledTimes(2);
  });

  it('never presents the prior target during a document or project switch', () => {
    render(); act(() => publisher.publish(target, canvas)); expect(seen).not.toBeNull();
    render({ ...target, workRef: 'b', enabled: true }); expect(seen).toBeNull();
    act(() => publisher.publish({ ...target, workRef: 'b' }, canvas)); expect(seen).not.toBeNull();
    render({ ...target, projectId: 'other', enabled: true }); expect(seen).toBeNull();
    act(() => publisher.dispose()); expect(seen).toBeNull();
  });
});
