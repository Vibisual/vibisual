/** Keep iframe mouse events in the host while letting the browser choose the visible target. */
export interface InspectorHitTest {
  elementFromPoint: (x: number, y: number) => Element | null;
  dispose: () => void;
}

export function createInspectorHitTest(doc: Document): InspectorHitTest {
  const pointers = new Map<HTMLIFrameElement, { value: string; priority: string }>();
  const restore = (frame: HTMLIFrameElement): void => {
    const original = pointers.get(frame);
    if (!original) return;
    if (original.value) frame.style.setProperty('pointer-events', original.value, original.priority);
    else frame.style.removeProperty('pointer-events');
  };
  const block = (frame: HTMLIFrameElement): void => {
    frame.style.setProperty('pointer-events', 'none', 'important');
  };
  const syncFrames = (): void => {
    const frames = new Set(doc.querySelectorAll('iframe'));
    for (const frame of pointers.keys()) {
      if (frames.has(frame)) continue;
      restore(frame);
      pointers.delete(frame);
    }
    for (const frame of frames) {
      if (pointers.has(frame)) continue;
      pointers.set(frame, {
        value: frame.style.getPropertyValue('pointer-events'),
        priority: frame.style.getPropertyPriority('pointer-events'),
      });
      block(frame);
    }
  };
  syncFrames();
  const observer = new MutationObserver(syncFrames);
  observer.observe(doc.body, { childList: true, subtree: true });

  return {
    elementFromPoint: (x, y) => {
      // Bounding boxes alone also match covered/clipped video frames. Restore only our
      // temporary blocker so native hit-testing observes stacking, clipping and the
      // frame's own pointer-events (render-only composition frames stay transparent).
      pointers.forEach((_original, frame) => restore(frame));
      try {
        return doc.elementFromPoint(x, y);
      } finally {
        pointers.forEach((_original, frame) => block(frame));
      }
    },
    dispose: () => {
      observer.disconnect();
      pointers.forEach((_original, frame) => restore(frame));
      pointers.clear();
    },
  };
}
