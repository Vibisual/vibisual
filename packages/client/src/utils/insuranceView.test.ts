import { describe, it, expect } from 'vitest';
import type {
  CompactMarker,
  CompactNotCarried,
  CompactWatchState,
  FilePreimage,
  InsuranceSessionCounts,
  ProjectInsuranceLedger,
  ResurrectableSession,
} from '@vibisual/shared';
import {
  INSURANCE_TABS,
  INSURANCE_TAB_LABEL_KEY,
  canPreviewPreimage,
  canRestorePreimage,
  findInsuranceLedger,
  formatBytes,
  formatInsuranceTime,
  markerCopyState,
  markerOutcomeState,
  notCarriedRows,
  preimageFileName,
  restoreLabelKey,
  skipReasonKey,
  sessionFailedCompacts,
  sessionWatchLevel,
  matchesInsuranceSession,
  worstWatchLevel,
  INSURANCE_SCOPE_LEVELS,
  INSURANCE_SCOPE_LABEL_KEY,
  availableScopeLevels,
  canScopeToSession,
  filterByScope,
  resolveScopeLevel,
  rowInScope,
  scopeRowCount,
  scopedNotCarriedRows,
  showsVaultSize,
  markerSubject,
  preimageActionKey,
  preimageRevisions,
  resurrectTitle,
  shortSessionId,
} from './insuranceView.js';

// SCENARIO.md §5.26 / §7.23 — 팝업의 표시 판정.
//
// 이 시험이 지키는 것은 모양이 아니라 **약속**이다: 없는 사본에 손잡이를 내주지 않고, 되돌리기가
// 실은 삭제인 자리에서는 다른 낱말을 쓴다. 둘 다 틀리면 사용자가 버튼을 눌러 파일을 잃는다.

function nc(over: Partial<CompactNotCarried> = {}): CompactNotCarried {
  return { openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [], ...over };
}

function marker(over: Partial<CompactMarker> = {}): CompactMarker {
  return {
    id: 'm1',
    at: 1_700_000_000_000,
    projectName: 'proj',
    sessionId: 'sess-1',
    trigger: 'auto',
    transcriptPath: 'C:/proj/.claude/sess-1.jsonl',
    transcriptBytes: 1024,
    transcriptMtime: 1_700_000_000_000,
    mirrored: false,
    workingSet: {
      openFiles: [],
      recentEdits: [],
      runningTasks: [],
      goalSteps: [],
      teammates: [],
      queuedCommands: 0,
    },
    ...over,
  };
}

function preimage(over: Partial<FilePreimage> = {}): FilePreimage {
  return {
    id: 'p1',
    at: 1_700_000_000_000,
    projectName: 'proj',
    path: 'C:/proj/src/a.ts',
    pathKey: 'C:/proj/src/a.ts',
    sha256: 'abc',
    size: 10,
    sessionId: 'sess-1',
    toolName: 'Edit',
    ...over,
  };
}

function ledger(over: Partial<ProjectInsuranceLedger> = {}): ProjectInsuranceLedger {
  return {
    projectName: 'proj',
    markers: [],
    preimages: [],
    counts: { markers: 0, preimages: 0, vaultBytes: 0, failedCompacts: 0, restorable: 0 },
    updatedAt: 0,
    ...over,
  };
}

function watch(over: Partial<CompactWatchState> = {}): CompactWatchState {
  return { sessionId: 's', level: 'ok', canSendCompact: true, ...over };
}

describe('§7.23 갈피', () => {
  it('네 갈피가 모두 제목 키를 가진다 — 키가 빠지면 빈 갈피가 그려진다', () => {
    expect(INSURANCE_TABS).toHaveLength(4);
    for (const id of INSURANCE_TABS) {
      expect(INSURANCE_TAB_LABEL_KEY[id]).toMatch(/^panel\.insurance\.tabs\./);
    }
  });
});

describe('§7.23 findInsuranceLedger', () => {
  it('프로젝트가 안 정해졌으면 undefined — 남의 원장을 그리지 않는다', () => {
    expect(findInsuranceLedger([ledger()], null)).toBeUndefined();
  });

  it('이름이 맞는 것만 고른다', () => {
    const list = [ledger({ projectName: 'a' }), ledger({ projectName: 'b' })];
    expect(findInsuranceLedger(list, 'b')?.projectName).toBe('b');
    expect(findInsuranceLedger(list, 'c')).toBeUndefined();
  });
});

describe('§5.26 마커 한 줄의 상태', () => {
  it('사본 유무는 서버가 디스크와 맞대 본 값을 그대로 쓴다', () => {
    expect(markerCopyState(marker({ mirrored: true }))).toBe('mirrored');
    expect(markerCopyState(marker({ mirrored: false }))).toBe('indexOnly');
  });

  it('결과가 없으면 pending — 아직 대조 전이다', () => {
    expect(markerOutcomeState(marker())).toBe('pending');
  });

  it('실패 사유가 있으면 failed', () => {
    const m = marker({ outcome: { at: 1, summaryBytes: 0, notCarried: nc(), carriedCount: 0, failed: 'no-summary' } });
    expect(markerOutcomeState(m)).toBe('failed');
  });

  it('대조가 끝났으면 done', () => {
    const m = marker({ outcome: { at: 1, summaryBytes: 99, notCarried: nc(), carriedCount: 3 } });
    expect(markerOutcomeState(m)).toBe('done');
  });

  it('완료 훅이 온 압축은 실패가 아니라 **못 읽음**이다 — 둘을 섞으면 멀쩡한 세션을 되살리게 된다', () => {
    const m = marker({
      postCompactAt: 2,
      outcome: { at: 1, summaryBytes: 0, notCarried: nc(), carriedCount: 0, summaryUnreadable: true },
    });
    expect(markerOutcomeState(m)).toBe('unreadable');
  });

  it('실패 사유가 함께 있으면 실패가 이긴다 — 더 무거운 쪽을 적는다', () => {
    const m = marker({
      outcome: {
        at: 1, summaryBytes: 0, notCarried: nc(), carriedCount: 0,
        failed: 'transcript-gone', summaryUnreadable: true,
      },
    });
    expect(markerOutcomeState(m)).toBe('failed');
  });
});

describe('§7.23 사본에 손잡이를 내줄지 — 이 기능의 유일한 약속', () => {
  it('평범한 사본에는 되돌리기를 내준다', () => {
    expect(canRestorePreimage(preimage())).toBe(true);
  });

  it('못 뜬 사본에는 내주지 않는다 — 눌러서 실패하게 두지 않는다', () => {
    expect(canRestorePreimage(preimage({ skipped: 'too-large' }))).toBe(false);
  });

  it('이미 되돌린 줄에도 내주지 않는다', () => {
    expect(canRestorePreimage(preimage({ restoredAt: 123 }))).toBe(false);
  });

  it('미리보기는 내용 바이트가 있어야 한다', () => {
    expect(canPreviewPreimage(preimage())).toBe(true);
    expect(canPreviewPreimage(preimage({ sha256: undefined }))).toBe(false);
    expect(canPreviewPreimage(preimage({ skipped: 'too-large' }))).toBe(false);
  });
});

describe('§7.23 되돌리기의 낱말 — 복구인가 삭제인가', () => {
  it('내용이 있으면 되돌리기', () => {
    expect(restoreLabelKey(preimage())).toBe('panel.insurance.restore');
  });

  it('그 자리에 파일이 없었으면 되돌리기 = 삭제라, 다른 말을 쓴다', () => {
    expect(restoreLabelKey(preimage({ sha256: undefined }))).toBe('panel.insurance.restoreAsDelete');
  });
});

describe('§7.23 못 뜬 이유', () => {
  it('안 건너뛴 줄은 이유가 없다', () => {
    expect(skipReasonKey(preimage())).toBeNull();
  });

  it('건너뛴 줄은 사유별 키를 준다', () => {
    expect(skipReasonKey(preimage({ skipped: 'budget' }))).toBe('panel.insurance.skip.budget');
  });
});

describe('§7.23 preimageFileName — 윈도우 경로가 그대로 온다', () => {
  it('역슬래시 경로에서도 파일명을 뽑는다', () => {
    expect(preimageFileName(preimage({ path: 'C:\\proj\\src\\a.ts' }))).toBe('a.ts');
  });

  it('슬래시 경로도 같다', () => {
    expect(preimageFileName(preimage({ path: '/proj/src/b.ts' }))).toBe('b.ts');
  });

  it('구분자가 없으면 경로 자체가 이름이다', () => {
    expect(preimageFileName(preimage({ path: 'a.ts' }))).toBe('a.ts');
  });

  it('끝이 구분자로 끝나도 빈 칸을 그리지 않는다', () => {
    expect(preimageFileName(preimage({ path: 'C:/proj/' }))).toBe('C:/proj/');
  });
});

describe('§5.26 (F) worstWatchLevel — 칸 하나가 가장 무거운 것만 말한다', () => {
  it('감시가 없으면 null — 평상시에는 칸이 조용하다', () => {
    expect(worstWatchLevel(undefined)).toBeNull();
    expect(worstWatchLevel([])).toBeNull();
  });

  it('전부 ok 면 null', () => {
    expect(worstWatchLevel([watch(), watch()])).toBeNull();
  });

  it('stalled 하나가 overdue 여럿을 이긴다', () => {
    expect(worstWatchLevel([watch({ level: 'overdue' }), watch({ level: 'stalled' })])).toBe('stalled');
  });

  it('overdue 만 있으면 overdue', () => {
    expect(worstWatchLevel([watch(), watch({ level: 'overdue' })])).toBe('overdue');
  });
});

describe('§7.23 formatBytes', () => {
  it('0 이하·유한하지 않은 값은 0B', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(-5)).toBe('0B');
    expect(formatBytes(Number.NaN)).toBe('0B');
  });

  it('단위가 바뀌는 자리', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0GB');
  });
});

describe('§7.23 formatInsuranceTime', () => {
  it('시각이 없으면 줄표 — 0 을 1970 으로 적지 않는다', () => {
    expect(formatInsuranceTime(0)).toBe('—');
  });

  it('MM-DD HH:mm 로 적는다(감사 타임라인과 같은 모양)', () => {
    const at = new Date(2026, 8, 7, 3, 5).getTime();
    expect(formatInsuranceTime(at)).toBe('09-07 03:05');
  });
});

describe('§5.26 (D) notCarriedRows — 근거 없이 "잃었다"고 적지 않는다', () => {
  it('원장이 없으면 빈 목록', () => {
    expect(notCarriedRows(undefined)).toEqual([]);
  });

  it('아직 대조 전인 마커는 서지 않는다', () => {
    expect(notCarriedRows(ledger({ markers: [marker()] }))).toEqual([]);
  });

  it('안 실린 것이 하나도 없는 마커도 서지 않는다 — 빈 줄로 목록을 늘리지 않는다', () => {
    const m = marker({ outcome: { at: 1, summaryBytes: 1, notCarried: nc(), carriedCount: 5 } });
    expect(notCarriedRows(ledger({ markers: [m] }))).toEqual([]);
  });

  it('축이 하나라도 남으면 선다', () => {
    const withGoal = marker({ id: 'g', outcome: { at: 1, summaryBytes: 1, notCarried: nc({ goal: '보험 끝내기' }), carriedCount: 0 } });
    const withFiles = marker({ id: 'f', outcome: { at: 1, summaryBytes: 1, notCarried: nc({ openFiles: ['/a.ts'] }), carriedCount: 0 } });
    const withMates = marker({ id: 't', outcome: { at: 1, summaryBytes: 1, notCarried: nc({ teammates: ['리뷰어'] }), carriedCount: 0 } });
    const rows = notCarriedRows(ledger({ markers: [withGoal, withFiles, withMates, marker({ id: 'x' })] }));
    expect(rows.map((r) => r.id)).toEqual(['g', 'f', 't']);
  });
});

// ─── §5.26 (I) — 상태바 칸은 **보고 있는 세션 하나**를 주어로 삼는다 ───
//
// 사용자 보고: 세션 8개짜리 커스텀 버블에서 실패 압축 배지 `1` 이 여덟 탭 전부에 떴고, 탭을 넘겨도
// 안 사라졌다. 원인은 상태바가 원장의 **프로젝트 합계**(`counts.failedCompacts`)와 **프로젝트 안
// 모든 세션의 최악 등급**을 읽은 것이었다. 아래 시험이 그 회귀를 못 박는다.

function sessionCount(over: Partial<InsuranceSessionCounts> = {}): InsuranceSessionCounts {
  return { sessionId: 'uuid-1', failedCompacts: 1, markers: 3, ...over };
}

describe('§5.26 (I) matchesInsuranceSession — 두 id 는 namespace 가 다르다', () => {
  it('세션 탭 id 는 세션 탭 id 끼리만 견준다 — CLI UUID 자리와 맞대지 않는다', () => {
    const row = { sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' };
    // 고른 탭의 `subAgentId` 가 원장 줄의 `sessionId` 자리와 우연히 같아도 그것은 매치가 아니다.
    expect(matchesInsuranceSession(row, { agentId: 'agent-1', subAgentId: 'uuid-1' })).toBe(false);
    expect(matchesInsuranceSession(row, { agentId: 'agent-1', subAgentId: 'sub-a' })).toBe(true);
  });

  it('CLI 세션 UUID 로도 잡힌다 — 훅 세션에는 세션 탭 id 가 없다', () => {
    const row = { sessionId: 'uuid-1', agentId: 'agent-1' };
    expect(matchesInsuranceSession(row, { agentId: 'agent-1', sessionId: 'uuid-1' })).toBe(true);
  });

  it('탭을 고르고 있으면 형제 탭의 줄은 들어오지 않는다 — 이 한 줄이 사용자가 본 버그다', () => {
    const sibling = { sessionId: 'uuid-2', subAgentId: 'sub-b', agentId: 'agent-1' };
    expect(matchesInsuranceSession(sibling, {
      agentId: 'agent-1', subAgentId: 'sub-a', sessionId: 'uuid-1',
    })).toBe(false);
  });

  it('탭을 아직 안 골랐으면 버블 id 로 좁힌다 — 그때도 프로젝트 전체는 아니다', () => {
    const mine = { sessionId: 'uuid-1', agentId: 'agent-1' };
    const other = { sessionId: 'uuid-9', agentId: 'agent-2' };
    expect(matchesInsuranceSession(mine, { agentId: 'agent-1' })).toBe(true);
    expect(matchesInsuranceSession(other, { agentId: 'agent-1' })).toBe(false);
    // 소유 버블을 모르는 줄은 아무 데도 붙이지 않는다(넘겨짚지 않는다).
    expect(matchesInsuranceSession({ sessionId: 'uuid-3' }, { agentId: 'agent-1' })).toBe(false);
  });
});

describe('§5.26 (I) sessionFailedCompacts — 세션을 넘기면 배지가 사라진다', () => {
  const led = ledger({
    counts: { markers: 9, preimages: 0, vaultBytes: 0, failedCompacts: 1, restorable: 0 },
    sessionCounts: [sessionCount({ sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' })],
  });

  it('실패가 난 세션에서는 그 수가 뜬다', () => {
    expect(sessionFailedCompacts(led, { agentId: 'agent-1', subAgentId: 'sub-a', sessionId: 'uuid-1' })).toBe(1);
  });

  it('형제 세션에서는 0 이다 — 종전에는 프로젝트 합계 1 이 여덟 탭 전부에 떴다', () => {
    expect(sessionFailedCompacts(led, { agentId: 'agent-1', subAgentId: 'sub-b', sessionId: 'uuid-2' })).toBe(0);
  });

  it('세션별 집계를 못 받았으면 0 이다 — 프로젝트 합계로 굴러떨어지지 않는다', () => {
    const noRows = ledger({
      counts: { markers: 9, preimages: 0, vaultBytes: 0, failedCompacts: 4, restorable: 0 },
    });
    expect(sessionFailedCompacts(noRows, { agentId: 'agent-1', subAgentId: 'sub-a' })).toBe(0);
  });

  it('원장이 아예 없어도 터지지 않는다', () => {
    expect(sessionFailedCompacts(undefined, { agentId: 'agent-1' })).toBe(0);
  });
});

describe('§5.26 (F)(I) sessionWatchLevel — 옆 세션이 벽에 닿아도 내 칸은 안 물든다', () => {
  const led = ledger({
    watch: [
      watch({ sessionId: 'uuid-2', subAgentId: 'sub-b', agentId: 'agent-1', level: 'stalled' }),
      watch({ sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1', level: 'overdue' }),
    ],
  });

  it('내 세션의 등급만 읽는다', () => {
    expect(sessionWatchLevel(led, { agentId: 'agent-1', subAgentId: 'sub-a', sessionId: 'uuid-1' })).toBe('overdue');
    expect(sessionWatchLevel(led, { agentId: 'agent-1', subAgentId: 'sub-b', sessionId: 'uuid-2' })).toBe('stalled');
  });

  it('감시에 안 걸린 세션은 null — 프로젝트 최악값으로 굴러떨어지지 않는다', () => {
    expect(sessionWatchLevel(led, { agentId: 'agent-1', subAgentId: 'sub-c', sessionId: 'uuid-3' })).toBeNull();
  });
});
// ─── §7.23 범위 축 — 이 세션 / 이 에이전트 / 이 프로젝트 ───
//
// 이 시험이 지키는 것: **좁힌 눈금이 남의 줄을 내 것으로 적지 않는다**, 그리고 **넓은 쪽에 있는
// 줄을 없는 것처럼 보이게 두지 않는다**. 보험 화면에서 안 보이는 줄은 없는 줄로 읽히므로,
// 둘 중 하나만 틀려도 사용자가 살아 있는 사본을 포기한다.

function resurrectableRow(over: Partial<ResurrectableSession> = {}): ResurrectableSession {
  return {
    sessionId: 'uuid-1',
    projectName: 'proj',
    cwd: 'C:/proj',
    lastActivityAt: 1_700_000_000_000,
    transcriptBytes: 100,
    mirroredOnly: false,
    resumeRisky: false,
    ...over,
  };
}

/** 세 눈금이 서로 다른 답을 내야 하는 원장 — 내 세션 · 형제 세션 · 남의 버블이 한 장에 있다. */
const mine = { agentId: 'agent-1', subAgentId: 'sub-a', sessionId: 'uuid-1' };
const scopeLedger = ledger({
  markers: [
    marker({ id: 'm-mine', sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' }),
    marker({ id: 'm-sibling', sessionId: 'uuid-2', subAgentId: 'sub-b', agentId: 'agent-1' }),
    marker({ id: 'm-other', sessionId: 'uuid-3', subAgentId: 'sub-c', agentId: 'agent-2' }),
    marker({ id: 'm-orphan', sessionId: 'uuid-4' }),
  ],
  preimages: [
    preimage({ id: 'p-mine', sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' }),
    preimage({ id: 'p-other', sessionId: 'uuid-3', agentId: 'agent-2' }),
  ],
  resurrectable: [
    resurrectableRow({ sessionId: 'uuid-9', agentId: 'agent-1' }),
    resurrectableRow({ sessionId: 'uuid-8', agentId: 'agent-2' }),
  ],
});

describe('§7.23 범위 눈금 — 셋이 서로 다른 질문이다', () => {
  it('눈금은 좁은 것부터 넓은 것 순 — 화면 순서가 곧 이 배열이다', () => {
    expect(INSURANCE_SCOPE_LEVELS).toEqual(['session', 'agent', 'project']);
  });

  it('세 눈금 모두 이름 키를 가진다 — 키가 빠지면 이름 없는 버튼이 선다', () => {
    for (const lv of INSURANCE_SCOPE_LEVELS) {
      expect(INSURANCE_SCOPE_LABEL_KEY[lv]).toMatch(/^panel\.insurance\.scope\./);
    }
  });
});

describe('§7.23 canScopeToSession — 좌표가 없으면 눈금을 내주지 않는다', () => {
  it('세션 탭이 있으면 고를 수 있다', () => {
    expect(canScopeToSession(mine)).toBe(true);
  });

  it('sessionId 만 있어도 고를 수 있다(훅 세션)', () => {
    expect(canScopeToSession({ agentId: 'agent-1', sessionId: 'uuid-1' })).toBe(true);
  });

  it('좌표가 없으면 못 고른다 — 그리면 누르는 순간 빈 창이 된다', () => {
    expect(canScopeToSession({ agentId: 'agent-1' })).toBe(false);
    expect(availableScopeLevels({ agentId: 'agent-1' })).toEqual(['agent', 'project']);
  });

  it('좌표가 있으면 셋 다 선다', () => {
    expect(availableScopeLevels(mine)).toEqual(['session', 'agent', 'project']);
  });
});

describe('§7.23 resolveScopeLevel — 물러설 때는 넓히는 쪽으로', () => {
  it('쓸 수 있는 눈금은 그대로', () => {
    expect(resolveScopeLevel('session', mine)).toBe('session');
    expect(resolveScopeLevel('project', mine)).toBe('project');
  });

  it('세션 좌표가 사라지면 agent 로 넓힌다 — 빈 목록을 남기지 않는다', () => {
    expect(resolveScopeLevel('session', { agentId: 'agent-1' })).toBe('agent');
  });

  it('넓은 눈금은 좌표와 무관하게 그대로', () => {
    expect(resolveScopeLevel('agent', { agentId: 'agent-1' })).toBe('agent');
  });
});

describe('§7.23 rowInScope — 남의 줄을 내 것으로 적지 않는다', () => {
  const row = { sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' };

  it('project 는 전부 든다 — 원장이 이미 프로젝트 한 장이다', () => {
    expect(rowInScope({ sessionId: 'zzz' }, 'project', mine)).toBe(true);
  });

  it('agent 는 그 버블 줄만', () => {
    expect(rowInScope(row, 'agent', mine)).toBe(true);
    expect(rowInScope({ sessionId: 'uuid-3', agentId: 'agent-2' }, 'agent', mine)).toBe(false);
  });

  it('귀속 기록이 없는 줄은 agent 눈금에 들지 않는다 — 남의 것일 수 있다', () => {
    expect(rowInScope({ sessionId: 'uuid-4' }, 'agent', mine)).toBe(false);
  });

  it('session 은 상태바와 같은 판정을 쓴다 — 형제 탭이 딸려 오지 않는다', () => {
    expect(rowInScope(row, 'session', mine)).toBe(true);
    expect(rowInScope({ sessionId: 'uuid-2', subAgentId: 'sub-b', agentId: 'agent-1' }, 'session', mine)).toBe(false);
  });
});

describe('§7.23 filterByScope — 세 목록이 같은 규칙을 쓴다', () => {
  it('세션 눈금은 내 줄 하나만', () => {
    expect(filterByScope(scopeLedger.markers, 'session', mine).map((m) => m.id)).toEqual(['m-mine']);
  });

  it('에이전트 눈금은 형제 탭까지, 남의 버블·귀속 없는 줄은 빼고', () => {
    expect(filterByScope(scopeLedger.markers, 'agent', mine).map((m) => m.id)).toEqual(['m-mine', 'm-sibling']);
  });

  it('프로젝트 눈금은 전량 — 종전 화면과 정확히 같다', () => {
    expect(filterByScope(scopeLedger.markers, 'project', mine)).toHaveLength(4);
  });

  it('사본도 같은 규칙', () => {
    expect(filterByScope(scopeLedger.preimages, 'session', mine).map((p) => p.id)).toEqual(['p-mine']);
    expect(filterByScope(scopeLedger.preimages, 'project', mine)).toHaveLength(2);
  });

  it('목록이 없으면 빈 배열 — 부활 후보는 방송 스냅샷에 아예 안 실린다', () => {
    expect(filterByScope(undefined, 'project', mine)).toEqual([]);
  });

  it('원본을 건드리지 않는다 — project 눈금도 사본을 낸다', () => {
    const out = filterByScope(scopeLedger.markers, 'project', mine);
    expect(out).not.toBe(scopeLedger.markers);
  });
});

describe('§7.23 scopeRowCount — 누르기 전에 저쪽에 뭐가 있는지 안다', () => {
  it('갈피마다 따로 센다', () => {
    expect(scopeRowCount(scopeLedger, 'compacts', 'session', mine)).toBe(1);
    expect(scopeRowCount(scopeLedger, 'compacts', 'agent', mine)).toBe(2);
    expect(scopeRowCount(scopeLedger, 'compacts', 'project', mine)).toBe(4);
    expect(scopeRowCount(scopeLedger, 'preimages', 'session', mine)).toBe(1);
    expect(scopeRowCount(scopeLedger, 'preimages', 'project', mine)).toBe(2);
  });

  it('부활 갈피는 원장에 실렸을 때만 센다', () => {
    expect(scopeRowCount(scopeLedger, 'resurrect', 'agent', mine)).toBe(1);
    expect(scopeRowCount(scopeLedger, 'resurrect', 'project', mine)).toBe(2);
    expect(scopeRowCount(ledger(), 'resurrect', 'project', mine)).toBe(0);
  });

  it('원장이 없으면 0 — 창이 열리기 전에도 숫자 자리가 흔들리지 않는다', () => {
    expect(scopeRowCount(undefined, 'compacts', 'project', mine)).toBe(0);
  });

  it('세는 대상이 그리는 대상과 같다 — 갈피 목록과 눈금 숫자가 어긋나지 않는다', () => {
    for (const lv of INSURANCE_SCOPE_LEVELS) {
      expect(scopeRowCount(scopeLedger, 'compacts', lv, mine))
        .toBe(filterByScope(scopeLedger.markers, lv, mine).length);
      expect(scopeRowCount(scopeLedger, 'notCarried', lv, mine))
        .toBe(scopedNotCarriedRows(scopeLedger, lv, mine).length);
    }
  });
});

describe('§7.23 scopedNotCarriedRows — 갈피 ①과 ②가 같은 목록을 말한다', () => {
  const led = ledger({
    markers: [
      marker({
        id: 'm-mine', sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1',
        outcome: { at: 1, summaryBytes: 1, carriedCount: 0, notCarried: nc({ goal: '내 목표' }) },
      }),
      marker({
        id: 'm-other', sessionId: 'uuid-3', agentId: 'agent-2',
        outcome: { at: 1, summaryBytes: 1, carriedCount: 0, notCarried: nc({ goal: '남의 목표' }) },
      }),
      // 대조 전이라 "안 실렸다"고 말할 근거가 없는 줄 — 눈금과 무관하게 빠진다.
      marker({ id: 'm-pending', sessionId: 'uuid-1', subAgentId: 'sub-a', agentId: 'agent-1' }),
    ],
  });

  it('좁힌 눈금에서는 내 줄만', () => {
    expect(scopedNotCarriedRows(led, 'session', mine).map((m) => m.id)).toEqual(['m-mine']);
  });

  it('넓히면 남의 줄도 함께', () => {
    expect(scopedNotCarriedRows(led, 'project', mine)).toHaveLength(2);
  });

  it('대조 전인 줄은 어느 눈금에서도 안 뜬다 — 근거 없이 "안 실렸다"고 적지 않는다', () => {
    for (const lv of INSURANCE_SCOPE_LEVELS) {
      expect(scopedNotCarriedRows(led, lv, mine).some((m) => m.id === 'm-pending')).toBe(false);
    }
  });
});

describe('§7.23 showsVaultSize — 쪼갤 수 없는 숫자는 좁힌 칸에 적지 않는다', () => {
  it('프로젝트 눈금에서만 적는다', () => {
    expect(showsVaultSize('project')).toBe(true);
  });

  it('좁힌 눈금에서는 안 적는다 — 프로젝트 합계를 세션 칸에 적으면 그냥 틀린 숫자다', () => {
    expect(showsVaultSize('session')).toBe(false);
    expect(showsVaultSize('agent')).toBe(false);
  });
});
// ─── §7.23 "이 줄이 무슨 내용인가" ───
//
// 사용자 보고: "안에 들어있던 내용들 보면 내가 하나도 알아볼 수 없다". 이 시험이 지키는 것은
// **줄마다 고를 근거가 있는가**다 — 같은 파일 네 줄이 구별되는가, 세션 제목이 id 로 굴러떨어지지
// 않는가, 그리고 모를 때 지어내지 않는가.

describe('§7.23 resurrectTitle — 해시 8자로 물러서지 않는다', () => {
  it('서버가 붙여 준 제목을 그대로 쓴다', () => {
    expect(resurrectTitle({ label: 'cmd창버블 화면이 넘어가는 것 고치기' })).toBe('cmd창버블 화면이 넘어가는 것 고치기');
  });

  it('제목이 없으면 null — 화면이 "제목을 알 수 없다"고 적는다', () => {
    expect(resurrectTitle({})).toBeNull();
    expect(resurrectTitle({ label: undefined })).toBeNull();
  });

  it('공백뿐인 제목은 없는 것으로 친다 — 빈 줄이 제목 자리를 차지하면 안 된다', () => {
    expect(resurrectTitle({ label: '   ' })).toBeNull();
  });
});

describe('§7.23 shortSessionId — 제목 자리를 뺏지 않는 보조 표기', () => {
  it('앞 8자', () => {
    expect(shortSessionId('39f5680d-1234-5678-9abc-def012345678')).toBe('39f5680d');
  });

  it('짧은 id 도 깨지지 않는다', () => {
    expect(shortSessionId('abc')).toBe('abc');
  });
});

describe('§7.23 markerSubject — 압축 줄이 서로 구별된다', () => {
  const ws = (over: Partial<CompactMarker['workingSet']> = {}): CompactMarker['workingSet'] => ({
    openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [], queuedCommands: 0, ...over,
  });

  it('세션 목표가 있으면 그것이 가장 좋은 설명이다', () => {
    expect(markerSubject(marker({ workingSet: ws({ goal: '보험 팝업을 세 눈금으로 나눈다' }) })))
      .toBe('보험 팝업을 세 눈금으로 나눈다');
  });

  it('슬래시 명령 자체는 설명이 못 된다 — "무엇을 눌렀나"이지 "무엇을 하던 중"이 아니다', () => {
    // 실제 원장에 `goal: "/compact"` 로 앉아 있던 줄이 있었다.
    expect(markerSubject(marker({ workingSet: ws({ goal: '/compact' }) }))).toBe('/compact');
    expect(markerSubject(marker({ workingSet: ws({ goal: '/compact', recentEdits: ['C:/p/src/a.ts'] }) })))
      .toBe('a.ts');
  });

  it('목표가 없으면 만지던 파일 이름으로', () => {
    expect(markerSubject(marker({ workingSet: ws({ recentEdits: ['C:/proj/src/projectGraph.ts'] }) })))
      .toBe('projectGraph.ts');
  });

  it('파일이 여럿이면 "외 N" 으로 접는다 — 한 줄에 다 적으면 못 읽는다', () => {
    expect(markerSubject(marker({ workingSet: ws({ recentEdits: ['a/x.ts', 'b/y.ts', 'c/z.ts'] }) })))
      .toBe('x.ts 외 2');
  });

  it('윈도우 역슬래시 경로에서도 파일명을 뽑는다', () => {
    expect(markerSubject(marker({ workingSet: ws({ openFiles: ['C:\\proj\\src\\a.ts'] }) }))).toBe('a.ts');
  });

  it('파일도 없으면 진행 중 작업으로', () => {
    expect(markerSubject(marker({ workingSet: ws({ runningTasks: ['빌드 돌리는 중'] }) }))).toBe('빌드 돌리는 중');
  });

  it('아무것도 모르면 null — 지어내지 않는다(화면은 종전대로 시각·트리거만 적는다)', () => {
    expect(markerSubject(marker({ workingSet: ws() }))).toBeNull();
  });
});

describe('§7.23 preimageRevisions — 같은 파일 네 줄이 구별된다', () => {
  it('같은 파일이 여럿이면 번호를 매긴다 — 1 이 가장 최근(목록이 최신 순)', () => {
    const rows = [
      preimage({ id: 'a', path: 'C:/p/g.ts', pathKey: 'C:/p/g.ts' }),
      preimage({ id: 'b', path: 'C:/p/g.ts', pathKey: 'C:/p/g.ts' }),
      preimage({ id: 'c', path: 'C:/p/g.ts', pathKey: 'C:/p/g.ts' }),
    ];
    const rev = preimageRevisions(rows);
    expect(rev.get('a')).toEqual({ index: 1, total: 3 });
    expect(rev.get('c')).toEqual({ index: 3, total: 3 });
  });

  it('한 벌뿐인 파일에는 안 붙인다 — 모든 줄에 1/1 이 붙으면 그건 잡음이다', () => {
    const rev = preimageRevisions([preimage({ id: 'solo' })]);
    expect(rev.has('solo')).toBe(false);
  });

  it('서로 다른 파일은 각자 센다', () => {
    const rows = [
      preimage({ id: 'a1', path: 'C:/p/a.ts', pathKey: 'C:/p/a.ts' }),
      preimage({ id: 'b1', path: 'C:/p/b.ts', pathKey: 'C:/p/b.ts' }),
      preimage({ id: 'a2', path: 'C:/p/a.ts', pathKey: 'C:/p/a.ts' }),
    ];
    const rev = preimageRevisions(rows);
    expect(rev.get('a1')).toEqual({ index: 1, total: 2 });
    expect(rev.get('a2')).toEqual({ index: 2, total: 2 });
    expect(rev.has('b1')).toBe(false);
  });

  it('묶는 기준은 pathKey 다 — linux 에서 대소문자만 다른 두 파일은 서로 다른 파일이다', () => {
    const rows = [
      preimage({ id: 'u', path: 'C:/p/Foo.ts', pathKey: '/p/Foo.ts' }),
      preimage({ id: 'l', path: 'C:/p/foo.ts', pathKey: '/p/foo.ts' }),
    ];
    expect(preimageRevisions(rows).size).toBe(0);
  });

  it('빈 목록도 견딘다', () => {
    expect(preimageRevisions([]).size).toBe(0);
  });
});

describe('§7.23 preimageActionKey — 도구 이름이 아니라 무엇을 했나', () => {
  it('편집 도구는 "편집 전"', () => {
    expect(preimageActionKey(preimage({ toolName: 'Edit' }))).toBe('panel.insurance.action.edited');
    expect(preimageActionKey(preimage({ toolName: 'Write' }))).toBe('panel.insurance.action.edited');
  });

  it('셸은 따로 적는다 — 무엇이 파일을 건드렸는지가 다르다', () => {
    expect(preimageActionKey(preimage({ toolName: 'Bash' }))).toBe('panel.insurance.action.shell');
  });

  it('그 자리에 파일이 없었으면 그 사실이 먼저다 — 되돌리기가 삭제인 줄이다', () => {
    const p = preimage({ toolName: 'Write' });
    delete (p as { sha256?: string }).sha256;
    expect(preimageActionKey(p)).toBe('panel.insurance.action.created');
  });
});
