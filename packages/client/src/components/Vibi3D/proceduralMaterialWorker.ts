import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { generateSurfaceWearPixels } from '@vibisual/compute';
import type { MaterialWorkerRequest, MaterialWorkerResponse } from './proceduralMaterialWorkerClient.js';

const scope = self as unknown as { onmessage: ((event: MessageEvent<MaterialWorkerRequest>) => void) | null; postMessage: (data: MaterialWorkerResponse, transfer?: Transferable[]) => void };
scope.onmessage = ({ data }: MessageEvent<MaterialWorkerRequest>): void => {
  try {
    if (data.kind === 'surface-wear') {
      const surfaceWear = generateSurfaceWearPixels(data.input);
      scope.postMessage({ id: data.id, surfaceWear } satisfies MaterialWorkerResponse, [...new Set(surfaceWear.map(map => map.buffer))]);
      return;
    }
    const maps = generateMaterialMaps(data.preset, data.options);
    const response: MaterialWorkerResponse = { id: data.id, maps };
    scope.postMessage(response, [...new Set(Object.values(maps).map(map => map.data.buffer as ArrayBuffer))]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies MaterialWorkerResponse);
  }
};
