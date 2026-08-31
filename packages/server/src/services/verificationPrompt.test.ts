/**
 * §5.5 #17-35 ④⑤ — 검증 프롬프트 조립 + 판정 해석 테스트.
 *
 * 이 모듈이 지키는 것은 둘이다: **레시피를 실어 보낸다**(다시 알아내게 두지 않는다)와
 * **해석 실패가 통과로 흐르지 않는다**(fail-closed). 아래 케이스는 그 둘만 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  VERIFY_SLASH_COMMAND,
  VERIFY_RECORDED_SKILL_PATH,
  VERIFICATION_ATTEMPTS_MAX,
} from '@vibisual/shared';
import type { VerificationDemo } from '@vibisual/shared';
import {
  buildVerifyPrompt,
  buildVerifyReworkPrompt,
  formatDemoTime,
  parseVerificationVerdict,
  recordedSkillRecipe,
  summarizePlayRecipe,
  NO_RECIPE,
} from './verificationPrompt.js';
import { composeTurnPrompt } from './turnPrompt.js';

describe('summarizePlayRecipe', () => {
  it('명령 실행 레시피는 명령·작업 폴더·주소를 사실로 옮긴다', () => {
    const r = summarizePlayRecipe({
      kind: 'command',
      command: 'pnpm dev',
      cwd: 'C:/repo/app',
      url: 'http://127.0.0.1:5173/',
    });
    expect(r.source).toBe('play-recipe');
    expect(r.lines.join('\n')).toContain('pnpm dev');
    expect(r.lines.join('\n')).toContain('C:/repo/app');
    expect(r.lines.join('\n')).toContain('http://127.0.0.1:5173/');
    expect(r.label).toContain('pnpm dev');
  });

  it('정적 서빙은 실행 명령이 필요 없다는 사실을 적는다', () => {
    const r = summarizePlayRecipe({ kind: 'static', root: 'C:/repo/site', url: 'http://127.0.0.1:8080/' });
    expect(r.source).toBe('play-recipe');
    expect(r.lines.join('\n')).toContain('정적');
    expect(r.label).toContain('정적 서빙');
  });

  it('건질 사실이 하나도 없으면 레시피가 있다고 말하지 않는다', () => {
    const r = summarizePlayRecipe({ kind: 'command' });
    expect(r.source).toBe('none');
    expect(r.lines).toHaveLength(0);
  });
});

describe('buildVerifyPrompt', () => {
  it('첫 줄은 항상 /verify 이고 판정 형식이 끝에 붙는다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE });
    expect(text.split('\n')[0]).toBe(VERIFY_SLASH_COMMAND);
    expect(text).toContain('Verdict format');
    expect(text).toContain('"verdict"');
  });

  it('우리 레시피가 있으면 그 사실을 싣고 "다시 알아내지 말라"고 못박는다', () => {
    const recipe = summarizePlayRecipe({ kind: 'command', command: 'pnpm dev', cwd: 'C:/repo' });
    const text = buildVerifyPrompt({ recipe, focus: '로그인 버튼이 실제로 눌리는지' });
    expect(text).toContain('pnpm dev');
    expect(text).toContain('다시 알아내지 말고');
    expect(text).toContain('로그인 버튼이 실제로 눌리는지');
  });

  it('기록된 스킬이 있으면 경로를 알리고 그대로 따르라고 한다', () => {
    const text = buildVerifyPrompt({ recipe: recordedSkillRecipe() });
    expect(text).toContain(VERIFY_RECORDED_SKILL_PATH);
    expect(text).toContain('그대로 따라라');
  });

  it('레시피가 없으면 실행법 블록 자체를 넣지 않는다(빈 블록 ❌)', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE });
    expect(text).not.toContain('이 앱을 띄우는 법');
    expect(text).not.toContain('이미 기록된 검증 레시피');
  });

  it('테스트 통과로 대신하지 말라는 규칙은 항상 실린다', () => {
    expect(buildVerifyPrompt({ recipe: NO_RECIPE })).toContain('테스트 통과');
  });
});

describe('parseVerificationVerdict — fail-closed', () => {
  it('증거 있는 approve 만 pass 가 된다', () => {
    const r = parseVerificationVerdict(
      '```json\n{"verdict":"approve","reason":"버튼이 눌린다","attempts":[{"kind":"run","command":"pnpm dev","exitCode":0}]}\n```',
    );
    expect(r.verdict).toBe('pass');
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]!.exitCode).toBe(0);
  });

  it('증거 없는 approve 는 held 다', () => {
    const r = parseVerificationVerdict('```json\n{"verdict":"approve","reason":"looks good"}\n```');
    expect(r.verdict).toBe('held');
  });

  it('reject 는 증거가 없어도 fail 이다', () => {
    const r = parseVerificationVerdict('```json\n{"verdict":"reject","reason":"흰 화면"}\n```');
    expect(r.verdict).toBe('fail');
    expect(r.reason).toBe('흰 화면');
  });

  it('구조화 블록이 없고 통과처럼 보이기만 하면 held 다', () => {
    expect(parseVerificationVerdict('다 됐습니다. 잘 동작합니다.').verdict).toBe('held');
    expect(parseVerificationVerdict('LGTM, it works').verdict).toBe('held');
  });

  it('구조화 블록 없이 실패만 말하면 fail 로 인정한다', () => {
    expect(parseVerificationVerdict('The app FAILED to start.').verdict).toBe('fail');
  });

  it('빈 응답·비문자열은 held 다', () => {
    expect(parseVerificationVerdict('').verdict).toBe('held');
    expect(parseVerificationVerdict(undefined as unknown as string).verdict).toBe('held');
  });

  it('시도 목록은 상한에서 잘리고 모양이 아닌 항목은 버린다', () => {
    const many = Array.from({ length: VERIFICATION_ATTEMPTS_MAX + 5 }, (_, i) => ({
      kind: 'test', command: `cmd ${i}`, exitCode: 0,
    }));
    const raw = JSON.stringify({ verdict: 'approve', attempts: [...many, { kind: 'test' }, null, 3] });
    const r = parseVerificationVerdict(raw);
    expect(r.verdict).toBe('pass');
    expect(r.attempts).toHaveLength(VERIFICATION_ATTEMPTS_MAX);
  });

  it('산문에 섞인 마지막 JSON 블록을 읽는다', () => {
    const r = parseVerificationVerdict(
      '먼저 { 이건 아니고 } 이런저런 설명…\n{"verdict":"reject","reason":"포트가 안 열림"}\n끝.',
    );
    expect(r.verdict).toBe('fail');
    expect(r.reason).toBe('포트가 안 열림');
  });
});

describe('buildVerifyReworkPrompt', () => {
  it('실패는 근거(시도·종료코드)를 그대로 다음 프롬프트에 싣는다', () => {
    const text = buildVerifyReworkPrompt({
      verdict: 'fail',
      focus: '로그인',
      reason: '흰 화면',
      attempts: [{ kind: 'run', command: 'pnpm dev', exitCode: 1, detail: 'Cannot find module' }],
    });
    expect(text).toContain('실패');
    expect(text).toContain('흰 화면');
    expect(text).toContain('pnpm dev');
    expect(text).toContain('exit 1');
    expect(text).toContain('Cannot find module');
  });

  it('보류는 "실제로 돌려서 확인" 을 요구한다', () => {
    const text = buildVerifyReworkPrompt({ verdict: 'held', attempts: [] });
    expect(text).toContain('보류');
    expect(text).toContain('실제로 돌린 기록이 남지 않았습니다');
  });
});

// ─── §5.5 #17-35 ⑨-4 — 시연(재현 절차)이 실릴 때 ───
//
// 여기서 지키는 것은 둘이다: **안 고르면 ⑨ 이전과 완전히 같은 프롬프트**(회귀 0)와,
// **고르면 재현하라고 분명히 말한다**(추론하지 말라는 그 문장이 빠지면 시연을 실은 뜻이 사라진다).

const demoFixture = (over: Partial<VerificationDemo> = {}): VerificationDemo => ({
  id: 'demo-1',
  agentId: 'agent-1',
  subAgentId: 'sub-1',
  projectName: 'app',
  label: '로그인 후 저장',
  sourceName: 'MyApp',
  steps: [
    { atMs: 3_000, text: '좌측에서 로그인을 누른다' },
    { atMs: 11_000, text: '저장을 누른다' },
  ],
  expected: '초록색 저장됨 알림이 뜬다',
  frames: [{ rel: 'demo-1/0.png', atMs: 3_000 }],
  durationMs: 15_000,
  recordedAt: 1,
  ...over,
});

/** 프레임 N 장 — 10초 간격(0:03, 0:13, 0:23, 0:33)으로 시각이 겹치지 않게 둔다. */
const frameRefs = (n: number): { path: string; atMs: number }[] =>
  Array.from({ length: n }, (_, i) => ({ path: `C:/att/demo-${i}.png`, atMs: 3_000 + i * 10_000 }));

describe('buildVerifyPrompt — 시연 승격(⑨)', () => {
  it('시연을 안 실으면 프롬프트가 종전과 **한 글자도 다르지 않다**', () => {
    const base = { recipe: NO_RECIPE, focus: '저장이 되는지' };
    expect(buildVerifyPrompt(base)).toBe(buildVerifyPrompt({ ...base, demo: undefined }));
  });

  it('단계는 번호 + 시각으로 나가고, 시각 표기는 0:03 꼴이다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture(), demoFrames: frameRefs(1) });
    expect(text).toContain('1. (0:03) 좌측에서 로그인을 누른다');
    expect(text).toContain('2. (0:11) 저장을 누른다');
  });

  it('추론하지 말고 그대로 재현하라고 말한다 — 이 문장이 시연을 실은 이유다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture() });
    expect(text).toContain('추론하지 말고');
    expect(text).toContain('재현');
  });

  it('기대 결과와 시연 이름·소스가 함께 실린다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture() });
    expect(text).toContain('초록색 저장됨 알림이 뜬다');
    expect(text).toContain('로그인 후 저장');
    expect(text).toContain('MyApp');
  });

  it('그림이 0장이면 그림 얘기를 꺼내지 않는다(없는 첨부를 찾게 두지 않는다)', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture({ frames: [] }), demoFrames: [] });
    expect(text).not.toContain('아래 경로에 있다');
  });

  it('그림은 장수만이 아니라 **경로와 시각**이 실린다 — 첨부 레일은 슬래시 프롬프트에 닿지 않는다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture(), demoFrames: frameRefs(4) });
    expect(text).toContain('화면 4장이 아래 경로에 있다');
    expect(text).toContain('1) 0:03 — C:/att/demo-0.png');
    expect(text).toContain('4) 0:33 — C:/att/demo-3.png');
  });

  it('그림은 "이미 실려 있는 것이 아니다" 라고 못 박고 Read 를 시킨다', () => {
    // 종전엔 "첨부된 그림 N장" 이라고만 해서, 경로가 통째로 잘려 나간 줄 모른 채
    // 모델이 없는 이미지를 찾다 멈췄다(실측). 그 문장이 다시 들어오면 이 테스트가 잡는다.
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture(), demoFrames: frameRefs(2) });
    expect(text).toContain('파일 경로일 뿐 이미 실려 있는 그림이 아니다');
    expect(text).toContain('Read 도구로');
    expect(text).not.toContain('첨부된 그림');
  });

  it('단계가 없으면 "위 순서를 그대로 재현하라"고 하지 않는다 — 없는 목록을 찾게 두지 않는다', () => {
    const noSteps = demoFixture({ steps: [] });
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: noSteps, demoFrames: frameRefs(4) });
    expect(text).not.toContain('위 순서를 그대로 재현');
    expect(text).toContain('글로 적어 둔 단계는 없다');
  });

  it('무엇을 찍은 화면인지 말한다 — 시연은 이 리포의 앱이 아닐 수 있다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture(), demoFrames: frameRefs(1) });
    expect(text).toContain('녹화한 화면: MyApp');
    expect(text).toContain('구간 길이: 0:15');
  });

  it('이름이 이미 소스명을 담고 있으면 같은 말을 두 줄 쓰지 않는다', () => {
    // `defaultDemoLabel` 이 `<소스명> · <시각>` 을 만들므로 기본 이름은 항상 이 경우다.
    const text = buildVerifyPrompt({
      recipe: NO_RECIPE,
      demo: demoFixture({ label: 'MyApp · 오전 11:05' }),
      demoFrames: frameRefs(1),
    });
    expect(text).toContain('시연: MyApp · 오전 11:05');
    expect(text).not.toContain('녹화한 화면:');
  });

  it('내용이 하나도 없는 시연은 블록 자체를 만들지 않는다', () => {
    const empty = demoFixture({ steps: [], frames: [] });
    delete (empty as { expected?: string }).expected;
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: empty, demoFrames: [] });
    expect(text).not.toContain('사람이 직접 해 보인 재현 절차');
  });

  it('시연 블록은 실행법(레시피) **뒤**에 온다 — 켜는 법 다음이 곧 무엇을 누르는가다', () => {
    const text = buildVerifyPrompt({
      recipe: summarizePlayRecipe({ kind: 'command', command: 'pnpm dev' }),
      demo: demoFixture(),
    });
    expect(text.indexOf('pnpm dev')).toBeLessThan(text.indexOf('사람이 직접 해 보인 재현 절차'));
  });

  it('판정 형식 안내는 여전히 맨 끝이다(시연이 그 자리를 밀어내지 않는다)', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo: demoFixture(), demoFrames: frameRefs(2) });
    expect(text.indexOf('사람이 직접 해 보인 재현 절차')).toBeLessThan(text.lastIndexOf('approve'));
  });
});

// 이 검증 하나가 없어서 그림이 한 번도 에이전트에 닿지 않았다 — 두 모듈은 각자 맞았는데
// **이어 붙인 결과**가 틀렸다(프롬프트는 그림이 있다고 말하고, 조립은 그 경로를 버렸다).
describe('시연 그림은 실제로 턴 프롬프트까지 살아 남는다(⑨-4 ↔ #17-2 이음매)', () => {
  const demo = demoFixture();
  const frames = frameRefs(4);

  it('`/verify` 는 여전히 맨 앞이다 — CLI 가 내장 명령으로 집을 수 있어야 한다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo, demoFrames: frames });
    expect(text.startsWith(VERIFY_SLASH_COMMAND)).toBe(true);
    expect(composeTurnPrompt({
      text, attachments: frames.map((f) => f.path), contextSummary: 'S', hasSession: true,
    }).slashPassthrough).toBe(true);
  });

  it('슬래시 통과 경로가 꼬리 첨부를 버려도 경로는 본문에 남아 있다', () => {
    const text = buildVerifyPrompt({ recipe: NO_RECIPE, demo, demoFrames: frames });
    const turn = composeTurnPrompt({
      text, attachments: frames.map((f) => f.path), contextSummary: 'S', hasSession: true,
    });
    for (const f of frames) expect(turn.prompt).toContain(f.path);
  });
});

describe('formatDemoTime', () => {
  it('초를 두 자리로 채워 단계와 그림이 같은 순간을 가리키게 한다', () => {
    expect(formatDemoTime(0)).toBe('0:00');
    expect(formatDemoTime(3_400)).toBe('0:03');
    expect(formatDemoTime(125_000)).toBe('2:05');
  });
});
