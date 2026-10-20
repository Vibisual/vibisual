/** Metres and bounded repetitions for the opt-in architectural generator; draft dimensions remain unchanged. */
export const ARCHITECTURAL_DETAIL = {
  edge: { radius: 0.008, segments: 1, maximumFraction: 0.2 },
  frame: { width: 0.045, narrowFraction: 0.12, depth: 0.08, reveal: 0.025, gasket: 0.008, gasketDepth: 0.012,
    sashSetback: 0.025, mullionMinimum: 0.8, drainWidth: 0.045, drainHeight: 0.006, drainInset: 0.15,
    sillSlope: 0.012, sillProjection: 0.08, dripHeight: 0.009, dripSetback: 0.02 },
  ac: { width: 0.75, height: 0.5, depth: 0.3, radius: 0.025, fanRadius: 0.165, hubRadius: 0.04,
    faceDepth: 0.015, fanX: -0.1, fanZ: 0.165, grillInset: 0.035, slots: 12, slotWidth: 0.014, slotHeight: 0.34,
    bracketWidth: 0.04, bracketHeight: 0.2, bracketReach: 0.37, bracketX: 0.25, bladeCount: 3, bladeWidth: 0.06 },
  awning: { thickness: 0.018, curve: 0.09, curveSamples: 6, valanceMin: 0.12, scallopDepth: 0.025,
    scallopSpan: 0.24, maxScallops: 24, seamSpacing: 0.55, maxSeams: 8, seamRadius: 0.0025, railRadius: 0.012,
    bracketDrop: 0.35, armRadius: 0.017, bracketSize: [0.05, 0.16, 0.04] as [number, number, number] },
  wood: { plankWidth: 0.18, gap: 0.007, thickness: 0.032, maxPlanks: 20, grainRotation: 90, fastenerRadius: 0.005 },
  kerb: { width: 0.18, segmentLength: 1, joint: 0.012, maxSegments: 96, bevel: 0.012, drainEvery: 6, drainWidth: 0.36, drainDepth: 0.24 },
  door: { hingeRadius: 0.012, hingeHeight: 0.075, closerWidth: 0.16, closerHeight: 0.035, closerDepth: 0.04 },
  bench: { seatSlats: 4, backSlats: 3, gap: 0.012, thickness: 0.055 },
  colors: { gasket: '#24292b', fan: '#3a4143', grille: '#bfc7c5', joint: '#52504a', wood: '#78553c', woodSecondary: '#a47e55' },
} as const;
