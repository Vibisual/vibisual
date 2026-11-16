import { imageId, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { boxBounds, unionBounds, type Box } from './imageGeometry.js';

/**
 * §5.13 (R-9) 레이어 편집기 ④⑤ — 여러 레이어에 한 번에 거는 편집. 잠긴 레이어는 어떤 편집에서도 그대로다((R-10) 보존 규약).
 * 정렬·분배는 회전한 레이어가 실제로 덮는 상자(축 정렬)로 잰다.
 */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type ArrangeMode = 'front' | 'forward' | 'backward' | 'back';

const editable = (layer: ImageLayer, ids: ReadonlySet<string>): boolean => ids.has(layer.id) && !layer.locked;

export function moveLayers(doc: ImageDocument, ids: readonly string[], dx: number, dy: number): ImageDocument {
  if (!dx && !dy) return doc;
  const set = new Set(ids);
  return { ...doc, layers: doc.layers.map((layer) => editable(layer, set) ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer) };
}

/** 하나면 캔버스 기준, 둘 이상이면 고른 레이어들의 묶음 상자 기준. */
export function alignLayers(doc: ImageDocument, ids: readonly string[], mode: AlignMode): ImageDocument {
  const set = new Set(ids);
  const chosen = doc.layers.filter((layer) => set.has(layer.id));
  if (!chosen.length) return doc;
  const frame: Box = chosen.length === 1 ? { x: 0, y: 0, width: doc.width, height: doc.height } : unionBounds(chosen.map(boxBounds))!;
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (!editable(layer, set)) return layer;
      const b = boxBounds(layer);
      const dx = mode === 'left' ? frame.x - b.x : mode === 'right' ? frame.x + frame.width - (b.x + b.width)
        : mode === 'hcenter' ? frame.x + frame.width / 2 - (b.x + b.width / 2) : 0;
      const dy = mode === 'top' ? frame.y - b.y : mode === 'bottom' ? frame.y + frame.height - (b.y + b.height)
        : mode === 'vcenter' ? frame.y + frame.height / 2 - (b.y + b.height / 2) : 0;
      return dx || dy ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer;
    }),
  };
}

/** 셋 이상 — 양 끝은 두고 사이 간격을 같게. */
export function distributeLayers(doc: ImageDocument, ids: readonly string[], axis: 'x' | 'y'): ImageDocument {
  const set = new Set(ids);
  const chosen = doc.layers.filter((layer) => set.has(layer.id)).map((layer) => ({ layer, b: boxBounds(layer) }));
  if (chosen.length < 3) return doc;
  const start = (b: Box): number => axis === 'x' ? b.x : b.y;
  const size = (b: Box): number => axis === 'x' ? b.width : b.height;
  chosen.sort((a, b) => start(a.b) + size(a.b) / 2 - (start(b.b) + size(b.b) / 2));
  const first = chosen[0]!.b; const last = chosen[chosen.length - 1]!.b;
  const span = start(last) + size(last) - start(first);
  const gap = (span - chosen.reduce((sum, item) => sum + size(item.b), 0)) / (chosen.length - 1);
  const target = new Map<string, number>();
  let cursor = start(first);
  for (const item of chosen) { target.set(item.layer.id, cursor - start(item.b)); cursor += size(item.b) + gap; }
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      const shift = target.get(layer.id);
      if (!shift || layer.locked) return layer;
      return axis === 'x' ? { ...layer, x: layer.x + shift } : { ...layer, y: layer.y + shift };
    }),
  };
}

/** 앞뒤 순서 — 배열 뒤가 앞이다. 고른 것끼리의 순서는 지킨다. */
export function arrangeLayers(doc: ImageDocument, ids: readonly string[], mode: ArrangeMode): ImageDocument {
  const set = new Set(ids);
  const moving = doc.layers.filter((layer) => editable(layer, set));
  if (!moving.length) return doc;
  if (mode === 'front' || mode === 'back') {
    const rest = doc.layers.filter((layer) => !editable(layer, set));
    return { ...doc, layers: mode === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
  }
  const layers = [...doc.layers];
  const up = mode === 'forward';
  const order = up ? [...layers.keys()].reverse() : [...layers.keys()];
  for (const i of order) {
    const j = up ? i + 1 : i - 1;
    const here = layers[i]!; const there = layers[j];
    if (!there || !editable(here, set) || set.has(there.id)) continue;
    layers[i] = there; layers[j] = here;
  }
  return { ...doc, layers };
}

/** 레이어 패널 끌어 놓기 — `index` 는 배열 자리(0 = 맨 뒤). 잠긴 레이어는 자리를 지킨다. */
export function moveLayerToIndex(doc: ImageDocument, id: string, index: number): ImageDocument {
  const from = doc.layers.findIndex((layer) => layer.id === id);
  if (from < 0 || doc.layers[from]!.locked) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  const to = Math.max(0, Math.min(layers.length, index > from ? index - 1 : index));
  if (to === from) return doc;
  layers.splice(to, 0, layer!);
  return { ...doc, layers };
}

/** 복제본은 원본 바로 앞에 선다(안정 id 는 새로). 잠긴 레이어는 복제하지 않는다. */
export function duplicateLayers(doc: ImageDocument, ids: readonly string[], offset: number): { doc: ImageDocument; ids: string[] } {
  const set = new Set(ids);
  const created: string[] = [];
  const layers = doc.layers.flatMap((layer) => {
    if (!editable(layer, set)) return [layer];
    const copy = { ...layer, id: imageId(), x: layer.x + offset, y: layer.y + offset };
    created.push(copy.id);
    return [layer, copy];
  });
  return created.length ? { doc: { ...doc, layers }, ids: created } : { doc, ids: [] };
}

export function removeLayers(doc: ImageDocument, ids: readonly string[]): ImageDocument {
  const set = new Set(ids);
  const layers = doc.layers.filter((layer) => !editable(layer, set));
  return layers.length === doc.layers.length ? doc : { ...doc, layers };
}

/** 여러 레이어에 같은 값을 건다(불투명도·혼합 등). `locked` 를 푸는 패치만 잠긴 레이어에 닿는다. */
export function patchLayers(doc: ImageDocument, ids: readonly string[], patch: Partial<ImageLayer>): ImageDocument {
  const set = new Set(ids);
  return {
    ...doc,
    layers: doc.layers.map((layer) => !set.has(layer.id) || (layer.locked && patch.locked !== false)
      ? layer : { ...layer, ...patch, id: layer.id, kind: layer.kind }),
  };
}
