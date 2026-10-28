import { describe, expect, it } from 'vitest';

import { LINKED_OUTPUT_MARK, buildLinkedOutputBrief, withLinkedOutputBrief, type LinkedOutputNode } from './agentCard.js';

/**
 * §5.4 #36 (C) · §5.13 (T-15) ① — 앱 브리프가 있는 노드는 그것만 말하고, 공통 납품 문구는 공통 노드가 있을 때만 붙는다.
 * 되돌아가면 에이전트가 영상 노드에 파이썬·ffmpeg 로 완성 mp4 를 먼저 구워 꽂는다.
 */

const fileNode: LinkedOutputNode = { id: 'app-9', appName: 'Imager', label: 'Logo', accepts: ['.png'], file: 'out/logo.png' };
const docNode: LinkedOutputNode = {
  id: 'app-v',
  appName: 'Studio',
  label: 'Teaser',
  accepts: ['.mp4', '.webm'],
  brief: '  VIDEO PROJECT: this node is a work document. Build inside it; do not render.  \n',
};

describe('§5.4 #36 (C) 앱 몫 브리프', () => {
  it('작업 문서 노드만 있으면 납품 문구도 받는 확장자도 싣지 않는다', () => {
    const brief = buildLinkedOutputBrief([docNode]);
    expect(brief).toContain(LINKED_OUTPUT_MARK);
    expect(brief).toContain('VIDEO PROJECT: this node is a work document. Build inside it; do not render.');
    expect(brief).not.toContain('/api/app-bubbles/<node id>/output');
    expect(brief).not.toContain('delivered only after');
    expect(brief).not.toContain('- node app-v');
    expect(brief).not.toContain('.mp4');
    expect(brief).toContain('Never print the token');
  });

  it('공통 노드와 섞이면 공통 노드에만 납품 문구가 붙고 브리프는 그 뒤에 그대로 실린다', () => {
    const brief = buildLinkedOutputBrief([fileNode, docNode]);
    expect(brief).toContain('- node app-9 · Imager "Logo" · accepts .png · holds "out/logo.png"');
    expect(brief).toContain('/api/app-bubbles/<node id>/output');
    expect(brief).toContain('delivered only after');
    expect(brief).not.toContain('- node app-v');
    expect(brief.indexOf('VIDEO PROJECT')).toBeGreaterThan(brief.indexOf('/api/app-bubbles/<node id>/output'));
  });

  it('브리프의 앞뒤 공백을 다듬고, 토큰을 드러내지 말라는 줄로 끝난다', () => {
    const lines = buildLinkedOutputBrief([docNode]).split('\n');
    expect(lines).toContain('VIDEO PROJECT: this node is a work document. Build inside it; do not render.');
    expect(lines[lines.length - 1]).toMatch(/^Never print the token/);
  });

  it('본문에 한 번만 붙는다(전송 실패로 초안에 돌아온 글을 다시 보낼 때)', () => {
    const once = withLinkedOutputBrief('make a short teaser', [docNode]);
    expect(once.startsWith('make a short teaser\n\n---')).toBe(true);
    expect(withLinkedOutputBrief(once, [docNode])).toBe(once);
  });
});
