import { COMMAND_ERROR_CODES, COMMAND_ERROR_CODES_WITH_EXIT } from '@vibisual/shared';
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

// 목록은 shared 한 벌뿐이다 — 여기에 자기 집합을 또 두면 코드가 늘 때마다 한쪽만 늘어나고,
//   빠진 코드는 조용히 `unknown` 으로 떨어지거나 **다른 엔진의 실패를 Claude CLI 종료로 잘못 말한다**
//   (§5.19 `local` 이 실제로 그랬다 — 2026-08-20 사용자 보고).
const KNOWN_CODES: ReadonlySet<string> = new Set<string>(COMMAND_ERROR_CODES);

/** 종료 코드가 있느냐로 문장이 갈리는 코드 — 없는데 `{{code}}` 를 쓰면 "code undefined" 가 뜬다. */
const CODE_AWARE: ReadonlySet<string> = new Set<string>(COMMAND_ERROR_CODES_WITH_EXIT);

/**
 * 사유를 특정할 수 없는 줄에 붙이는 코드. `CommandErrorCode` 유니언 밖의 값이라 캐스트하지만,
 * 이 값은 **화면 문장을 고르는 데에만** 쓰인다(`describeCommandError` 가 `unknown` 으로 받는다).
 * 실행·판정 로직은 `CommandError` 를 읽지 않는다(표시 전용).
 */
const UNTYPED_ERROR_CODE = 'unknown' as CommandErrorCode;

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
    // 봉투가 없는 줄 = 누가 낸 실패인지 모른다. 예전엔 `exit` 로 떨어뜨려 "Claude CLI 가 예기치 않게
    //   종료됐습니다" 라고 단정했는데, 로컬 모델처럼 CLI 가 아예 없는 경로의 실패까지 Claude 탓으로
    //   말하게 된다. 모르면 모른다고 하고(사유는 `unknown`) 원문을 그대로 보여준다.
    const raw = content.trim();
    return raw ? { code: UNTYPED_ERROR_CODE, detail: raw } : { code: UNTYPED_ERROR_CODE };
  }
  const rawCode = m[1] ?? '';
  // 모르는 코드는 **그대로 실어 보낸다** — `describeCommandError` 가 `unknown` 문장으로 받아 준다.
  //   여기서 `exit` 로 바꿔치면 미래에 코드가 하나 늘 때마다 같은 오인이 되살아난다.
  const code = (KNOWN_CODES.has(rawCode) ? rawCode : UNTYPED_ERROR_CODE) as CommandErrorCode;
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
