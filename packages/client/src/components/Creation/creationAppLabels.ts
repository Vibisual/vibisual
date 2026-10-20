import type { TFunction } from 'i18next';

/** The kind of an editable source in words, reusing the media labels (one English text, one key). */
const APP_KEYS: Readonly<Record<string, string>> = {
  vibimage: 'panel.videoStudio.editor.media_image',
  vibi3d: 'ide.stage.surfaceName.model3d',
  vibistudio: 'panel.videoStudio.editor.media_video',
};
export function creationAppLabel(t: TFunction, appId: string): string {
  const key = APP_KEYS[appId];
  return key ? t(key) : appId;
}
