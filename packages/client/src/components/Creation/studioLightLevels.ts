/**
 * §5.13 (R-10) — the studio light levels every 3D view uses (Vibi3D view, candidate preview, video model scenes,
 * product stills). Kept apart from three so the video inspector can show the same defaults without loading it.
 */
export const STUDIO_LIGHT = { ambient: 1.1, key: 1.4, environment: 1, keyPosition: [3, 5, 4] as const } as const;
