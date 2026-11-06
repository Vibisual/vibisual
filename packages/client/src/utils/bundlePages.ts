import { BUNDLE_BUBBLE } from '@vibisual/shared';

export function bundlePageWindow(count: number, requestedPage: number): { page: number; pages: number; start: number; end: number } {
  const pages = Math.max(1, Math.ceil(count / BUNDLE_BUBBLE.interiorMax));
  const page = Math.max(0, Math.min(pages - 1, Math.floor(requestedPage)));
  const start = page * BUNDLE_BUBBLE.interiorMax;
  return { page, pages, start, end: Math.min(count, start + BUNDLE_BUBBLE.interiorMax) };
}
