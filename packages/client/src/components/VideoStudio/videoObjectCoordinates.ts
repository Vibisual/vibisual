import type { DrawOp } from '@vibisual/video/render';

export function objectLocalPoint(box: DrawOp['transform'], x: number, y: number): { x: number; y: number } {
  const angle = -box.rotation * Math.PI / 180;
  const dx = (x - box.x - box.width / 2) / (box.scale || 1), dy = (y - box.y - box.height / 2) / (box.scale || 1);
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle) + box.width / 2, y: dx * Math.sin(angle) + dy * Math.cos(angle) + box.height / 2 };
}
export function objectDocumentRect(box: DrawOp['transform'], rect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const angle = box.rotation * Math.PI / 180;
  const points = [0, 1, 2, 3].map(i => {
    const dx = (rect.x + (i % 2) * rect.width - box.width / 2) * box.scale;
    const dy = (rect.y + Math.floor(i / 2) * rect.height - box.height / 2) * box.scale;
    return { x: box.x + box.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: box.y + box.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
