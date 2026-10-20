/**
 * Translation keys of media and item kinds. One English text has one key (docs/rules/i18n.md): the 3D kind uses the
 * existing "3D" label instead of a second copy.
 */
const MODEL_LABEL = 'ide.stage.surfaceName.model3d';
export function mediaKindKey(kind: string): string {
  return kind === 'model' ? MODEL_LABEL : `panel.videoStudio.editor.media_${kind}`;
}
export function itemKindKey(kind: string): string {
  return kind === 'model' ? MODEL_LABEL : `panel.videoStudio.values.kind_${kind}`;
}
