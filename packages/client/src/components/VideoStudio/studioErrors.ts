/**
 * §5.13 (V) 37-1 — 오류를 사람이 읽는 말 한 줄로(순수). 원문은 [자세히] 안에 접고 겉에는 갈래별 한 줄을 보인다.
 * 갈래는 원문의 낱말로 고른다 — 서버·전송 층 문구가 영문·한국어 섞여 있어 둘 다 본다. 화면 문구는 번역 키(`panel.videoStudio.errors.<kind>`).
 */

import { creationErrorCode } from '../Creation/creationErrors.js';

export type StudioErrorKind =
  | 'offline' | 'conflict' | 'missingDoc' | 'worker' | 'timeout' | 'unreadable' | 'tooLarge' | 'limit' | 'forbidden' | 'generic' | 'coded';

export interface StudioError {
  readonly kind: StudioErrorKind;
  /** 원문 — [자세히] 안에 접는다. */
  readonly detail: string;
  /** §5.13 (R-10) — 서버·화면이 코드로 던진 이유(`media-size-invalid`, `model-renderer-unavailable` …). 그 문장이 따로 번역돼 있다. */
  readonly code?: string;
}

const RULES: ReadonlyArray<{ readonly kind: StudioErrorKind; readonly test: RegExp }> = [
  { kind: 'conflict', test: /\b409\b|version-conflict|그 사이 바뀌|changed — read it again|최신 변경/i },
  { kind: 'tooLarge', test: /128 MiB|too large|너무 큽|limited to/i },
  { kind: 'limit', test: /custom-agent-limit|\b429\b/i },
  { kind: 'forbidden', test: /\b403\b|renderer-only/i },
  { kind: 'missingDoc', test: /unknown doc|unknown revision|\b404\b/i },
  { kind: 'worker', test: /일꾼|worker|main process bridge|offscreen/i },
  { kind: 'timeout', test: /\b504\b|timed? ?out|시간|within \d+s/i },
  { kind: 'unreadable', test: /읽지 못했|unreadable|could not read|not a file|does not exist|decode/i },
  { kind: 'offline', test: /failed to fetch|network|ECONN|연결|disconnected|socket/i },
];

export function classifyStudioError(err: unknown): StudioError {
  const detail = err instanceof Error ? err.message : String(err);
  const code = creationErrorCode(err);
  if (code !== 'unexpected') return { kind: 'coded', detail, code };
  for (const rule of RULES) if (rule.test.test(detail)) return { kind: rule.kind, detail };
  return { kind: 'generic', detail };
}
