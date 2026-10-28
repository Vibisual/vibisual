import {
  AGENT_ENGINE_CLI_LABEL,
  COMMAND_ERROR_CODES,
  COMMAND_ERROR_CODES_WITH_EXIT,
  UNKNOWN_ENGINE_CLI_LABEL,
} from '@vibisual/shared';
import type { AgentEngineKind, CommandError, CommandErrorCode } from '@vibisual/shared';
import { providerErrorGuidance, type ProviderErrorGuidance } from './providerError.js';

/** §5.5 #17-12 ③ — 사유를 문장 키 + 파라미터로(`t()` ❌ — i18n 없이 시험되고 화면마다 문장을 붙인다). 서버는 코드 + 원문만 싣는다. */

/** 엔진 이름을 채울 수 있는 엔진 종류 — 표에 없는 값(옛 데이터·미래 엔진)은 중립 이름으로 떨어진다. */
const ENGINE_KINDS: ReadonlySet<string> = new Set(Object.keys(AGENT_ENGINE_CLI_LABEL));

/** §5.5 #17-12 ③-7 — 문장이 부를 엔진 이름(모르면 `CLI`). 고유명사라 번역 파일이 아니라 shared 표에서. */
export function engineLabelOf(engine: AgentEngineKind | undefined): string {
  return engine && ENGINE_KINDS.has(engine) ? AGENT_ENGINE_CLI_LABEL[engine] : UNKNOWN_ENGINE_CLI_LABEL;
}

/** 사유 한 건의 표시 재료. `detail` 은 stderr 꼬리·CLI 본문이라 **번역하지 않는다**. */
export interface CommandErrorText {
  /** i18n 키 — 호출자가 `t(labelKey, labelParams)` 로 문장을 만든다. */
  labelKey: string;
  labelParams?: Record<string, string | number>;
  /** 원문 꼬리(있을 때만). 코드 폰트로 그대로 보여준다. */
  detail: string | null;
  /** Known service response: calm explanation and recovery advice; raw detail stays available. */
  guidance?: ProviderErrorGuidance;
}

// 목록은 shared 한 벌 — 여기 따로 두면 빠진 코드가 `unknown` 이 되거나 다른 엔진 실패를 Claude CLI 종료로 말한다(§5.19 `local`).
const KNOWN_CODES: ReadonlySet<string> = new Set<string>(COMMAND_ERROR_CODES);

/** 종료 코드가 있느냐로 문장이 갈리는 코드 — 없는데 `{{code}}` 를 쓰면 "code undefined" 가 뜬다. */
const CODE_AWARE: ReadonlySet<string> = new Set<string>(COMMAND_ERROR_CODES_WITH_EXIT);

/** 유니언 밖이라 캐스트하지만 화면 문장 고르기에만 쓰인다(실행·판정은 `CommandError` 를 읽지 않는다). */
const UNTYPED_ERROR_CODE = 'unknown' as CommandErrorCode;

/** 모르는 코드도 `unknown` 문장 + 원문으로. 엔진 파라미터는 늘 싣는다 — 빠지면 `cli`·`spawn`·`exit` 문장에 `{{engine}}` 이 그대로 뜬다. */
export function describeCommandError(error: CommandError): CommandErrorText {
  const code = KNOWN_CODES.has(error.code) ? error.code : 'unknown';
  const detail = error.detail && error.detail.trim() !== '' ? error.detail.trim() : null;
  if (code === 'local' && detail === 'local-images-unsupported') {
    return { labelKey: 'ide.mainArea.localImagesUnsupported', detail: null };
  }
  const engine = engineLabelOf(error.engine);
  const guidance = providerErrorGuidance(error);
  if (guidance) {
    return {
      labelKey: code === 'usageLimit' ? 'ide.cmdError.usageLimit' : `ide.providerNotice.${guidance.kind}.title`,
      labelParams: { engine }, detail, guidance,
    };
  }
  if (CODE_AWARE.has(code)) {
    return error.exitCode !== undefined
      ? { labelKey: `ide.cmdError.${code}`, labelParams: { code: error.exitCode, engine }, detail }
      : { labelKey: `ide.cmdError.${code}Unknown`, labelParams: { engine }, detail };
  }
  return { labelKey: `ide.cmdError.${code}`, labelParams: { engine }, detail };
}

/** `[code]` / `[code:exit] detail` 을 되돌린다(system `[subtype]` 과 같은 꼴). 형식이 안 맞으면 전체를 원문 detail 로. */
export function parseStreamErrorContent(content: string): CommandError {
  // `@engine` 은 **선택 꼬리**다(§5.5 #17-12 ③-7). 그것이 없는 옛 줄은 종전과 똑같이 읽히고,
  //   엔진이 비면 화면이 엔진 이름 없이 `CLI` 라고만 말한다 — 모르는 것을 클로드로 단정하지 않는다.
  const m = /^\[([A-Za-z]+)(?::(-?\d+))?(?:@([A-Za-z]+))?\]\s*([\s\S]*)$/.exec(content.trim());
  if (!m) {
    // 봉투 없는 줄은 누구 실패인지 모른다 — `unknown` + 원문(`exit` 면 CLI 없는 경로까지 Claude 탓이 된다).
    const raw = content.trim();
    return raw ? { code: UNTYPED_ERROR_CODE, detail: raw } : { code: UNTYPED_ERROR_CODE };
  }
  const rawCode = m[1] ?? '';
  // 모르는 코드는 **그대로 실어 보낸다** — `describeCommandError` 가 `unknown` 문장으로 받아 준다.
  //   여기서 `exit` 로 바꿔치면 미래에 코드가 하나 늘 때마다 같은 오인이 되살아난다.
  const code = (KNOWN_CODES.has(rawCode) ? rawCode : UNTYPED_ERROR_CODE) as CommandErrorCode;
  const exitCode = m[2] !== undefined ? Number(m[2]) : undefined;
  const rawEngine = m[3];
  const engine = rawEngine && ENGINE_KINDS.has(rawEngine) ? (rawEngine as AgentEngineKind) : undefined;
  const detail = (m[4] ?? '').trim();
  return {
    code,
    ...(exitCode !== undefined && Number.isFinite(exitCode) ? { exitCode } : {}),
    ...(detail ? { detail } : {}),
    ...(engine ? { engine } : {}),
  };
}

/** 상태바처럼 한 줄만 쓸 수 있는 자리를 위한 합성 — 라벨은 이미 번역된 문장을 받는다. */
export function joinCommandErrorLine(label: string, detail: string | null): string {
  if (!detail) return label;
  // 원문은 여러 줄일 수 있다 — 한 줄 자리에서는 줄바꿈을 공백으로 눕힌다.
  return `${label} — ${detail.replace(/\s*\n+\s*/g, ' ')}`;
}
