import { withComputeMemory } from '@vibisual/compute';
import { extentOf, MAGNET_GAP, type PhysicsShape } from './physicsGeometry.js';

export interface FrozenPhysicsBody extends PhysicsShape {
  id: string;
  dragging: boolean;
}

const STRIDE = 6;

/** Rust owns the repeated neighborhood/distance work. The bridge only packs the
 * current step and translates frozen flags back to the existing body IDs. */
export function frozenSatelliteIds(bodies: readonly FrozenPhysicsBody[]): Set<string> {
  if (bodies.every((body) => body.parentId === null || body.dragging)) return new Set();
  const indices = new Map(bodies.map((body, index) => [body.id, index]));
  return withComputeMemory(bodies.length * STRIDE * Float64Array.BYTES_PER_ELEMENT, bodies.length, (context, inputPtr, outputPtr) => {
    const input = new Float64Array(context.memory.buffer, inputPtr, bodies.length * STRIDE);
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index]!;
      const offset = index * STRIDE;
      input[offset] = body.x;
      input[offset + 1] = body.y;
      input[offset + 2] = body.radius;
      input[offset + 3] = extentOf(body);
      input[offset + 4] = body.parentId === null ? -1 : indices.get(body.parentId) ?? -1;
      input[offset + 5] = body.dragging ? 1 : 0;
    }
    const status = context.exports.physics_frozen_satellites(inputPtr, bodies.length, MAGNET_GAP, outputPtr);
    if (status !== 0) throw new Error(`Rust satellite calculation failed (${status})`);
    // Rust allocation can grow memory, invalidating the input view's buffer.
    const flags = new Uint8Array(context.memory.buffer, outputPtr, bodies.length);
    const frozen = new Set<string>();
    for (let index = 0; index < bodies.length; index += 1) {
      if (flags[index] !== 0) frozen.add(bodies[index]!.id);
    }
    return frozen;
  });
}
