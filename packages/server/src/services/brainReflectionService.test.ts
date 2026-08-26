/**
 * §5.10 v3.54 — brainReflectionService 폭주 차단 단위 테스트.
 * 다이제스트 정제(thinking/base64/system-reminder/도구 페이로드 제거)와 수확 0 지수 백오프.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  BRAIN_REFLECTION_DEBOUNCE_MS,
  BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD,
  BRAIN_REFLECTION_BACKOFF_MAX_MS,
  BRAIN_REFLECTION_INPUT_MAX_CHARS,
  BRAIN_REFLECTION_CWD_DIRNAME,
  buildBrainReflectionPrompt,
} from '@vibisual/shared';
import {
  buildDigest,
  backoffMsForStreak,
  isBrainReflectionCwd,
  scheduleBrainReflection,
  parseCandidates,
  parseSkillDraft,
  __resetBrainReflectionStateForTest,
} from './brainReflectionService.js';

/** JSONL 한 줄 만들기 헬퍼. */
const line = (o: unknown): string => JSON.stringify(o);

const userText = (text: string): string =>
  line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });

const assistant = (content: unknown[]): string =>
  line({ type: 'assistant', message: { role: 'assistant', content } });

describe('buildDigest — 입력 정제', () => {
  it('thinking 블록과 signature base64 를 통째로 버린다', () => {
    const sig = 'A'.repeat(400);
    const raw = [
      userText('버튼이 안 눌립니다'),
      assistant([
        { type: 'thinking', thinking: '길게 고민하는 내용', signature: sig },
        { type: 'text', text: '핸들러가 빠져 있었습니다' },
      ]),
    ].join('\n');

    const d = buildDigest(raw);
    expect(d.text).toContain('버튼이 안 눌립니다');
    expect(d.text).toContain('핸들러가 빠져 있었습니다');
    expect(d.text).not.toContain('길게 고민하는 내용');
    expect(d.text).not.toContain(sig);
  });

  it('본문에 섞인 긴 base64 덩어리를 잘라낸다', () => {
    const blob = 'aGVsbG93b3JsZA'.repeat(20); // 80자 훨씬 초과
    const raw = userText(`데이터는 ${blob} 입니다`);
    const d = buildDigest(raw);
    expect(d.text).not.toContain(blob);
    expect(d.text).toContain('데이터는');
  });

  it('system-reminder 블록을 제거한다', () => {
    const raw = userText('실제 질문입니다<system-reminder>이건 훅이 붙인 상용구</system-reminder>');
    const d = buildDigest(raw);
    expect(d.text).toContain('실제 질문입니다');
    expect(d.text).not.toContain('훅이 붙인 상용구');
  });

  it('Vibisual 자기 안내문 머리말을 걷어내고 실제 지시는 남긴다', () => {
    const raw = userText(
      '# 작업 신고 (Vibisual IDE 색 구분)\n'
      + '사용자가 직접 해야 할 일이 생긴 완료 보고에서만 신고한다.\n'
      + 'curl -s -X POST ...\n'
      + 'Task: 로그인 버그를 고쳐라',
    );
    const d = buildDigest(raw);
    expect(d.text).toContain('Task: 로그인 버그를 고쳐라');
    expect(d.text).not.toContain('완료 보고에서만 신고한다');
  });

  it('도구 호출은 이름 + 대상 한 줄로 줄이고 페이로드 전량은 안 싣는다', () => {
    const bigBody = 'X'.repeat(5000);
    const raw = assistant([
      { type: 'tool_use', name: 'Write', input: { file_path: 'src/foo.ts', content: bigBody } },
    ]);
    const d = buildDigest(raw);
    expect(d.text).toContain('[도구] Write');
    expect(d.text).toContain('src/foo.ts');
    expect(d.text).not.toContain(bigBody);
  });

  it('실패한 도구 결과는 정상 결과보다 길게 남긴다(같은 실수 반복 판정 신호)', () => {
    const errText = 'E'.repeat(300);
    const okText = 'O'.repeat(300);
    const errDigest = buildDigest(
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: errText }] } }),
    );
    const okDigest = buildDigest(
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: okText }] } }),
    );
    expect(errDigest.text).toContain('[결과 실패]');
    expect(errDigest.text.length).toBeGreaterThan(okDigest.text.length);
  });

  it('대화가 아닌 라인(summary·file-history-snapshot)은 건너뛴다', () => {
    const raw = [
      line({ type: 'file-history-snapshot', operation: 'snapshot', payload: 'Z'.repeat(2000) }),
      line({ type: 'summary', summary: '요약 라인' }),
      userText('진짜 대화'),
    ].join('\n');
    const d = buildDigest(raw);
    expect(d.text).toContain('진짜 대화');
    expect(d.text).not.toContain('요약 라인');
    expect(d.lineCount).toBe(3);
  });

  it('문자 상한을 지키며 tail(세션 끝) 을 우선 남긴다', () => {
    const many = Array.from({ length: 400 }, (_, i) => userText(`메시지 ${i} ${'가'.repeat(200)}`));
    const d = buildDigest(many.join('\n'));
    expect(d.text.length).toBeLessThanOrEqual(BRAIN_REFLECTION_INPUT_MAX_CHARS);
    expect(d.text).toContain('메시지 399');
    expect(d.text).not.toContain('메시지 0 ');
  });

  it('원시 JSONL 대비 다이제스트가 크게 줄어든다', () => {
    const raw = [
      assistant([
        { type: 'thinking', thinking: '고민', signature: 'S'.repeat(2000) },
        { type: 'text', text: '결론입니다' },
      ]),
      assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts', old_string: 'Q'.repeat(3000), new_string: 'R'.repeat(3000) } }]),
    ].join('\n');
    const d = buildDigest(raw);
    expect(d.text.length).toBeLessThan(d.rawChars / 10);
  });

  it('빈 입력·깨진 JSON 에도 던지지 않는다', () => {
    expect(buildDigest('').text).toBe('');
    expect(buildDigest('not json\n{broken').text).toBe('');
  });
});

describe('backoffMsForStreak — 수확 0 지수 백오프', () => {
  it('문턱 미만이면 백오프를 걸지 않는다', () => {
    expect(backoffMsForStreak(0)).toBe(0);
    expect(backoffMsForStreak(BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD - 1)).toBe(0);
  });

  it('문턱에 닿으면 디바운스의 2배부터 시작한다', () => {
    expect(backoffMsForStreak(BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD)).toBe(BRAIN_REFLECTION_DEBOUNCE_MS * 2);
  });

  it('연속 횟수가 늘면 지수로 커진다', () => {
    const a = backoffMsForStreak(BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD);
    const b = backoffMsForStreak(BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD + 1);
    expect(b).toBe(a * 2);
  });

  it('상한을 넘지 않는다', () => {
    expect(backoffMsForStreak(100)).toBe(BRAIN_REFLECTION_BACKOFF_MAX_MS);
  });
});

/**
 * v3.76 — 리플렉션 자식이 낸 훅으로 자기 자신을 다시 리플렉션하던 자가 증식(5분 40초 주기 무한 체인)
 * 차단. 판정은 전적으로 cwd 이므로 경로 표기 흔들림(구분자·대소문자·끝 슬래시)까지 함께 고정한다.
 */
describe('isBrainReflectionCwd — 자가 증식 차단 판정', () => {
  const reflectCwd = path.join(os.tmpdir(), BRAIN_REFLECTION_CWD_DIRNAME);

  it('리플렉션 전용 cwd 를 잡아낸다', () => {
    expect(isBrainReflectionCwd(reflectCwd)).toBe(true);
  });

  it('구분자·대소문자·끝 슬래시가 달라도 같은 폴더로 본다', () => {
    expect(isBrainReflectionCwd(reflectCwd.replace(/\\/g, '/'))).toBe(true);
    expect(isBrainReflectionCwd(reflectCwd.toUpperCase())).toBe(true);
    expect(isBrainReflectionCwd(`${reflectCwd}\\`)).toBe(true);
  });

  it('tmpdir 표기가 달라도 마지막 구간으로 잡는다(8.3 단축 경로 대비)', () => {
    expect(isBrainReflectionCwd(`C:\\DOCUME~1\\OWNER\\LOCALS~1\\Temp\\${BRAIN_REFLECTION_CWD_DIRNAME}`)).toBe(true);
  });

  it('일반 프로젝트 cwd 는 통과시킨다', () => {
    expect(isBrainReflectionCwd('C:\\work\\projects\\app')).toBe(false);
    expect(isBrainReflectionCwd('/srv/projects/app')).toBe(false);
  });

  it('빈 값·null·undefined 에 던지지 않는다', () => {
    expect(isBrainReflectionCwd('')).toBe(false);
    expect(isBrainReflectionCwd(null)).toBe(false);
    expect(isBrainReflectionCwd(undefined)).toBe(false);
  });

  it('폴더명이 부분 일치하는 다른 폴더는 잡지 않는다', () => {
    expect(isBrainReflectionCwd(`C:\\tmp\\${BRAIN_REFLECTION_CWD_DIRNAME}-old`)).toBe(false);
    expect(isBrainReflectionCwd(`C:\\tmp\\my-${BRAIN_REFLECTION_CWD_DIRNAME}x`)).toBe(false);
  });
});

describe('scheduleBrainReflection — 자식 세션은 예약 자체를 안 한다', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetBrainReflectionStateForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const reflectCwd = path.join(os.tmpdir(), BRAIN_REFLECTION_CWD_DIRNAME);

  it('리플렉션 자식 cwd 의 Stop 은 타이머를 걸지 않는다(체인 절단)', () => {
    scheduleBrainReflection({
      sessionId: 'child-session',
      cwd: reflectCwd,
      root: reflectCwd,
      scope: 'project',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('일반 세션의 Stop 은 종전대로 디바운스 타이머를 건다', () => {
    scheduleBrainReflection({
      sessionId: 'real-session',
      cwd: 'C:\\work\\projects\\app',
      root: 'C:\\work\\projects\\app',
      scope: 'project',
    });
    expect(vi.getTimerCount()).toBe(1);
  });
});

// ─── §5.10 v3.78 F — 관문을 추출 시점으로 ─────────────────────────────────────

describe('v3.78 F — 리플렉션 출력 스키마(topic · contradicts)', () => {
  it('contradicts 로 지목한 카드 id 를 파싱한다', () => {
    const out = parseCandidates(JSON.stringify([{
      type: 'rule', title: '이제는 훅 푸시를 쓴다', body: '폴링은 폐기',
      files: ['packages/server/src/index.ts'], topic: 'usage-statusline', contradicts: 'card-abc1-2xy',
    }]));
    expect(out).toHaveLength(1);
    expect(out[0]?.contradicts).toBe('card-abc1-2xy');
    expect(out[0]?.topic).toBe('usage-statusline');
  });

  it('형식이 어긋난 contradicts·모르는 topic 은 버리되 카드는 살린다', () => {
    const out = parseCandidates(JSON.stringify([{
      type: 'lesson', title: '뭔가 배움', body: 'b', files: [],
      topic: '존재하지-않는-주제', contradicts: '그냥 문장',
    }]));
    expect(out).toHaveLength(1);
    expect(out[0]?.contradicts).toBeUndefined();
    expect(out[0]?.topic).toBeUndefined();
  });

  it('코드펜스·설명이 섞여 있어도 JSON 배열만 뽑아낸다', () => {
    const out = parseCandidates('설명입니다\n```json\n[{"type":"fact","title":"제목","body":"본문","files":[]}]\n```');
    expect(out.map((c) => c.title)).toEqual(['제목']);
  });
});

describe('v3.78 F — 프롬프트에 기존 카드 제목 목록을 싣는다', () => {
  it('제목 목록이 있으면 "다시 뽑지 마라" 블록과 contradicts 지시가 들어간다', () => {
    const p = buildBrainReflectionPrompt({
      knownTitles: ['[card-a] 기존 규칙 하나', '[card-b] 기존 결정 둘'],
      topicSlugs: ['misc', 'ui-client'],
    });
    expect(p).toContain('[card-a] 기존 규칙 하나');
    expect(p).toContain('다시 뽑지 마라');
    expect(p).toContain('contradicts');
    expect(p).toContain('misc, ui-client');
  });

  it('제목 목록이 비면 그 블록을 통째로 생략한다(빈 목록은 잡음)', () => {
    const p = buildBrainReflectionPrompt({ knownTitles: [], topicSlugs: [] });
    expect(p).not.toContain('이미 저장된 기억');
    expect(p).toContain('세션 기록:');
  });

  // §5.10 v2 (B) — 절차 초안 지시문은 축이 켜지고 복잡한 세션일 때만 실린다.
  it('wantSkill 이 아니면 절차 지시문 자체를 싣지 않는다(안 쓸 지시로 예산을 먹지 않는다)', () => {
    const p = buildBrainReflectionPrompt({ knownTitles: [], topicSlugs: [] });
    expect(p).not.toContain('절차 하나 더');
  });

  it('wantSkill 이면 절차 초안 형식을 지시한다', () => {
    const p = buildBrainReflectionPrompt({ knownTitles: [], topicSlugs: [], wantSkill: true });
    expect(p).toContain('절차 하나 더');
    expect(p).toContain('"type":"skill"');
  });
});

// ─── §5.10 v2 (B) 절차 초안 ───

describe('parseSkillDraft — 카드 배열에 섞여 오는 절차 한 벌', () => {
  it('type:skill 항목을 꺼낸다', () => {
    const out = JSON.stringify([
      { type: 'lesson', title: '교훈', body: '본문' },
      { type: 'skill', name: '릴리스 절차', description: '새 버전을 낼 때 쓴다', body: '1. bump\n2. tag', files: ['x.ts'] },
    ]);
    const d = parseSkillDraft(out);
    expect(d?.name).toBe('릴리스 절차');
    expect(d?.description).toBe('새 버전을 낼 때 쓴다');
    expect(d?.files).toEqual(['x.ts']);
  });

  it('세 필드 중 하나라도 비면 버린다 (빈 껍데기 스킬이 검색을 오염시킨다)', () => {
    expect(parseSkillDraft(JSON.stringify([{ type: 'skill', name: 'x', description: '', body: 'b' }]))).toBeNull();
    expect(parseSkillDraft(JSON.stringify([{ type: 'skill', name: '', description: 'd', body: 'b' }]))).toBeNull();
    expect(parseSkillDraft(JSON.stringify([{ type: 'skill', name: 'x', description: 'd', body: '  ' }]))).toBeNull();
  });

  it('절차가 없으면 null 이다', () => {
    expect(parseSkillDraft(JSON.stringify([{ type: 'lesson', title: 't', body: 'b' }]))).toBeNull();
    expect(parseSkillDraft('설명만 있고 JSON 이 없음')).toBeNull();
  });

  it('절차 항목이 lesson 카드로 둔갑하지 않는다', () => {
    const out = JSON.stringify([
      { type: 'skill', name: '절차', description: '언제', body: '1. 한다' },
      { type: 'lesson', title: '진짜 교훈', body: '본문' },
    ]);
    const cards = parseCandidates(out);
    expect(cards.length).toBe(1);
    expect(cards[0]?.title).toBe('진짜 교훈');
  });
});

describe('buildDigest — 도구 호출 계수', () => {
  const line = (content: unknown): string =>
    JSON.stringify({ type: 'assistant', message: { content } });

  it('tool_use 블록을 센다 (다이제스트 본문에선 걷어내므로 여기서 안 세면 알 길이 없다)', () => {
    const raw = [
      line([{ type: 'text', text: '해보겠습니다' }]),
      line([{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }]),
      line([{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }]),
    ].join('\n');
    expect(buildDigest(raw).toolCalls).toBe(2);
  });

  it('도구를 안 쓴 세션은 0 이다 (단순 질의응답은 절차가 아니다)', () => {
    expect(buildDigest(line([{ type: 'text', text: '네' }])).toolCalls).toBe(0);
  });
});
