import { vi } from 'vitest';
import { installInputCompositionGuard } from './inputComposition.js';

// Real EventTarget propagation/default flags, with a deterministic animation-frame boundary.
class TestView extends EventTarget {
  private frames = new Map<number, FrameRequestCallback>();
  private next = 0;
  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = ++this.next; this.frames.set(id, callback); return id;
  }
  cancelAnimationFrame(id: number): void { this.frames.delete(id); }
  frame(): void {
    const work = [...this.frames.values()]; this.frames.clear();
    for (const callback of work) callback(0);
  }
}

export function field(tagName = 'TEXTAREA'): EventTarget & { isConnected: boolean } {
  return Object.assign(new EventTarget(), { tagName, isConnected: true });
}

export function emit(view: TestView, type: string, target: EventTarget, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.assign(event, props);
  view.dispatchEvent(event);
  return event;
}

export function harness(): { view: TestView; dispose: () => void; command: ReturnType<typeof vi.fn> } {
  const view = new TestView();
  // No browser window in node tests; the guard only uses EventTarget + the frame scheduler above.
  const dispose = installInputCompositionGuard(view as unknown as Window);
  const command = vi.fn();
  view.addEventListener('keydown', command);
  return { view, dispose, command };
}
