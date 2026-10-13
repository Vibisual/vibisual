/**
 * §5.13 (V) 37-1 — 오류를 **사람이 읽는 말 한 줄**로 (순수).
 *
 * 종전에는 `String(err)` 원문이 상태줄에 그대로 찍혔다("Error: request failed 504 …"). 이제 원문은 [자세히] 안에 접어 두고
 * 겉에는 갈래별 한 줄을 보인다. 갈래는 원문의 낱말로 고른다 — 서버·전송 층이 던지는 문구가 영문·한국어 섞여 있어 둘 다 본다.
 * 화면 문구는 번역 키(`panel.videoStudio.errors.<kind>`)가 맡는다.
 */

export type StudioErrorKind =
  | 'offline' | 'conflict' | 'missingDoc' | 'worker' | 'timeout' | 'unreadable' | 'tooLarge' | 'limit' | 'forbidden' | 'generic';

export interface StudioError {
  readonly kind: StudioErrorKind;
  /** 원문 — [자세히] 안에 접는다. */
  readonly detail: string;
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
  for (const rule of RULES) if (rule.test.test(detail)) return { kind: rule.kind, detail };
  return { kind: 'generic', detail };
}
