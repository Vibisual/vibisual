export class AudioServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'AudioServiceError';
  }
}

export function badRequest(message: string): never {
  throw new AudioServiceError(400, 'invalid-request', message);
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)
    && value !== 'constructor' && value !== 'prototype';
}
