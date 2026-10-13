/** §5.13 (V) 37-12 — 소리의 순수 판정(비트 분석·덕킹 곡선). 화면도 오디오 API 도 없다. */

export { BEAT_MAX_BPM, BEAT_MIN_BPM, analyzeBeats, downmixToMono, nearestBeat } from './beats.js';
export type { BeatAnalysis } from './beats.js';
export { DUCK_ATTACK_S, DUCK_DEFAULT_DB, DUCK_RELEASE_S, dbToGain, duckEnvelope, duckGainAt, mergeDuckRanges } from './duck.js';
export type { DuckOptions, DuckPoint, DuckRange } from './duck.js';
