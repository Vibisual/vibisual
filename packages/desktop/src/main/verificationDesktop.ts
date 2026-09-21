import { desktopCapturer } from 'electron';
import { VERIFICATION_AUTOMATION, type VerificationAction, type VerificationTarget, type CaptureInputEvent } from '@vibisual/shared';
import type { VerificationObservation } from '@vibisual/server';
import { injectCaptureInput, resolveCaptureTargetRect } from './captureInputManager';
import { normalizedPoint, verificationKey } from './verificationAutomationPolicy';
import { normalizeVerificationImage } from './verificationImage';

type DesktopTarget = Extract<VerificationTarget, { kind: 'desktop' }>;
const PIXELS_PER_WHEEL_STEP = 100;

async function sourceFor(target: DesktopTarget): Promise<Electron.DesktopCapturerSource> {
  if (!target.sourceId.startsWith(`${target.sourceKind}:`)) throw new Error('The capture source kind does not match its id.');
  const sources = await desktopCapturer.getSources({ types: [target.sourceKind], thumbnailSize: { width: VERIFICATION_AUTOMATION.imageWidth, height: VERIFICATION_AUTOMATION.imageHeight } });
  // Titles legitimately change after a click/edit. Keep the user-selected native source id,
  // then use its current title for the native provider's public title-based lookup.
  const source = sources.find((candidate) => candidate.id === target.sourceId);
  if (!source) throw new Error('The selected capture source is no longer available. Select the target again.');
  if (target.sourceKind === 'window' && sources.filter((candidate) => candidate.name === source.name).length !== 1) throw new Error('Multiple windows have the selected title; rename or close the duplicate target.');
  if (source.thumbnail.isEmpty()) throw new Error('Screen capture is unavailable or the selected window is minimized.');
  return source;
}

export async function probeVerificationDesktop(target: DesktopTarget, platform = process.platform): Promise<void> {
  // The existing input adapter uses Windows screen coordinate conversion. Browser/CDP is portable.
  if (platform !== 'win32') throw new Error('Desktop input verification is currently available on Windows. Connect a browser URL on this platform.');
  const source = await sourceFor(target);
  const rect = await resolveCaptureTargetRect({ ...target, sourceName: source.name }, { focus: false });
  if (!rect.ok || rect.physical.width <= 0 || rect.physical.height <= 0) throw new Error('The input engine cannot resolve this exact capture target.');
}

export async function observeVerificationDesktop(target: DesktopTarget): Promise<VerificationObservation> {
  const source = await sourceFor(target);
  return { ...normalizeVerificationImage(source.thumbnail), title: source.name, elements: [] };
}

async function input(target: DesktopTarget, event: CaptureInputEvent, cancelled: () => boolean): Promise<void> {
  if (cancelled()) throw new Error('The verification was stopped.');
  const source = await sourceFor(target);
  if (cancelled()) throw new Error('The verification was stopped.');
  const result = await injectCaptureInput({ ...event, sourceName: source.name }, { cancelled });
  if (!result.ok) throw new Error(`Desktop input failed: ${result.reason ?? 'unknown'}.`);
}

async function press(target: DesktopTarget, raw: string, cancelled: () => boolean): Promise<void> {
  const key = verificationKey(raw, process.platform);
  await input(target, { ...target, type: 'key', action: 'press', key: key.key === ' ' ? 'Space' : key.key, ctrl: key.ctrl, alt: key.alt, shift: key.shift, meta: key.meta }, cancelled);
}

async function act(target: DesktopTarget, action: VerificationAction, cancelled: () => boolean): Promise<string> {
  if (cancelled()) throw new Error('The verification was stopped.');
  await probeVerificationDesktop(target);
  if (action.kind === 'click' || action.kind === 'double-click') {
    if (action.selector) throw new Error('Desktop targets use screenshot coordinates, not DOM selectors.');
    const point = normalizedPoint(action.x, action.y);
    await input(target, { ...target, type: 'mouse', action: action.kind === 'click' ? 'click' : 'dblclick', u: point.x, v: point.y, restoreCursor: true, preferBackgroundClick: false }, cancelled);
  } else if (action.kind === 'fill') {
    if (action.selector) throw new Error('Desktop targets use the focused field, not DOM selectors.');
    await press(target, 'Mod+A', cancelled); await press(target, 'Backspace', cancelled);
    if (action.text) await input(target, { ...target, type: 'key', action: 'type', text: action.text }, cancelled);
  } else if (action.kind === 'press') await press(target, action.key, cancelled);
  else if (action.kind === 'scroll') {
    if (action.deltaX !== 0) throw new Error('Horizontal scrolling is not supported by the desktop capture input engine.');
    const deltaY = Math.sign(action.deltaY) * Math.ceil(Math.abs(action.deltaY) / PIXELS_PER_WHEEL_STEP);
    await input(target, { ...target, type: 'mouse', action: 'wheel', u: 0.5, v: 0.5, deltaY, restoreCursor: true, preferBackgroundClick: false }, cancelled);
  } else if (action.kind === 'wait') await new Promise<void>((resolve) => setTimeout(resolve, Math.min(action.ms, VERIFICATION_AUTOMATION.maxWaitMs)));
  else throw new Error('Desktop targets cannot navigate to a browser URL.');
  return `${action.kind} executed against the selected desktop capture source.`;
}

// Keep each compound desktop gesture (select-all + typing) atomic across verification runs.
let desktopQueue: Promise<unknown> = Promise.resolve();
export function actVerificationDesktop(target: DesktopTarget, action: VerificationAction, cancelled: () => boolean): Promise<string> {
  const pending = desktopQueue.then(() => act(target, action, cancelled));
  desktopQueue = pending.catch(() => undefined);
  return pending;
}
