import type { BubbleSurface } from './bubbleSurface.js';

/** Decorative layers never become a drag, selection or connection target. */
export function BubbleSurfaceDetail({ surface }: { surface: BubbleSurface }): React.JSX.Element {
  return <>
    <span
      aria-hidden="true"
      data-bubble-inner-rim
      className="pointer-events-none absolute rounded-full"
      style={{ inset: Math.max(0, 4 - Number(surface.body.borderWidth)), borderStyle: 'solid', ...surface.inner }}
    />
    {surface.specular && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100">
      <path d="M18 26 Q50 2 82 26" fill="none" stroke="#e2e8f0" strokeWidth=".65" opacity=".16" />
    </svg>}
  </>;
}
