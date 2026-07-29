/**
 * §5.10 v3.54 — brainReflectionService 폭주 차단 단위 테스트.
 * 다이제스트 정제(thinking/base64/system-reminder/도구 페이로드 제거)와 수확 0 지수 백오프.
 */
import { describe, it, expect } from 'vitest';
import {
  BRAIN_REFLECTION_DEBOUNCE_MS,
  BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD,
  BRAIN_REFLECTION_BACKOFF_MAX_MS,
  BRAIN_REFLECTION_INPUT_MAX_CHARS,
} from '@vibisual/shared';
import { buildDigest, backoffMsForStreak } from './brainReflectionService.js';

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
