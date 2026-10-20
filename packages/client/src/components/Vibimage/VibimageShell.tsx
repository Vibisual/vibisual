import { useState } from 'react';
import type { AppShellProps } from '../../apps/registry.js';
import { ImageEditor } from './ImageEditor.js';
import { VibimageViewer } from './VibimageViewer.js';

/**
 * §5.13 (R-9)(R-10) — a picture node opens on the R-9 viewer (opening writes nothing). [Edit] turns the picture into
 * an editable source in the editor; a node that already has a source opens the editor directly.
 */
export function VibimageShell(props: AppShellProps): React.JSX.Element {
  const hasSource = !!(props.params['imageId'] ?? props.params['ref']);
  const file = props.params['file'] ?? '';
  const [editing, setEditing] = useState(hasSource || !file);
  if (!editing) return <VibimageViewer {...props} onEdit={() => setEditing(true)} />;
  return <ImageEditor {...props} onShowPicture={file && !hasSource ? () => setEditing(false) : undefined} />;
}
