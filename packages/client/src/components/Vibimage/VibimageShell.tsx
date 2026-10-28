import { useState } from 'react';
import type { AppShellProps } from '../../apps/registry.js';
import { isAbsoluteMediaPath } from '../../utils/workspaceMedia.js';
import { ImageEditor } from './ImageEditor.js';
import { VibimageViewer } from './VibimageViewer.js';

/**
 * §5.13 (R-9)(R-10) — a picture node opens on the R-9 viewer (writes nothing); [Edit] makes an editable source, and a node with a source opens the editor.
 * §5.1 #2-1 (A) — a picture outside the project (absolute `file`) is view-only: sources live in the project's `.vibisual`, so no [Edit].
 */
export function VibimageShell(props: AppShellProps): React.JSX.Element {
  const hasSource = !!(props.params['imageId'] ?? props.params['ref']);
  const file = props.params['file'] ?? '';
  const outside = isAbsoluteMediaPath(file);
  const [editing, setEditing] = useState(hasSource || !file);
  if (!editing) return <VibimageViewer {...props} onEdit={outside ? undefined : () => setEditing(true)} />;
  return <ImageEditor {...props} onShowPicture={file && !hasSource ? () => setEditing(false) : undefined} />;
}
