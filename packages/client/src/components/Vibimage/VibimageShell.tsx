import { useEffect, useState } from 'react';
import type { AppShellProps } from '../../apps/registry.js';
import { isAbsoluteMediaPath } from '../../utils/workspaceMedia.js';
import { ImageEditor } from './ImageEditor.js';
import { peekLayerEditPicture, releaseLayerEditPicture, type LayerEditPicture } from './layerEditHandoff.js';
import { VibimageViewer } from './VibimageViewer.js';

/**
 * §5.13 (R-9)(R-10) — a picture node opens on the R-9 viewer (writes nothing); its [Edit] is the quick editor, [Layer edit] makes
 * an editable source, and a node with a source opens the editor. A picture handed over from a quick editor (§5.5 #17-25 ④-3)
 * opens straight in the editor.
 * §5.1 #2-1 (A) — a picture outside the project (absolute `file`) has no [Layer edit]: sources live in the project's `.vibisual`.
 */
export function VibimageShell(props: AppShellProps): React.JSX.Element {
  const hasSource = !!(props.params['imageId'] ?? props.params['ref']);
  const file = props.params['file'] ?? '';
  const draftKey = props.params['draftKey'];
  const outside = isAbsoluteMediaPath(file);
  const [picture, setPicture] = useState<LayerEditPicture | null>(() => peekLayerEditPicture(draftKey));
  const [editing, setEditing] = useState(() => hasSource || !file || picture !== null);
  useEffect(() => { releaseLayerEditPicture(draftKey); }, [draftKey]);
  if (!editing) {
    return <VibimageViewer {...props} onLayerEdit={outside ? undefined : (next) => { setPicture(next); setEditing(true); }} />;
  }
  return <ImageEditor {...props} picture={picture}
    onShowPicture={file && !hasSource ? () => { setPicture(null); setEditing(false); } : undefined} />;
}
