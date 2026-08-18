import type { CommandError, CommandErrorCode } from '@vibisual/shared';

/**
 * §5.5 #17-12 ③ — "오류" 한 단어를 사람이 읽을 수 있는 사유로 바꾸는 순수 모듈.
 *
 * 서버는 사유를 **코드 + 원문**으로만 싣는다(로케일을 모른다). 문장은 여기서 만들되, 이 모듈도
 * `t()` 를 부르지 않고 **키와 파라미터만** 돌려준다 — 그래야 i18n 없이 단위 테스트가 되고,
 * 부르는 화면(하단 상태바 · 스트림 · 메인 타임라인)이 저마다 자기 방식으로 문장을 붙일 수 있다.
 */

/** 사유 한 건의 표시 재료. `detail` 은 stderr 꼬리·CLI 본문이라 **번역하지 않는다**. */
export interface CommandErrorText {
  /** i18n 키 — 호출자가 `t(labelKey, labelParams)` 로 문장을 만든다. */
  labelKey: string;
  labelParams?: Record<string, string | number>;
  /** 원문 꼬리(있을 때만). 코드 폰트로 그대로 보여준다. */
  detail: string | null;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<CommandErrorCode>([
  'spawn', 'stdin', 'exit', 'crash', 'cli', 'maxTurns', 'agentView', 'orphaned',
]);

/** 종료 코드가 있느냐로 문장이 갈리는 코드 — 없는데 `{{code}}` 를 쓰면 "code undefined" 가 뜬다. */
const CODE_AWARE: ReadonlySet<string> = new Set(['exit', 'crash']);

/** 사유 → 화면 재료. 모르는 코드(옛 데이터·미래 코드)도 버리지 않고 `unknown` 문장 + 원문으로 남긴다. */
export function describeCommandError(error: CommandError): CommandErrorText {
  const code = KNOWN_CODES.has(error.code) ? error.code : 'unknown';
  const detail = error.detail && error.detail.trim() !== '' ? error.detail.trim() : null;
  if (CODE_AWARE.has(code)) {
    return error.exitCode !== undefined
      ? { labelKey: `ide.cmdError.${code}`, labelParams: { code: error.exitCode }, detail }
      : { labelKey: `ide.cmdError.${code}Unknown`, detail };
  }
  return { labelKey: `ide.cmdError.${code}`, detail };
}

/**
 * 서버가 `error` 스트림 이벤트 본문에 실어 보낸 `[code]` / `[code:exit] detail` 을 되돌린다.
 * system 줄의 `[subtype]` 규약과 같은 모양이라, 형식이 안 맞으면 전체를 원문 detail 로 본다
 * (사유를 통째로 잃느니 원문이라도 보여주는 편이 낫다).
 */
export function parseStreamErrorContent(content: string): CommandError {
  const m = /^\[([A-Za-z]+)(?::(-?\d+))?\]\s*([\s\S]*)$/.exec(content.trim());
  if (!m) {
    const raw = content.trim();
    return raw ? { code: 'exit' as CommandErrorCode, detail: raw } : { code: 'exit' as CommandErrorCode };
  }
  const rawCode = m[1] ?? '';
  const code = (KNOWN_CODES.has(rawCode) ? rawCode : 'exit') as CommandErrorCode;
  const exitCode = m[2] !== undefined ? Number(m[2]) : undefined;
  const detail = (m[3] ?? '').trim();
  return {
    code,
    ...(exitCode !== undefined && Number.isFinite(exitCode) ? { exitCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

/** 상태바처럼 한 줄만 쓸 수 있는 자리를 위한 합성 — 라벨은 이미 번역된 문장을 받는다. */
export function joinCommandErrorLine(label: string, detail: string | null): string {
  if (!detail) return label;
  // 원문은 여러 줄일 수 있다 — 한 줄 자리에서는 줄바꿈을 공백으로 눕힌다.
  return `${label} — ${detail.replace(/\s*\n+\s*/g, ' ')}`;
}
