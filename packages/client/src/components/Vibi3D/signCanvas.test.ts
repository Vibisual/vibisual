import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { bakeSignTexture } from './signCanvas.js';

afterEach(() => vi.unstubAllGlobals());
describe('sign canvas PNG contract', () => {
  it('draws meter-valued contours with holes and embeds the canvas as PNG', () => {
    const context = { moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), beginPath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    class Canvas { width = 0; height = 0; getContext() { return context; } toDataURL = vi.fn((mime: string) => `data:${mime};base64,iVBORw0KGgo=`); }
    vi.stubGlobal('HTMLCanvasElement', Canvas); vi.stubGlobal('document', { createElement: () => new Canvas() });
    const shape = new THREE.Shape([new THREE.Vector2(-1, -0.3), new THREE.Vector2(1, -0.3), new THREE.Vector2(1, 0.3), new THREE.Vector2(-1, 0.3)]);
    shape.holes = [new THREE.Path([new THREE.Vector2(-0.5, -0.1), new THREE.Vector2(-0.5, 0.1), new THREE.Vector2(0.5, 0.1), new THREE.Vector2(0.5, -0.1)])];
    const texture = bakeSignTexture({ kind: 'fascia', text: 'O', size: [3, 1], background: false, color: '#123456', outline: { color: '#ffffff', width: 0.01 } }, [{ key: 'O', character: 'O', shapes: [shape] }]);
    expect(texture.image.width).toBe(1536); expect(texture.image.height).toBe(512); expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(context.fill).toHaveBeenCalledWith('evenodd'); expect(context.closePath).toHaveBeenCalledTimes(2); expect(context.stroke).toHaveBeenCalledOnce(); expect(context.fillRect).not.toHaveBeenCalled();
    const json = texture.source.toJSON(); expect(json.url).toMatch(/^data:image\/png;/); expect(texture.image.toDataURL).toHaveBeenCalledWith('image/png');
  });
});
