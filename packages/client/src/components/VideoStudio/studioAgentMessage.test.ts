import { describe, expect, it } from 'vitest';
import type { ResolvedItem, VideoAsset } from '@vibisual/video';

import {
  STUDIO_CONTEXT_MARK,
  buildStudioAgentContext,
  stripStudioContext,
  withStudioAgentContext,
  type StudioAgentContext,
} from './studioAgentMessage.js';

/**
 * §5.13 (G)(T-15) ④ · (V) 37-16 — 스튜디오에서 AI 에게 보내는 말의 **문맥 블록**.
 *
 * 사용자는 보며 고친다("2초쯤 제목을 더 크게"). 그 말만 가면 에이전트는 어느 문서의 어디인지 모른다. 바퀴 id 가 빠지면 판 기록이
 * 바퀴를 묶지 못하고, 렌더 금지가 빠지면 에이전트는 다시 완성 영상을 굽는다 — 그것들을 여기서 고정한다. 규약은 정본 글이 말한다.
 */

const BASE: StudioAgentContext = {
  projectName: 'demo',
  doc: { id: 'vid-1', title: 'Teaser', version: 7 },
  playhead: 2.5,
  duration: 10,
  passId: 'pass-abc',
  mode: 'revise',
};

const selected: ResolvedItem = {
  id: 'c1',
  trackId: 'v',
  trackKind: 'visual',
  kind: 'composition',
  start: 1,
  end: 4,
  duration: 3,
  item: { id: 'c1', kind: 'composition', at: 1, duration: 3, label: 'Title card' },
};

const attached: VideoAsset = { id: 'img-1', kind: 'image', source: { kind: 'file', path: '.vibisual/video/assets/a.png' } };

describe('§5.13 (G)(V) 스튜디오 문맥 블록', () => {
  it('문서·판본·길이·프로젝트·바퀴·재생 위치를 싣는다', () => {
    const text = buildStudioAgentContext(BASE);
    expect(text.startsWith(`---\n${STUDIO_CONTEXT_MARK}`)).toBe(true);
    expect(text).toContain('"vid-1" ("Teaser", version 7, 10.00s) in project "demo"');
    expect(text).toContain('- Pass: pass-abc (mode: revise). Send "passId": "pass-abc" with every patch');
    expect(text).toContain('finish with POST /doc/vid-1/pass');
    expect(text).toContain('- Playhead: 2.50s.');
  });

  it('고른 아이템과 붙인 소재를 적는다', () => {
    const text = buildStudioAgentContext({ ...BASE, selected, attached: [attached] });
    expect(text).toMatch(/- Selected item: "c1" \(composition, "Title card"\) at 1\.00s.4\.00s\./);
    expect(text).toContain('- Attached asset (already in the document, not placed yet): "img-1" (image, .vibisual/video/assets/a.png).');
  });

  it('§5.13 (V) 37-6·37-7 — 가리킨 것과 메모 핀을 데이터로 싣고, 고친 메모를 보고에 적으라고 말한다', () => {
    const text = buildStudioAgentContext({
      ...BASE,
      pointed: [{ itemId: 'c1', t: 1.5, kind: 'composition', file: 'x/index.html', path: 'div#title', text: 'Hello', prop: 'title' }],
      notes: [{ id: 'note-2', n: 2, t: 3, x: 0.5, y: 0.25, text: 'logo bigger' }],
    });
    expect(text).toContain('- Pointed at: item "c1" (composition) at 1.50s, file x/index.html, element "div#title", bound to prop "title", text "Hello".');
    expect(text).toContain('- Note #2 (id "note-2") at 3.00s, x 0.50 y 0.25: "logo bigger"');
    expect(text).toContain('"notesFixed"');
  });

  it('§5.13 (V) 37-14 — 그림 생성은 켤 때만 허용하고, 끄면 하지 말라고 말한다(Claude 면 말하지 않는다)', () => {
    expect(buildStudioAgentContext({ ...BASE, imageGeneration: true })).toContain('Image generation is ALLOWED');
    expect(buildStudioAgentContext({ ...BASE, imageGeneration: false })).toContain('Do not generate images');
    expect(buildStudioAgentContext(BASE)).not.toMatch(/generat/i);
  });

  it('규약 글을 가리키고, 시키기 전에는 렌더하지 말라고 말한다 — 토큰 값은 싣지 않는다', () => {
    const text = buildStudioAgentContext(BASE);
    expect(text).toContain('/api/app/vibistudio/guide');
    expect(text).toContain('GET the document before you patch');
    expect(text).toContain('Do not render or export a video unless the user asks');
    expect(text).toContain('x-vibisual-hook-token: ${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}'); // 이름만 — 값은 세션 환경에 있다
  });

  it('시각이 이상해도 0초로 적는다', () => {
    expect(buildStudioAgentContext({ ...BASE, playhead: -3 })).toContain('- Playhead: 0.00s.');
    expect(buildStudioAgentContext({ ...BASE, playhead: Number.NaN })).toContain('- Playhead: 0.00s.');
  });

  it('사용자의 말 뒤에 한 번만 붙고, 대화에 보일 때는 사용자가 쓴 말만 남는다', () => {
    const once = withStudioAgentContext('make the title bigger  ', BASE);
    expect(once.startsWith(`make the title bigger\n\n---\n${STUDIO_CONTEXT_MARK}`)).toBe(true);
    expect(withStudioAgentContext(once, BASE)).toBe(once);
    expect(stripStudioContext(once)).toBe('make the title bigger');
    const withRecipe = withStudioAgentContext('intro video', { ...BASE, recipe: { id: 'logo-reveal', prompt: 'Recipe "logo-reveal" — a short logo animation.' } });
    expect(stripStudioContext(withRecipe)).toBe('intro video');
  });
});
