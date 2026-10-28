/**
 * 세션 진입점 — 이 Claude Code 세션을 누가 켰는가. "직접 연 인터랙티브 세션"은 술어(`isInteractiveEntrypoint`)로 판정하고 제품 이름은 그 안에만 —
 * `entrypoint === 'vscode'` 처럼 적으면 같은 성격의 Cowork 가 탈락한다(§5.7 #24).
 * 실측(2026-09-11, `~/.claude/sessions/*.json`): `claude-vscode` 7 · `sdk-cli` 1. `sdk` 와 `cli` 는 가른다. 순수(`process`·`node:*` ❌).
 */

/**
 * `vscode` IDE 확장(실측 `claude-vscode`) · `cowork` Claude Desktop Cowork(문자열 아닌 출처로 판정 — `entrypointFromConfigHome`)
 * · `sdk` Agent SDK 자식(실측 `sdk-cli`) · `cli` 터미널의 `claude` · `unknown` 파일 없음·모르는 문자열(인터랙티브로 넘겨짚지 않는다).
 */
export type SessionEntrypoint = 'vscode' | 'cowork' | 'cli' | 'sdk' | 'unknown';

/** `sdk-cli` 가 `cli` 를 포함하므로 `sdk` 를 먼저 본다. 모르면 `unknown` — 인터랙티브로 치면 훅 워커·리플렉션 세션이 전부 버블이 된다. */
export function parseSessionEntrypoint(raw: unknown): SessionEntrypoint {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s.includes('vscode') || s.includes('vs-code')) return 'vscode';
  if (s.includes('cowork') || s.includes('local-agent-mode')) return 'cowork';
  if (s.includes('sdk')) return 'sdk';
  if (s.includes('claude-code') || s === 'claude' || s.includes('cli')) return 'cli';
  return 'unknown';
}

/**
 * 버블 후보 판정(§5.7 #24 (c) 정본) — 직접 연 인터랙티브 세션만. `sdk`·`cli` 는 몇 초 살다 사라지며 들락거려 뺀다(`aliveDiagSignature` 실측).
 * 추가(`discoverSessions`/`seedAgents`)와 제거(`readAliveSessionIds`)가 이 술어 하나를 본다 — 한쪽만 통과하면 10초 주기로 깜빡인다.
 */
export function isInteractiveEntrypoint(ep: SessionEntrypoint): boolean {
  return ep === 'vscode' || ep === 'cowork';
}

/**
 * 어느 설정 홈에서 읽었나로 진입점을 정한다 — Cowork 판정의 정본. Cowork 의 `entrypoint` 문자열은 실측된 적이 없어 추측하지 않는다 —
 * Cowork 세션 홈(`<세션디렉터리>/.claude`)에서 읽었으면 Cowork. 호스트 홈(`~/.claude`)이면 적힌 문자열을 믿는다.
 */
export function entrypointFromConfigHome(
  raw: unknown,
  source: 'host' | 'cowork',
): SessionEntrypoint {
  if (source === 'cowork') return 'cowork';
  return parseSessionEntrypoint(raw);
}
