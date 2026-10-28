/**
 * §5.25 (F) "쓴 내용도 남는다" — 코덱스 `apply_patch` 의 바뀐 덩어리를 적어 두는 장부. `codex exec --json` 의 `file_change` 는 `{path, kind}` 만 싣는다(공개 소스 `exec_events.rs` 의 `FileUpdateChange`).
 * 내용은 앱 소유 사전 훅(`PreToolUse(apply_patch)`, §5.25 (H))이 받는 패치 본문에 있다 — 허락된 패치를 파일별로 그 sub 칸에 적고, 그 파일의 완료가 오면 꺼내 수정 이력으로 넘긴다.
 * - 디스크를 뜨지 않는다: `item.started` 는 부수효과보다 늦게 오고, 앞뒤 전체 비교는 한 줄 고친 큰 파일을 수천 줄 이력으로 만든다.
 * - 칸이 없으면(훅이 못 붙은 턴) 지어내지 않는다 — 버블과 화살표만 선다.
 * - 키는 `sub × pathKey(절대경로)` — 머리줄 `C:/…`·상대경로와 완료 `C:\…` 의 차이를 `pathKey()` 에 맡긴다(Linux 는 접지 않음). 플랫폼은 인자(세 OS 시험용).
 */
import path from 'node:path';
import {
  CODEX_PATCH_PENDING_MAX,
  auditPatchText,
  capMapSize,
  clampEditSide,
  joinEditHunks,
  parseApplyPatch,
  pathKey,
  type EditToolHunk,
  type PlatformName,
} from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';

/** 수정 이력 한 줄의 재료 — 이미 잇고 자른 본문이다(받는 쪽은 다시 자르지 않는다 — 표식이 두 번 붙는다). */
export interface CodexPatchFileEdit {
  /** `<사전 훅 tool_use_id>:<pathKey>` — 한 패치가 여러 파일을 고쳐도 서로의 이력을 지우지 않게 경로까지 넣는다. */
  id: string;
  oldString: string;
  newString: string;
}

/** 사전 훅이 실어 오는 것. */
export interface CodexPatchNote {
  /** 그 훅의 작업 폴더 — 머리줄의 상대경로를 올리는 기준. */
  cwd: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
}

const KEY_SEP = '\u0000';

export class CodexPatchEditLedger {
  private readonly pending = new Map<string, CodexPatchFileEdit>();
  private fallbackSeq = 0;

  constructor(
    private readonly platform: PlatformName = HOST_PLATFORM,
    private readonly max: number = CODEX_PATCH_PENDING_MAX,
  ) {}

  /** 머리줄과 완료를 같은 키로 — 상대경로는 그 턴의 작업 폴더로 올린 뒤 `pathKey` 로 접는다. */
  private keyOf(owner: string, rawPath: string, cwd: string): { key: string; fileKey: string } {
    const p = this.platform === 'win32' ? path.win32 : path.posix;
    const abs = p.isAbsolute(rawPath) || !cwd ? rawPath : p.resolve(cwd, rawPath);
    const fileKey = pathKey(abs, this.platform);
    return { key: `${owner}${KEY_SEP}${fileKey}`, fileKey };
  }

  /**
   * 사전 훅이 허락한 패치를 적고 적은 파일 수를 돌려준다(패치 도구가 아니거나 바뀐 줄이 없으면 0).
   * 지우기(`Delete File`)는 적지 않는다 — 지운 본문이 없고, 사라진 파일은 존재 확인 스윕이 Ghost 로 돌린다(§2.1 쓰기 축).
   * 한 패치에 같은 파일이 두 번 나오면 덩어리를 잇는다 — 덮으면 이력이 반만 남는다.
   */
  note(owner: string, input: CodexPatchNote): number {
    if (!owner) return 0;
    const text = auditPatchText(input.toolName, input.toolInput);
    if (!text) return 0;
    const byFile = new Map<string, { fileKey: string; hunks: EditToolHunk[] }>();
    for (const file of parseApplyPatch(text)) {
      if (file.op === 'delete' || file.hunks.length === 0) continue;
      const { key, fileKey } = this.keyOf(owner, file.path, input.cwd);
      const slot = byFile.get(key);
      if (slot) slot.hunks.push(...file.hunks);
      else byFile.set(key, { fileKey, hunks: [...file.hunks] });
    }
    const base = input.toolUseId || `codex-patch-${Date.now()}-${++this.fallbackSeq}`;
    for (const [key, { fileKey, hunks }] of byFile) {
      const joined = joinEditHunks(hunks);
      // 다시 적으면 가장 새것이 된다 — 상한이 가장 오래된 칸부터 걷으므로 지우고 넣는다.
      this.pending.delete(key);
      this.pending.set(key, {
        id: `${base}:${fileKey}`,
        oldString: clampEditSide(joined.oldString),
        newString: clampEditSide(joined.newString),
      });
    }
    capMapSize(this.pending, this.max);
    return byFile.size;
  }

  /** 그 파일의 `file_change` 완료에서 — 칸을 꺼내고 지운다. 없으면 null(지어내지 않는다). */
  take(owner: string, filePath: string, cwd: string): CodexPatchFileEdit | null {
    if (!owner || !filePath) return null;
    const { key } = this.keyOf(owner, filePath, cwd);
    const hit = this.pending.get(key);
    if (!hit) return null;
    this.pending.delete(key);
    return hit;
  }

  /** 그 sub 의 턴이 시작될 때 — 지난 턴에 적용되지 못한 칸이 이번 턴의 같은 파일에 붙지 않게 통째로 비운다. */
  clearOwner(owner: string): void {
    const prefix = `${owner}${KEY_SEP}`;
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }

  /** 지금 붙들고 있는 칸 수(시험·진단용). */
  get size(): number {
    return this.pending.size;
  }
}
