import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_RETENTION_SETTINGS,
  INSURANCE_MARKERS_MAX_PER_PROJECT,
  INSURANCE_PREIMAGES_MAX_PER_PROJECT,
} from '@vibisual/shared';
import type { ProjectInsuranceLedger, RetentionSettings } from '@vibisual/shared';
import { InsuranceVault } from './insuranceVault.js';
import { InsuranceLedgerService } from './insuranceLedger.js';

// SCENARIO.md §5.26 (H) / §3.2.3 — 컨텍스트 보험 저장고의 **용량 회수**.
//
// 이 시험이 지키는 것은 하나다: **줄을 버리면 그 바이트도 버린다.**
//
// 상한 다섯 축은 처음부터 다 있었는데 걷어 내는 자리가 실제로는 돌지 않았다. 줄을 자르는
// `trimPreimages` 는 blob 을 안 건드렸고, blob 을 걷는 `pruneOrphans` 는 ① 아무도 부르지 않는
// `applyRetention` ② 예산(256MB) 초과 분기 안에만 있었다. 그래서 사본 줄이 상한 500 을 지키는
// 동안 디스크 blob 은 513개까지 자랐고 그중 **177개(22.5MB)가 아무도 가리키지 않는 고아**였다
// (실측 2026-09-09 · 금고 76MB). 미러 쪽은 걷어 내는 자리가 아예 없었다.

// 사본 상한(500줄)을 실제로 넘겨 봐야 하는 시험은 작은 파일 쓰기를 수백 번 한다. 개발기 Windows 에서는
// 3초 남짓인데 GitHub 의 windows-latest 러너는 작은 파일 I/O 가 훨씬 느려 같은 시험이 44.6초가 걸렸고
// 기본 제한(30초)을 넘겨 떨어졌다(2026-09-13 CI · ubuntu·macos 는 통과). 한 줄당 비용은 일정해
// 코드가 느려진 것이 아니다 — 판정은 그대로 두고 이 시험들에만 넉넉한 제한을 준다.
const CAP_WALK_TIMEOUT_MS = 180_000;

const PROJECT = 'demo';

let tmp: string;
let saveDir: string;
let vault: InsuranceVault;
let ledger: InsuranceLedgerService;
let retention: RetentionSettings;

function newVault(): InsuranceVault {
  return new InsuranceVault({ resolveSaveDir: (name) => (name === PROJECT ? saveDir : null) });
}

function makeLedger(): InsuranceLedgerService {
  return new InsuranceLedgerService(vault, () => retention);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-insurance-cap-'));
  saveDir = path.join(tmp, '.vibisual', 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  vault = newVault();
  retention = { ...DEFAULT_RETENTION_SETTINGS };
  ledger = makeLedger();
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
});

function writeFile(name: string, body: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

function writeTranscript(): string {
  return writeFile('sess.jsonl', '{"type":"user"}\n{"type":"assistant"}\n');
}

/** 저장고에 **실제로** 남아 있는 blob 해시들 — 원장이 뭐라 적었든 디스크가 진실이다. */
function blobsOnDisk(): Set<string> {
  const base = path.join(saveDir, 'insurance', 'blobs');
  const out = new Set<string>();
  let shards: string[];
  try { shards = fs.readdirSync(base); } catch { return out; }
  for (const shard of shards) {
    try {
      for (const f of fs.readdirSync(path.join(base, shard))) out.add(f);
    } catch { /* 방금 비워진 껍데기 폴더 */ }
  }
  return out;
}

/** 저장고에 실제로 남아 있는 미러들(파일명 = 세션 id). */
function mirrorsOnDisk(): Set<string> {
  const base = path.join(saveDir, 'insurance', 'transcripts');
  try {
    return new Set(fs.readdirSync(base).map((f) => f.replace(/\.jsonl$/, '')));
  } catch {
    return new Set<string>();
  }
}

/** 원장이 아직 가리키는 해시들 — 디스크와 이것이 같아야 고아가 없다. */
function referencedShas(led: InsuranceLedgerService = ledger): Set<string> {
  const out = new Set<string>();
  for (const p of led.full(PROJECT)?.preimages ?? []) if (p.sha256) out.add(p.sha256);
  return out;
}

function addPreimage(body: string): void {
  const p = writeFile(`f-${body}.txt`, body);
  ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: p, toolName: 'Write' });
}

/** 파생 칸은 `restore` 가 안 읽지만 타입이 요구한다 — 0 으로 채워 모양만 맞춘다. */
const EMPTY_COUNTS = { markers: 0, preimages: 0, vaultBytes: 0, failedCompacts: 0, restorable: 0 };

/** 마커·사본이 없는 원장 — 옛 판본이 남긴 "색인은 비었는데 바이트는 남은" 상태를 세운다. */
function emptyLedger(retiredMarkers = 0): ProjectInsuranceLedger {
  return {
    projectName: PROJECT,
    markers: [],
    preimages: [],
    counts: { ...EMPTY_COUNTS },
    retired: { markers: retiredMarkers, preimages: 0, bytes: 0 },
    updatedAt: Date.now(),
  };
}

/** 캡을 넘긴 원장을 손으로 세운다 — `restore` 는 자르지 않으므로 한 바퀴의 대상이 된다. */
function overCapLedger(markers: number, preimages: number): ProjectInsuranceLedger {
  const at = Date.now();
  return {
    projectName: PROJECT,
    counts: { ...EMPTY_COUNTS },
    updatedAt: at,
    markers: Array.from({ length: markers }, (_, i) => ({
      id: `m-${i}`,
      at: at - i,
      projectName: PROJECT,
      sessionId: `s-${i}`,
      trigger: 'auto' as const,
      transcriptPath: path.join(tmp, 'sess.jsonl'),
      transcriptBytes: 10,
      transcriptMtime: at,
      mirrored: false,
      workingSet: {
        openFiles: [], recentEdits: [], runningTasks: [], goalSteps: [], teammates: [], queuedCommands: 0,
      },
    })),
    preimages: Array.from({ length: preimages }, (_, i) => ({
      id: `p-${i}`,
      at: at - i,
      projectName: PROJECT,
      path: path.join(tmp, `p-${i}.txt`),
      pathKey: path.join(tmp, `p-${i}.txt`),
      size: 0,
      sessionId: 's1',
      toolName: 'Write',
    })),
    retired: { markers: 0, preimages: 0, bytes: 0 },
  };
}

describe('§5.26 (H) 캡에 밀려난 줄의 바이트를 그 자리에서 회수한다', () => {
  it('사본 줄이 상한을 넘으면 밀려난 줄의 blob 이 디스크에서도 사라진다', () => {
    const cap = INSURANCE_PREIMAGES_MAX_PER_PROJECT;
    for (let i = 0; i < cap + 5; i += 1) addPreimage(`body-${i}`);

    const led = ledger.full(PROJECT);
    expect(led?.preimages.length).toBe(cap);
    expect(led?.retired?.preimages).toBe(5);
    // 종전에는 줄만 잘리고 디스크는 그대로라 여기서 `cap + 5` 가 나왔다 — 그 차이가 곧 고아다.
    expect(blobsOnDisk().size).toBe(cap);
    expect(blobsOnDisk()).toEqual(referencedShas());
    expect(led?.retired?.bytes).toBeGreaterThan(0);
  }, CAP_WALK_TIMEOUT_MS);

  it('남은 줄이 아직 가리키는 해시는 지우지 않는다 — 한 벌을 여럿이 가리킨다', () => {
    // 같은 내용으로 두 줄(= blob 한 벌). 그 뒤 상한을 **딱 하나만** 넘겨 옛 쪽 한 줄만 밀어낸다.
    const shared = writeFile('shared.txt', 'same-bytes');
    for (let i = 0; i < 2; i += 1) {
      ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: shared, toolName: 'Write' });
    }
    const sha = ledger.full(PROJECT)?.preimages[0]?.sha256;
    expect(sha).toBeTruthy();

    for (let i = 0; i < INSURANCE_PREIMAGES_MAX_PER_PROJECT - 1; i += 1) addPreimage(`filler-${i}`);

    expect(ledger.full(PROJECT)?.retired?.preimages).toBe(1); // 공유 줄 하나만 밀려났다
    // 살아 있는 다른 줄이 아직 가리키므로 blob 은 남아야 한다 — 지우면 그 줄의 되돌리기가 조용히 죽는다.
    expect(blobsOnDisk().has(sha!)).toBe(true);
    expect(vault.readBlob(PROJECT, sha!)).not.toBeNull();
  }, CAP_WALK_TIMEOUT_MS);

  it('마커가 상한을 넘으면 밀려난 세션의 미러도 회수된다', () => {
    const cap = INSURANCE_MARKERS_MAX_PER_PROJECT;
    const transcriptPath = writeTranscript();
    for (let i = 0; i < cap + 3; i += 1) {
      const m = ledger.recordCompact({
        projectName: PROJECT, sessionId: `s-${i}`, trigger: 'auto', transcriptPath,
      })!;
      ledger.mirrorFor(m.id, PROJECT);
    }
    expect(ledger.full(PROJECT)?.markers.length).toBe(cap);
    // 마커가 없으면 그 미러에는 닿을 길이 아예 없다 — 부활 후보 목록이 `markers` 를 돌기 때문이다.
    expect(mirrorsOnDisk().size).toBe(cap);
    expect(mirrorsOnDisk().has('s-0')).toBe(false);
    expect(mirrorsOnDisk().has(`s-${cap + 2}`)).toBe(true);
  });

  it('같은 세션의 마커가 아직 남아 있으면 미러는 살려 둔다', () => {
    const cap = INSURANCE_MARKERS_MAX_PER_PROJECT;
    const transcriptPath = writeTranscript();
    // 미러는 세션당 한 벌이고 마커는 압축마다 선다 — 한 마커가 밀려나도 다른 마커가 아직 쓴다.
    for (let i = 0; i < 2; i += 1) {
      const m = ledger.recordCompact({
        projectName: PROJECT, sessionId: 'shared-session', trigger: 'auto', transcriptPath,
      })!;
      ledger.mirrorFor(m.id, PROJECT);
    }
    for (let i = 0; i < cap - 1; i += 1) {
      ledger.recordCompact({ projectName: PROJECT, sessionId: `s-${i}`, trigger: 'auto', transcriptPath });
    }
    expect(ledger.full(PROJECT)?.retired?.markers).toBe(1);
    expect(mirrorsOnDisk().has('shared-session')).toBe(true);
  });

  it('회수한 바이트는 `retired.bytes` 로 접힌다 — 숫자는 줄지 않는다', () => {
    for (let i = 0; i < INSURANCE_PREIMAGES_MAX_PER_PROJECT + 2; i += 1) addPreimage(`b-${i}`);
    expect(ledger.full(PROJECT)?.retired?.bytes).toBeGreaterThan(0);
  }, CAP_WALK_TIMEOUT_MS);
});

describe('§5.26 (H) 보존 한 바퀴 — 부팅 정리가 부르는 그 길', () => {
  it('마커·사본 두 캡이 **둘 다** 적용된다 — `||` 로 묶으면 뒤가 안 돈다', () => {
    ledger.restore(overCapLedger(INSURANCE_MARKERS_MAX_PER_PROJECT + 2, INSURANCE_PREIMAGES_MAX_PER_PROJECT + 2));
    ledger.applyRetention();
    const led = ledger.full(PROJECT);
    expect(led?.markers.length).toBe(INSURANCE_MARKERS_MAX_PER_PROJECT);
    expect(led?.preimages.length).toBe(INSURANCE_PREIMAGES_MAX_PER_PROJECT);
  });

  it('원장이 안 가리키는 미러까지 걷어 낸다 — blob 만 걷고 미러는 두던 비대칭', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'gone', trigger: 'auto', transcriptPath,
    })!;
    ledger.mirrorFor(m.id, PROJECT);
    expect(mirrorsOnDisk().has('gone')).toBe(true);

    // 마커가 사라진 원장(= 옛 판본이 남긴 상태)을 세우고 한 바퀴 돌린다.
    const fresh = makeLedger();
    fresh.restore(emptyLedger(1));
    fresh.applyRetention();
    expect(mirrorsOnDisk().has('gone')).toBe(false);
  });

  it('살아 있는 세션의 미러는 마커가 없어도 남긴다 (§3.2.3 규칙 2)', () => {
    const transcriptPath = writeTranscript();
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'alive', trigger: 'auto', transcriptPath,
    })!;
    ledger.mirrorFor(m.id, PROJECT);

    const fresh = makeLedger();
    fresh.liveSessions = () => new Set(['alive']);
    fresh.restore(emptyLedger(1));
    fresh.applyRetention();
    // 압축이 이제 막 시작된 세션의 사본을 먼저 지우면, 그 세션이 죽었을 때 되살릴 것이 없다.
    expect(mirrorsOnDisk().has('alive')).toBe(true);
  });

  it('나이가 지난 줄은 만료되고 그 바이트도 함께 회수된다', () => {
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const p = writeFile('aged.txt', 'aged-body');
    ledger.recordPreimage({ projectName: PROJECT, sessionId: 's1', absPath: p, toolName: 'Write', at: old });
    expect(blobsOnDisk().size).toBe(1);

    retention = { ...DEFAULT_RETENTION_SETTINGS, insuranceRetentionDays: 14 };
    ledger.applyRetention();
    expect(ledger.full(PROJECT)?.preimages.length).toBe(0);
    expect(blobsOnDisk().size).toBe(0);
  });
});

describe('§5.26 (H) measure() — 훅 경로에서 금고를 다시 훑지 않는다', () => {
  it('반복해서 물어도 폴더를 다시 읽지 않는다 — 이 자리가 매 도구 호출마다 돈다', () => {
    for (let i = 0; i < 5; i += 1) addPreimage(`r-${i}`);

    const cold = newVault();
    const spy = vi.spyOn(fs, 'readdirSync');
    cold.measure(PROJECT);
    // 먼저 **감시가 실제로 걸린다는 것**을 확인한다 — 안 걸리면 아래 단언이 공허하게 통과한다.
    expect(spy.mock.calls.length).toBeGreaterThan(0);

    spy.mockClear();
    for (let i = 0; i < 20; i += 1) cold.measure(PROJECT);
    expect(spy).not.toHaveBeenCalled();
  });

  it('쓰고 버린 뒤에도 갓 잰 값과 같다 — 델타 장부가 표류하지 않는다', () => {
    const transcriptPath = writeTranscript();
    for (let i = 0; i < 12; i += 1) addPreimage(`m-${i}`);
    const m = ledger.recordCompact({
      projectName: PROJECT, sessionId: 'sess-m', trigger: 'auto', transcriptPath,
    })!;
    ledger.mirrorFor(m.id, PROJECT);

    // 차가운 저장고(캐시 없음)는 디스크를 실제로 센다. 이어 온 값과 같아야 한다.
    expect(vault.measure(PROJECT)).toBe(newVault().measure(PROJECT));

    // 버리는 쪽도 같은 장부를 탄다.
    vault.dropMirror(PROJECT, 'sess-m');
    expect(vault.measure(PROJECT)).toBe(newVault().measure(PROJECT));
  });

  it('캡 회수를 한참 겪은 뒤에도 갓 잰 값과 같다', () => {
    for (let i = 0; i < INSURANCE_PREIMAGES_MAX_PER_PROJECT + 20; i += 1) addPreimage(`d-${i}`);
    expect(vault.measure(PROJECT)).toBe(newVault().measure(PROJECT));
  }, CAP_WALK_TIMEOUT_MS);

  it('보존 한 바퀴는 캐시를 버리고 다시 잰다 — 바깥에서 폴더가 바뀌었을 수 있다', () => {
    for (let i = 0; i < 3; i += 1) addPreimage(`c-${i}`);
    const before = vault.measure(PROJECT);
    expect(before).toBeGreaterThan(0);

    // 바깥에서 통째로 지운다(사용자 삭제·휴지통 비우기).
    fs.rmSync(path.join(saveDir, 'insurance', 'blobs'), { recursive: true, force: true });
    expect(vault.measure(PROJECT)).toBe(before); // 아직 캐시가 그대로다

    ledger.applyRetention();
    expect(vault.measure(PROJECT)).toBe(0);
  });
});
