/** Screen-fixed canvas decoration; keep it below React Flow's renderer (z-index 4). */
export const CANVAS_PROJECT_WATERMARK = {
  className: 'pointer-events-none absolute bottom-5 right-6 z-[1] max-w-[calc(100%-6rem)] select-none truncate text-right text-2xl font-bold leading-none tracking-tight text-white/[0.12] sm:text-4xl lg:text-5xl xl:text-[56px]',
} as const;

/**
 * Selection focus preserves category colors; distant connections stay above the unrelated floor.
 *
 * Motion is an iOS-style critically damped spring rather than a switch: the curve leaves with zero
 * velocity (nothing pops), covers half the change in the first fifth, then settles slowly. Each ring
 * recedes a little slower than the one inside it, so the map sinks back in depth order instead of
 * dimming all at once. Every state carries exactly one `duration-*` — two on one element have no
 * defined winner. Level 0 has no filter at all: `saturate(1)` changes nothing but still makes the
 * compositor filter the selected bubble's animated corona on every frame.
 */
export const SELECTION_FOCUS = {
  nodeTransition: 'transition-[opacity,filter] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
  edgeTransition: 'transition-opacity ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
  /** No focus: the whole map lights back up together. */
  restore: 'duration-[420ms]',
  nodes: [
    'duration-[360ms]',
    'saturate-[1.1] duration-[360ms]',
    'opacity-[0.7] saturate-[0.85] duration-[460ms]',
    'opacity-50 saturate-[0.7] duration-[520ms]',
    'opacity-[0.38] saturate-[0.55] duration-[560ms]',
  ],
  edges: [
    'duration-[360ms]',
    'duration-[360ms]',
    'opacity-60 duration-[460ms]',
    'opacity-40 duration-[520ms]',
    'opacity-[0.28] duration-[560ms]',
  ],
  unrelatedNode: 'opacity-[0.22] saturate-[0.4] duration-[600ms]',
  unrelatedEdge: 'opacity-[0.12] duration-[600ms]',
} as const;
