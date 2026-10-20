import { describe, expect, it } from 'vitest';

import { appWindowKey, outsideAppWindowsFrom, resolveAppWindowDestination, type OutsideAppWindow } from './appWindowFocus.js';

/**
 * §5.13 (S-11) — 앱을 여는 손짓의 **행선지**.
 *
 * 사용자 보고: 영상 스튜디오 창이 IDE 창과 달리 "처음 켜졌을 때 포커싱 · 창 잡고 옮기기 · 밖으로 빼기"가 빠졌다. 그중
 * 포커싱은 IDE 창(§5.5 #17-6 (H-13)(H-27))과 같은 규율이다 — 그 문서가 이미 밖에 떠 있으면 앱 안에 한 벌 더 세우지 않고
 * 밖의 그 창을 앞으로 세운다. 여기서 못 박는 것: ① 밖에 같은 대상이 있으면 밖 ② 다른 문서면 앱 안 ③ 앱 안에 이미 같은
 * 창이 있으면 앱 안(그 창이 앞으로 온다) ④ 되돌아오는 길은 밖을 보지 않는다 ⑤ 세울 수 없는 판이면 앱 안.
 */

const PROJECT = 'C:/proj';
const outside: OutsideAppWindow[] = [
  { windowId: 7, appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' },
  { windowId: 9, appId: 'vibisound', projectId: PROJECT, file: 'media/a.wav' },
];

function destination(args: { appId: string; projectId: string; ref?: string; file?: string }, opts: Partial<{
  inside: { appId: string; projectId: string; ref?: string; file?: string }[];
  redock: boolean;
  canFocusOutside: boolean;
}> = {}) {
  return resolveAppWindowDestination({
    args,
    inside: opts.inside ?? [],
    outside,
    redock: opts.redock ?? false,
    canFocusOutside: opts.canFocusOutside ?? true,
  });
}

describe('같은 창인가 — 열쇠', () => {
  it('distinguishes source-less drafts while leaving established document and file identities unchanged', () => {
    const base = { appId: 'vibi3d', projectId: PROJECT };
    expect(appWindowKey({ ...base, draftKey: 'local:first' })).not.toBe(appWindowKey({ ...base, draftKey: 'local:second' }));
    expect(appWindowKey({ ...base, draftKey: 'local:first' })).not.toBe(appWindowKey(base));
    expect(appWindowKey({ ...base, ref: 'doc-1', draftKey: 'local:first' })).toBe(appWindowKey({ ...base, ref: 'doc-1' }));
    expect(appWindowKey({ ...base, file: 'scene.glb', draftKey: 'local:first' })).toBe(appWindowKey({ ...base, file: 'scene.glb' }));
  });
  it('앱·프로젝트·문서·파일이 같으면 같고, 버블 이름은 보지 않는다', () => {
    expect(appWindowKey({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }))
      .toBe(appWindowKey({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1', file: '' }));
    expect(appWindowKey({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }))
      .not.toBe(appWindowKey({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-2' }));
    expect(appWindowKey({ appId: 'vibistudio', projectId: PROJECT }))
      .not.toBe(appWindowKey({ appId: 'vibisound', projectId: PROJECT }));
  });
});

describe('main 의 목록을 앱 안 창과 같은 말로 옮긴다', () => {
  const refKeyOf = (appId: string): string | null => ({ vibistudio: 'docId', vibisound: 'clipId' } as Record<string, string>)[appId] ?? null;
  it('retains draft identity from a source-less native editor for focus routing', () => {
    const list = outsideAppWindowsFrom([{ windowId: 5, appId: 'vibi3d', params: { projectId: PROJECT, draftKey: 'local:first' } }], () => 'modelId');
    expect(list).toEqual([{ windowId: 5, appId: 'vibi3d', projectId: PROJECT, draftKey: 'local:first' }]);
    expect(resolveAppWindowDestination({ args: { appId: 'vibi3d', projectId: PROJECT, draftKey: 'local:first' },
      inside: [], outside: list, redock: false, canFocusOutside: true })).toEqual({ kind: 'outside', appId: 'vibi3d', windowId: 5 });
  });

  it('문서 열쇠는 앱이 선언한 이름에서 꺼낸다', () => {
    expect(outsideAppWindowsFrom([
      { windowId: 7, appId: 'vibistudio', params: { projectId: PROJECT, docId: 'doc-1', appBubbleId: 'node-1', _windowTitle: '내 영상' } },
      { windowId: 9, appId: 'vibisound', params: { projectId: PROJECT, clipId: 'clip-1', file: 'media/a.wav' } },
    ], refKeyOf)).toEqual([
      { windowId: 7, appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' },
      { windowId: 9, appId: 'vibisound', projectId: PROJECT, ref: 'clip-1', file: 'media/a.wav' },
    ]);
  });

  it('견줄 수 없는 줄(모르는 앱·프로젝트 없음)은 버린다 — 모르는 것을 "같다"로 읽지 않는다', () => {
    expect(outsideAppWindowsFrom([
      { windowId: 1, appId: 'unknown', params: { projectId: PROJECT } },
      { windowId: 2, appId: 'vibistudio', params: {} },
      { windowId: 3, appId: 'vibistudio', params: { projectId: '' } },
    ], refKeyOf)).toEqual([]);
  });
});

describe('여는 손짓의 행선지', () => {
  it('그 문서가 이미 밖에 떠 있으면 앱 안에 세우지 않고 밖의 그 창을 앞으로 세운다', () => {
    expect(destination({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }))
      .toEqual({ kind: 'outside', appId: 'vibistudio', windowId: 7 });
    expect(destination({ appId: 'vibisound', projectId: PROJECT, file: 'media/a.wav' }))
      .toEqual({ kind: 'outside', appId: 'vibisound', windowId: 9 });
  });

  it('다른 문서면 종전대로 앱 안에 연다 — 밖의 창이 보던 문서를 빼앗지 않는다', () => {
    expect(destination({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-2' })).toEqual({ kind: 'inside' });
    expect(destination({ appId: 'vibistudio', projectId: 'C:/other', ref: 'doc-1' })).toEqual({ kind: 'inside' });
  });

  it('앱 안에 같은 창이 이미 있으면 그 창이 앞으로 온다(앱 안)', () => {
    expect(destination({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }, {
      inside: [{ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }],
    })).toEqual({ kind: 'inside' });
  });

  it('되돌아오는 길은 밖을 보지 않는다 — 닫히는 그 창을 앞으로 세우면 앱 안에 아무것도 서지 않는다', () => {
    expect(destination({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }, { redock: true })).toEqual({ kind: 'inside' });
  });

  it('밖의 창을 세울 수 없는 판(웹·구버전 preload)이면 앱 안이다', () => {
    expect(destination({ appId: 'vibistudio', projectId: PROJECT, ref: 'doc-1' }, { canFocusOutside: false })).toEqual({ kind: 'inside' });
  });
});
