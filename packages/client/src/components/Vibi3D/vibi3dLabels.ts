/**
 * The translation key of a Vibi3D authoring label. One English text has one key (docs/rules/i18n.md): labels whose
 * wording already exists elsewhere use that key; the rest live under `panel.vibi3d.authoring`.
 */
const SHARED: Readonly<Record<string, string>> = {
  shape: 'panel.videoStudio.editor.props.shape',
  path: 'panel.detailPanel.path',
  duplicate: 'panel.videoStudio.editor.duplicate',
  delete: 'panel.apps.delete',
  lock: 'canvas.bubbleMenu.lock',
  unlock: 'canvas.bubbleMenu.unlock',
  width: 'ide.imageAnnotate.crop.width',
  height: 'ide.imageAnnotate.crop.height',
  depth: 'ide.specReading.axis.depth',
  opacity: 'panel.videoStudio.editor.transformFields.opacity',
  cameraPosition: 'panel.vibi3d.position',
  light_ambient: 'panel.videoStudio.editor.props.ambientLight',
  addShape: 'panel.apps.vibimage.editor.addShape',
  groupName: 'ide.context.sort.category',
};
export function vibi3dLabelKey(label: string): string {
  return SHARED[label] ?? `panel.vibi3d.authoring.${label}`;
}
