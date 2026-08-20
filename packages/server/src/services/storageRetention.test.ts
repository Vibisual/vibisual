/**
 * §3.2.3 **파일 쪽** 보존 정책 회귀 테스트 — `retentionPolicy.test.ts` 가 체크포인트 안쪽(편집 이력·
 * 말풍선)을 지킨다면 이쪽은 디스크에 따로 놓인 것(sub-streams jsonl · attachments · 휴지통)을 지킨다.
 *
 * 여기서 못 박는 것은 "지워지는가" 가 아니라 **지워지지 않아야 할 것이 지워지지 않는가** 다.
 * 실제로 잃기 직전까지 갔던 세 지점을 그대로 재현해 둔다(실측 2026-08-19):
 *  1. 탭 닫힌(아카이브) 서브에이전트의 대화 — 목록에는 남는데 파일이 지워져 "누르면 빈 화면" 이었다.
 *  2. 참조 중인 첨부 — 위성 파일 노드·완료 명령이 가리키는데 나이만 보고 지웠다.
 *  3. 살아있는 폴더 — 부모 폴더 mtime 은 손자 파일 추가를 추적하지 못해 방금 쓴 이미지까지 후보가 됐다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectInfo, RetentionSettings } from '@vibisual/shared';
import { DEFAULT_RETENTION_SETTINGS } from '@vibisual/shared';

// 보존 설정은 머신 단위(`~/.vibisual/app-state.json`) — 테스트가 사용자 실제 설정을 읽거나 쓰면 안 된다.
const retention = vi.hoisted(() => ({ current: null as RetentionSettings | null }));
vi.mock('./appState.js', () => ({
  appStateGetRetention: (): RetentionSettings => retention.current as RetentionSettings,
}));

const {
  pruneSubStreams,
  pruneAttachments,
  pruneTrash,
  listTrash,
  restoreFromTrash,
  runStorageCleanup,
  scanProjectStorage,
} = await import('./storageRetention.js');

const DAY = 24 * 60 * 60 * 1000;

let tmpRoot: string;
let project: ProjectInfo;
let saveDir: string;
let attachRoot: string;
let trashRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-storage-')));
  project = { name: 'proj', path: tmpRoot };
  saveDir = path.join(tmpRoot, '.vibisual', 'save');
  attachRoot = path.join(tmpRoot, '.vibisual', 'attachments');
  trashRoot = path.join(saveDir, 'trash');
  fs.mkdirSync(saveDir, { recursive: true });
  retention.current = { ...DEFAULT_RETENTION_SETTINGS };
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 파일을 쓰고 나이를 강제로 늙힌다(mtime 조작 — 판정이 mtime 이라 시계를 돌릴 필요가 없다). */
function writeAged(abs: string, body: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  if (ageDays > 0) {
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(abs, t, t);
  }
}

/** 체크포인트를 "이 첨부들을 참조하는 상태" 로 만든다 — 참조 수집이 문자열 훑기라 형태만 같으면 된다. */
function writeCheckpointReferencing(names: string[]): void {
  const nodes: Record<string, unknown> = {};
  for (const n of names) nodes[`.vibisual/attachments/sess-a/sub-live/${n}`] = { path: `.vibisual/attachments/sess-a/sub-live/${n}` };
  fs.writeFileSync(path.join(saveDir, 'checkpoint.json'), JSON.stringify({ graph: { nodes } }), 'utf8');
}

describe('pruneSubStreams — 규칙 1(살아있는 것 + 아카이브는 나이 무관 보존)', () => {
  function seedStream(subId: string, ageDays: number): string {
    const fp = path.join(saveDir, 'sub-streams', 'agent-1', `${subId}.jsonl`);
    writeAged(fp, '{"t":1}\n', ageDays);
    return fp;
  }

  it('보호 목록에 든 서브에이전트의 스트림은 만료돼도 남는다 — registry 든 archive 든', () => {
    const live = seedStream('sub-live', 90);
    const archived = seedStream('sub-archived', 90);
    const orphan = seedStream('sub-orphan', 90);

    const r = pruneSubStreams([saveDir], new Set(['sub-live', 'sub-archived']), 30);

    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(r.removedFiles).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it('아카이브를 보호 목록에서 빼면 그 대화가 사라진다 — 회귀하면 이 테스트가 먼저 깨진다', () => {
    const archived = seedStream('sub-archived', 90);
    pruneSubStreams([saveDir], new Set<string>(), 30); // 종전 동작(registry 만)
    expect(fs.existsSync(archived)).toBe(false);
  });

  it('만료 전 파일은 건드리지 않고, 0(무제한)이면 아무것도 지우지 않는다', () => {
    const fresh = seedStream('sub-fresh', 3);
    const old = seedStream('sub-old', 90);

    expect(pruneSubStreams([saveDir], new Set(), 30).removedFiles).toBe(1);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(old)).toBe(false);

    const old2 = seedStream('sub-old2', 999);
    expect(pruneSubStreams([saveDir], new Set(), 0).removedFiles).toBe(0);
    expect(fs.existsSync(old2)).toBe(true);
  });

  it('지운 것은 사라지지 않고 휴지통에 남는다(규칙 3) — 복원 후보가 된다', () => {
    seedStream('sub-orphan', 90);
    pruneSubStreams([saveDir], new Set(), 30);
    expect(fs.existsSync(path.join(trashRoot, 'sub-streams', 'agent-1', 'sub-orphan.jsonl'))).toBe(true);
  });
});

describe('pruneAttachments — 규칙 2(참조되는 것은 나이 무관 보존)', () => {
  it('체크포인트가 이름을 가리키는 첨부는 만료돼도 남고, 고아만 치운다', () => {
    const kept = path.join(attachRoot, 'sess-a', 'sub-live', 'kept.png');
    const orphan = path.join(attachRoot, 'sess-a', 'sub-live', 'orphan.png');
    writeAged(kept, 'k', 90);
    writeAged(orphan, 'o', 90);
    writeCheckpointReferencing(['kept.png']);

    const r = pruneAttachments([project], new Set(), 30);

    expect(fs.existsSync(kept)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(r.removedFiles).toBe(1);
    expect(r.keptReferenced).toBe(1);
  });

  it('그 대화를 보존 중이면(살아있음·아카이브) 참조 문자열이 없어도 첨부를 남긴다', () => {
    const inProtected = path.join(attachRoot, 'sess-a', 'sub-keepme', 'shot.png');
    writeAged(inProtected, 's', 90);
    writeCheckpointReferencing([]); // 아무것도 참조하지 않는 체크포인트

    const r = pruneAttachments([project], new Set(['sub-keepme']), 30);

    expect(fs.existsSync(inProtected)).toBe(true);
    expect(r.keptReferenced).toBe(1);
    expect(r.removedFiles).toBe(0);
  });

  it('나이는 폴더가 아니라 **파일** 기준 — 오래된 폴더 안의 새 파일은 살아남는다', () => {
    const sessDir = path.join(attachRoot, 'sess-old');
    const fresh = path.join(sessDir, 'sub-x', 'fresh.png');
    const stale = path.join(sessDir, 'sub-x', 'stale.png');
    writeAged(stale, 'st', 90);
    writeAged(fresh, 'fr', 0);
    // 세션 폴더 자체를 아주 늙힌다 — 종전 판정(폴더 mtime)이면 통째로 지워졌다.
    const t = new Date(Date.now() - 400 * DAY);
    fs.utimesSync(sessDir, t, t);
    writeCheckpointReferencing([]);

    const r = pruneAttachments([project], new Set(), 30);

    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
    expect(r.removedFiles).toBe(1);
  });

  it('참조 목록을 읽을 수 없으면 아예 건드리지 않는다 — "판단이 서지 않으면 지우지 않는다"', () => {
    const orphan = path.join(attachRoot, 'sess-a', 'sub-a', 'orphan.png');
    writeAged(orphan, 'o', 90);
    // checkpoint.json / activity.json 이 없다 = 참조를 확정할 수 없다.

    const r = pruneAttachments([project], new Set(), 30);

    expect(fs.existsSync(orphan)).toBe(true);
    expect(r.removedFiles).toBe(0);
    expect(r.skippedProjects).toBe(1);
  });

  it('0(무제한)이면 만료·고아여도 지우지 않는다', () => {
    const orphan = path.join(attachRoot, 'sess-a', 'sub-a', 'orphan.png');
    writeAged(orphan, 'o', 999);
    writeCheckpointReferencing([]);

    expect(pruneAttachments([project], new Set(), 0).removedFiles).toBe(0);
    expect(fs.existsSync(orphan)).toBe(true);
  });

  it('활동 이력(activity.json)만 가리켜도 보존된다 — 완료 명령 썸네일이 사는 자리', () => {
    const kept = path.join(attachRoot, 'sess-a', 'sub-a', 'thumb.png');
    writeAged(kept, 'k', 90);
    fs.writeFileSync(path.join(saveDir, 'activity.json'), JSON.stringify({
      completedCommands: { 'sess-a': [{ attachments: [`${tmpRoot}/.vibisual/attachments/sess-a/sub-a/thumb.png`] }] },
    }), 'utf8');

    const r = pruneAttachments([project], new Set(), 30);
    expect(fs.existsSync(kept)).toBe(true);
    expect(r.keptReferenced).toBe(1);
  });
});

describe('휴지통 — 규칙 3(되돌릴 수 있게) · 규칙 4(무엇을 치웠는지 보인다)', () => {
  function seedTrashedAttachment(ageDays = 0): string {
    const orphan = path.join(attachRoot, 'sess-a', 'sub-a', 'gone.png');
    writeAged(orphan, 'body', 90);
    writeCheckpointReferencing([]);
    pruneAttachments([project], new Set(), 30);
    const inTrash = path.join(trashRoot, 'attachments', 'sess-a', 'sub-a', 'gone.png');
    if (ageDays > 0) {
      const t = new Date(Date.now() - ageDays * DAY);
      fs.utimesSync(inTrash, t, t);
    }
    return inTrash;
  }

  it('치운 파일은 휴지통에 있고 목록에 뜬다 — 원래 경로까지 함께', () => {
    const inTrash = seedTrashedAttachment();
    expect(fs.existsSync(inTrash)).toBe(true);

    const { entries, totalBytes } = listTrash([project]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('attachments');
    expect(entries[0]!.trashRel).toBe('attachments/sess-a/sub-a/gone.png');
    expect(entries[0]!.originalPath.endsWith('/.vibisual/attachments/sess-a/sub-a/gone.png')).toBe(true);
    expect(totalBytes).toBeGreaterThan(0);
  });

  it('복원하면 원래 자리로 돌아오고 휴지통에서는 빠진다', () => {
    seedTrashedAttachment();
    const original = path.join(attachRoot, 'sess-a', 'sub-a', 'gone.png');
    expect(fs.existsSync(original)).toBe(false);

    const r = restoreFromTrash(project, 'attachments/sess-a/sub-a/gone.png');

    expect(r.ok).toBe(true);
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.readFileSync(original, 'utf8')).toBe('body');
    expect(listTrash([project]).entries).toHaveLength(0);
  });

  it('원래 자리에 파일이 있으면 덮어쓰지 않고 실패한다 — 복원이 지금 것을 지우면 안 된다', () => {
    seedTrashedAttachment();
    const original = path.join(attachRoot, 'sess-a', 'sub-a', 'gone.png');
    writeAged(original, 'newer', 0);

    const r = restoreFromTrash(project, 'attachments/sess-a/sub-a/gone.png');

    expect(r.ok).toBe(false);
    expect(fs.readFileSync(original, 'utf8')).toBe('newer');
  });

  it('휴지통 밖을 가리키는 요청은 거부한다(경로 탈출)', () => {
    seedTrashedAttachment();
    expect(restoreFromTrash(project, '../checkpoint.json').ok).toBe(false);
    expect(restoreFromTrash(project, 'attachments/../../checkpoint.json').ok).toBe(false);
    expect(fs.existsSync(path.join(saveDir, 'checkpoint.json'))).toBe(true);
  });

  it('휴지통 보존일이 지나면 영구 삭제하고, 0이면 영구 보관한다', () => {
    const inTrash = seedTrashedAttachment(30);
    expect(pruneTrash([saveDir], 0).purgedFiles).toBe(0);
    expect(fs.existsSync(inTrash)).toBe(true);

    const r = pruneTrash([saveDir], 14);
    expect(r.purgedFiles).toBe(1);
    expect(r.purgedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(inTrash)).toBe(false);
  });

  it('방금 치운 것은 같은 회차의 휴지통 정리에 걸리지 않는다', () => {
    const inTrash = seedTrashedAttachment(0);
    expect(pruneTrash([saveDir], 14).purgedFiles).toBe(0);
    expect(fs.existsSync(inTrash)).toBe(true);
  });

  it('저장소 사용량에 휴지통이 따로 잡힌다 — "정리했는데 왜 안 줄었나" 가 보이게', () => {
    seedTrashedAttachment();
    const usage = scanProjectStorage(project);
    expect(usage.entries.find((e) => e.kind === 'trash')?.bytes).toBeGreaterThan(0);
  });
});

describe('runStorageCleanup — 결과 보고(규칙 4)', () => {
  it('보존한 것·치운 것·영구 삭제한 것을 각각 돌려준다', () => {
    // 고아 첨부 1건 + 참조된 첨부 1건 + 보호된 스트림 1건 + 만료된 휴지통 1건.
    // 고아는 **보호 목록에 없는** 서브 폴더에 둔다 — 같은 폴더에 두면 규칙 2(b)로 보존돼 후보가 아니다.
    writeAged(path.join(attachRoot, 'sess-a', 'sub-live', 'kept.png'), 'k', 90);
    writeAged(path.join(attachRoot, 'sess-a', 'sub-dead', 'orphan.png'), 'o', 90);
    writeCheckpointReferencing(['kept.png']);
    writeAged(path.join(saveDir, 'sub-streams', 'agent-1', 'sub-live.jsonl'), '{}\n', 90);
    writeAged(path.join(trashRoot, 'attachments', 'old', 'x.png'), 'x', 60);

    const result = runStorageCleanup({ projects: [project], protectedSubAgentIds: new Set(['sub-live']) });

    expect(result.removedFiles).toBe(1); // 고아 첨부만
    expect(result.keptReferenced).toBe(1);
    expect(result.purgedFiles).toBe(1); // 만료된 휴지통
    expect(result.skipped).toContain('protected-sub-streams:1');
    expect(result.skipped).toContain('referenced-attachments:1');
    expect(fs.existsSync(path.join(saveDir, 'sub-streams', 'agent-1', 'sub-live.jsonl'))).toBe(true);
  });

  it('보존일이 전부 0이면 아무것도 치우지 않고 그 사실을 알려 준다', () => {
    retention.current = {
      ...DEFAULT_RETENTION_SETTINGS,
      subStreamRetentionDays: 0,
      attachmentRetentionDays: 0,
      trashRetentionDays: 0,
    };
    writeAged(path.join(attachRoot, 'sess-a', 'sub-a', 'orphan.png'), 'o', 999);
    writeCheckpointReferencing([]);

    const result = runStorageCleanup({ projects: [project], protectedSubAgentIds: new Set() });

    expect(result.removedFiles).toBe(0);
    expect(result.skipped).toContain('attachments:disabled');
    expect(result.skipped).toContain('sub-streams:disabled');
    expect(result.skipped).toContain('trash:kept-forever');
  });
});
