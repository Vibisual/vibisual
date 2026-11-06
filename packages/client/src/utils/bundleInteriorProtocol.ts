export interface BundlePackingMessage {
  id: number;
  input: Float64Array;
  count: number;
  directions: number;
}

export type BundlePackingResult = { id: number; output: Float64Array } | { id: number; error: string };
