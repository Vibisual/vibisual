import { describe, expect, it } from 'vitest';
import { SATELLITE_MAX_BOUNDS, type BubbleData } from '@vibisual/shared';
import { canvasFolderBundleSatelliteMaxes, canvasFolderSatelliteMaxes, canvasRootBundleSatelliteMaxes } from './sessionCanvasSettings.js';

const folder = (id: string, path: string, maxSatellites?: number): BubbleData => ({
  id, path, absolutePath: path, label: id, bubbleType: 'internal_folder', status: 'idle', activity: 1,
  ...(maxSatellites === undefined ? {} : { maxSatellites }),
});

describe('canvasFolderSatelliteMaxes', () => {
  it('uses the matching project folder setting when absolute paths overlap', () => {
    const nodes = {
      a: folder('a', 'C:/work/shared', 5),
      b: folder('b', 'C:/work/shared', 3),
      c: folder('c', 'C:/work/shared', 9),
    };
    expect(canvasFolderSatelliteMaxes(nodes, { a: 'A', b: 'B', c: 'C' }, 'B', 'win32')).toEqual({ 'c:/work/shared': 3 });
  });

  it('keeps Linux path case distinct and folds Windows and macOS paths', () => {
    const nodes = { a: folder('a', '/work/Assets', 3), b: folder('b', '/work/assets', 5) };
    expect(canvasFolderSatelliteMaxes(nodes, {}, null, 'linux')).toEqual({ '/work/Assets': 3, '/work/assets': 5 });
    for (const platform of ['win32', 'darwin'] as const) {
      expect(canvasFolderSatelliteMaxes(nodes, {}, null, platform)).toEqual({ '/work/assets': 3 });
    }
  });

  it('ignores unset or invalid limits and clamps configured folder limits', () => {
    const nodes = {
      unset: folder('unset', '/unset'),
      invalid: folder('invalid', '/invalid', Number.NaN),
      low: folder('low', '/low', -1),
      high: folder('high', '/high', SATELLITE_MAX_BOUNDS.MAX + 10),
      file: { ...folder('file', '/file.png', 3), bubbleType: 'file' as const },
    };
    expect(canvasFolderSatelliteMaxes(nodes, {}, null, 'linux')).toEqual({
      '/low': SATELLITE_MAX_BOUNDS.MIN, '/high': SATELLITE_MAX_BOUNDS.MAX,
    });
  });

  it('carries the matching project bundle settings by session and kind', () => {
    const own = { 'image:session-a': 3, 'audio:session-a': 1 };
    const nodes = {
      foreign: { ...folder('foreign', '/work/assets'), bundleMaxSatellites: { 'image:session-a': 8 } },
      own: { ...folder('own', '/work/assets'), bundleMaxSatellites: own },
    };
    expect(canvasFolderBundleSatelliteMaxes(nodes, { foreign: 'foreign', own: 'own' }, 'own', 'linux'))
      .toEqual({ '/work/assets': own });
  });

  it('does not inherit another project override when the matching folder uses defaults', () => {
    const nodes = {
      foreign: { ...folder('foreign', '/work/assets', 8), bundleMaxSatellites: { image: 8 } },
      own: folder('own', '/work/assets'),
    };
    const owners = { foreign: 'foreign', own: 'own' };
    expect(canvasFolderSatelliteMaxes(nodes, owners, 'own', 'linux')).toEqual({});
    expect(canvasFolderBundleSatelliteMaxes(nodes, owners, 'own', 'linux')).toEqual({});
  });

  it('selects the owning project root settings and leaves unknown projects unset', () => {
    const own = { 'image:session-a': 1 };
    const nodes: Record<string, BubbleData> = {
      foreign: { ...folder('foreign', '__root__:A'), bubbleType: 'root', bundleMaxSatellites: { image: 8 } },
      own: { ...folder('own', '__root__:B'), bubbleType: 'root', bundleMaxSatellites: own },
    };
    expect(canvasRootBundleSatelliteMaxes(nodes, { foreign: 'A', own: 'B' }, 'B')).toBe(own);
    expect(canvasRootBundleSatelliteMaxes(nodes, { foreign: 'A', own: 'B' }, null)).toBeUndefined();
  });
});
