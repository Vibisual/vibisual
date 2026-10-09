import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAudioDoc } from '@vibisual/audio';
import { VibisoundShell } from './VibisoundShell.js';
import { WindowControls } from '../Layout/WindowControls.js';
import type { useSoundProject } from './useSoundProject.js';

const mocks = vi.hoisted(() => ({ target: vi.fn(), project: vi.fn(), prepare: null as (() => Promise<boolean>) | null }));
vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../apps/appWindowLifecycle.js', () => ({ useAppWindowTarget: mocks.target,
  useAppWindowTransferGuard: (_params: unknown, prepare: () => Promise<boolean>) => { mocks.prepare = prepare; },
}));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./useSoundProject.js', () => ({ useSoundProject: mocks.project }));
vi.mock('./useSoundAudio.js', () => ({ useSoundAudio: () => ({ sourceDurations: {}, playhead: 0 }) }));
vi.mock('./SoundConnections.js', () => ({ SoundConnections: () => null }));
vi.mock('./SoundInspector.js', () => ({ SoundInspector: () => null }));
vi.mock('./SoundLibrary.js', () => ({ SoundLibrary: () => null }));
vi.mock('./SoundTracks.js', () => ({ SoundTracks: () => null }));
vi.mock('./SoundWaveform.js', () => ({ SoundWaveform: () => null }));

let view: ReactTestRenderer | undefined;
let project: ReturnType<typeof useSoundProject>;
function render(params: Record<string, string>): void {
  const element = createElement(VibisoundShell, { appId: 'vibisound', params });
  if (view) view.update(element); else view = create(element);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.prepare = null;
  project = { doc: createEmptyAudioDoc('first', 'First'), envelope: null, docs: [], busy: false, error: '', notice: '',
    setError: vi.fn(), setNotice: vi.fn(), open: vi.fn(), create: vi.fn(), patch: vi.fn(), history: vi.fn(), importFiles: vi.fn(), refreshList: vi.fn() };
  mocks.project.mockImplementation(() => project);
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('sound shell window handoff', () => {
  it('blocks transfer while project changes are busy and allows it once they finish', async () => {
    const params = { projectId: '/project', appWindowId: 'window' };
    project = { ...project, busy: true };
    act(() => render(params));
    expect(await mocks.prepare!()).toBe(false);
    project = { ...project, busy: false };
    act(() => render(params));
    expect(await mocks.prepare!()).toBe(true);
  });

  it('publishes the current document while retaining its initial open parameters', () => {
    const params = { projectId: '/project', clipId: 'first', file: 'original.wav', appWindowId: 'window' };
    act(() => render(params));
    expect(mocks.target).toHaveBeenLastCalledWith(params, { ref: 'first', file: undefined });
    project = { ...project, doc: createEmptyAudioDoc('second', 'Second') };
    act(() => render({ ...params, clipId: 'second', file: '' }));
    expect(mocks.target).toHaveBeenLastCalledWith(expect.anything(), { ref: 'second', file: undefined });
    expect(mocks.project).toHaveBeenLastCalledWith('/project', 'first', 'original.wav');
  });

  it.each<Record<string, string>>([{ appWindowId: 'embedded' }, { appWindowHosted: '1' }])('leaves native chrome to its host (%j)', (host) => {
    act(() => render({ projectId: '/project', ...host }));
    expect(view!.root.findAllByType(WindowControls)).toHaveLength(0);
    expect(view!.root.findByType('header').props.className.split(' ')).not.toContain('app-drag');
  });
});
