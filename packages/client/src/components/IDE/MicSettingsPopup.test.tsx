import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MicSettingsPopup, type MicSettingsPopupProps } from './MicSettingsPopup.js';
import { VoiceInputOverlay } from './VoiceInputOverlay.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const props: MicSettingsPopupProps = {
  open: true,
  openable: false,
  hintKey: 'ide.mainArea.voiceMicSettingsHintIos',
  blocked: true,
  noDevice: false,
  onOpenSettings: () => undefined,
  onClose: () => undefined,
  denoise: true,
  onDenoiseChange: () => undefined,
  respace: true,
  onRespaceChange: () => undefined,
  echoUnavailable: false,
};

describe('mobile microphone recovery', () => {
  it('distinguishes insecure connections and provides access to the recovery popup', () => {
    const markup = renderToStaticMarkup(<VoiceInputOverlay
      status="error" error="insecure-context" interim="" analyserRef={{ current: null }}
      onStop={() => undefined} onDismissError={() => undefined} onOpenMicSettings={() => undefined}
    />);
    expect(markup).toContain('ide.mainArea.voiceErrInsecureContext');
    expect(markup).toContain('ide.mainArea.voiceMicSettingsAction');
    expect(markup).not.toContain('ide.mainArea.voiceErrDevice');
  });

  it('offers the public CA download and trust instructions for insecure browser connections', () => {
    const markup = renderToStaticMarkup(<MicSettingsPopup {...props} insecureContext />);
    expect(markup).toContain('href="/mobile/ca.crt"');
    expect(markup).toContain('panel.mobileAccess.certificateTrustNote');
    expect(markup).toContain('panel.mobileAccess.certificateFingerprintNote');
    expect(markup).not.toContain('ide.mainArea.voiceMicSettingsOpen');
    expect(markup).not.toContain('ide.mainArea.voiceMicSettingsDeviceNote');
  });

  it('does not ask to install a certificate for a normal microphone permission error', () => {
    const markup = renderToStaticMarkup(<MicSettingsPopup {...props} />);
    expect(markup).not.toContain('/mobile/ca.crt');
    expect(markup).toContain('ide.mainArea.voiceMicSettingsHintIos');
  });

  it('keeps the desktop OS settings action and device guidance', () => {
    const markup = renderToStaticMarkup(<MicSettingsPopup {...props} openable hintKey="ide.mainArea.voiceMicSettingsHintWin" />);
    expect(markup).toContain('ide.mainArea.voiceMicSettingsOpen');
    expect(markup).toContain('ide.mainArea.voiceMicSettingsDeviceNote');
    expect(markup).not.toContain('/mobile/ca.crt');
  });
});
