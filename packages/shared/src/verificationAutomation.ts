import { VERIFICATION_AUTOMATION as L, VERIFICATION_DEMO_STEPS_MAX } from './constants.js';
import type { VerificationAction, VerificationCheck, VerificationRun, VerificationTarget } from './types.js';

/** Evidence-backed operations must form a subsequence in procedure order; a typed action precedes its check. */
export function verificationStepCompletion(
  run: Pick<VerificationRun, 'requiredSteps' | 'procedure' | 'toolEvents' | 'evidence'>,
): boolean[] {
  const required = run.requiredSteps ?? 0;
  if (!Number.isInteger(required) || required <= 0) return [];
  const completion = Array<boolean>(Math.min(required, VERIFICATION_DEMO_STEPS_MAX)).fill(false);
  const evidenceIds = new Set((run.evidence ?? []).map((image) => image.id));
  const events = (run.toolEvents ?? []).filter((event) => event.ok && event.evidenceId && evidenceIds.has(event.evidenceId)
    && (event.operation === 'act' || event.operation === 'check'));
  let cursor = 0;
  for (let index = 0; index < completion.length; index++) {
    const step = run.procedure?.[index];
    const operations: ('act' | 'check' | 'either')[] = [];
    if (step?.action) operations.push('act');
    if (step?.check) operations.push('check');
    if (!operations.length) operations.push('either');
    for (const operation of operations) {
      const found = events.findIndex((event, at) => at >= cursor && event.stepIndex === index
        && (operation === 'either' || event.operation === operation)
        && (operation !== 'act' || JSON.stringify(event.action) === JSON.stringify(step?.action))
        && (operation !== 'check' || JSON.stringify(event.check) === JSON.stringify(step?.check)));
      if (found < 0) return completion;
      cursor = found + 1;
    }
    completion[index] = true;
  }
  return completion;
}

/** Convenience predicate shares the ordered completion calculation with the UI and verdict gate. */
export function verificationStepCovered(
  run: Pick<VerificationRun, 'requiredSteps' | 'procedure' | 'toolEvents' | 'evidence'>,
  index: number,
): boolean {
  return Number.isInteger(index) && index >= 0 && verificationStepCompletion(run)[index] === true;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function finite(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
export function verificationUrl(value: unknown): string | undefined {
  if (!text(value, L.maxUrl)) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function parseVerificationTarget(value: unknown): VerificationTarget | undefined {
  const v = record(value);
  if (!v) return undefined;
  if (v.kind === 'browser') {
    const url = verificationUrl(v.url);
    return url ? { kind: 'browser', url, ...(text(v.playBubbleId, 200) ? { playBubbleId: v.playBubbleId } : {}) } : undefined;
  }
  if (v.kind === 'desktop' && text(v.sourceId, 200) && text(v.sourceName, 500)
    && (v.sourceKind === 'window' || v.sourceKind === 'screen')) {
    return { kind: 'desktop', sourceId: v.sourceId, sourceName: v.sourceName, sourceKind: v.sourceKind };
  }
  return undefined;
}
export function parseVerificationAction(value: unknown): VerificationAction | undefined {
  const v = record(value);
  if (!v) return undefined;
  switch (v.kind) {
    case 'click': case 'double-click':
      if (text(v.selector, L.maxSelector)) return { kind: v.kind, selector: v.selector };
      return finite(v.x, 0, 1) && finite(v.y, 0, 1) ? { kind: v.kind, x: v.x, y: v.y } : undefined;
    case 'fill':
      return typeof v.text === 'string' && v.text.length <= L.maxText && (v.selector === undefined || text(v.selector, L.maxSelector))
        ? { kind: 'fill', text: v.text, ...(typeof v.selector === 'string' ? { selector: v.selector } : {}) } : undefined;
    case 'press': return text(v.key, 80) ? { kind: 'press', key: v.key } : undefined;
    case 'scroll': return finite(v.deltaX, -L.maxScroll, L.maxScroll) && finite(v.deltaY, -L.maxScroll, L.maxScroll) ? { kind: 'scroll', deltaX: v.deltaX, deltaY: v.deltaY } : undefined;
    case 'wait': return finite(v.ms, 0, L.maxWaitMs) ? { kind: 'wait', ms: v.ms } : undefined;
    case 'navigate': { const url = verificationUrl(v.url); return url ? { kind: 'navigate', url } : undefined; }
    default: return undefined;
  }
}
export function parseVerificationCheck(value: unknown): VerificationCheck | undefined {
  const v = record(value);
  if (!v) return undefined;
  switch (v.kind) {
    case 'visible': return text(v.selector, L.maxSelector) ? { kind: 'visible', selector: v.selector } : undefined;
    case 'text': case 'value':
      return (text(v.expected, L.maxText) || (v.kind === 'value' && v.expected === '')) && (v.selector === undefined || text(v.selector, L.maxSelector))
        ? { kind: v.kind, expected: v.expected, ...(typeof v.selector === 'string' ? { selector: v.selector } : {}) } : undefined;
    case 'url': return text(v.expected, L.maxUrl) ? { kind: 'url', expected: v.expected } : undefined;
    case 'screenshot': {
      if (!finite(v.referenceFrame, 0, 100) || !Number.isInteger(v.referenceFrame)) return undefined;
      const region = record(v.region);
      if (v.region !== undefined && (!region || !finite(region.x, 0, 1) || !finite(region.y, 0, 1)
        || !finite(region.width, 0.01, 1) || !finite(region.height, 0.01, 1)
        || region.x + region.width > 1 || region.y + region.height > 1)) return undefined;
      return { kind: 'screenshot', referenceFrame: v.referenceFrame,
        ...(region ? { region: { x: region.x as number, y: region.y as number, width: region.width as number, height: region.height as number } } : {}) };
    }
    default: return undefined;
  }
}
