import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '@vibisual/video';

vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>): string => (vars ? `${key}|${JSON.stringify(vars)}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

import { ExportTargetForm, type ExportTargetFormProps } from './ExportTargetForm.js';
import { RenderQueueList } from './RenderQueueList.js';
import type { ExportTarget } from './exportTarget.js';
import type { VideoJob } from './videoApi.js';

const TARGET: ExportTarget = {
  docIds: ['d1'], ownFormat: true, extraFormats: [], rangeMode: 'all', range: { start: 0, end: 10 }, sceneIds: [], mutedTracks: [], thumbnailAt: 4,
};

function form(settings: ExportSettings, extra: Partial<ExportTargetFormProps> = {}): { tree: ReactTestRenderer; onSettings: ReturnType<typeof vi.fn>; onTarget: ReturnType<typeof vi.fn> } {
  const onSettings = vi.fn();
  const onTarget = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(ExportTargetForm, {
      target: TARGET, onTarget, settings, onSettings, currentDocId: 'd1', currentFormat: 'landscape', docs: [{ id: 'd1', title: 'One' }],
      chapters: [], tracks: [], duration: 10, fps: 30, readPlayhead: () => 7, hasCaptions: false, ...extra,
    }));
  });
  return { tree, onSettings, onTarget };
}

const text = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());
const checkbox = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.type === 'label' && n.findAll((c) => c.type === 'span' && c.props.children === `panel.videoStudio.export.${label}`).length > 0)[0]!.findByType('input');

describe('함께 내기 — 설정 창 (§5.13 42-13)', () => {
  it('체크는 설정의 extras 를 바꾸고, 썸네일을 켜면 시각 칸과 [재생 머리로]가 선다', () => {
    const { tree, onSettings } = form(DEFAULT_EXPORT_SETTINGS);
    expect(text(tree)).not.toContain('extras.thumbnailAt');
    act(() => { checkbox(tree, 'extras.chapters').props.onChange({ target: { checked: true } }); });
    expect(onSettings).toHaveBeenCalledWith({ extras: { thumbnail: false, chapters: true, subtitles: false } });

    const on = form({ ...DEFAULT_EXPORT_SETTINGS, extras: { thumbnail: true, chapters: true, subtitles: true } });
    const out = text(on.tree);
    expect(out).toContain('extras.thumbnailAt');
    expect(out).toContain('extras.noChapters');
    expect(out).toContain('extras.noCaptions');
    const playhead = on.tree.root.findAll((n) => n.type === 'button' && n.props.title === 'panel.videoStudio.export.target.fromPlayhead');
    act(() => { playhead[0]!.props.onClick(); });
    expect(on.onTarget).toHaveBeenCalledWith(expect.objectContaining({ thumbnailAt: 7 }));
  });

  it('자막 [따로 내기]면 자막 파일 체크는 켜진 채 잠긴다', () => {
    const { tree } = form({ ...DEFAULT_EXPORT_SETTINGS, captions: 'separate' }, { hasCaptions: true });
    const input = checkbox(tree, 'extras.subtitles');
    expect(input.props.checked).toBe(true);
    expect(input.props.disabled).toBe(true);
    expect(text(tree)).toContain('extras.subtitlesLocked');
  });
});

describe('함께 내기 — 대기열 줄', () => {
  const base = { id: 'j1', docId: 'd1', progress: 1, createdAt: 1 } as const;
  const render = (jobs: VideoJob[]): string => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(createElement(RenderQueueList, { jobs, host: true, onControl: vi.fn(), onReveal: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn() })); });
    return text(tree);
  };

  it('끝난 일감은 함께 낸 파일 이름과 나오지 않은 까닭을 적는다', () => {
    const out = render([{
      ...base, status: 'done', result: '/out/a.mp4',
      companions: { thumbnail: '/x/a.png', chapters: '/x/a.chapters.txt' }, companionNotes: ['subtitles-empty'],
    } as unknown as VideoJob]);
    expect(out).toContain('a.png, a.chapters.txt');
    expect(out).toContain('extras.note_subtitlesEmpty');
  });

  it('대기 중인 일감은 걸 때의 선택을 적는다', () => {
    const out = render([{
      ...base, status: 'queued', progress: 0,
      output: { extras: { thumbnail: true, chapters: false, subtitles: false } }, spec: { captions: 'separate' },
    } as unknown as VideoJob]);
    expect(out).toContain('extras.withEach');
    expect(out).toContain('extras.thumbnail');
    expect(out).toContain('extras.subtitles');
    expect(out).not.toContain('extras.chapters');
  });
});
