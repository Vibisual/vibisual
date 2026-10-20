import type { Object3D } from 'three';

const installed = new WeakSet<Object3D>();
export function markPreparedInstalled(object: Object3D): void { installed.add(object); }
export function isPreparedInstalled(object: Object3D): boolean { return installed.has(object); }
