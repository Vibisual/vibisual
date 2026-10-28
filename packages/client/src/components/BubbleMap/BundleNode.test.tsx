/**
 * §2.2 · §5.1 #2-1 (B) — 묶음 버블 렌더 고정: ① 미리보기 ❌(겹친 원 글리프 + 구성 수) ② 원 아래 이름 + `{{kind}} · {{count}}` 는 모든 묶음이 같다
 * ③ 툴팁이 폴더·구성·더블클릭 안내 ④ 우클릭이 캔버스 메뉴로 새지 않는다 ⑤ 둘레 궤도 ❌.
 */
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';

import type { BundleInfo } from '../../utils/constellationView.js';
import { BundleNode } from './BundleNode.js';

vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Top: 'top' } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
  }),
}));

let renderer: ReactTestRenderer | undefined;

/** 궤도 = 흐린 점선 원(`ConstellationOrbit`) — memo 부품이라 타입이 아니라 그린 원으로 찾는다. */
function orbits(r: ReactTestRenderer): number {
  return r.root.findAll((n) => n.type === 'circle' && n.props.strokeDasharray === '2 6').length;
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

function bundle(info: BundleInfo, extra: Partial<BubbleData> = {}): BubbleData {
  return { id: 'sat-bundle-folder-test-video-1a2b', label: 'video', bubbleType: 'bundle', path: '', status: 'idle', activity: 1, ...extra, _bundle: info } as BubbleData;
}

function render(data: BubbleData): ReactTestRenderer {
  act(() => {
    renderer = create(createElement(BundleNode, { id: data.id, data } as unknown as Parameters<typeof BundleNode>[0]));
  });
  return renderer!;
}

function spans(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => typeof n.type === 'string' && n.type === 'span').map((n) => n.children.join(''));
}

function titleOf(r: ReactTestRenderer): string {
  const body = r.root.find((n) => typeof n.props.className === 'string' && n.props.className.includes('bubble-body'));
  return String(body.props.title);
}

const FOLDER: BundleInfo = {
  source: 'folder',
  kind: 'video',
  folder: 'bubble-test/video',
  memberIds: ['f-veg', 'f-vob'],
  members: [{ label: 'veg.veg', reason: null }, { label: 'vob.vob', reason: null }],
  count: 2,
};

describe('BundleNode — 파일로 읽히지 않는 묶음 버블', () => {
  it('미리보기 그림 없이 겹친 원 글리프와 구성 수, 원 아래 이름과 종류 줄을 그리고, 둘레 궤도는 그리지 않는다', () => {
    const r = render(bundle(FOLDER));
    expect(r.root.findAllByType('img')).toHaveLength(0);
    const texts = spans(r);
    expect(texts).toContain('2');
    expect(texts).toContain('video');
    expect(texts.some((t) => t.startsWith('canvas.bundle.line') && t.includes('canvas.bundle.kind.video'))).toBe(true);
    // 둘레 점선 궤도는 그리지 않는다 — 묶음의 위성은 폴더처럼 위성선이 말한다.
    expect(orbits(r)).toBe(0);
  });

  it('툴팁이 그 폴더 · 구성 · 더블클릭 안내를 말한다', () => {
    const title = titleOf(render(bundle(FOLDER)));
    expect(title).toContain('canvas.bundle.title');
    expect(title).toContain('bubble-test/video');
    expect(title).toContain('  veg.veg');
    expect(title).toContain('  vob.vob');
    expect(title).toContain('canvas.bundle.enterHint');
    expect(title).not.toContain('canvas.bundle.sequence');
  });

  it('우클릭은 캔버스 메뉴로 새지 않는다', () => {
    const r = render(bundle(FOLDER));
    const body = r.root.find((n) => typeof n.props.className === 'string' && n.props.className.includes('bubble-body'));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => body.props.onContextMenu({ preventDefault, stopPropagation }));
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('연속 번호도 아래 설명은 종류 줄로 같고(통일), `연속 번호` 는 툴팁이 말하며 궤도를 그리지 않는다', () => {
    const r = render(bundle({
      source: 'sequence',
      kind: 'image',
      memberIds: ['f-1', 'f-2', 'f-3'],
      members: [{ label: 'frame_0001.png', reason: null }],
      count: 3,
    }, { id: 'sat-bundle-f-3', label: 'frame_####' }));
    const texts = spans(r);
    expect(texts).toContain('frame_####');
    expect(texts.some((t) => t.startsWith('canvas.bundle.line') && t.includes('canvas.bundle.kind.image'))).toBe(true);
    expect(texts.some((t) => t.includes('canvas.bundle.sequence'))).toBe(false);
    expect(titleOf(r)).toContain('canvas.bundle.sequence');
    expect(orbits(r)).toBe(0);
  });
});
