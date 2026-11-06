interface MicrophoneNavigator {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

/** Only the requesting browser knows whose microphone needs permission. */
export function browserMicSettingsHint(nav?: MicrophoneNavigator): string {
  const ua = nav?.userAgent ?? '';
  const platform = nav?.userAgentData?.platform ?? nav?.platform ?? '';
  if (/iphone|ipad|ipod/i.test(`${platform} ${ua}`)
    || (/mac/i.test(platform) && (nav?.maxTouchPoints ?? 0) > 1)) {
    return 'ide.mainArea.voiceMicSettingsHintIos';
  }
  if (/android/i.test(`${platform} ${ua}`)) return 'ide.mainArea.voiceMicSettingsHintAndroid';
  return 'ide.mainArea.voiceMicSettingsHintBrowser';
}

export function isBrowserMicSettingsHint(key: string): boolean {
  return key === 'ide.mainArea.voiceMicSettingsHintIos'
    || key === 'ide.mainArea.voiceMicSettingsHintAndroid'
    || key === 'ide.mainArea.voiceMicSettingsHintBrowser';
}
