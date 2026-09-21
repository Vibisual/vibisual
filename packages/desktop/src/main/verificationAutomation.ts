import type { VerificationAutomationAdapter, VerificationObservation } from '@vibisual/server';
import type { VerificationAction, VerificationCheck, VerificationTarget, VerificationTargetAvailability } from '@vibisual/shared';
import { VerificationBrowser } from './verificationBrowser';
import { probeVerificationBrowser } from './verificationBrowserProbe';
import { actVerificationDesktop, observeVerificationDesktop, probeVerificationDesktop } from './verificationDesktop';
import { compareVerificationImages } from './verificationImage';

type Runtime = { target: VerificationTarget; browser?: VerificationBrowser; closed: boolean };
const runs = new Map<string, Runtime>();

function runtime(runId: string): Runtime {
  const value = runs.get(runId);
  if (!value || value.closed) throw new Error('This verification tool session is closed.');
  return value;
}

export const verificationAutomationAdapter: VerificationAutomationAdapter = {
  async probe(target: VerificationTarget): Promise<VerificationTargetAvailability> {
    try {
      if (target.kind === 'browser') await probeVerificationBrowser(target.url);
      else await probeVerificationDesktop(target);
      return { available: true, actions: target.kind === 'browser' ? ['click', 'double-click', 'fill', 'press', 'scroll', 'wait', 'navigate'] : ['click', 'double-click', 'fill', 'press', 'scroll', 'wait'], checks: target.kind === 'browser' ? ['visible', 'text', 'value', 'url', 'screenshot'] : ['screenshot'] };
    } catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error), actions: [], checks: [] }; }
  },

  async open(runId: string, target: VerificationTarget): Promise<void> {
    if (runs.has(runId)) throw new Error('The verification target is already open.');
    const state: Runtime = { target, closed: false };
    runs.set(runId, state);
    try {
      if (target.kind === 'browser') {
        state.browser = new VerificationBrowser(target.url);
        await state.browser.navigate(target.url);
      } else await probeVerificationDesktop(target);
      if (state.closed) throw new Error('The verification was stopped while opening its target.');
    } catch (error) { state.browser?.close(); if (runs.get(runId) === state) runs.delete(runId); throw error; }
  },

  async observe(runId: string): Promise<VerificationObservation> {
    const state = runtime(runId);
    if (state.browser) return state.browser.observe();
    if (state.target.kind !== 'desktop') throw new Error('The browser target is unavailable.');
    return observeVerificationDesktop(state.target);
  },

  async act(runId: string, action: VerificationAction): Promise<string> {
    const state = runtime(runId);
    if (state.browser) return state.browser.act(action);
    if (state.target.kind !== 'desktop') throw new Error('The browser target is unavailable.');
    return actVerificationDesktop(state.target, action, () => state.closed);
  },

  async check(runId: string, check: VerificationCheck, referencePng?: Buffer): Promise<{ passed: boolean; detail: string }> {
    const state = runtime(runId);
    if (check.kind === 'screenshot') {
      if (!referencePng?.length) throw new Error('The reference screenshot is missing.');
      const actual = await verificationAutomationAdapter.observe(runId);
      return compareVerificationImages(actual.png, referencePng, check.region);
    }
    if (!state.browser) throw new Error('Desktop targets support screenshot checks. DOM and URL checks require a browser target.');
    return state.browser.check(check);
  },

  async close(runId: string): Promise<void> {
    const state = runs.get(runId);
    if (!state) return;
    state.closed = true;
    runs.delete(runId);
    state.browser?.close();
  },
};

export function closeAllVerificationTargets(): void {
  for (const state of runs.values()) { state.closed = true; state.browser?.close(); }
  runs.clear();
}
