import { AUDIO_LIMITS } from './constants.js';
import type { AudioValidationIssue } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export class FieldValidator {
  readonly errors: AudioValidationIssue[] = [];

  check(condition: boolean, path: string, message: string): void {
    if (!condition) this.errors.push({ path, message });
  }

  number(value: unknown, path: string, min: number, max: number, integer = false): void {
    this.check(isFiniteNumber(value) && value >= min && value <= max
      && (!integer || Number.isInteger(value)), path, `Expected ${integer ? 'integer' : 'number'} in [${min}, ${max}].`);
  }

  text(value: unknown, path: string, nonempty = false): void {
    this.check(typeof value === 'string' && value.length <= AUDIO_LIMITS.maxTextLength
      && (!nonempty || value.trim().length > 0), path, 'Expected a valid string.');
  }

  optionalText(value: unknown, path: string): void {
    if (value !== undefined) this.text(value, path);
  }

  optionalBoolean(value: unknown, path: string): void {
    this.check(value === undefined || typeof value === 'boolean', path, 'Expected boolean.');
  }

  gain(value: unknown, path: string): void {
    if (value !== undefined) this.number(value, path, AUDIO_LIMITS.minGainDb, AUDIO_LIMITS.maxGainDb);
  }
}
