import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import type { SceneChangeSet } from '@vibisual/video';

vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>): string => (vars ? `${key}|${JSON.stringify(vars)}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: Object.assign(() => undefined, { getState: () => ({}) }) }));
vi.mock('./videoApi.js', () => ({ readDoc: vi.fn(), VersionConflictError: class extends Error {} }));
vi.mock('./studioApi.js', () => ({ checkPatch: vi.fn(), decideScene: vi.fn(), readSceneFilePlan: vi.fn(), restoreScene: vi.fn() }));

import { StudioChangeCard } from './StudioChangeCard.js';
import { buildNextAsks, NEXT_ASKS_MAX, nextAskLayoutOf, nextAskScoreOf, type NextAskInput } from './nextAsks.js';
import { confirmOf, type SceneReview } from './useSceneReview.js';
import { passIdOfPrompt, scenePassFilter, studioChatTail } from './useStudioConversation.js';
import { sceneChatOf, scenePassIds } from './sceneChat.js';

/** §5.13 (V) 37-23 — 골라 받기 화면: 장면 카드 · 확인 띠 · 장면별 대화 · 다음에 시킬 말. */

const t = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key)) as unknown as import('i18next').TFunction;

describe('37-23 (I) 장면별 대화', () => {
  function convo(): { events: SubAgentStreamEvent[]; commands: QueuedCommand[] } {
    const commands: QueuedCommand[] = [];
    const events: SubAgentStreamEvent[] = [];
    const passes = ['p1', null, 'p2', 'p1'];
    passes.forEach((pass, k) => {
      const ts = 1_000 + k * 100;
      const text = pass ? `ask ${k}\n\n- Pass: ${pass} (mode: revise). Send "passId"` : `ask ${k}`;
      commands.push({ id: `c${k}`, text, timestamp: ts - 5, startedAt: ts, subAgentId: 'S', status: 'completed' } as QueuedCommand);
      events.push({ id: `e${k}`, subAgentId: 'S', parentAgentId: 'P', timestamp: ts + 10, eventType: 'text', content: `answer ${k}` } as SubAgentStreamEvent);
      events.push({ id: `r${k}`, subAgentId: 'S', parentAgentId: 'P', timestamp: ts + 20, eventType: 'result', content: '' } as SubAgentStreamEvent);
    });
    return { events, commands };
  }

  it('reads the pass id from the context block', () => {
    expect(passIdOfPrompt('hello\n- Pass: pass-abc (mode: revise). Send')).toBe('pass-abc');
    expect(passIdOfPrompt('hello')).toBeUndefined();
  });

  it('AI lines inherit the pass of the preceding user line; unmarked turns show only under “all”', () => {
    const { events, commands } = convo();
    const all = studioChatTail(events, commands).lines;
    expect(all.filter((l) => l.who === 'ai').map((l) => l.passId)).toEqual(['p1', undefined, 'p2', 'p1']);
    const p1 = studioChatTail(events, commands, 40, scenePassFilter(new Set(['p1']))).lines;
    expect(p1.map((l) => l.id)).toEqual(['cmd-c0', 'e0', 'cmd-c3', 'e3']);
  });

  it('counts the tail after filtering', () => {
    const { events, commands } = convo();
    const two = studioChatTail(events, commands, 2, scenePassFilter(new Set(['p1']))).lines;
    expect(two.map((l) => l.id)).toEqual(['cmd-c3', 'e3']);
  });

  it('scene pass ids are stable for the same pass list and fall back to “all” for an unknown scene', () => {
    const passes = [{ id: 'p1', startedAt: 0, startVersion: 1, status: 'done' as const, versions: [], focuses: ['a'] }];
    expect(scenePassIds(passes, 'a')).toBe(scenePassIds(passes, 'a'));
    const onChange = vi.fn();
    const chapters = [{ id: 'a', chapter: { id: 'a', title: 'Alpha', duration: 1 } }] as unknown as Parameters<typeof sceneChatOf>[1];
    expect(sceneChatOf(t, chapters, passes, 'gone', onChange)?.value).toBeNull();
    expect([...(sceneChatOf(t, chapters, passes, 'a', onChange)?.passIds ?? [])]).toEqual(['p1']);
    expect(sceneChatOf(t, [], passes, null, onChange)).toBeNull();
  });
});

describe('37-23 (J) 다음에 시킬 말', () => {
  const base: NextAskInput = { suggestions: [], score: null, layout: null, openNotes: 0, undecidedScenes: [], planScenes: [] };

  it('orders report suggestions → score → layout → notes → scenes, without duplicates, capped', () => {
    const asks = buildNextAsks(t, {
      suggestions: ['tighten intro', 'tighten intro'],
      score: { introduced: 2, scoreChange: -6, heaviest: { code: 'safe-area', values: { text: 'Hi' } } },
      layout: { overlap: 0, covered: 0, clipped: 3, offscreen: 1, unsafe: 0, lowContrast: 0 },
      openNotes: 4,
      undecidedScenes: [{ n: 2, title: 'Beta' }],
      planScenes: [{ n: 3, title: 'Gamma' }],
    }, 20);
    expect(asks.map((s) => s.split('|')[0])).toEqual([
      'tighten intro',
      'panel.videoStudio.nextAsks.introduced',
      'panel.videoStudio.nextAsks.scoreDrop',
      'panel.videoStudio.review.fixRequest',
      'panel.videoStudio.nextAsks.layout_clipped',
      'panel.videoStudio.notes.handoffRequest',
      'panel.videoStudio.nextAsks.refineScene',
      'panel.videoStudio.nextAsks.buildScene',
    ]);
    expect(buildNextAsks(t, { ...base, suggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toHaveLength(NEXT_ASKS_MAX);
  });

  it('nothing to say → no chips; same input → same chips', () => {
    expect(buildNextAsks(t, base)).toEqual([]);
    const input = { ...base, openNotes: 1 };
    expect(buildNextAsks(t, input)).toEqual(buildNextAsks(t, input));
  });

  it('reads the score and layout answers defensively', () => {
    expect(nextAskScoreOf({ delta: { score: -3, introduced: 1 }, findings: [
      { code: 'blank', level: 'info' }, { code: 'read-time', level: 'warn', introduced: true }, { code: 'safe-area', level: 'error', values: { text: 'x' } },
    ] })).toEqual({ introduced: 1, scoreChange: -3, heaviest: { code: 'safe-area', values: { text: 'x' } } });
    expect(nextAskScoreOf(null)).toBeNull();
    expect(nextAskLayoutOf({ flags: { overlap: 2 } })).toMatchObject({ overlap: 2, covered: 0 });
    expect(nextAskLayoutOf({})).toBeNull();
  });
});

describe('37-23 (F) 확인 띠 값', () => {
  it('an error blocks with its hint; warnings are counted', () => {
    expect(confirmOf('a', [{ code: 'x', level: 'warn', hint: 'w' }, { code: 'y', level: 'error', hint: 'broken' }], null, 2)).toMatchObject({ blocked: 'broken', warnings: 1, nothing: false });
    expect(confirmOf('a', [], null, 0)).toMatchObject({ blocked: null, nothing: true });
  });
});

describe('37-23 (C) 장면 카드', () => {
  let view: ReactTestRenderer | undefined;
  afterEach(() => { act(() => { view?.unmount(); }); view = undefined; });

  const scenes: SceneChangeSet = {
    scenes: [
      { chapterId: 'a', n: 1, title: 'Alpha', state: 'changed', lines: [{ kind: 'itemChanged', values: { name: 'x' }, target: { itemId: 'ta' } }], codeAssets: [] },
      { chapterId: 'b', n: 2, title: 'Beta', state: 'added', lines: [{ kind: 'chapterAdded', values: { title: 'Beta' } }], codeAssets: [] },
    ],
    rest: [{ kind: 'titleChanged', values: {} }],
  } as unknown as SceneChangeSet;

  function review(over: Partial<SceneReview> = {}): SceneReview {
    return { confirm: null, busy: null, keep: vi.fn(), reopen: vi.fn(), askRestore: vi.fn(), confirmRestore: vi.fn(), cancel: vi.fn(), ...over };
  }
  const texts = (root: ReactTestInstance): string[] => root.findAllByType('button').map((b) => String(b.props.children instanceof Array ? b.props.children.filter((c: unknown) => typeof c === 'string').join('') : b.props.children));

  it('groups by scene with keep / restore / chat handles and a rest group', () => {
    const r = review();
    const chat = vi.fn();
    act(() => { view = create(createElement(StudioChangeCard, { lines: [{ kind: 'titleChanged', values: {} }] as never, report: null, open: false, onJump: vi.fn(), onUndoPass: vi.fn(), scenes, decided: {}, review: r, onSceneChat: chat })); });
    const buttons = texts(view!.root);
    expect(buttons.filter((s) => s === 'panel.videoStudio.sceneReview.keep')).toHaveLength(2);
    expect(buttons.filter((s) => s === 'panel.videoStudio.sceneReview.restore')).toHaveLength(2);
    expect(JSON.stringify(view!.toJSON())).toContain('panel.videoStudio.sceneReview.rest"');
    const keep = view!.root.findAllByType('button').find((b) => texts({ findAllByType: () => [b] } as unknown as ReactTestInstance)[0] === 'panel.videoStudio.sceneReview.keep');
    act(() => { keep?.props.onClick(); });
    expect(r.keep).toHaveBeenCalledWith('a');
  });

  it('a decided scene folds to its chip and [review again]', () => {
    act(() => { view = create(createElement(StudioChangeCard, { lines: [{ kind: 'titleChanged', values: {} }] as never, report: null, open: false, onJump: vi.fn(), onUndoPass: null, scenes, decided: { a: { how: 'kept', signature: 's', at: 1 } }, review: review() })); });
    const json = JSON.stringify(view!.toJSON());
    expect(json).toContain('panel.videoStudio.sceneReview.decided.kept');
    expect(texts(view!.root).filter((s) => s === 'panel.videoStudio.sceneReview.keep')).toHaveLength(1);
    expect(texts(view!.root)).toContain('panel.videoStudio.sceneReview.reopen');
  });

  it('the confirm strip blocks restore when the check found an error', () => {
    const r = review({ confirm: { chapterId: 'a', phase: 'ready', blocked: 'bad op', warnings: 0, plan: null, nothing: false } });
    act(() => { view = create(createElement(StudioChangeCard, { lines: [{ kind: 'titleChanged', values: {} }] as never, report: null, open: false, onJump: vi.fn(), onUndoPass: null, scenes, decided: {}, review: r })); });
    const confirm = view!.root.findAllByType('button').find((b) => texts({ findAllByType: () => [b] } as unknown as ReactTestInstance)[0] === 'panel.videoStudio.sceneReview.confirmRestore');
    expect(confirm?.props.disabled).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain('bad op');
  });

  it('filtered to one scene shows only that group and hides the rest group', () => {
    act(() => { view = create(createElement(StudioChangeCard, { lines: [{ kind: 'titleChanged', values: {} }] as never, report: null, open: false, onJump: vi.fn(), onUndoPass: null, scenes, decided: {}, review: review(), sceneFilter: 'b' })); });
    const json = JSON.stringify(view!.toJSON());
    expect(json).toContain('Beta');
    expect(json).not.toContain('Alpha');
    expect(json).not.toContain('panel.videoStudio.sceneReview.rest"');
  });

  it('a document without scenes keeps the plain line list', () => {
    act(() => { view = create(createElement(StudioChangeCard, { lines: [{ kind: 'titleChanged', values: {} }] as never, report: null, open: false, onJump: vi.fn(), onUndoPass: null, scenes: { scenes: [], rest: [] }, decided: {}, review: review() })); });
    expect(texts(view!.root)).not.toContain('panel.videoStudio.sceneReview.keep');
    expect(JSON.stringify(view!.toJSON())).toContain('panel.videoStudio.diff.titleChanged');
  });
});
