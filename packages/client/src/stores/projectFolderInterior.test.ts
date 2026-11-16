import { beforeEach, describe, expect, it } from 'vitest';

import { useGraphStore } from './graphStore.js';

/** §5.1 #2-3 — 프로젝트 폴더 안에서 들어간 묶음은 나오면 그 폴더 안으로, 그 폴더에서 나오면 메인으로 간다. */
describe('프로젝트 폴더 안 내비게이션', () => {
  beforeEach(() => useGraphStore.setState({ interiorView: null, currentFolderId: null, navStack: [] }));

  it('묶음 → 프로젝트 폴더 안 → 메인', () => {
    const projectFolder = { kind: 'projectFolder', label: 'vibisual' } as const;
    useGraphStore.getState().enterInterior(projectFolder);
    useGraphStore.getState().enterInterior({ kind: 'bundle', bundleId: 'bundle-radial-image', label: 'vibisual', memberIds: ['a.png'], parent: projectFolder });

    useGraphStore.getState().exitInterior();
    expect(useGraphStore.getState().interiorView).toEqual(projectFolder);

    useGraphStore.getState().exitInterior();
    expect(useGraphStore.getState().interiorView).toBeNull();
  });

  it('메인에서 들어간 묶음은 종전대로 메인으로 나온다', () => {
    useGraphStore.getState().enterInterior({ kind: 'bundle', bundleId: 'bundle-x', label: 'x', memberIds: ['a.png'] });
    useGraphStore.getState().exitInterior();
    expect(useGraphStore.getState().interiorView).toBeNull();
  });
});
