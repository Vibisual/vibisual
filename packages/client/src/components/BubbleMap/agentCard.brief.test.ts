import { describe, expect, it } from 'vitest';

import { LINKED_OUTPUT_MARK, buildLinkedOutputBrief, withLinkedOutputBrief, type LinkedOutputNode } from './agentCard.js';

/**
 * §5.4 #36 (C) 개정 · §5.13 (T-15) ① — **앱 몫 브리프.**
 *
 * 영상 노드에 공통 문구("결과 파일을 만들어 /output 으로 넣어라 · accepts .mp4")가 붙자 에이전트가 파이썬·ffmpeg 로
 * 완성 mp4 를 먼저 구워 꽂았다(2026-10-11 사용자 보고). 앱이 자기 브리프를 낸 노드는 그 브리프만 말하고, 공통 납품
 * 문구는 공통 노드가 있을 때만 붙는다 — 이 갈림이 되돌아가면 같은 사고가 난다.
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
