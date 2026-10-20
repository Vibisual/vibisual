/**
 * The translation key of a Vibimage editor label. One English text has one key (docs/rules/i18n.md): labels whose
 * wording already exists elsewhere use that key; the rest live under `panel.apps.vibimage.editor`.
 */
const SHARED: Readonly<Record<string, string>> = {
  canvas: 'common.shortcuts.scope.canvas',
  name: 'panel.videoStudio.editor.props.name',
  text: 'panel.videoStudio.values.kind_text',
  shape: 'panel.videoStudio.editor.props.shape',
  width: 'ide.imageAnnotate.crop.width',
  height: 'ide.imageAnnotate.crop.height',
  opacity: 'panel.videoStudio.editor.transformFields.opacity',
  color: 'panel.videoStudio.editor.props.color',
  font: 'panel.videoStudio.style.font',
  fontSize: 'panel.videoStudio.editor.props.fontSize',
  left: 'panel.videoStudio.editor.options.left',
  center: 'panel.videoStudio.editor.options.center',
  right: 'panel.videoStudio.editor.options.right',
  rectangle: 'panel.videoStudio.editor.options.rect',
  ellipse: 'panel.videoStudio.editor.options.ellipse',
  opaque: 'panel.videoStudio.editor.scene_solid',
  background: 'panel.videoStudio.style.slot_bg',
  accent: 'panel.videoStudio.style.slot_accent',
  undo: 'panel.videoStudio.editor.undo',
  redo: 'panel.videoStudio.editor.redo',
  agent: 'panel.detailPanel.agentBadge',
  ask: 'panel.videoStudio.agent.send',
  working: 'panel.videoStudio.ai.working',
  unsaved: 'panel.options.discardTitle',
  saved: 'providers.saved',
  duplicate: 'panel.videoStudio.editor.duplicate',
  delete: 'panel.apps.delete',
  discard: 'ide.verify.demo.discard',
  fit: 'panel.apps.vibimage.fit',
  rebase: 'panel.creation.rebase',
  cleanupAll: 'panel.creation.cleanupAll',
  cleanupStale: 'panel.creation.cleanupStale',
  confirmCleanupAll: 'panel.creation.confirmCleanupAll',
  confirmCloseUnsaved: 'panel.creation.confirmCloseUnsaved',
  save: 'panel.vibi3d.authoring.saveSource',
  quality: 'panel.vibi3d.review.stage',
  draft: 'panel.vibi3d.review.draft',
};
export function imageLabelKey(label: string): string {
  return SHARED[label] ?? `panel.apps.vibimage.editor.${label}`;
}
