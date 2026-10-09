export const SOUND_UI = {
  pollMs: 2000,
  maxImportBytes: 128 * 1024 * 1024,
  waveformHeight: 200,
  minCanvasWidth: 240,
  peakColumns: 1600,
  rangeThreshold: 0.01,
  maxZoom: 16,
  background: '#0b1416',
  wave: '#5eead4',
  grid: '#263b3d',
  selection: 'rgba(45,212,191,0.18)',
  playhead: '#fde68a',
} as const;
export const SOUND_ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.weba,audio/*';
export interface SoundRange { start: number; end: number }
