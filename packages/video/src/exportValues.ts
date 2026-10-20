/**
 * §5.13 (AA) 42 — 내보내기 값 거르개의 작은 도우미(순수). 설정(`exportSettings.ts`)과 렌더 일감(`renderSpec.ts`)이 같은 규칙을 쓴다.
 */

import { EXPORT_FPS_MAX, EXPORT_FPS_MIN, EXPORT_PATH_MAX, EXPORT_TEXT_MAX } from './constants.js';

export function record(raw: unknown): Readonly<Record<string, unknown>> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 짧은 글 — 제어 글자를 빼고 상한까지. 비면 null. */
export function exportText(value: unknown, max: number = EXPORT_TEXT_MAX): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- 제어 글자를 걸러 내는 것이 목적이다.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return cleaned === '' ? null : cleaned;
}

/** 프레임 수 — 정수 범위 안이면 그 값, 아니면 null(문서대로). */
export function exportFps(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= EXPORT_FPS_MIN && value <= EXPORT_FPS_MAX ? value : null;
}

/** 저장 위치 — 글자 모양만 본다(절대 경로·존재는 서버가 `path` 로 본다). */
export function exportDir(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('\u0000')) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > EXPORT_PATH_MAX ? null : trimmed;
}
