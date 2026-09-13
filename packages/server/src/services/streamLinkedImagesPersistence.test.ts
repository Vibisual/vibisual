import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { appendEvent, flushAll, loadBuffer } from './streamBufferStore.js';

it('recovers a saved image link with the same event identity used by the image route', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-linked-image-'));
  try {
    const source: SubAgentStreamEvent = {
      id: 'old', subAgentId: 'sub', parentAgentId: 'parent', timestamp: 1,
      eventType: 'text', content: '[이미지 열기](/pictures/gorilla.png)', turnId: 'turn',
    };
    appendEvent(dir, source);
    const first = loadBuffer(dir, 'sub', 20);
    expect(first).toHaveLength(2);
    expect(first.find((event) => event.id === 'old:image:0')?.imagePath).toBe('/pictures/gorilla.png');
    appendEvent(dir, first[1]!);
    expect(loadBuffer(dir, 'sub', 20)).toEqual(first);
  } finally {
    flushAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
