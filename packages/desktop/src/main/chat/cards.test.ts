import { describe, expect, it } from 'vitest';
import type {
  AgentReport, AgentReview, PermissionRequest, SessionGoal, SubAgentStreamEvent,
} from '@vibisual/shared';
import {
  chunk, clip, clipList, goalCard, passesVerbosity, permissionCard,
  renderCard, reportCard, reviewCard, streamCard, summarizeToolInput, textCard,
} from './cards';
import { chatStrings } from './strings';

// §4 메신저 브리지 — 카드가 폰으로 나가는 모양. 여기가 전송량 정책의 실행 지점이라
// "카드만 보낸다"가 새면 그건 곧 제3자 서버로 원문이 흘러나가는 것이다.

const s = chatStrings('ko');

describe('clip / clipList — 카드는 훑어보는 것이지 읽는 것이 아니다', () => {
  it('여러 줄을 한 줄로 접는다', () => {
    expect(clip('첫 줄\n\n  둘째 줄  ')).toBe('첫 줄 둘째 줄');
  });

  it('상한을 넘으면 자르고 말줄임을 붙인다', () => {
    const out = clip('가'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('상한 이하면 손대지 않는다', () => {
    expect(clip('짧다', 10)).toBe('짧다');
  });

  it('목록은 상한까지 담고 남은 개수를 알린다', () => {
    const out = clipList(['a', 'b', 'c', 'd'], '·', 2);
    expect(out).toEqual(['· a', '· b', '· … +2']);
  });

  it('상한 이하 목록에는 꼬리를 붙이지 않는다', () => {
    expect(clipList(['a'], '·', 2)).toEqual(['· a']);
  });
});

describe('passesVerbosity — 기본값에서 원문은 안 나간다', () => {
  it('cards 에서 스트림만 막힌다', () => {
    expect(passesVerbosity('stream', 'cards')).toBe(false);
    expect(passesVerbosity('stream', 'full')).toBe(true);
  });

  it('사람이 읽으라고 만든 요약은 기본값에서도 나간다', () => {
    for (const kind of ['permission', 'question', 'report', 'review', 'goal', 'text'] as const) {
      expect(passesVerbosity(kind, 'cards')).toBe(true);
    }
  });
});

describe('summarizeToolInput — 전문이 아니라 한 줄만', () => {
  it('Bash 는 명령을 `$` 로 보여 준다', () => {
    expect(summarizeToolInput('Bash', { command: 'rm -rf build' })).toBe('$ rm -rf build');
  });

  it('파일 도구는 경로를 고른다', () => {
    expect(summarizeToolInput('Write', { file_path: '/tmp/a.ts', content: '아주 긴 본문'.repeat(99) }))
      .toBe('/tmp/a.ts');
  });

  it('본문(content)은 어떤 경우에도 실리지 않는다', () => {
    const out = summarizeToolInput('Write', { content: '비밀' });
    expect(out).toBeNull();
  });

  it('뽑을 것이 없으면 null', () => {
    expect(summarizeToolInput('Unknown', {})).toBeNull();
    expect(summarizeToolInput('Bash', { command: '   ' })).toBeNull();
  });

  it('긴 값은 200자로 접힌다', () => {
    const out = summarizeToolInput('Bash', { command: 'x'.repeat(500) });
    expect(out?.length).toBe(202); // '$ ' + 200
  });
});

describe('permissionCard — 이 브리지의 존재 이유', () => {
  const req = {
    requestId: 'r1',
    agentLabel: '작업자',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    risk: ['파일 삭제'],
    expiresAt: Date.now() + 60_000,
  } as unknown as PermissionRequest;

  it('도구·요약·위험·남은 시간이 순서대로 들어간다', () => {
    const card = permissionCard(req, [{ actionId: 'a', label: '허용' }], s);
    expect(card.kind).toBe('permission');
    expect(card.lines[0]).toBe('도구: Bash');
    expect(card.lines[1]).toBe('$ ls');
    expect(card.lines[2]).toContain('파일 삭제');
    expect(card.lines[3]).toMatch(/\d+초/);
    expect(card.agentLabel).toBe('작업자');
  });

  it('자리표시자가 남지 않는다', () => {
    const card = permissionCard(req, [], s);
    expect(card.lines.join('\n')).not.toMatch(/\{\w+\}/);
  });

  it('언어를 바꾸면 카드도 바뀐다 — 모달만 번역되면 소용이 없다', () => {
    const enCard = permissionCard(req, [], chatStrings('en'));
    expect(enCard.title).toBe('Permission needed');
    expect(enCard.lines[0]).toBe('Tool: Bash');
  });
});

describe('reportCard / reviewCard', () => {
  it('작업 신고는 "직접 하실 일" 을 먼저 놓는다', () => {
    const report = {
      did: ['고쳤다'],
      userActions: ['빌드 돌려 주세요'],
      note: '요약',
    } as unknown as AgentReport;
    const card = reportCard(report, s);
    const userIdx = card.lines.indexOf(s.reportUserActions);
    const didIdx = card.lines.indexOf(s.reportDid);
    expect(userIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeLessThan(didIdx);
  });

  it('빈 목록은 머리글도 만들지 않는다', () => {
    const report = { did: [], userActions: [] } as unknown as AgentReport;
    expect(reportCard(report, s).lines).toEqual([]);
  });

  it('검수 카드는 지시·고친 것·확인할 것을 담는다', () => {
    const review = {
      instruction: '끄기가 안 먹힌다',
      changes: ['sendTo 에서 enabled 확인'],
      checkpoints: ['끄고 카드가 안 오는지'],
    } as unknown as AgentReview;
    const card = reviewCard(review, s);
    expect(card.kind).toBe('review');
    expect(card.lines[0]).toContain('끄기가 안 먹힌다');
    expect(card.lines.join('\n')).toContain('☐');
  });
});

describe('goalCard — 목표가 폰까지 온다', () => {
  const goal = {
    agentId: 'agent-1',
    subAgentId: 'sub-1',
    text: '브리지 14건 수정',
    percent: 50,
    status: 'active',
    note: '지금 상황',
    steps: [
      { id: 's1', text: '드라이버', status: 'done', updatedAt: 1 },
      { id: 's2', text: '상위', status: 'in_progress', updatedAt: 1 },
    ],
  } as unknown as SessionGoal;

  it('문장 · 단계 진행 · 지금 하는 단계 · 메모가 들어간다', () => {
    const card = goalCard(goal, s, '작업자');
    expect(card.kind).toBe('goal');
    expect(card.lines[0]).toBe('브리지 14건 수정');
    expect(card.lines[1]).toBe('1/2 단계 · 50%');
    expect(card.lines[2]).toBe('▸ 상위');
    expect(card.lines[3]).toBe('지금 상황');
  });

  it('단계가 없으면 퍼센트만 말한다', () => {
    const card = goalCard({ ...goal, steps: [], note: undefined } as unknown as SessionGoal, s);
    expect(card.lines[1]).toBe('50%');
  });

  it('자리표시자가 남지 않는다', () => {
    expect(goalCard(goal, chatStrings('fr'), undefined).lines.join('\n')).not.toMatch(/\{\w+\}/);
  });
});

describe('streamCard — full 에서만 나가는 것', () => {
  it('도구는 이름만 남기고 결과 원문은 싣지 않는다', () => {
    const ev = { eventType: 'tool_use', toolName: 'Bash', content: '출력 전문' } as unknown as SubAgentStreamEvent;
    const card = streamCard(ev, s);
    expect(card?.lines).toEqual(['Bash']);
  });

  it('이름 없는 도구도 터지지 않는다', () => {
    const ev = { eventType: 'tool_use' } as unknown as SubAgentStreamEvent;
    expect(streamCard(ev, s)?.lines).toEqual([s.streamUnnamedTool]);
  });

  it('빈 본문은 카드를 만들지 않는다', () => {
    const ev = { eventType: 'text', content: '   ' } as unknown as SubAgentStreamEvent;
    expect(streamCard(ev, s)).toBeNull();
  });

  it('우리가 모르는 종류는 카드가 아니다', () => {
    const ev = { eventType: 'tool_result', content: '원문' } as unknown as SubAgentStreamEvent;
    expect(streamCard(ev, s)).toBeNull();
  });
});

describe('renderCard — 메신저에 실을 평문', () => {
  it('머리글에 종류 글리프와 에이전트 이름이 붙는다(이모지 ❌)', () => {
    const out = renderCard(textCard('제목', ['본문'], '작업자'), 100);
    expect(out.split('\n')[0]).toBe('[-] 제목 — 작업자');
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('상한을 넘으면 자른다 — 메신저가 통째로 거부하는 것보다 낫다', () => {
    const out = renderCard(textCard('제목', ['가'.repeat(500)]), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('종류마다 글리프가 다르다', () => {
    const marks = (['permission', 'question', 'report', 'review', 'goal', 'stream', 'text'] as const)
      .map((kind) => renderCard({ kind, title: 't', lines: [] }, 100).slice(0, 3));
    expect(new Set(marks).size).toBe(marks.length);
  });
});

describe('chunk — 버튼 줄 나누기', () => {
  it('요청한 크기로 자른다', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('빈 목록은 빈 결과', () => {
    expect(chunk([], 3)).toEqual([]);
  });
});
