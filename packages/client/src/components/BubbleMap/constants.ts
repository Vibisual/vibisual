/** Screen-fixed canvas decoration; keep it below React Flow's renderer (z-index 4). */
export const CANVAS_PROJECT_WATERMARK = {
  className: 'pointer-events-none absolute bottom-5 right-6 z-[1] max-w-[calc(100%-6rem)] select-none truncate text-right text-2xl font-bold leading-none tracking-tight text-white/[0.12] sm:text-4xl lg:text-5xl xl:text-[56px]',
} as const;

/**
 * Selection focus keeps category colors; distant connections stay above the unrelated floor.
 * Motion is a critically damped spring (zero start velocity, half the change in the first fifth, slow settle).
 * One clock: bubbles, lines and task-edge icons start and stop on the same frames — durations live only in the transitions.
 * Don't stagger by depth (inner rings first): on a bubble with many connections it reads as each bubble firing its own effect in turn.
 * Level 0 has no filter: even `saturate(1)` makes the compositor filter the selected bubble's animated corona every frame.
 */
export const SELECTION_FOCUS = {
  nodeTransition: 'transition-[opacity,filter] duration-[420ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
  edgeTransition: 'transition-opacity duration-[420ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
  /** No focus: the whole map lights back up together. */
  restore: '',
  nodes: [
    '',
    'saturate-[1.1]',
    'opacity-[0.7] saturate-[0.85]',
    'opacity-50 saturate-[0.7]',
    'opacity-[0.38] saturate-[0.55]',
  ],
  edges: [
    '',
    '',
    'opacity-60',
    'opacity-40',
    'opacity-[0.28]',
  ],
  unrelatedNode: 'opacity-[0.22] saturate-[0.4]',
  unrelatedEdge: 'opacity-[0.12]',
} as const;
