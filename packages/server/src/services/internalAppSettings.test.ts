import { describe, expect, it } from 'vitest';
import { mergeInternalAppSettings } from './userDefaultsService.js';
describe('internal app preferences', () => {
  it('merges one app without dropping another app setting', () => {
    const previous = { 'first-app': { aiEnabled: false }, 'second-app': { aiEnabled: true } };
    expect(mergeInternalAppSettings(previous, { 'second-app': { aiEnabled: false } })).toEqual({ 'first-app': { aiEnabled: false }, 'second-app': { aiEnabled: false } });
  });
  it('keeps old user defaults optional and ignores malformed values', () => {
    expect(mergeInternalAppSettings(undefined, undefined)).toBeUndefined();
    const previous = { 'first-app': { aiEnabled: false } };
    expect(mergeInternalAppSettings(previous, { 'first-app': { aiEnabled: 'yes' } } as never)).toEqual(previous);
  });
});
