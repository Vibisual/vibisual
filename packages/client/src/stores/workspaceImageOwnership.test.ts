import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore, workspaceImageFileKey } from './graphStore.js';

beforeEach(() => useGraphStore.setState({ imageLightbox: null, workspaceImageSavedAt: {} }));
describe('workspace image ownership', () => {
  it('an old save cannot close a newly opened image, including reopening the same URL', () => {
    useGraphStore.getState().openImageLightbox('blob:same');
    const old = useGraphStore.getState().imageLightbox!;
    useGraphStore.getState().openImageLightbox('blob:same');
    const current = useGraphStore.getState().imageLightbox!;
    useGraphStore.getState().closeImageLightbox(old);
    expect(useGraphStore.getState().imageLightbox).toBe(current);
    useGraphStore.getState().closeImageLightbox(current);
    expect(useGraphStore.getState().imageLightbox).toBeNull();
  });
  it('saving the same relative path signals only the matching project and every save advances it', () => {
    useGraphStore.getState().markWorkspaceImageSaved('/a', 'same.png');
    const first = useGraphStore.getState().workspaceImageSavedAt[workspaceImageFileKey('/a', 'same.png')]!;
    expect(useGraphStore.getState().workspaceImageSavedAt[workspaceImageFileKey('/b', 'same.png')]).toBeUndefined();
    useGraphStore.getState().markWorkspaceImageSaved('/a', 'same.png');
    expect(useGraphStore.getState().workspaceImageSavedAt[workspaceImageFileKey('/a', 'same.png')]).toBeGreaterThan(first);
  });
});
