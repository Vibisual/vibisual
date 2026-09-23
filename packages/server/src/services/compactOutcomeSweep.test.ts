/**
 * SCENARIO.md §5.26 (D) — 압축 결과 판정을 **파일 증거 위로** 옮긴 것을 고정한다.
 *
 * ## 왜 이 시험이 있나
 *
 * 사용자가 보험 창에서 "실패 10"을 보고 물었다 — 앱이 깨진 줄 알았고, 10건 중 7건은 실제로
 * 오탐이었다. 원인이 셋이었고 셋 다 여기서 막는다.
 *
 *  ① **자란 바이트를 요약으로 읽었다.** 마커 오프셋 뒤 512바이트만 넘으면 요약이 온 것으로 보고
 *     그 구간의 모든 문자열을 요약 본문으로 썼다. 그 구간에는 `attachment`(실측 한 건 86KB)·
 *     `last-prompt`·`atis-latch` 가 섞여 있어, 압축이 **시작도 안 한** 마커가 **1초 만에** 실패로
 *     굳었다(실측 2건).
 *  ② **기다리는 시간이 실제 도착보다 짧았다.** 요약이 실제로 붙은 시각은 마커 기준 +2분·+9분·
 *     +28분이었는데 3분에 잘랐다. 세션이 사람의 다음 말을 기다리는 동안 트랜스크립트는 한 바이트도
 *     안 자란다 — 그 정지는 교착이 아니다.
 *  ③ **실패와 판독 불가를 `PostCompact` 훅 하나로 갈랐다.** 그 훅은 마커 100건 중 14건에만 왔다.
 *     같은 사건이 훅 운에 따라 색이 갈렸다.
 *
 * ## 무엇을 지키나
 *
 * **"모르는 것을 실패라고 적지 않는다"** 하나다. 실패로 적히면 사용자가 멀쩡한 세션을 되살리려
 * 들고, 갈피에 붙는 건수가 거짓말을 한다. 모를 때는 판정을 미루고, 압축이 끝난 것만 아는 때는
 * `summaryUnreadable`(= 우리 한계)로 적는다. 그리고 증거는 **늦게 온다** — 이미 적은 실패도
 * 되짚어 지운다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INSURANCE_COMPACT_TIMEOUT_MS,
  INSURANCE_COMPACT_VERDICT_MS,
  INSURANCE_SUMMARY_SCAN_MAX_BYTES,
} from '@vibisual/shared';
import type { CompactMarker, CompactWorkingSet } from '@vibisual/shared';

/**
 * `readTail` 회계 — §9 가 잡았던 **전량 재파싱**이 돌아오지 않았는지 보는 유일한 창이다.
 *
 * 판정을 30분까지 미루면 같은 마커를 스윕이 180번 본다. 매번 마커 오프셋부터 되읽으면 그게 곧
 * 10초마다 수십 MB 다. 커서가 실제로 앞으로만 가는지는 호출 인자로만 확인할 수 있다.
 */
const reads = vi.hoisted(() => [] as Array<{ from: number; want: number }>);
vi.mock('./insuranceVault.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./insuranceVault.js')>();
  return {
    ...actual,
    readTail: (filePath: string, fromBytes: number, maxBytes?: number) => {
      reads.push({ from: fromBytes, want: maxBytes ?? INSURANCE_SUMMARY_SCAN_MAX_BYTES });
      return actual.readTail(filePath, fromBytes, maxBytes);
    },
  };
});

const { ProjectGraph } = await import('./projectGraph.js');
const { emptyWorkingSet } = await import('./compactDiff.js');
type InsuranceLedgerService = import('./insuranceLedger.js').InsuranceLedgerService;

const PROJECT = 'demo';
const SESSION = 'sess-1';
const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

// ─── 트랜스크립트 레코드 ─────────────────────────────────────────────────────
// 실제 JSONL 의 모양을 그대로 쓴다. 여기서 모양을 단순화하면 시험이 통과해도 제품이 못 읽는다.

/** 압축이 **일어났다**는 CLI 자신의 기록. 본문("Conversation compacted")은 요약이 아니다. */
const BOUNDARY = JSON.stringify({
  type: 'system',
  subtype: 'compact_boundary',
  compactMetadata: { trigger: 'auto', preTokens: 174_000 },
});

/** 표식이 붙은 요약 — 지금 판본이 쓰는 모양. */
function taggedSummary(text: string): string {
  return JSON.stringify({
    type: 'user',
    isCompactSummary: true,
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

/** 표식이 없는 요약 — 옛 판본 폴백이 받아야 하는 모양. */
function untaggedSummary(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

/** 평범한 사용자 턴. 요약이 아니다 — 이걸 요약으로 읽으면 진짜 실패가 화면에서 사라진다. */
function userTurn(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

/** 압축 구간에 섞여 붙는 잡음. 실측에서 한 건이 86KB 였다. */
function noise(bytes: number): string {
  return JSON.stringify({ type: 'attachment', content: 'x'.repeat(bytes) });
}

// ─── 하네스 ─────────────────────────────────────────────────────────────────

let tmp: string;
let graph: InstanceType<typeof ProjectGraph>;
let ledger: InsuranceLedgerService;
let file: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-compact-sweep-'));
  file = path.join(tmp, `${SESSION}.jsonl`);
  graph = new ProjectGraph();
  ledger = (graph as unknown as { insuranceService: InsuranceLedgerService }).insuranceService;
  reads.length = 0;
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
});

function append(...lines: string[]): void {
  fs.appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

/** 압축 직전 상태 — 대화가 얼마간 쌓인 파일 위에 마커를 세운다. */
function mark(workingSet: Partial<CompactWorkingSet> = {}): CompactMarker {
  fs.writeFileSync(file, `${userTurn('압축 전 대화')}\n`, 'utf8');
  const marker = ledger.recordCompact({
    projectName: PROJECT,
    sessionId: SESSION,
    trigger: 'auto',
    transcriptPath: file,
    at: T0,
    workingSet: { ...emptyWorkingSet(), ...workingSet },
  });
  if (!marker) throw new Error('마커를 못 세웠다 — 하네스가 틀렸다');
  return marker;
}

/** 스윕이 물고 있는 커서. 사적 필드라 시험에서만 들여다본다. */
function cursorOf(markerId: string): number | undefined {
  const scans = (graph as unknown as { compactScans: Map<string, { cursor: number }> }).compactScans;
  return scans.get(markerId)?.cursor;
}

function failedCount(): number {
  return ledger.getSnapshot(T0).find((l) => l.projectName === PROJECT)?.counts.failedCompacts ?? 0;
}

// ─── ① 자란 바이트는 요약의 유무를 말하지 않는다 ────────────────────────────

describe('§5.26 (D) 잡음이 실패를 만들지 않는다', () => {
  it('오프셋 뒤가 512바이트 넘게 자라도, 잡음뿐이면 옛 3분 시한을 넘겨도 판정이 안 난다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    // 실측에서 이 두 줄이 "요약이 왔다"로 읽혀 마커가 1초 만에 실패로 굳었다.
    append(noise(2000), JSON.stringify({ type: 'atis-latch', state: 'idle' }));

    graph.sweepCompactOutcomes(T0 + 1000);
    expect(marker.outcome).toBeUndefined();

    // 옛 시한(3분)을 넘겨도 마찬가지다 — 압축이 일어났다는 증거가 하나도 없다.
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_TIMEOUT_MS + MIN);
    expect(marker.outcome).toBeUndefined();
    expect(failedCount()).toBe(0);
  });

  it('첨부 본문에 파일명이 있어도 "실렸다"로 읽지 않는다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    // 첨부가 파일 내용을 통째로 싣고 있다 — 옛 규칙은 이걸 요약으로 읽어 "다 실렸다"로 적었다.
    append(JSON.stringify({ type: 'attachment', content: `/w/alpha-file.ts\n${'x'.repeat(1000)}` }));

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    // 증거가 없으니 시한에 `no-summary` 로 못 박되, 실린 것은 **하나도 없다**고 적어야 한다.
    expect(marker.outcome?.failed).toBe('no-summary');
    expect(marker.outcome?.carriedCount).toBe(0);
    expect(marker.outcome?.notCarried.openFiles).toEqual(['/w/alpha-file.ts']);
  });
});

// ─── ② 요약은 늦게 온다 ─────────────────────────────────────────────────────

describe('§5.26 (D) 늦게 오는 요약', () => {
  it('+9분에 붙은 요약을 잡고, `summaryBytes` 는 **요약 줄**의 크기다', () => {
    const marker = mark({
      openFiles: ['/w/kept-alpha.ts', '/w/lost-beta.ts'],
      goal: '압축 판정을 파일 증거 위로 옮기기',
    });
    append(noise(4000)); // 압축이 시작되기 전에 붙는 잡음

    graph.sweepCompactOutcomes(T0 + 5 * MIN);
    expect(marker.outcome).toBeUndefined(); // 옛 3분 시한이었다면 여기서 실패로 굳었다

    const summary = taggedSummary('이어지는 세션입니다. /w/kept-alpha.ts 를 고치던 중이었습니다.');
    append(BOUNDARY, summary);
    graph.sweepCompactOutcomes(T0 + 9 * MIN);

    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryUnreadable).toBeUndefined();
    // 자란 총량(잡음 4KB + 경계 + 요약)이 아니라 고른 **그 줄**의 크기여야 한다.
    expect(marker.outcome?.summaryBytes).toBe(Buffer.byteLength(summary, 'utf8'));
    expect(marker.outcome?.notCarried.openFiles).toEqual(['/w/lost-beta.ts']);
    expect(marker.outcome?.notCarried.goal).toBe('압축 판정을 파일 증거 위로 옮기기');
    expect(marker.outcome?.carriedCount).toBe(1);
  });

  it('증거가 하나도 없으면 30분까지 판정을 미룬다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS - 1);
    expect(marker.outcome).toBeUndefined();

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('no-summary');
  });
});

// ─── ③ 실패와 판독 불가는 파일 증거로 가른다 ────────────────────────────────

describe('§5.26 (D) 실패 vs 판독 불가', () => {
  it('경계만 보이면 유예 뒤 `summaryUnreadable` 이고, `notCarried` 는 **빈다**', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'], goal: '목표 한 줄' });
    append(BOUNDARY);

    // 유예는 **우리가 증거를 본 시각**에서 시작한다(파일에 붙은 시각이 아니다).
    const seen = T0 + MIN;
    graph.sweepCompactOutcomes(seen);
    expect(marker.outcome).toBeUndefined();

    graph.sweepCompactOutcomes(seen + INSURANCE_COMPACT_TIMEOUT_MS - 1);
    expect(marker.outcome).toBeUndefined();

    graph.sweepCompactOutcomes(seen + INSURANCE_COMPACT_TIMEOUT_MS);
    expect(marker.outcome?.summaryUnreadable).toBe(true);
    expect(marker.outcome?.failed).toBeUndefined();
    // "잃은 것이 없다"가 아니라 "무엇을 잃었는지 모른다" — 여기에 작업셋을 적으면
    // (E) 브리핑이 "이걸 다 잃었다"는 거짓을 실어 보낸다.
    expect(marker.outcome?.notCarried.openFiles).toEqual([]);
    expect(marker.outcome?.notCarried.goal).toBeUndefined();
    expect(failedCount()).toBe(0);
  });

  it('`PostCompact` 훅만 와도 실패로 적지 않는다 — 30분을 지나도', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    graph.notePostCompact(SESSION, T0 + 10_000);

    graph.sweepCompactOutcomes(T0 + 10_000 + INSURANCE_COMPACT_TIMEOUT_MS);
    expect(marker.outcome?.summaryUnreadable).toBe(true);
    expect(marker.outcome?.failed).toBeUndefined();

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + MIN);
    expect(marker.outcome?.failed).toBeUndefined();
  });

  it('훅이 안 와도 파일 증거만으로 같은 결론에 닿는다 — 훅 운에 색이 갈리지 않는다', () => {
    const withHook = mark({ openFiles: ['/w/alpha-file.ts'] });
    append(BOUNDARY);
    graph.notePostCompact(SESSION, T0);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_TIMEOUT_MS);
    const hooked = { ...withHook.outcome! };

    // 같은 사건, 훅만 없다.
    const graph2 = new ProjectGraph();
    const ledger2 = (graph2 as unknown as { insuranceService: InsuranceLedgerService }).insuranceService;
    const file2 = path.join(tmp, 'sess-2.jsonl');
    fs.writeFileSync(file2, `${userTurn('압축 전 대화')}\n`, 'utf8');
    const bare = ledger2.recordCompact({
      projectName: PROJECT, sessionId: 'sess-2', trigger: 'auto', transcriptPath: file2, at: T0,
      workingSet: { ...emptyWorkingSet(), openFiles: ['/w/alpha-file.ts'] },
    })!;
    fs.appendFileSync(file2, `${BOUNDARY}\n`, 'utf8');
    graph2.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_TIMEOUT_MS);

    expect(bare.outcome?.summaryUnreadable).toBe(hooked.summaryUnreadable);
    expect(bare.outcome?.failed).toBe(hooked.failed);
  });
});

// ─── ④ 이미 적은 실패를 되짚는다 ────────────────────────────────────────────

describe('§5.26 (D) 되짚기 — 실패로 적힌 줄을 늦게 온 증거로 되돌린다', () => {
  it('뒤늦게 붙은 요약이 `failed` 를 **지우고** 갈피 건수를 되돌린다', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts', '/w/lost-beta.ts'] });

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('no-summary');
    expect(failedCount()).toBe(1);

    const summary = taggedSummary('이어지는 세션입니다. /w/kept-alpha.ts 를 보고 있었습니다.');
    append(BOUNDARY, summary);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + MIN);

    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryBytes).toBe(Buffer.byteLength(summary, 'utf8'));
    expect(marker.outcome?.notCarried.openFiles).toEqual(['/w/lost-beta.ts']);
    // 배지는 `outcome.failed` 를 매번 다시 세므로 정정이 곧바로 화면에 닿는다.
    expect(failedCount()).toBe(0);
  });

  it('뒤늦게 보인 경계는 실패를 판독 불가로 낮춘다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('no-summary');

    append(BOUNDARY);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + MIN);
    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryUnreadable).toBe(true);
  });

  it('판독 불가로 낮춘 뒤에도 **계속 지켜본다** — 그 뒤에 온 요약까지 받는다', () => {
    // 이 시험이 막는 것: 되짚기가 "한 번 봤다"고 손을 떼면, 강등 뒤에 붙은 요약은 영영 안 온다.
    // 그건 지금 고치고 있는 결함과 **같은 부류**다(증거가 늦게 오는데 먼저 결론을 굳힌다).
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('no-summary');

    append(BOUNDARY);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + MIN);
    expect(marker.outcome?.summaryUnreadable).toBe(true);

    const summary = taggedSummary('이어지는 세션입니다. /w/kept-alpha.ts 를 보고 있었습니다.');
    append(summary);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + 2 * MIN);

    expect(marker.outcome?.summaryUnreadable).toBeUndefined();
    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryBytes).toBe(Buffer.byteLength(summary, 'utf8'));
    expect(marker.outcome?.carriedCount).toBe(1);
  });

  it('둘째 경계를 지나면 손을 뗀다 — 다음 압축의 요약을 이 마커의 것으로 적지 않는다', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('no-summary');

    // 우리 압축은 경계만 남기고 요약을 못 남겼다(잡음이 그 자리를 먹었다).
    append(BOUNDARY, noise(200));
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + MIN);
    expect(marker.outcome?.summaryUnreadable).toBe(true);

    // 대화가 이어지고 **다음** 압축이 일어난다. 그 요약은 이 마커의 것이 아니다.
    const otherSummary = taggedSummary('다음 압축의 요약입니다. /w/kept-alpha.ts 를 보고 있었습니다.');
    append(userTurn('사람이 쓴 다음 말'), BOUNDARY, otherSummary);
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + 2 * MIN);

    expect(marker.outcome?.summaryUnreadable).toBe(true);
    expect(marker.outcome?.summaryBytes).toBe(0);
    expect(marker.outcome?.carriedCount).toBe(0);

    // 손을 뗐으므로 그 뒤에 무엇이 붙어도 이 줄은 안 바뀐다.
    append(taggedSummary('또 다른 요약 /w/kept-alpha.ts'));
    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS + 3 * MIN);
    expect(marker.outcome?.summaryBytes).toBe(0);
  });
});

// ─── ⑤ 파일이 사라진 경우 ───────────────────────────────────────────────────

describe('§5.26 (D) 트랜스크립트가 사라졌다', () => {
  it('시한 전에는 미정, 30분에 `transcript-gone`', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    fs.rmSync(file);

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS - 1);
    expect(marker.outcome).toBeUndefined();

    graph.sweepCompactOutcomes(T0 + INSURANCE_COMPACT_VERDICT_MS);
    expect(marker.outcome?.failed).toBe('transcript-gone');
    // 사라진 파일에는 요약이 붙지 않는다 — 실린 것이 없다고 적는 쪽이 정직하다.
    expect(marker.outcome?.notCarried.openFiles).toEqual(['/w/alpha-file.ts']);
  });
});

// ─── ⑥ 요약을 고르는 규칙 ───────────────────────────────────────────────────

describe('§5.26 (D) 요약을 고르는 규칙', () => {
  it('표식이 없어도 **경계 바로 다음 한 줄**이면 요약으로 받는다(옛 판본)', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    const summary = untaggedSummary('이어지는 세션입니다. /w/kept-alpha.ts 를 보고 있었습니다.');
    append(BOUNDARY, summary);

    graph.sweepCompactOutcomes(T0 + MIN);
    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryBytes).toBe(Buffer.byteLength(summary, 'utf8'));
    expect(marker.outcome?.carriedCount).toBe(1);
  });

  it('경계 다음 자리를 잡음이 먹었으면, 뒤에 오는 평범한 사용자 턴을 요약으로 읽지 않는다', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    // 이 줄을 요약으로 읽으면 화면이 "정상"이라고 적어 **진짜 실패가 사라진다.**
    append(BOUNDARY, noise(100), userTurn('/w/kept-alpha.ts 를 마저 고쳐 줘'));

    const seen = T0 + MIN;
    graph.sweepCompactOutcomes(seen);
    graph.sweepCompactOutcomes(seen + INSURANCE_COMPACT_TIMEOUT_MS);

    expect(marker.outcome?.summaryUnreadable).toBe(true);
    expect(marker.outcome?.summaryBytes).toBe(0);
    expect(marker.outcome?.carriedCount).toBe(0);
  });

  it('경계 자신의 본문은 요약이 아니다', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    append(JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted — /w/kept-alpha.ts',
      compactMetadata: { trigger: 'auto' },
    }));

    const seen = T0 + MIN;
    graph.sweepCompactOutcomes(seen);
    graph.sweepCompactOutcomes(seen + INSURANCE_COMPACT_TIMEOUT_MS);
    expect(marker.outcome?.summaryUnreadable).toBe(true);
    expect(marker.outcome?.carriedCount).toBe(0);
  });
});

// ─── ⑦ 읽기 총량 — §9 가 잡았던 전량 재파싱이 돌아오지 않았나 ───────────────

describe('§5.26 (D) 커서는 앞으로만 간다', () => {
  it('파일이 안 자라면 **한 바이트도** 안 읽는다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    append(noise(50_000));

    graph.sweepCompactOutcomes(T0 + 1000);
    const size = fs.statSync(file).size;
    expect(cursorOf(marker.id)).toBe(size);
    expect(reads.length).toBeGreaterThan(0);

    // 사람의 다음 말을 기다리는 동안 — 실측에서 이 구간이 수십 분이다.
    reads.length = 0;
    for (let i = 1; i <= 20; i += 1) graph.sweepCompactOutcomes(T0 + 1000 + i * 10_000);
    expect(reads).toEqual([]);
  });

  it('새로 붙은 자리에서만 이어 읽는다', () => {
    const marker = mark({ openFiles: ['/w/alpha-file.ts'] });
    append(noise(20_000));
    graph.sweepCompactOutcomes(T0 + 1000);
    const size = fs.statSync(file).size;

    reads.length = 0;
    append(noise(1000));
    graph.sweepCompactOutcomes(T0 + 2000);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.from >= size)).toBe(true);
    expect(cursorOf(marker.id)).toBe(fs.statSync(file).size);
  });

  it('창보다 긴 한 줄이 커서를 세우지 않는다(거대 첨부)', () => {
    const marker = mark({ openFiles: ['/w/kept-alpha.ts'] });
    const giant = JSON.stringify({
      type: 'attachment',
      content: 'x'.repeat(INSURANCE_SUMMARY_SCAN_MAX_BYTES + 4096),
    });
    const summary = taggedSummary('이어지는 세션입니다. /w/kept-alpha.ts 를 보고 있었습니다.');
    append(giant, BOUNDARY, summary);

    graph.sweepCompactOutcomes(T0 + MIN);
    expect(marker.outcome?.failed).toBeUndefined();
    expect(marker.outcome?.summaryBytes).toBe(Buffer.byteLength(summary, 'utf8'));
    expect(cursorOf(marker.id)).toBeUndefined(); // 결론이 났으면 커서는 버린다
  });
});
