import { packBundleGeometry } from '@vibisual/compute';
import type { BundlePackingMessage, BundlePackingResult } from '../utils/bundleInteriorProtocol.js';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<BundlePackingMessage>) => void) | null;
  postMessage(message: BundlePackingResult, transfer?: Transferable[]): void;
};

worker.onmessage = ({ data }): void => {
  try {
    const output = packBundleGeometry(data.input, data.count, data.directions);
    worker.postMessage({ id: data.id, output }, [output.buffer as ArrayBuffer]);
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
