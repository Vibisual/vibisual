/** Screen-fixed canvas decoration; keep it below React Flow's renderer (z-index 4). */
export const CANVAS_PROJECT_WATERMARK = {
  className: 'pointer-events-none absolute bottom-5 right-6 z-[1] max-w-[calc(100%-6rem)] select-none truncate text-right text-2xl font-bold leading-none tracking-tight text-white/[0.12] sm:text-4xl lg:text-5xl xl:text-[56px]',
} as const;
