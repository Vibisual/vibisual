import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { isImeConsumedKey } from '../../utils/inputComposition.js';
import type { Size } from './imageAnnotate.js';

export const MIN_IMAGE_ZOOM = 0.25;
export const MAX_IMAGE_ZOOM = 4;
const ZOOM_STEP = 0.25;
// Padding and scrollbar room are reserved independently of overflow so fitting cannot oscillate.
const VIEWPORT_GUTTER = 48;

export type ImageZoomAction = 'in' | 'out' | 'reset';

export function imageZoomAction(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'isComposing' | 'keyCode' | 'defaultPrevented'>): ImageZoomAction | null {
  if (event.altKey || isImeConsumedKey(event) || event.defaultPrevented) return null;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-') return 'out';
  if (event.key === '0') return 'reset';
  return null;
}

export function nextImageZoom(zoom: number, action: ImageZoomAction): number {
  if (action === 'reset') return 1;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, zoom + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP)));
}

/** 100% means the initial fitted view; only the on-screen size changes. */
export function zoomedImageSize(natural: Size, viewport: Size, zoom: number): Size {
  if (natural.w <= 0 || natural.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return { w: 0, h: 0 };
  const fit = Math.min(1, Math.max(1, viewport.w - VIEWPORT_GUTTER) / natural.w, Math.max(1, viewport.h - VIEWPORT_GUTTER) / natural.h);
  return { w: natural.w * fit * zoom, h: natural.h * fit * zoom };
}

export function useImageLightboxZoom(natural: Size, source: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const size = zoomedImageSize(natural, viewport, zoom);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) => prev.w === rect.width && prev.h === rect.height ? prev : { w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setZoom(1);
    pendingCenter.current = null;
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
  }, [source]);

  const changeZoom = useCallback((action: ImageZoomAction): void => {
    if (action !== 'reset' && nextImageZoom(zoom, action) === zoom) {
      pendingCenter.current = null;
      return;
    }
    const el = viewportRef.current;
    const surface = surfaceRef.current;
    if (action === 'reset') {
      pendingCenter.current = null;
      if (el) { el.scrollLeft = 0; el.scrollTop = 0; }
    } else if (el && surface) {
      const bounds = el.getBoundingClientRect();
      const image = surface.getBoundingClientRect();
      if (image.width > 0 && image.height > 0) {
        pendingCenter.current = {
          x: Math.min(1, Math.max(0, (bounds.left + el.clientWidth / 2 - image.left) / image.width)),
          y: Math.min(1, Math.max(0, (bounds.top + el.clientHeight / 2 - image.top) / image.height)),
        };
      }
    }
    setZoom((prev) => nextImageZoom(prev, action));
  }, [zoom]);

  // Keep the viewed image point at the viewport center when zooming in or out.
  useLayoutEffect(() => {
    const center = pendingCenter.current;
    const el = viewportRef.current;
    const surface = surfaceRef.current;
    if (!center || !el || !surface) return;
    const bounds = el.getBoundingClientRect();
    const image = surface.getBoundingClientRect();
    el.scrollLeft += image.left + center.x * image.width - bounds.left - el.clientWidth / 2;
    el.scrollTop += image.top + center.y * image.height - bounds.top - el.clientHeight / 2;
    pendingCenter.current = null;
  }, [size.w, size.h]);

  return { viewportRef, surfaceRef, size, zoom, changeZoom };
}
