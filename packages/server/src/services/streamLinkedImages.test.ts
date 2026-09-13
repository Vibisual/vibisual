import { describe, expect, it } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { linkedImageEvents, restoreLinkedImages } from './streamLinkedImages.js';

const event: SubAgentStreamEvent = {
  id: 'e1', subAgentId: 's1', parentAgentId: 'a1', timestamp: 1,
  eventType: 'text', content: '', turnId: 'turn1',
};

describe('linked image recovery', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('recovers explicit file links on %s', (platform) => {
    const url = platform === 'win32' ? 'file:///C:/Pictures/gorilla%20one.png' : 'file:///srv/pics/gorilla%20one.png';
    const result = linkedImageEvents({ ...event, content: `완성했습니다. [이미지 열기](${url})` }, platform);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'e1:image:0', turnId: 'turn1', subAgentId: 's1', content: 'gorilla one.png',
      imagePath: platform === 'win32' ? 'C:/Pictures/gorilla one.png' : '/srv/pics/gorilla one.png',
    });
  });
  it('supports spaces, Windows paths, parentheses and multiple pictures without duplicates', () => {
    const content = '[보기](<C:/My Pictures/a.png>) ![그림](C:\\Pictures\\b(1).jpg) [다시](<C:/My Pictures/a.png>)';
    expect(linkedImageEvents({ ...event, content }, 'win32').map((e) => e.imagePath))
      .toEqual(['C:/My Pictures/a.png', 'C:\\Pictures\\b(1).jpg']);
  });
  it('does not turn tool output, code, remote URLs, SVG or plain filenames into images', () => {
    const content = '```md\n[x](/a.png)\n```\n`[x](/b.png)` [x](https://example.com/a.png) [x](/a.svg) /b.png';
    expect(linkedImageEvents({ ...event, content }, 'linux')).toEqual([]);
    expect(linkedImageEvents({ ...event, eventType: 'tool_result', content: '[x](/a.png)' }, 'linux')).toEqual([]);
  });
  it('restores old records without mutation and is idempotent for newly persisted records', () => {
    const old = [{ ...event, content: '[이미지 열기](/srv/pics/gorilla.png)' }];
    const restored = restoreLinkedImages(old, 'linux');
    expect(old).toHaveLength(1);
    expect(restored).toHaveLength(2);
    expect(restoreLinkedImages(restored, 'linux')).toEqual(restored);
    expect(restored[1]?.imagePath).toBe('/srv/pics/gorilla.png');
  });
});
