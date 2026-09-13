/**
 * 세션 진입점 SSOT — "이 Claude Code 세션을 **누가 켰는가**".
 *
 * §5.7 #24 Session Liveness Watcher 는 오랫동안 `entrypoint === 'vscode'` 하나만 통과시켰다.
 * 그 조건은 "사용자가 직접 연 인터랙티브 세션"을 뜻하려던 것인데, **VS Code 라는 한 제품의
 * 이름으로 그 뜻을 적어 버려서** 같은 성격의 다른 진입점(Cowork)이 들어오자 그대로 탈락했다.
 * 뜻과 표현을 분리한다 — 판정은 `isInteractiveEntrypoint` 가 하고, 제품 이름은 그 술어 안에만 있다.
 *
 * **실측(2026-09-11, `~/.claude/sessions/*.json`)**: `claude-vscode` 7건 · `sdk-cli` 1건.
 * 종전 파서는 `sdk-cli` 를 `'cli'` 로 접었다(`includes('cli')`). 둘은 성격이 달라 가른다 —
 * `sdk` 는 우리(또는 남)가 SDK 로 띄운 자식이고 `cli` 는 사람이 터미널에서 친 것이다.
 * 어느 쪽도 버블 후보가 아니므로 **가르는 것만으로 기존 판정은 한 줄도 바뀌지 않는다**(탈락 사유
 * 문자열만 정확해진다).
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform`·`node:*` 을 읽지 않는다(pathCase 와 같은 규약).
 */

/**
 * 세션 진입점.
 *
 * - `vscode` — VS Code·Cursor 등 IDE 확장이 띄운 세션(실측 값 `claude-vscode`).
 * - `cowork` — Claude Desktop 의 Cowork 로컬 세션. **문자열로 판정하지 않는 것이 정본이다**
 *   (아래 `entrypointFromConfigHome` 주석) — 이 값은 그 판정 결과를 담는 자리다.
 * - `sdk` — Agent SDK 가 띄운 자식(실측 값 `sdk-cli`).
 * - `cli` — 사람이 터미널에서 친 `claude`.
 * - `unknown` — 세션 파일이 없거나 우리가 모르는 문자열. **인터랙티브로 넘겨짚지 않는다.**
 */
export type SessionEntrypoint = 'vscode' | 'cowork' | 'cli' | 'sdk' | 'unknown';

/**
 * 진입점 문자열 → `SessionEntrypoint`.
 *
 * 검사 순서에 의미가 있다 — `sdk-cli` 는 `cli` 를 **포함**하므로 `sdk` 를 먼저 본다.
 * 모르는 문자열은 `unknown` 이다(화이트리스트 밖을 버리는 §2.1 셸 토크나이저와 같은 규율 —
 * 모르는 것을 인터랙티브로 넘겨짚으면 훅 워커·리플렉션 세션이 전부 버블이 된다).
 */
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
 * **버블 후보 판정** — §5.7 #24 (c) 의 정본.
 *
 * "사용자가 직접 연 인터랙티브 세션"만 Hook 에이전트 버블이 된다. 우리가(또는 남이) 프로그램으로
 * 띄운 자식(`sdk`)과 터미널 세션(`cli`)은 몇 초 살다 사라지며 끊임없이 들락거리므로 제외한다
 * (제외 근거는 `aliveDiagSignature` 주석의 실측 — 2초마다 지문이 흔들려 진단 로그가 3일 만에
 * 회전 상한에 닿았다).
 *
 * 이 술어 하나가 추가 경로(`discoverSessions`/`seedAgents`)와 제거 경로(`readAliveSessionIds`)를
 * **함께** 판정한다 — 한쪽만 통과하면 10초 주기로 버블이 깜빡인다.
 */
export function isInteractiveEntrypoint(ep: SessionEntrypoint): boolean {
  return ep === 'vscode' || ep === 'cowork';
}

/**
 * 세션 JSON 을 **어느 설정 홈에서 읽었는가**로 진입점을 정한다 — Cowork 판정의 정본.
 *
 * Cowork 세션의 `entrypoint` 문자열이 무엇인지는 **실측된 바 없다**(이 기계에 Cowork 로컬 세션이
 * 살아 있던 적이 없어 확인 불가). 그래서 문자열을 추측해 화이트리스트에 적는 대신, **출처**로
 * 판정한다 — Cowork 세션 홈(`<세션디렉터리>/.claude`)에서 읽은 세션 파일은 정의상 Cowork 의
 * 것이다. 추측이 0 이므로 Anthropic 이 그 문자열을 바꿔도 이 판정은 흔들리지 않는다.
 *
 * 출처가 호스트 홈(`~/.claude`)이면 파일에 적힌 문자열을 그대로 믿는다(종전 동작 불변).
 */
export function entrypointFromConfigHome(
  raw: unknown,
  source: 'host' | 'cowork',
): SessionEntrypoint {
  if (source === 'cowork') return 'cowork';
  return parseSessionEntrypoint(raw);
}
