import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_RETENTION_SETTINGS, INSURANCE_PREIMAGE_MAX_BYTES } from '@vibisual/shared';
import type { CompactOutcome, RetentionSettings } from '@vibisual/shared';
import { InsuranceVault } from './insuranceVault.js';
import { InsuranceLedgerService, extractTeammateNames, foldSessionCounts } from './insuranceLedger.js';

// SCENARIO.md §5.26 — 컨텍스트 보험 저장고 + 원장.
//
// 이 시험이 지키는 것은 **"없는데 있다고 적지 않는다"** 하나다(§5.26 (A) 마지막 항목). 사본이
// 없는데 화면이 "사본 있음"이라고 말하면 사용자는 되돌릴 수 있다고 믿고 그 파일을 덮어쓴다.
//
// 저장고는 `resolveSaveDir` 하나로만 바깥과 닿으므로 임시 폴더를 물려 돌린다 — 이 시험은
// 사용자의 실제 저장 폴더도 `app-state.json` 도 건드리지 않는다.

const PROJECT = 'demo';

let tmp: string;
let saveDir: string;
let vault: InsuranceVault;
let ledger: InsuranceLedgerService;
let retention: RetentionSettings;

function makeLedger(): InsuranceLedgerService {
  return new InsuranceLedgerService(vault, () => retention);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-insurance-'));
  saveDir = path.join(tmp, '.vibisual', 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  vault = new InsuranceVault({ resolveSaveDir: (name) => (name === PROJECT ? saveDir : null) });
  retention = { ...DEFAULT_RETENTION_SETTINGS };
  ledger = makeLedger();
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
});

function writeFile(name: string, body: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

function writeTranscript(lines: string[] = ['{"type":"user"}']): string {
  return writeFile('sess.jsonl', `${lines.join('\n')}\n`);
}

describe('§5.26 (B) recordCompact — 마커', () => {
  it('트랜스크립트가 있으면 마커가 서고, 미러를 뜨기 전에는 `mirrored: false`', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath,
    });
    expect(m).not.toBeNull();
    // 사본을 아직 안 떴다 — 여기서 true 로 적으면 그게 이 기능의 유일한 거짓말이다.
    expect(m?.mirrored).toBe(false);
    expect(m?.transcriptBytes).toBeGreaterThan(0);
  });

  it('트랜스크립트가 없으면 마커를 만들지 않는다', () => {
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath: path.join(tmp, 'nope.jsonl'),
    });
    expect(m).toBeNull();
  });

  it('mirrorFor 뒤에 `mirrored: true` 로 바뀌고 사본 파일이 생긴다', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    expect(ledger.mirrorFor(m.id, PROJECT)).toBe(true);
    expect(ledger.latestMarker(PROJECT, 's1')?.mirrored).toBe(true);
    expect(fs.existsSync(path.join(saveDir, 'insurance', 'transcripts', 's1.jsonl'))).toBe(true);
  });

  it('미러를 끄면(`insuranceMirror: false`) 마커만 남는다', () => {
    retention = { ...retention, insuranceMirror: false };
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    expect(ledger.mirrorFor(m.id, PROJECT)).toBe(false);
    expect(ledger.latestMarker(PROJECT, 's1')?.mirrored).toBe(false);
  });
});

describe('§5.26 (C) recordPreimage — 세 갈래를 전부 적는다', () => {
  it('있는 파일은 사본이 남고 되돌릴 수 있다', () => {
    const target = writeFile('a.txt', 'before');
    const p = ledger.recordPreimage({
      projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Bash', toolUseId: 'u1',
    })!;
    expect(p.sha256).toBeTruthy();
    expect(p.skipped).toBeUndefined();

    fs.writeFileSync(target, 'after', 'utf8');
    const out = ledger.restorePreimage(PROJECT, p.id);
    expect(out.ok).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('before');
    // 되돌리기 직전 내용도 사본으로 남는다 — 잘못 눌러도 한 번 더 되돌아갈 자리가 있다.
    expect(out.undoId).toBeTruthy();
  });

  it('없던 파일은 `sha256` 없이 기록되고, 되돌리기는 곧 삭제다', () => {
    const target = path.join(tmp, 'new.txt');
    const p = ledger.recordPreimage({
      projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Write', toolUseId: 'u2',
    })!;
    expect(p.sha256).toBeUndefined();

    fs.writeFileSync(target, 'created by the tool', 'utf8');
    expect(ledger.restorePreimage(PROJECT, p.id).ok).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('너무 큰 파일은 **조용히 건너뛰지 않고** 이유를 적는다', () => {
    const target = writeFile('big.bin', 'x'.repeat(INSURANCE_PREIMAGE_MAX_BYTES + 1));
    const p = ledger.recordPreimage({
      projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Bash', toolUseId: 'u3',
    })!;
    expect(p.skipped).toBe('too-large');
    expect(p.sha256).toBeUndefined();
  });

  it('같은 호출(`toolUseId`+경로)은 한 번만 적힌다 — 사전/사후가 둘 다 와도', () => {
    const target = writeFile('a.txt', 'before');
    const first = ledger.recordPreimage({
      projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Bash', toolUseId: 'u1',
    });
    const second = ledger.recordPreimage({
      projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Bash', toolUseId: 'u1',
    });
    expect(first?.id).toBe(second?.id);
    expect(ledger.full(PROJECT)?.preimages.length).toBe(1);
  });

  it('같은 내용은 저장고에 한 벌만 앉는다(내용 주소 지정)', () => {
    const a = writeFile('a.txt', 'same bytes');
    const b = writeFile('b.txt', 'same bytes');
    const pa = ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: a, toolName: 'Bash', toolUseId: 'u1' })!;
    const pb = ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: b, toolName: 'Bash', toolUseId: 'u2' })!;
    expect(pa.sha256).toBe(pb.sha256);
  });
});

describe('§5.26 (E) 브리핑은 한 번만', () => {
  function seedWithOutcome(): string {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    ledger.attachOutcome(PROJECT, m.id, {
      at: Date.now(),
      summaryBytes: 100,
      notCarried: { openFiles: ['/a/b.ts'], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [] },
      carriedCount: 0,
    });
    return m.id;
  }

  it('결과가 붙기 전에는 브리핑이 나오지 않는다 — 대조하지 않은 것을 알릴 수 없다', () => {
    const transcriptPath = writeTranscript();
    ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath });
    expect(ledger.peekBriefing('s1')).toBeUndefined();
  });

  it('peek 은 못 박지 않는다 — 주입원 표를 여는 것으로 브리핑이 사라지면 안 된다', () => {
    seedWithOutcome();
    expect(ledger.peekBriefing('s1')).toBeDefined();
    expect(ledger.peekBriefing('s1')).toBeDefined();
  });

  it('take 는 한 번만 준다', () => {
    seedWithOutcome();
    expect(ledger.takeBriefing('s1')).toBeDefined();
    expect(ledger.takeBriefing('s1')).toBeUndefined();
  });

  it('markBriefed 는 두 번째 호출에서 false — 두 주입 지점이 동시에 물어도 한 번만 나간다', () => {
    const id = seedWithOutcome();
    expect(ledger.markBriefed(PROJECT, id)).toBe(true);
    expect(ledger.markBriefed(PROJECT, id)).toBe(false);
  });
});

describe('§3.2 영속 왕복 — 색인이 사라지면 바이트는 고아가 된다', () => {
  it('체크포인트 → 복원 왕복에서 사본이 살아남는다', () => {
    const target = writeFile('a.txt', 'before');
    ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: target, toolName: 'Bash', toolUseId: 'u1' });
    const cp = ledger.toCheckpoint(PROJECT);
    expect(cp).toBeDefined();

    const revived = makeLedger();
    revived.restore(cp);
    const p = revived.full(PROJECT)?.preimages[0];
    expect(p).toBeDefined();

    fs.writeFileSync(target, 'after', 'utf8');
    expect(revived.restorePreimage(PROJECT, p!.id).ok).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('before');
  });

  it('복원 시 미러가 사라졌으면 `mirrored` 를 내린다 — 없는 사본을 있다고 적지 않는다', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    ledger.mirrorFor(m.id, PROJECT);
    const cp = ledger.toCheckpoint(PROJECT)!;
    expect(cp.markers[0]?.mirrored).toBe(true);

    // 바깥에서 저장고를 통째로 치웠다(사용자 정리·디스크 사고).
    fs.rmSync(path.join(saveDir, 'insurance'), { recursive: true, force: true });

    const revived = makeLedger();
    revived.restore(cp);
    expect(revived.full(PROJECT)?.markers[0]?.mirrored).toBe(false);
  });

  it('병합은 id 기준 합집합 — 이미 있는 줄을 덮지 않는다', () => {
    const transcriptPath = writeTranscript();
    ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath });
    const cp = ledger.toCheckpoint(PROJECT)!;

    const other = makeLedger();
    other.merge(cp);
    other.merge(cp);
    expect(other.full(PROJECT)?.markers.length).toBe(1);
  });

  it('빈 원장은 체크포인트를 늘리지 않는다', () => {
    expect(ledger.toCheckpoint(PROJECT)).toBeUndefined();
  });
});

describe('§3.2.3 보존 — 예산은 실제로 지운다', () => {
  it('나이가 지난 마커는 걷힌다', () => {
    retention = { ...retention, insuranceRetentionDays: 1 };
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath,
      at: Date.now() - 3 * 24 * 60 * 60 * 1000,
    })!;
    expect(m).toBeDefined();
    expect(ledger.applyRetention()).toBe(true);
    expect(ledger.full(PROJECT)?.markers.length).toBe(0);
    expect(ledger.full(PROJECT)?.retired?.markers).toBe(1);
  });

  it('`0` 은 무제한이라 아무것도 걷지 않는다', () => {
    retention = { ...retention, insuranceRetentionDays: 0 };
    const transcriptPath = writeTranscript();
    ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath,
      at: Date.now() - 3650 * 24 * 60 * 60 * 1000,
    });
    ledger.applyRetention();
    expect(ledger.full(PROJECT)?.markers.length).toBe(1);
  });
});

describe('§5.26 (B) extractTeammateNames — 넓게 받는다', () => {
  it('단수 키·복수 배열·객체 배열을 모두 받아 합집합을 만든다', () => {
    const names = extractTeammateNames({
      teammate: 'alice',
      teammates: ['bob'],
      agents: [{ name: 'carol' }],
    });
    expect(new Set(names)).toEqual(new Set(['alice', 'bob', 'carol']));
  });

  it('세션 id 처럼 보이는 값은 이름이 아니다', () => {
    expect(extractTeammateNames({ name: '3f2a1b4c-1111-2222-3333-444455556666' })).toEqual([]);
  });

  it('빈 값·아주 긴 값은 담지 않는다', () => {
    expect(extractTeammateNames({ teammate: '   ', agentName: 'x'.repeat(200) })).toEqual([]);
  });

  it('아무것도 없으면 빈 배열', () => {
    expect(extractTeammateNames({ hook_event_name: 'TeammateIdle' })).toEqual([]);
  });
});

describe('§5.26 (D) notePostCompact — 완료 훅이 실패 판정을 막는다', () => {
  function seed(): string {
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'sess-1', trigger: 'auto',
      transcriptPath: writeTranscript(), contextUsed: 90_000, contextMax: 100_000,
    });
    if (!m) throw new Error('marker not created');
    return m.id;
  }

  it('완료 훅이 오면 마커에 시각이 남는다', () => {
    const id = seed();
    expect(ledger.notePostCompact('sess-1', 555)).toBe(true);
    expect(ledger.latestMarker(PROJECT, 'sess-1')?.postCompactAt).toBe(555);
    expect(id).toBeTruthy();
  });

  it('두 번 와도 첫 번째만 새긴다 — 중복 훅이 시각을 밀지 않는다', () => {
    seed();
    ledger.notePostCompact('sess-1', 100);
    expect(ledger.notePostCompact('sess-1', 200)).toBe(false);
    expect(ledger.latestMarker(PROJECT, 'sess-1')?.postCompactAt).toBe(100);
  });

  it('대조가 이미 끝난 마커에는 새기지 않는다 — 그 훅은 다음 압축의 것이다', () => {
    const id = seed();
    ledger.attachOutcome(PROJECT, id, {
      at: 1, summaryBytes: 10, carriedCount: 0,
      notCarried: { openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [] },
    });
    expect(ledger.notePostCompact('sess-1', 300)).toBe(false);
  });

  it('마커가 없는 세션에는 아무 일도 하지 않는다 — 지어낸 마커는 오프셋이 없다', () => {
    expect(ledger.notePostCompact('nobody', 1)).toBe(false);
  });
});

describe('§5.26 (G) 되살리기 확인 — 빈 채로 되살아난 것을 잡는다', () => {
  function seed(contextUsed?: number): string {
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'sess-1', trigger: 'auto',
      transcriptPath: writeTranscript(),
      ...(contextUsed === undefined ? {} : { contextUsed }),
      contextMax: 100_000,
    });
    if (!m) throw new Error('marker not created');
    return m.id;
  }

  it('기준선이 없으면 확인을 걸지 않는다 — 비교할 수가 없다', () => {
    seed(undefined);
    expect(ledger.armResumeCheck('sess-1')).toBe(false);
    expect(ledger.armedResumeChecks()).toHaveLength(0);
  });

  it('기준선이 있으면 걸리고, 스윕이 훑을 목록에 선다', () => {
    seed(90_000);
    expect(ledger.armResumeCheck('sess-1', 10)).toBe(true);
    expect(ledger.armedResumeChecks().map((m) => m.sessionId)).toEqual(['sess-1']);
  });

  it('확인이 끝나면 목록에서 빠진다 — 첫 턴 한 번만 유효한 비교다', () => {
    const id = seed(90_000);
    ledger.armResumeCheck('sess-1', 10);
    expect(ledger.settleResumeCheck(id, false, 20)).toBe(true);
    expect(ledger.armedResumeChecks()).toHaveLength(0);
    expect(ledger.latestMarker(PROJECT, 'sess-1')?.resumeShortfall).toBeUndefined();
  });

  it('문맥이 안 실렸으면 **이미 보낸 브리핑도 다시** 실을 수 있게 표식을 푼다', () => {
    const id = seed(90_000);
    const marker = ledger.latestMarker(PROJECT, 'sess-1');
    if (!marker) throw new Error('no marker');
    marker.briefedAt = 5; // 죽기 전에 이미 한 번 브리핑했다
    ledger.armResumeCheck('sess-1', 10);
    ledger.settleResumeCheck(id, true, 20);
    expect(marker.resumeShortfall).toBe(true);
    expect(marker.briefedAt).toBeUndefined();
  });

  it('다시 걸면 지난 판정이 지워진다 — 되살리기마다 새로 잰다', () => {
    const id = seed(90_000);
    ledger.armResumeCheck('sess-1', 10);
    ledger.settleResumeCheck(id, true, 20);
    ledger.armResumeCheck('sess-1', 30);
    const m = ledger.latestMarker(PROJECT, 'sess-1');
    expect(m?.resumeShortfall).toBeUndefined();
    expect(m?.resumeCheckedAt).toBeUndefined();
  });
});

describe('§5.26 (D)(G) attachOutcome vs replaceOutcome — 나중 사실이 이긴다', () => {
  const NC = { openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [] };
  function seed(): string {
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'sess-1', trigger: 'auto',
      transcriptPath: writeTranscript(), contextUsed: 90_000,
    });
    if (!m) throw new Error('marker not created');
    return m.id;
  }

  it('대조는 한 번뿐 — attachOutcome 은 이미 붙은 결과를 지킨다', () => {
    const id = seed();
    ledger.attachOutcome(PROJECT, id, { at: 1, summaryBytes: 10, notCarried: NC, carriedCount: 1 });
    expect(ledger.attachOutcome(PROJECT, id, { at: 2, summaryBytes: 99, notCarried: NC, carriedCount: 9 })).toBe(false);
    expect(ledger.latestMarker(PROJECT, 'sess-1')?.outcome?.summaryBytes).toBe(10);
  });

  it('되살리기 측정은 덮어쓴다 — "지금 그 문맥이 없다"는 더 나중의 더 강한 사실이다', () => {
    const id = seed();
    // 요약을 못 읽어 notCarried 가 빈 결과 — 이대로 두면 브리핑에 실을 것이 없다
    ledger.attachOutcome(PROJECT, id, { at: 1, summaryBytes: 0, notCarried: NC, carriedCount: 0, summaryUnreadable: true });
    const carried = { ...NC, openFiles: ['/a.ts'], goal: '보험 끝내기' };
    expect(ledger.replaceOutcome(PROJECT, id, { at: 2, summaryBytes: 0, notCarried: carried, carriedCount: 0 })).toBe(true);
    const out = ledger.latestMarker(PROJECT, 'sess-1')?.outcome;
    expect(out?.notCarried.openFiles).toEqual(['/a.ts']);
    // 되살리기가 실패한 것이지 압축이 실패한 것이 아니다
    expect(out?.failed).toBeUndefined();
    expect(out?.summaryUnreadable).toBeUndefined();
  });

  it('없는 마커에는 덮어쓰지 않는다', () => {
    expect(ledger.replaceOutcome(PROJECT, 'nope', { at: 1, summaryBytes: 0, notCarried: NC, carriedCount: 0 })).toBe(false);
  });
});

// ─── §5.26 (I) 세션별 집계 — 상태바 배지가 자기 세션 것만 말하게 하는 근거 ───
//
// 사용자 보고(세션 8개짜리 커스텀 버블): 실패 압축 배지 `1` 이 여덟 탭 전부에 뜨고 탭을 넘겨도
// 안 사라졌다. 상태바가 프로젝트 합계(`counts.failedCompacts`)를 읽고 있었기 때문이다. 이 집계가
// **전선에 실려야** 화면이 세션을 주어로 삼을 수 있다.

function failedOutcome(): CompactOutcome {
  return {
    at: 1,
    summaryBytes: 0,
    carriedCount: 0,
    notCarried: { openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [] },
    failed: 'no-summary',
  };
}

describe('§5.26 (I) foldSessionCounts — 세션별로 접는다', () => {
  it('마커가 없으면 빈 목록', () => {
    expect(foldSessionCounts([])).toEqual([]);
  });

  it('실패가 0 인 세션은 싣지 않는다 — 대다수 세션이 여기 해당해 전선 비용이 0 이 된다', () => {
    const transcriptPath = writeTranscript();
    ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath });
    const snap = ledger.getSnapshot().find((l) => l.projectName === PROJECT);
    expect(snap?.counts.markers).toBe(1);
    expect(snap?.sessionCounts).toBeUndefined();
  });

  it('실패가 난 세션만, 그 세션의 수만 실린다', () => {
    const transcriptPath = writeTranscript();
    const a = ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', subAgentId: 'sub-a', agentId: 'agent-1', trigger: 'auto', transcriptPath,
    })!;
    ledger.recordCompact({
      projectName: PROJECT, sessionId: 's2', subAgentId: 'sub-b', agentId: 'agent-1', trigger: 'auto', transcriptPath,
    });
    ledger.attachOutcome(PROJECT, a.id, failedOutcome());

    const snap = ledger.getSnapshot().find((l) => l.projectName === PROJECT);
    // 프로젝트 합계는 그대로 1 — 팝업(§7.23)은 여전히 프로젝트 한 장이다.
    expect(snap?.counts.failedCompacts).toBe(1);
    expect(snap?.sessionCounts).toEqual([
      { sessionId: 's1', subAgentId: 'sub-a', agentId: 'agent-1', failedCompacts: 1, markers: 1 },
    ]);
    // 형제 세션(s2)은 목록에 아예 없다 → 상태바가 0 을 그린다.
    expect(snap?.sessionCounts?.some((c) => c.sessionId === 's2')).toBe(false);
  });

  it('같은 세션의 실패 여러 건은 합산되고, 마커 수는 실패가 아닌 것까지 센다', () => {
    const transcriptPath = writeTranscript();
    const m1 = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    const m2 = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath });
    ledger.attachOutcome(PROJECT, m1.id, failedOutcome());
    ledger.attachOutcome(PROJECT, m2.id, failedOutcome());

    const row = ledger.getSnapshot()
      .find((l) => l.projectName === PROJECT)?.sessionCounts?.[0];
    expect(row).toMatchObject({ sessionId: 's1', failedCompacts: 2, markers: 3 });
  });

  it('소유 정보는 가장 최근 마커의 것을 쓰되, 없으면 옛 마커의 것을 살린다', () => {
    const transcriptPath = writeTranscript();
    // 먼저 든 것이 더 오래된 마커다(배열은 최신 순이라 나중에 넣은 것이 앞에 선다).
    const old = ledger.recordCompact({
      projectName: PROJECT, sessionId: 's1', subAgentId: 'sub-a', agentId: 'agent-1', trigger: 'auto', transcriptPath,
    })!;
    ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath });
    ledger.attachOutcome(PROJECT, old.id, failedOutcome());

    const row = ledger.getSnapshot()
      .find((l) => l.projectName === PROJECT)?.sessionCounts?.[0];
    expect(row?.subAgentId).toBe('sub-a');
    expect(row?.agentId).toBe('agent-1');
  });

  it('디스크 포맷에는 싣지 않는다 — 파생이라 복원 후 같은 답이 다시 나온다', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({ projectName: PROJECT, sessionId: 's1', trigger: 'auto', transcriptPath })!;
    ledger.attachOutcome(PROJECT, m.id, failedOutcome());
    expect(ledger.toCheckpoint(PROJECT)?.sessionCounts).toBeUndefined();

    // 복원하면 전선에서는 다시 나온다.
    const revived = makeLedger();
    revived.restore(ledger.toCheckpoint(PROJECT));
    expect(revived.getSnapshot().find((l) => l.projectName === PROJECT)?.sessionCounts)
      .toEqual([{ sessionId: 's1', failedCompacts: 1, markers: 1 }]);
  });
});
