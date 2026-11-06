import type { Box } from './imageAnnotate.js';
import type { ColorKeyOptions, ColorKeyResult, PixelBuffer, Rgb } from './imageEdit.js';

export type ImagePixelJob =
  | { kind: 'key'; options: Omit<ColorKeyOptions, 'distances'> }
  | { kind: 'fill'; color: Rgb }
  | { kind: 'transparent' }
  | { kind: 'trim'; tolerance: number };
export type ImagePixelOutput = ColorKeyResult | PixelBuffer | Box | boolean | null;
export interface ImagePixelMessage { id: number; sourceId: number; pixels?: PixelBuffer; job: ImagePixelJob }
export type ImagePixelReply = { id: number; output: ImagePixelOutput } | { id: number; error: string };
