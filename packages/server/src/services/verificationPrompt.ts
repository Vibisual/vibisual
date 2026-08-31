/**
 * §5.5 #17-35 ④⑤ — 검증 프롬프트 조립 + 판정 해석 (순수 모듈).
 *
 * `/verify` 는 Claude Code 의 **번들 스킬**이라 실행 로직은 우리에게 없다 — 우리가 하는 일은 둘뿐이다.
 *
 *  1. **실행법을 먼저 쥐여 준다**(④) — `/verify` 는 앱 띄우는 법을 매번 다시 추론한다. 그런데 우리는
 *     §5.14 플레이 버블의 `PlayRecipe` 로 그 지식을 이미 구조화해 들고 있다. 그걸 그대로 실어 보낸다.
 *  2. **결론을 구조화해 받는다**(⑤) — 자유 텍스트 "됐습니다" 와 "실제로 돌려 봤다" 를 구별할 수 있게
 *     `VERIFICATION_VERDICT_SCHEMA_GUIDE`(§5.3 #10-3) 를 그대로 붙이고, 해석은 **fail-closed** 로 한다.
 *
 * 부수 효과 0 — 파일도 읽지 않고 시각도 보지 않는다(호출자가 읽어서 넘긴다). 그래야 이 조립·해석을
 * 화면 없이 통째로 시험할 수 있다(#17-11 ⑫(g) `sessionLoopPrompt` 와 같은 자리·같은 규율).
 */

import {
  VERIFY_SLASH_COMMAND,
  VERIFY_RECORDED_SKILL_PATH,
  VERIFICATION_VERDICT_SCHEMA_GUIDE,
  VERIFICATION_ATTEMPTS_MAX,
  VERIFICATION_REASON_MAX,
  VERIFICATION_ATTEMPT_TEXT_MAX,
} from '@vibisual/shared';
import type {
  VerificationAttemptRecord,
  VerificationDemo,
  VerificationRecipeSource,
  VerifyVerdict,
} from '@vibisual/shared';

/** 검증 프롬프트가 알아야 할 "이 앱을 띄우는 법" 한 벌. */
export interface VerifyRecipeInfo {
  source: VerificationRecipeSource;
  /** 화면·레코드에 남길 한 줄 요약(`pnpm dev · http://127.0.0.1:5173`). */
  label?: string;
  /** 프롬프트에 사실로 적어 줄 줄들. `source==='none'` 이면 빈 배열. */
  lines: string[];
}

/** 플레이 버블 하나에서 이 모듈이 쓰는 것만 추린 모양(레코드 전체를 끌고 오지 않는다). */
export interface PlayRecipeFacts {
  kind: 'static' | 'command';
  command?: string;
  cwd?: string;
  root?: string;
  port?: number;
  url?: string;
  openPath?: string;
  label?: string;
}

/** 사람이 읽을 한 줄로 자른다(줄바꿈은 공백으로 접는다 — 프롬프트 줄이 흐트러지지 않게). */
function oneLine(v: string, max: number): string {
  const flat = v.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * §5.5 #17-35 ④(a) — 우리 `PlayRecipe` 를 검증 프롬프트가 쓸 모양으로 옮긴다.
 *
 * 정적 서빙이면 "명령 없이 이 주소를 열면 된다" 가 핵심이고, 명령 실행이면 명령·작업 폴더가 핵심이다.
 */
export function summarizePlayRecipe(facts: PlayRecipeFacts): VerifyRecipeInfo {
  const lines: string[] = [];
  const labelParts: string[] = [];

  if (facts.kind === 'static') {
    lines.push('- 실행 방식: 정적 파일 서빙(별도 실행 명령이 필요 없다)');
    if (facts.root) lines.push(`- 서빙 루트: ${facts.root}`);
    labelParts.push('정적 서빙');
  } else {
    if (facts.command) {
      lines.push(`- 실행 명령: ${facts.command}`);
      labelParts.push(facts.command);
    }
    if (facts.cwd) lines.push(`- 작업 폴더: ${facts.cwd}`);
  }

  if (facts.url) {
    lines.push(`- 열 주소: ${facts.url}`);
    labelParts.push(facts.url);
  } else if (facts.port) {
    lines.push(`- 포트: ${facts.port}`);
    labelParts.push(`:${facts.port}`);
  }
  if (facts.openPath) lines.push(`- 열 경로: ${facts.openPath}`);

  // 아무 사실도 못 건졌다면 레시피가 있다고 말하지 않는다 — 빈 블록은 모델을 헷갈리게만 한다.
  if (lines.length === 0) return { source: 'none', lines: [] };

  const label = oneLine(labelParts.join(' · ') || facts.label || '실행 레시피', 120);
  return { source: 'play-recipe', label, lines };
}

/**
 * §5.5 #17-35 ④(b) — 리포에 `/verify` 자신이 적어 둔 레시피가 있을 때.
 *
 * 그 파일을 **읽지도 고치지도 않는다** — 존재만 알리고 따르라고 한다. 내용 관리는 `/verify` 의 몫이다.
 */
export function recordedSkillRecipe(relPath: string = VERIFY_RECORDED_SKILL_PATH): VerifyRecipeInfo {
  return {
    source: 'recorded-skill',
    label: relPath,
    lines: [`- 이 리포에는 이미 기록된 검증 레시피가 있다: \`${relPath}\``],
  };
}

/** 레시피가 하나도 없을 때 — `/verify` 에게 그대로 맡긴다. */
export const NO_RECIPE: VerifyRecipeInfo = { source: 'none', lines: [] };

/**
 * 시연 프레임 한 장 — 에이전트가 **직접 열 수 있는 절대 경로** + 클립 안 시각.
 *
 * 장수(`number`)가 아니라 경로를 받는 이유: `/verify` 프롬프트는 슬래시 명령이라 `composeTurnPrompt`
 * 가 **첨부 경로를 붙이지 않는다**(맨 앞 한 글자라도 앞서면 CLI 가 명령으로 집지 못한다는 규칙의
 * 일부로 꼬리 첨부까지 함께 잘린다). 그래서 "첨부된 그림 4장" 이라고 **말만 하고** 그림은 한 장도
 * 가지 않았다(실측: 에이전트가 "제 컨텍스트에는 이미지가 없습니다" 라고 되물었다).
 * 경로를 프롬프트 본문 안에 실으면 `/verify` 는 여전히 맨 앞이면서 그림이 실제로 도달한다.
 */
export interface DemoFrameRef {
  /** 그 명령의 첨부 자리에 복사된 PNG 의 절대 경로. */
  path: string;
  /** 구간 시작을 0 으로 본 클립 안 시각(ms) — 단계 시각과 같은 축. */
  atMs: number;
}

/** 검증 한 건을 보내기 위해 필요한 입력. */
export interface VerifyPromptInput {
  /** 사용자가 적은 "무엇을 확인할지" 한 줄(선택). */
  focus?: string;
  /** 실어 보낼 실행법. */
  recipe: VerifyRecipeInfo;
  /**
   * §5.5 #17-35 ⑨-4 — 사람이 직접 해 보인 재현 절차(선택).
   * 없으면 이 함수가 만드는 텍스트는 ⑨ 이전과 **완전히 같다**(회귀 테스트가 그 동일성을 지킨다).
   */
  demo?: VerificationDemo;
  /** 그 시연의 프레임들(빈 배열이면 그림 얘기를 아예 꺼내지 않는다). */
  demoFrames?: DemoFrameRef[];
}

/** 클립 안 시각을 `0:03` 로 — 단계 문장과 붙는 그림이 같은 순간을 가리키게 하는 표시. */
export function formatDemoTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * 그 탭 큐에 실제로 나갈 텍스트를 만든다.
 *
 * 첫 줄이 `/verify` 다 — Claude Code 는 명령 이름 뒤의 **나머지 전부**(줄바꿈 포함)를 그 스킬의
 * 인자로 넘기므로, 아래 블록들이 그대로 스킬에 전달된다. 순서는 항상 같다(확인할 것 → 실행법 →
 * 판정 형식) — 매번 흔들리면 모델이 검증마다 다른 규칙을 따른다(#17-11 ⑫(g) 와 같은 이유).
 */
export function buildVerifyPrompt(input: VerifyPromptInput): string {
  const parts: string[] = [VERIFY_SLASH_COMMAND];

  const focus = input.focus?.trim();
  if (focus) {
    parts.push('', `이번 검증에서 확인할 것: ${focus}`);
  }

  if (input.recipe.source === 'play-recipe' && input.recipe.lines.length > 0) {
    parts.push(
      '',
      '=== 이 앱을 띄우는 법 (Vibisual 이 이미 알고 있는 것) ===',
      ...input.recipe.lines,
      '',
      '위 정보는 이 프로젝트의 플레이 버블에 저장된 **실행 레시피**다. 다시 알아내지 말고 그대로 써라.',
      '틀렸다면 고쳐 쓰려 하지 말고, 무엇이 어떻게 틀렸는지를 판정 사유에 적어라.',
    );
  } else if (input.recipe.source === 'recorded-skill') {
    parts.push(
      '',
      '=== 이미 기록된 검증 레시피 ===',
      ...input.recipe.lines,
      '',
      '그 절차를 그대로 따라라. 그 파일은 네가 관리하는 것이니 이번 실행이 그 절차를 벗어났을 때만 손대라.',
    );
  }

  // §5.5 #17-35 ⑨-4 — 사람이 해 보인 절차. 레시피(앱 켜는 법) **바로 뒤**에 온다 —
  // 켜는 법 다음에 오는 것이 곧 "그 다음 무엇을 누르는가" 이기 때문이다.
  const demo = input.demo;
  const frames = input.demoFrames ?? [];
  if (demo && (demo.steps.length > 0 || demo.expected || frames.length > 0)) {
    parts.push('', '=== 사람이 직접 해 보인 재현 절차 ===');
    if (demo.label) parts.push(`시연: ${demo.label}`);
    // 무엇을 찍은 화면인지 말한다 — 시연은 이 리포의 앱이 아닐 수 있다(다른 프로그램을 녹화한
    // 시연이 실제로 온다). 그걸 안 알려 주면 모델은 그림 속 화면을 이 리포의 화면으로 착각한다.
    //
    // 다만 기본 이름(`defaultDemoLabel`)이 이미 `<소스명> · <시각>` 이라 그대로 또 적으면
    // 같은 문자열이 두 줄 연속으로 선다. 이름이 이미 소스명을 담고 있으면 이 줄은 생략한다.
    if (demo.sourceName && !demo.label.includes(demo.sourceName)) {
      parts.push(`녹화한 화면: ${demo.sourceName}`);
    }
    if (demo.durationMs > 0) parts.push(`구간 길이: ${formatDemoTime(demo.durationMs)} (아래 시각은 구간 시작이 0:00)`);
    if (demo.steps.length > 0) {
      parts.push('');
      demo.steps.forEach((st, i) => {
        parts.push(`${i + 1}. (${formatDemoTime(st.atMs)}) ${st.text}`);
      });
    }
    if (demo.expected) parts.push('', `기대 결과: ${demo.expected}`);
    if (frames.length > 0) {
      // 경로만 덩그러니 두지 않는다. 첨부 레일은 이 프롬프트에 닿지 않으므로(위 `DemoFrameRef` 주석)
      // **네가 열어야 보인다**는 것을 명시해야 한다 — "첨부됐다" 고만 하면 모델은 이미 봤다고 여기고
      // 그림 없이 판정하거나, 없는 첨부를 찾다 멈춘다.
      parts.push(
        '',
        `그 시연에서 뽑은 화면 ${frames.length}장이 아래 경로에 있다(시간 순서). 이것은 **파일 경로일 뿐 이미 실려 있는 그림이 아니다** —`,
        'Read 도구로 한 장씩 직접 열어 본 다음에 판단하라. 열지 않으면 무엇이 어떻게 보여야 하는지 알 수 없다.',
      );
      frames.forEach((f, i) => {
        parts.push(`${i + 1}) ${formatDemoTime(f.atMs)} — ${f.path}`);
      });
    }

    parts.push('');
    if (demo.steps.length > 0) {
      parts.push(
        '이 절차는 이 앱의 사용자가 화면을 녹화하며 **직접 조작해 보인 것**이다. 무엇을 눌러야 할지 추론하지 말고',
        '위 순서를 그대로 재현해 확인하라. 재현할 수 없는 단계가 있으면 임의로 건너뛰지 말고 무엇이 막았는지를 판정 사유에 적어라.',
      );
    } else if (frames.length > 0) {
      // 단계가 비었는데 "위 순서를 그대로 재현하라" 고 하면 없는 목록을 찾게 된다(실측: 단계 0개인
      // 시연에서 모델이 절차도 그림도 못 찾겠다고 되물었다). 있는 것만 말한다.
      parts.push(
        '이 화면은 이 앱의 사용자가 **직접 조작하며 녹화한 것**이다. 다만 글로 적어 둔 단계는 없다 —',
        '위 그림들이 절차의 전부이니 순서대로 열어 보고 무엇을 하고 있었는지 읽어 내라. 단계를 지어내지 말고,',
        '그림만으로 무엇을 확인해야 할지 정할 수 없으면 무엇이 부족했는지를 판정 사유에 적어라.',
      );
    } else {
      parts.push(
        '사용자가 남긴 것은 위 기대 결과 한 줄뿐이다(적어 둔 단계도 화면도 없다). 그것을 확인 기준으로 삼되,',
        '어떻게 재현할지는 앞의 실행법에서 찾고, 그래도 정할 수 없으면 무엇이 부족했는지를 판정 사유에 적어라.',
      );
    }
  }

  parts.push(
    '',
    '테스트 통과·타입체크 통과로 대신하지 마라 — **앱을 실제로 띄워 그 변경이 동작하는 것을 본 결과**를 답해야 한다.',
    '',
    VERIFICATION_VERDICT_SCHEMA_GUIDE,
  );

  return parts.join('\n');
}

/** 텍스트에서 균형 잡힌 최상위 `{ … }` 후보들을 뽑는다(펜스·주변 산문 허용, 뒤에 나온 것 우선). */
function extractJsonObjectCandidates(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
      if (depth < 0) depth = 0;
    }
  }
  return out.reverse();
}

/** `attempts` 배열을 우리 레코드로 정규화한다. 모양이 아닌 것은 조용히 버린다. */
function parseAttempts(raw: unknown): VerificationAttemptRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: VerificationAttemptRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const command = typeof o.command === 'string' ? oneLine(o.command, VERIFICATION_ATTEMPT_TEXT_MAX) : '';
    if (!command) continue;
    const kind = typeof o.kind === 'string' && o.kind.trim() ? oneLine(o.kind, 40) : 'custom';
    const rec: VerificationAttemptRecord = { kind, command };
    if (typeof o.exitCode === 'number' && Number.isFinite(o.exitCode)) rec.exitCode = Math.trunc(o.exitCode);
    if (typeof o.detail === 'string' && o.detail.trim()) rec.detail = oneLine(o.detail, VERIFICATION_ATTEMPT_TEXT_MAX);
    out.push(rec);
    if (out.length >= VERIFICATION_ATTEMPTS_MAX) break;
  }
  return out;
}

/** 판정 해석 결과. */
export interface ParsedVerifyVerdict {
  verdict: VerifyVerdict;
  reason?: string;
  attempts: VerificationAttemptRecord[];
}

/**
 * §5.5 #17-35 ⑤ — 에이전트 응답에서 판정을 읽는다. **fail-closed.**
 *
 *  - 구조화 블록의 `reject` → `fail`.
 *  - 구조화 블록의 `approve` 는 **실제로 돌린 시도가 하나라도 있어야** `pass`, 없으면 `held`.
 *    ("봤더니 괜찮다" 는 증거가 아니다 — §5.3 #10-3 이 세운 규율 그대로.)
 *  - 블록이 없으면 키워드 폴백으로 **reject 만** 인정하고, 나머지는 전부 `held`.
 *
 * 즉 해석 실패가 통과로 흐르는 길이 없다.
 */
export function parseVerificationVerdict(text: string): ParsedVerifyVerdict {
  const empty: VerificationAttemptRecord[] = [];
  if (!text || typeof text !== 'string') return { verdict: 'held', attempts: empty };

  for (const raw of extractJsonObjectCandidates(text)) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    const v = typeof obj.verdict === 'string' ? obj.verdict.toLowerCase() : '';
    if (v !== 'approve' && v !== 'reject') continue;

    const reason = typeof obj.reason === 'string' && obj.reason.trim()
      ? oneLine(obj.reason, VERIFICATION_REASON_MAX)
      : undefined;
    const attempts = parseAttempts(obj.attempts);

    if (v === 'reject') {
      return reason ? { verdict: 'fail', reason, attempts } : { verdict: 'fail', attempts };
    }
    // approve 는 증거가 있어야 통과다.
    if (attempts.length === 0) {
      return { verdict: 'held', reason: reason ?? '증거(실제로 돌린 시도) 없이 통과라고만 답했습니다', attempts };
    }
    return reason ? { verdict: 'pass', reason, attempts } : { verdict: 'pass', attempts };
  }

  const upper = text.toUpperCase();
  const hasReject = /\b(REJECT|FAIL(ED)?|BROKEN|NOT WORKING)\b/.test(upper);
  const hasApprove = /\b(APPROVE[D]?|LGTM|PASS(ED)?|WORKS|OK)\b/.test(upper);
  if (hasReject && !hasApprove) return { verdict: 'fail', attempts: empty };
  return { verdict: 'held', attempts: empty };
}

/**
 * §5.5 #17-35 ⑥ — 실패한 검증을 그대로 다음 프롬프트로 만든다.
 *
 * 새 통신 레이어를 만들지 않는다 — 이 문자열은 기존 명령 큐로 나간다(§5.16 반려 사유가 다음
 * 프롬프트가 되는 그 경로와 같은 골격).
 */
export function buildVerifyReworkPrompt(run: {
  verdict: VerifyVerdict;
  focus?: string;
  reason?: string;
  attempts: VerificationAttemptRecord[];
}): string {
  const head = run.verdict === 'fail'
    ? '방금 검증이 **실패**했습니다. 아래 근거를 보고 원인을 고쳐 주세요.'
    : '방금 검증이 **보류**되었습니다(통과 근거가 부족합니다). 아래를 보고 실제로 돌려서 확인해 주세요.';

  const parts: string[] = [head];
  if (run.focus?.trim()) parts.push('', `확인하려던 것: ${run.focus.trim()}`);
  if (run.reason) parts.push('', `판정 사유: ${run.reason}`);

  if (run.attempts.length > 0) {
    parts.push('', '실제로 돌린 것:');
    for (const a of run.attempts) {
      const code = a.exitCode === undefined ? '종료 코드 없음' : `exit ${a.exitCode}`;
      parts.push(`- [${a.kind}] ${a.command} → ${code}${a.detail ? ` (${a.detail})` : ''}`);
    }
  } else {
    parts.push('', '실제로 돌린 기록이 남지 않았습니다 — 이번에는 반드시 앱을 띄워서 확인해 주세요.');
  }

  parts.push('', '고친 뒤에는 다시 검증을 돌릴 수 있게 무엇을 어떻게 고쳤는지 한 줄로 알려 주세요.');
  return parts.join('\n');
}
