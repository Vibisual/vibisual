export class MemoError extends Error {
  /** `detail` 은 화면이 이어서 쓸 값(올리기 재개 자리 등)만 싣는다. */
  constructor(public readonly code: string, public readonly status = 400, public readonly detail: Readonly<Record<string, number>> = {}) { super(code); }
}
export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MemoError('invalid-request');
  return raw as Record<string, unknown>;
}
export function identifier(raw: unknown, prefix: string): string {
  if (typeof raw !== 'string' || !new RegExp(`^${prefix}-[a-zA-Z0-9-]{8,80}$`).test(raw)) throw new MemoError('invalid-id');
  return raw;
}
export function text(raw: unknown, max: number): string {
  if (typeof raw !== 'string' || raw.length > max) throw new MemoError('input-too-long');
  return raw;
}
