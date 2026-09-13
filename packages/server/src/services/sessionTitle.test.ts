import { describe, it, expect } from 'vitest';
import { sessionTitleFromPrompt, SESSION_TITLE_MAX_CHARS } from '@vibisual/shared';

// SCENARIO.md §5.26 / §7.23 — 세션 제목 뽑기.
//
// 이 시험이 지키는 것: **모든 세션이 같은 제목을 갖지 않는다**, 그리고 **없는 제목을 지어내지
// 않는다**. 첫째가 무너지면 목록이 종전(해시 8자)과 똑같이 못 읽는 것이 되고, 둘째가 무너지면
// 화면이 거짓을 적는다. 실제 세션 386개로 확증한 규칙을 여기 고정한다(373건 추출·310종 구분).

/** 서브에이전트 프롬프트의 앞머리 — 실물 그대로의 모양. 모든 세션에 똑같이 붙는다. */
const PREAMBLE = `You are a sub-agent working in project at: C:/work/vibisual
Parent agent: 생각 빼기 버전

Execute the following task.

# 카드 (Vibisual IDE) — 공통
아래 카드들은 같은 창구를 쓴다. 주소·토큰은 환경변수에 이미 있다.
\`\`\`bash
curl -s -X POST "\${VIBISUAL_BASE}/api/agent-report"
\`\`\`
- 전부 표시 전용이다.

---

`;

describe('§7.23 sessionTitleFromPrompt — 프리앰블이 제목을 먹지 않는다', () => {
  it('Task: 뒤의 진짜 지시를 뽑는다 — 이걸 못 찾으면 모든 세션이 "카드 (Vibisual IDE) — 공통"이 된다', () => {
    const t = sessionTitleFromPrompt(`${PREAMBLE}Task: cmd창버블 만들면 화면이 넘어가 버려 이거 고쳐`);
    expect(t).toBe('cmd창버블 만들면 화면이 넘어가 버려 이거 고쳐');
  });

  it('Task: 가 여러 줄이면 첫 줄만 — 제목은 한 줄이다', () => {
    const t = sessionTitleFromPrompt(`${PREAMBLE}Task: 첫 줄이 제목이다\n둘째 줄은 본문이다`);
    expect(t).toBe('첫 줄이 제목이다');
  });

  it('프리앰블만 있고 Task: 가 없으면 카드 규약 제목을 피해 간다', () => {
    const t = sessionTitleFromPrompt(PREAMBLE);
    expect(t).not.toContain('카드');
    expect(t).not.toContain('sub-agent');
  });
});

describe('§7.23 목표 창 블록 — 덧말로 이어진 턴의 유일한 뜻', () => {
  it('**목표**: 줄을 뽑는다', () => {
    const t = sessionTitleFromPrompt('# 이 세션의 목표\n**목표**: 보험 팝업을 세 눈금으로 나눈다\n**현재 진행률**: 0%');
    expect(t).toBe('보험 팝업을 세 눈금으로 나눈다');
  });

  it('Task: 가 함께 있으면 Task: 가 이긴다 — 더 구체적인 쪽', () => {
    const t = sessionTitleFromPrompt(`${PREAMBLE}Task: 진짜 지시\n\n**목표**: 오래된 목표`);
    expect(t).toBe('진짜 지시');
  });
});

describe('§7.23 슬래시 명령 세션', () => {
  it('명령 이름이 가장 좋은 제목이다', () => {
    expect(sessionTitleFromPrompt('<command-message>release</command-message>\n<command-name>/release</command-name>'))
      .toBe('/release');
  });

  it('감싸는 표는 제목에 남지 않는다', () => {
    const t = sessionTitleFromPrompt('<command-name>/reinstall</command-name>');
    expect(t).toBe('/reinstall');
    expect(t).not.toContain('<');
  });
});

describe('§7.23 그냥 사용자 프롬프트', () => {
  it('첫 쓸모 있는 줄을 그대로 쓴다', () => {
    expect(sessionTitleFromPrompt('이거 각 세션별로 표현해줘야 하는거 아닌가 ?')).toBe('이거 각 세션별로 표현해줘야 하는거 아닌가 ?');
  });

  it('구분선·빈 줄을 건너뛴다', () => {
    expect(sessionTitleFromPrompt('\n\n---\n\n실제 질문입니다')).toBe('실제 질문입니다');
  });

  it('마크다운 장식을 벗긴다 — 별표가 그대로 뜨면 제목이 코드처럼 보인다', () => {
    expect(sessionTitleFromPrompt('**굵은 제목**')).toBe('굵은 제목');
    expect(sessionTitleFromPrompt('## 머리말 제목')).toBe('머리말 제목');
    expect(sessionTitleFromPrompt('`코드` 를 고쳐')).toBe('코드 를 고쳐');
  });

  it('불릿 기호를 뗀다 — 뜻이 아니라 서식이다', () => {
    expect(sessionTitleFromPrompt('- 항목 하나를 처리해라')).toBe('항목 하나를 처리해라');
  });

  it('system-reminder 같은 붙임말은 사용자가 쓴 것이 아니다', () => {
    const t = sessionTitleFromPrompt('<system-reminder>배경 정보</system-reminder>\n진짜 질문');
    expect(t).toBe('진짜 질문');
  });
});

describe('§7.23 인스펙터 머리표 — 셀렉터가 제목이 되면 해시와 다를 바 없다', () => {
  it('머리표 아래의 문장을 우선한다', () => {
    const t = sessionTitleFromPrompt('[Component] <IDEStatusBar2>\n[Path] div#root > div.flex\n\n이거 세션별로 나눠줘');
    expect(t).toBe('이거 세션별로 나눠줘');
  });

  it('문장이 아예 없으면 머리표라도 적는다 — 빈 줄보다는 낫다', () => {
    const t = sessionTitleFromPrompt('[Component] <IDEMainArea2 agentId="agent-1">');
    expect(t).toContain('IDEMainArea2');
  });
});

describe('§7.23 지어내지 않는다 — 뽑을 것이 없으면 null', () => {
  it('빈 입력', () => {
    expect(sessionTitleFromPrompt('')).toBeNull();
    expect(sessionTitleFromPrompt('   \n\n  ')).toBeNull();
  });

  it('문자열이 아닌 것 — 첫 사용자 프롬프트가 아예 없는 세션이 실제로 13건 있었다', () => {
    expect(sessionTitleFromPrompt(null)).toBeNull();
    expect(sessionTitleFromPrompt(undefined)).toBeNull();
  });

  it('장식만 있는 입력에서 빈 제목을 짓지 않는다', () => {
    expect(sessionTitleFromPrompt('---\n===\n***')).toBeNull();
  });
});

describe('§7.23 길이 — 한 줄에 들어가야 한다', () => {
  it('긴 제목은 자르고 말줄임을 붙인다', () => {
    const long = '가'.repeat(200);
    const t = sessionTitleFromPrompt(long);
    expect(t).not.toBeNull();
    expect(t!.length).toBeLessThanOrEqual(SESSION_TITLE_MAX_CHARS + 1);
    expect(t!.endsWith('…')).toBe(true);
  });

  it('짧은 제목은 그대로 — 멀쩡한 줄에 말줄임을 붙이지 않는다', () => {
    const t = sessionTitleFromPrompt('짧은 제목');
    expect(t).toBe('짧은 제목');
    expect(t!.endsWith('…')).toBe(false);
  });

  it('낱말 중간에서 끊지 않는다 — 끊긴 낱말은 오히려 못 읽는다', () => {
    const t = sessionTitleFromPrompt('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike', 40);
    expect(t!.endsWith('…')).toBe(true);
    // 잘린 자리가 **낱말 경계**여야 한다 — 남은 부분이 통째로 원문의 낱말들이면 참이다.
    const kept = t!.slice(0, -1).trim();
    expect('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike')
      .toContain(`${kept} `);
  });

  it('상한을 인자로 받는다 — 화면마다 폭이 다르다', () => {
    const t = sessionTitleFromPrompt('가'.repeat(50), 10);
    expect(t!.length).toBeLessThanOrEqual(11);
  });

  it('줄바꿈은 접는다 — 제목은 한 줄이다', () => {
    expect(sessionTitleFromPrompt('첫 줄')).not.toContain('\n');
  });
});
