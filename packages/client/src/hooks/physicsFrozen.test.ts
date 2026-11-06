import { describe, expect, it } from 'vitest';
import { frozenSatelliteIds, type FrozenPhysicsBody } from './physicsFrozen.js';
import { extentOf, MAGNET_GAP } from './physicsGeometry.js';

// The removed JavaScript implementation is retained only as a parity oracle.
function originalFrozenIds(all: readonly FrozenPhysicsBody[]): Set<string> {
  const bodies = new Map(all.map((body) => [body.id, body]));
  const frozen = new Set<string>();
  for (const satellite of all.filter((body) => body.parentId !== null)) {
    if (satellite.dragging) continue;
    const parent = bodies.get(satellite.parentId!);
    if (!parent) continue;
    const sx = satellite.x - parent.x;
    const sy = satellite.y - parent.y;
    const satelliteDistance = Math.sqrt(sx * sx + sy * sy) || 1;
    for (const body of all) {
      if (body === satellite || body === parent) continue;
      const px = body.x - parent.x;
      const py = body.y - parent.y;
      const parentDistance = Math.sqrt(px * px + py * py) || 0.1;
      if (parentDistance > parent.radius + extentOf(body) + MAGNET_GAP + 1) continue;
      if (parentDistance >= satelliteDistance) continue;
      const dx = body.x - satellite.x;
      const dy = body.y - satellite.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.1;
      if (distance <= satellite.radius + extentOf(body) + MAGNET_GAP + 6) {
        frozen.add(satellite.id);
        break;
      }
    }
  }
  return frozen;
}

function body(id: string, x: number, y: number, extras: Partial<FrozenPhysicsBody> = {}): FrozenPhysicsBody {
  return { id, x, y, radius: 20, halfW: 20, halfH: 20, shape: 'circle', group: 'bubble', parentId: null, dragging: false, ...extras };
}

describe('Rust satellite return-path parity', () => {
  it('preserves contact thresholds, missing parents, and dragging', () => {
    for (const blockerX of [0, 50, 53, 53 + 1e-10, 69, 70, 100]) {
      for (const dragging of [false, true]) {
        const bodies = [body('P', 0, 0), body('S', 70, 0, { parentId: 'P', dragging }), body('B', blockerX, 0), body('M', 70, 0, { parentId: 'missing' })];
        expect([...frozenSatelliteIds(bodies)]).toEqual([...originalFrozenIds(bodies)]);
      }
    }
    expect([...frozenSatelliteIds([body('P', 0, 0), body('S', 70, 0, { parentId: 'P' }), body('B', 50, 0)])]).toEqual(['S']);
    expect([...frozenSatelliteIds([])]).toEqual([]);
  });

  it('preserves the original result for mixed shapes, groups and nested parents', () => {
    let seed = 0x6d2b79f5;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let round = 0; round < 100; round += 1) {
      const count = 12 + Math.floor(random() * 160);
      const bodies = Array.from({ length: count }, (_, index) => body(String(index), (random() - 0.5) * 2200, (random() - 0.5) * 1600, {
        radius: random() * 140,
        halfW: random() * 600,
        halfH: random() * 300,
        shape: random() < 0.7 ? 'circle' : 'rect',
        group: random() < 0.2 ? 'commentBox' : 'bubble',
        parentId: random() < 0.25 ? null : String(Math.floor(random() * (count + 2))),
        dragging: random() < 0.2,
      }));
      expect([...frozenSatelliteIds(bodies)], `round ${round}`).toEqual([...originalFrozenIds(bodies)]);
    }
  });

  it('does not lose touching bodies at spatial cell boundaries', () => {
    for (const origin of [-1e15, -106, -53, -1e-12, 0, 53, 106, 1e15]) {
      for (const offset of [53 - 1e-10, 53, 53 + 1e-10]) {
        const bodies = [body('P', origin, origin), body('S', origin + 70, origin, { parentId: 'P' }), body('B', origin + offset, origin)];
        expect([...frozenSatelliteIds(bodies)]).toEqual([...originalFrozenIds(bodies)]);
      }
    }
  });

  it('keeps zero-distance, non-finite and extreme-coordinate behavior', () => {
    for (const value of [0, -0, NaN, Infinity, -Infinity, 1e300, -1e300]) {
      const bodies = [
        body('P', value, 0),
        body('S', value, 0, { parentId: 'P' }),
        body('B', 0, 0, { shape: 'rect', halfW: value }),
        body('T', 70, 0, { parentId: 'S' }),
      ];
      expect([...frozenSatelliteIds(bodies)]).toEqual([...originalFrozenIds(bodies)]);
    }
  });
});
