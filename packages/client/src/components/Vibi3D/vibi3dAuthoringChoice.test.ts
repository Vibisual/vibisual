import { describe, expect, it } from 'vitest';
import { requestsVibi3DBlender } from './vibi3dAuthoringChoice.js';

describe('explicit authoring choice', () => {
  it.each(['Use Blender for this object', 'Make it with Blender', 'Blender로 만들어 주세요', '블렌더에서 제작해 주세요'])('recognizes positive request: %s', (request) => {
    expect(requestsVibi3DBlender(request)).toBe(true);
  });
  it.each(['Blender 없이 만들어 주세요', 'Blender 말고 Vibi3D로 만들어 주세요', 'Make it without Blender',
    'Do not use Blender', "Don't use Blender", '블렌더를 사용하지 마세요', 'Blender로 하지 말고 네이티브로 해주세요', 'Does Blender exist?'])('keeps native for: %s', (request) => {
    expect(requestsVibi3DBlender(request)).toBe(false);
  });
});
