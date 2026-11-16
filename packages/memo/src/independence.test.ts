import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root = path.resolve(import.meta.dirname, '../../..');
describe('memo app boundary', () => {
  for (const relative of ['packages/server/src/index.ts', 'packages/client/src/main.tsx', 'packages/client/src/components/BubbleMap/CanvasContextMenu.tsx',
    'packages/client/src/components/BubbleMap/BubbleMap.tsx', 'packages/client/src/components/BubbleMap/AppBubbleNode.tsx', 'packages/desktop/src/main/ipc.ts', 'packages/desktop/src/preload/index.ts']) {
    it(`${relative} uses generic app contracts`, () => {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(source).not.toMatch(/@vibisual\/memo|MemoShell|MemoCanvasFace|\/api\/app\/memo/);
    });
  }
  it('does not import core packages and only loads through lazy app registries', () => {
    const scan = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scan(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    for (const file of scan(path.join(root, 'packages/memo/src')).filter(file => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/(?:from|import\()\s*['"]@vibisual\/(?:client|server|desktop)/);
    }
    for (const relative of ['packages/server/src/services/appHost.ts', 'packages/client/src/apps/registry.tsx']) {
      expect(fs.readFileSync(path.join(root, relative), 'utf8')).not.toMatch(/import\s+(?:[^;\n]+)from\s+['"]@vibisual\/memo/);
    }
  });
});
