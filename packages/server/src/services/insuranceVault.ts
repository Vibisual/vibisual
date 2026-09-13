// SCENARIO.md §5.26 (A) — 컨텍스트 보험 저장고.
//
// **바이트는 디스크, 색인은 체크포인트.** 여기 앉는 것은 상태 JSON 이 아니라 **내용 바이트**라
// §3.2 "별도 JSON 저장 금지"의 새 예외가 아니다 — 이미 같은 규율로 사는 `sub-streams/<agentId>/…`
// (스트림 버퍼)와 같은 부류다. 색인(`ProjectInsuranceLedger`)만 체크포인트를 지난다.
//
// 두 갈래:
//   `insurance/blobs/<앞2자>/<sha256>`   — 내용 주소 지정. 같은 내용은 한 벌만 남는다.
//   `insurance/transcripts/<sessionId>.jsonl` — 미러. JSONL 이 append-only 라 **붙은 바이트만** 잇는다.
//
// **모든 실패는 삼킨다.** 보험이 실패해서 압축이 멈추거나 도구 호출이 막히면 그건 보험이 아니라
// 사고다. 실패하면 `null`/`false` 를 돌려주고 호출부는 "사본이 없다"로 적는다 — 없는데 있다고
// 적지 않는 것이 이 기능의 유일한 약속이다(§5.26 (A) 마지막 항목).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sessionTitleFromPrompt } from '@vibisual/shared';
import {
  INSURANCE_BLOBS_DIR,
  INSURANCE_DIR,
  INSURANCE_HEAD_HASH_BYTES,
  INSURANCE_PREIMAGE_MAX_BYTES,
  INSURANCE_SUMMARY_SCAN_MAX_BYTES,
  INSURANCE_TITLE_SCAN_MAX_BYTES,
  INSURANCE_TRANSCRIPTS_DIR,
} from '@vibisual/shared';
import { moveFileToTrash } from './storageRetention.js';

/** 저장고가 바깥에 대해 아는 전부 — 그래프도 앱 상태도 물지 않는다(시험이 임시 폴더를 준다). */
export interface InsuranceVaultDeps {
  /** 그 프로젝트의 `<projectPath>/.vibisual/save` 절대경로. 모르면 `null`. */
  resolveSaveDir: (projectName: string) => string | null;
  log?: (message: string, err: unknown) => void;
}

export interface StoredBlob {
  sha256: string;
  size: number;
}

/** 사본을 못 뜬 이유 — 호출부가 그대로 원장에 적는다. */
export type VaultSkip = 'too-large' | 'unreadable' | 'budget';

export interface PreimageResult {
  /** 파일이 **없었다**면 `absent: true` — 되돌리기는 삭제가 된다. */
  absent?: boolean;
  blob?: StoredBlob;
  skipped?: VaultSkip;
}

export class InsuranceVault {
  constructor(private deps: InsuranceVaultDeps) {}

  /**
   * 프로젝트별 저장고 크기 — **매번 재는 값이 아니라 이어 가는 값**이다.
   *
   * 예산 판정(`enforceVaultBudget`)은 사본 한 줄이 앉을 때마다 부르는데, 그것이 곧 **훅 경로**다
   * (`PreToolUse` 의 Bash·Write·Edit 하나하나). 종전에는 그 자리에서 `blobs/` + `transcripts/` 를
   * 통째로 재귀 스캔했다 — 예산에 한참 못 미쳐도 했다. 금고가 클수록 훅이 느려지는 구조라,
   * 파일 500개면 쓰기 한 번에 `stat` 이 500번 넘게 돌았다(§9 가 잡았던 "전량 재파싱" 과 같은 모양).
   *
   * 그래서 **처음 한 번만 재고, 그 뒤로는 우리가 쓴 만큼 더하고 버린 만큼 뺀다.** 저장고를 바꾸는
   * 자리는 이 파일 안에 닫혀 있어(`putBlob`·`mirrorTranscript`·`dropMirror`·`releaseBlob`·prune 둘)
   * 델타를 흘릴 곳이 없다. 그래도 바깥에서 폴더가 바뀔 수는 있으므로(사용자 삭제·휴지통 비우기)
   * 보존 정리는 `invalidateMeasure()` 로 캐시를 버리고 시작한다 — 그 한 번이 표류를 되돌린다.
   */
  private measured = new Map<string, number>();

  /** 캐시가 서 있을 때만 델타를 얹는다. 없으면 다음 `measure()` 가 한 번 제대로 재고 시작한다. */
  private addMeasured(projectName: string, delta: number): void {
    const cur = this.measured.get(projectName);
    if (cur === undefined) return;
    this.measured.set(projectName, Math.max(0, cur + delta));
  }

  /**
   * 캐시를 버린다 — 다음 `measure()` 가 디스크를 다시 센다.
   * 인자가 없으면 전부(시험·설정 변경처럼 어느 프로젝트가 바뀌었는지 모를 때).
   */
  invalidateMeasure(projectName?: string): void {
    if (projectName === undefined) this.measured.clear();
    else this.measured.delete(projectName);
  }

  private log(message: string, err: unknown): void {
    this.deps.log?.(message, err);
  }

  /** `<save>/insurance` — 없으면 만들지 않는다(읽기 경로가 부작용을 내면 안 된다). */
  dir(projectName: string): string | null {
    const saveDir = this.deps.resolveSaveDir(projectName);
    return saveDir ? path.join(saveDir, INSURANCE_DIR) : null;
  }

  private ensureDir(p: string): boolean {
    try {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      return true;
    } catch (err) {
      this.log(`[insurance] mkdir failed: ${p}`, err);
      return false;
    }
  }

  // ─── blobs (내용 주소 지정) ───

  private blobPath(root: string, sha: string): string {
    return path.join(root, INSURANCE_BLOBS_DIR, sha.slice(0, 2), sha);
  }

  /**
   * 바이트 한 덩이를 저장고에 앉힌다. **이미 같은 내용이 있으면 쓰지 않는다** —
   * `sed` 로 같은 파일을 다섯 번 고쳐도 사본은 내용이 실제로 바뀐 횟수만큼이다.
   */
  putBlob(projectName: string, data: Buffer): StoredBlob | null {
    const root = this.dir(projectName);
    if (!root) return null;
    const sha = createHash('sha256').update(data).digest('hex');
    const fp = this.blobPath(root, sha);
    try {
      if (fs.existsSync(fp)) return { sha256: sha, size: data.length };
      if (!this.ensureDir(path.dirname(fp))) return null;
      writeBufferAtomic(fp, data);
      this.addMeasured(projectName, data.length);
      return { sha256: sha, size: data.length };
    } catch (err) {
      this.log(`[insurance] putBlob failed: ${sha}`, err);
      return null;
    }
  }

  /**
   * blob 한 덩이를 **표적으로** 놓는다 — 줄이 캡에 밀려 나갔을 때 그 바이트를 같이 회수한다.
   *
   * `pruneOrphanBlobs` 와 하는 일은 같지만 **폴더를 훑지 않는다.** 캡(500줄)에 닿은 저장고는
   * 사본이 앉을 때마다 한 줄이 밀려나므로, 그 자리에서 전수 스캔을 부르면 쓰기마다 금고를
   * 통째로 읽게 된다. 지울 대상을 이미 아는 자리에서는 그 하나만 놓는 것이 맞다.
   *
   * **참조가 남아 있는지는 부르는 쪽이 판정한다** — 내용 주소 지정이라 같은 해시를 여러 줄이
   * 가리킬 수 있고, 그 판정은 원장만 할 수 있다(§5.26 (H) "삭제 후보는 고아뿐").
   * 돌려주는 값은 실제로 회수한 바이트이며, 못 옮겼으면 `0` 이다(남긴다 — 못 옮긴 것을 지우면 손실이다).
   */
  releaseBlob(projectName: string, sha: string): number {
    const root = this.dir(projectName);
    if (!root) return 0;
    const fp = this.blobPath(root, sha);
    try {
      const size = fs.statSync(fp).size;
      if (!this.toTrash(projectName, fp)) return 0;
      this.addMeasured(projectName, -size);
      return size;
    } catch {
      return 0; // 이미 없다 — 회수할 것도 없다
    }
  }

  readBlob(projectName: string, sha: string): Buffer | null {
    const root = this.dir(projectName);
    if (!root) return null;
    try {
      return fs.readFileSync(this.blobPath(root, sha));
    } catch {
      return null; // 예산에 밀려 지워진 blob — 호출부가 "되돌릴 수 없다"로 적는다
    }
  }

  hasBlob(projectName: string, sha: string): boolean {
    const root = this.dir(projectName);
    if (!root) return false;
    try {
      return fs.existsSync(this.blobPath(root, sha));
    } catch {
      return false;
    }
  }

  /** 참조되지 않는 blob 만 지운다 — 삭제 후보는 **고아뿐**이다(§5.26 (H)). */
  pruneOrphanBlobs(projectName: string, referenced: ReadonlySet<string>): { removed: number; bytes: number } {
    const root = this.dir(projectName);
    const out = { removed: 0, bytes: 0 };
    if (!root) return out;
    const base = path.join(root, INSURANCE_BLOBS_DIR);
    let shards: string[];
    try {
      shards = fs.readdirSync(base);
    } catch {
      return out;
    }
    for (const shard of shards) {
      const shardDir = path.join(base, shard);
      let files: string[];
      try {
        files = fs.readdirSync(shardDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (referenced.has(f)) continue;
        const fp = path.join(shardDir, f);
        try {
          const size = fs.statSync(fp).size;
          // 지우지 않고 휴지통을 거친다(§5.26 (H)) — 참조가 0이라는 판정이 틀렸을 때
          // 되돌릴 수단이 남아야 한다. 실패하면 남겨 둔다(못 옮긴 것을 지우면 그게 손실이다).
          if (!this.toTrash(projectName, fp)) continue;
          out.removed += 1;
          out.bytes += size;
        } catch (err) {
          this.log(`[insurance] prune blob failed: ${fp}`, err);
        }
      }
      // 빈 껍데기 폴더는 치운다(다음 스캔이 헛도는 것을 막는다).
      try {
        if (fs.readdirSync(shardDir).length === 0) fs.rmdirSync(shardDir);
      } catch { /* 다른 쓰기와 겹쳤을 뿐 — 다음 회차가 치운다 */ }
    }
    if (out.bytes > 0) this.addMeasured(projectName, -out.bytes);
    return out;
  }

  /**
   * 참조되지 않는 **미러**를 놓는다 — blob 쪽과 같은 규율의 트랜스크립트 판(§5.26 (H)).
   *
   * 미러는 마커가 가리킬 때만 닿을 수 있다(부활 후보 목록이 `markers` 를 돈다). 그래서 마커가
   * 캡·나이에 밀려 사라지면 그 `.jsonl` 은 **아무도 열 수 없는 바이트**로 남는다 — 종전에는
   * 그것을 치우는 자리가 아예 없어 미러가 영영 쌓였다. blob 만 고아를 걷어 내고 미러는 안 걷는
   * 비대칭이 이 기능의 조용한 누수였다.
   */
  pruneOrphanMirrors(projectName: string, referenced: ReadonlySet<string>): { removed: number; bytes: number } {
    const root = this.dir(projectName);
    const out = { removed: 0, bytes: 0 };
    if (!root) return out;
    const base = path.join(root, INSURANCE_TRANSCRIPTS_DIR);
    let files: string[];
    try {
      files = fs.readdirSync(base);
    } catch {
      return out;
    }
    // 파일명은 `mirrorPath` 가 **좁힌** 세션 id 다. 원장이 든 원본 id 와 그대로 견주면
    // 좁히기가 실제로 글자를 바꾼 세션에서 살아 있는 미러를 고아로 오판한다 — 같은 함수로 좁혀 견준다.
    const keys = new Set<string>();
    for (const id of referenced) keys.add(safeSessionKey(id));
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      if (keys.has(f.slice(0, -'.jsonl'.length))) continue;
      const fp = path.join(base, f);
      try {
        const size = fs.statSync(fp).size;
        if (!this.toTrash(projectName, fp)) continue;
        out.removed += 1;
        out.bytes += size;
      } catch (err) {
        this.log(`[insurance] prune mirror failed: ${fp}`, err);
      }
    }
    if (out.bytes > 0) this.addMeasured(projectName, -out.bytes);
    return out;
  }

  // ─── 파일 사본 (§5.26 (C)) ───

  /**
   * 쓰기 직전 파일 본문을 저장고에 앉힌다.
   *
   * 세 갈래로 갈리고 **셋 다 정직하게 기록된다**:
   *  · 파일이 없었다 → `absent` (되돌리기 = 삭제)
   *  · 너무 크다     → `skipped: 'too-large'` (되돌리기 손잡이 자체가 없다)
   *  · 읽기 실패     → `skipped: 'unreadable'`
   */
  capturePreimage(
    projectName: string,
    absPath: string,
    maxBytes: number = INSURANCE_PREIMAGE_MAX_BYTES,
  ): PreimageResult {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      return { absent: true }; // 새로 만드는 쓰기 — 빈 파일을 써 넣어 되돌린 척하지 않는다
    }
    if (!stat.isFile()) return { skipped: 'unreadable' };
    if (maxBytes > 0 && stat.size > maxBytes) return { skipped: 'too-large' };
    let data: Buffer;
    try {
      data = fs.readFileSync(absPath);
    } catch (err) {
      this.log(`[insurance] preimage read failed: ${absPath}`, err);
      return { skipped: 'unreadable' };
    }
    const blob = this.putBlob(projectName, data);
    return blob ? { blob } : { skipped: 'unreadable' };
  }

  /**
   * 사본을 원래 자리로 되돌린다. **원자적 쓰기**로 하고, 없던 파일이었으면 지운다.
   * 되돌리기 직전 내용을 먼저 뜨는 것은 호출부(원장)의 몫이다 — 그래야 되돌리기도 되돌릴 수 있다.
   */
  restoreFile(projectName: string, absPath: string, sha?: string): boolean {
    try {
      if (!sha) {
        // 그 시점에 파일이 없었다 = 되돌리기는 삭제다.
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        return true;
      }
      const data = this.readBlob(projectName, sha);
      if (!data) return false;
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir) && !this.ensureDir(dir)) return false;
      writeBufferAtomic(absPath, data);
      return true;
    } catch (err) {
      this.log(`[insurance] restore failed: ${absPath}`, err);
      return false;
    }
  }

  // ─── 트랜스크립트 미러 (§5.26 (B)) ───

  /**
   * 저장고 파일 하나를 **휴지통으로 옮긴다**(§5.26 (H) · §3.2.3-4).
   *
   * 휴지통 상대경로가 `insurance/…` 로 시작해야 정리 목록이 갈래를 알아보고 되돌리기를 내준다
   * (`kindForTrashRel`). 그래서 저장 폴더 기준 상대경로를 그대로 쓴다.
   */
  private toTrash(projectName: string, absPath: string): boolean {
    const saveDir = this.deps.resolveSaveDir(projectName);
    if (!saveDir) return false;
    const rel = path.relative(saveDir, absPath).split(path.sep).join('/');
    // 저장 폴더 밖이면 옮기지 않는다 — 휴지통은 그 폴더의 것만 받는다.
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    try {
      return moveFileToTrash(saveDir, rel, absPath) !== null;
    } catch (err) {
      this.log(`[insurance] trash failed: ${absPath}`, err);
      return false;
    }
  }

  private mirrorPath(root: string, sessionId: string): string {
    return path.join(root, INSURANCE_TRANSCRIPTS_DIR, `${safeSessionKey(sessionId)}.jsonl`);
  }

  mirrorSize(projectName: string, sessionId: string): number {
    const root = this.dir(projectName);
    if (!root) return 0;
    try {
      return fs.statSync(this.mirrorPath(root, sessionId)).size;
    } catch {
      return 0;
    }
  }

  /**
   * 트랜스크립트의 **붙은 바이트만** 미러에 잇는다(§9 증분 읽기와 같은 수법).
   *
   * 원본이 **줄었으면** 갈아치워진 것이므로 미러를 버리고 처음부터 다시 뜬다 — 이어 붙이면
   * 서로 다른 두 세션의 줄이 한 파일에 섞여 되살릴 수 없는 잡동사니가 된다.
   * 돌려주는 값은 미러의 새 크기이며, 실패하면 `null` 이다(= 호출부는 `mirrored: false`).
   */
  mirrorTranscript(projectName: string, sessionId: string, transcriptPath: string, upToBytes?: number): number | null {
    const root = this.dir(projectName);
    if (!root) return null;
    const dest = this.mirrorPath(root, sessionId);
    try {
      const srcSize = fs.statSync(transcriptPath).size;
      const limit = upToBytes === undefined ? srcSize : Math.min(upToBytes, srcSize);
      if (limit <= 0) return null;
      let have = 0;
      try {
        have = fs.statSync(dest).size;
      } catch { /* 아직 미러가 없다 */ }
      if (have > limit) {
        // 원본이 줄었다 = 갈아치워졌다. 처음부터 다시.
        try {
          fs.unlinkSync(dest);
          this.addMeasured(projectName, -have);
        } catch { /* 이미 없으면 그만 */ }
        have = 0;
      }
      if (have === limit) return have; // 붙은 게 없다
      if (!this.ensureDir(path.dirname(dest))) return null;
      copyRange(transcriptPath, dest, have, limit);
      this.addMeasured(projectName, limit - have);
      return limit;
    } catch (err) {
      this.log(`[insurance] mirror failed: ${sessionId}`, err);
      return null;
    }
  }

  /** 미러 삭제(예산 LRU). 마커는 남고 `mirrored: false` 가 된다. */
  dropMirror(projectName: string, sessionId: string): number {
    const root = this.dir(projectName);
    if (!root) return 0;
    const fp = this.mirrorPath(root, sessionId);
    try {
      const size = fs.statSync(fp).size;
      // 예산에 밀린 미러도 휴지통을 거친다 — 원본이 이미 사라진 세션이면 이 사본이 유일본이다.
      if (!this.toTrash(projectName, fp)) return 0;
      this.addMeasured(projectName, -size);
      return size;
    } catch {
      return 0;
    }
  }

  /** 미러 경로 — 원본이 사라졌을 때 대신 읽을 자리(§5.26 (G)). */
  mirrorFile(projectName: string, sessionId: string): string | null {
    const root = this.dir(projectName);
    if (!root) return null;
    const fp = this.mirrorPath(root, sessionId);
    return fs.existsSync(fp) ? fp : null;
  }

  /**
   * 저장고가 디스크에서 차지하는 바이트(blobs + transcripts). 저장소 사용량 화면과 예산이 읽는다.
   *
   * **처음 한 번만 디스크를 센다.** 그 뒤로는 우리가 쓰고 버린 만큼을 이어 간다(`measured` 주석).
   * 훅 경로에서 불리는 자리라, 여기서 폴더를 훑으면 그 비용이 그대로 도구 호출 지연이 된다.
   */
  measure(projectName: string): number {
    const cached = this.measured.get(projectName);
    if (cached !== undefined) return cached;
    const root = this.dir(projectName);
    if (!root) return 0; // 저장 폴더를 모르면 캐시하지 않는다 — 나중에 생길 수 있다
    const total = measureDirBytes(path.join(root, INSURANCE_BLOBS_DIR))
      + measureDirBytes(path.join(root, INSURANCE_TRANSCRIPTS_DIR));
    this.measured.set(projectName, total);
    return total;
  }
}

// ─── 순수 헬퍼 (클래스 밖 — 시험이 직접 부른다) ───

/**
 * 트랜스크립트 앞부분 해시. 크기·mtime 만으로는 "같은 경로에 다른 세션 파일이 앉은 경우"를
 * 가리지 못한다 — 그때 옛 마커의 오프셋으로 요약을 읽으면 **남의 대화**를 읽게 된다.
 */
export function hashHead(filePath: string, bytes: number = INSURANCE_HEAD_HASH_BYTES): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return createHash('sha256').update(buf.subarray(0, read)).digest('hex');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 닫기 실패는 무시 */ } }
  }
}

/**
 * 압축 요약 구간(마커 오프셋 뒤)을 읽는다.
 *
 * 한 번에 올리지 않고 상한을 건다(§3.2.4 G축 — 읽기 피크 상한). 요약은 앞쪽에 앉으므로
 * 구간의 **앞부분**만 읽어도 답이 나온다.
 */
export function readTail(
  filePath: string,
  fromBytes: number,
  maxBytes: number = INSURANCE_SUMMARY_SCAN_MAX_BYTES,
): string {
  let fd: number | undefined;
  try {
    const size = fs.statSync(filePath).size;
    if (size <= fromBytes) return '';
    const len = Math.min(maxBytes, size - fromBytes);
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(len);
    const read = fs.readSync(fd, buf, 0, len, fromBytes);
    return buf.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

/**
 * 파일 크기. **못 보면 `null`** — `0` 이 아니다.
 *
 * ⚠ 이 둘을 가르는 것이 §5.26 전체에서 가장 중요한 구분이다. `0` 은 "빈 파일이 있다"이고
 * `null` 은 "파일이 없다"인데, 없는 것을 `0` 으로 접으면:
 *   ① (D) 대조가 사라진 트랜스크립트를 "안 자란 파일"로 읽어 실패 사유를 틀리게 적고,
 *   ② (G) 부활 목록이 "원본이 사라져 사본만 남은 세션"을 영영 못 찾는다 —
 *      그게 이 기능의 값어치인데도.
 */
export function fileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

/**
 * §7.23 — 세션 하나가 **무엇에 대한 것이었나**. 못 읽으면 `undefined`(지어내지 않는다).
 *
 * 부활 목록은 종전에 `39f5680d` 처럼 세션 id 앞 8자만 적었다(사용자 보고: "하나도 알아볼 수
 * 없다"). 시각과 크기만으로는 수백 개 세션 중 어느 것이 내가 찾는 대화인지 고를 근거가 없다.
 *
 * 뜻은 **첫 사용자 프롬프트**에 있다. JSONL 은 append-only 라 그 줄이 파일 앞쪽에 앉으므로
 * **앞 몇 KB 만** 읽으면 된다(전량 파싱 ❌ — 385개 세션을 매 스냅샷마다 통째로 읽으면 그게
 * 바로 §9 가 잡았던 재파싱 사고다). 제목을 만드는 규칙은 `@vibisual/shared` 의 순수 함수라
 * 세 OS 어디서든 도는 시험으로 고정돼 있다.
 */
export function readSessionTitle(jsonlPath: string, maxChars?: number): string | undefined {
  const raw = readHead(jsonlPath, INSURANCE_TITLE_SCAN_MAX_BYTES);
  if (!raw) return undefined;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      // 마지막 줄은 상한에서 잘려 반 토막일 수 있다 — 그 줄만 버리고 다음으로 간다.
      continue;
    }
    const text = userTextOf(rec);
    if (!text) continue;
    return sessionTitleFromPrompt(text, maxChars) ?? undefined;
  }
  return undefined;
}

/** JSONL 한 줄이 **사용자가 쓴 것**이면 그 본문. 아니면 `null`. */
function userTextOf(rec: unknown): string | null {
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as Record<string, unknown>;
  if (r['type'] !== 'user') return null;
  const msg = r['message'];
  if (!msg || typeof msg !== 'object') return null;
  const content = (msg as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content.trim() ? content : null;
  if (!Array.isArray(content)) return null;
  // 도구 결과 블록은 사용자가 쓴 것이 아니다 — 글 블록만 잇는다.
  const text = content
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string)
    .join(' ');
  return text.trim() ? text : null;
}

/** 파일 **앞부분**만 읽는다. `readTail` 의 짝 — 첫 프롬프트는 앞에 앉는다. */
function readHead(filePath: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    const size = fs.statSync(filePath).size;
    if (size === 0) return '';
    const len = Math.min(maxBytes, size);
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(len);
    const read = fs.readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

/** 마지막 수정 시각. 위와 같은 이유로 못 보면 `null`. */
export function fileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** 바이트용 원자적 쓰기 — `atomicWriteFileSync` 는 utf8 문자열 전용이라 여기서 한 벌 더 든다. */
function writeBufferAtomic(filePath: string, data: Buffer): void {
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    try { fs.fsyncSync(fd); } catch { /* 일부 FS 는 fsync 미지원 — best effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/** `[from, to)` 구간만 이어 붙인다. 고정 청크로 순회해 읽기 피크를 파일 크기와 무관하게 묶는다. */
function copyRange(src: string, dest: string, from: number, to: number): void {
  const CHUNK = 1024 * 1024;
  const rfd = fs.openSync(src, 'r');
  const wfd = fs.openSync(dest, from > 0 ? 'a' : 'w');
  try {
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, to - from));
    let pos = from;
    while (pos < to) {
      const want = Math.min(buf.length, to - pos);
      const read = fs.readSync(rfd, buf, 0, want, pos);
      if (read <= 0) break;
      fs.writeSync(wfd, buf, 0, read);
      pos += read;
    }
    try { fs.fsyncSync(wfd); } catch { /* best effort */ }
  } finally {
    fs.closeSync(rfd);
    fs.closeSync(wfd);
  }
}

/**
 * 미러 파일명이 되는 세션 키. sessionId 는 UUID 라 경로 문자가 섞이지 않지만 밖에서 온 값이라
 * 한 번 좁힌다. **좁히는 규칙은 여기 한 벌뿐이다** — 파일을 만들 때와 고아를 가릴 때가 서로
 * 다른 규칙을 쓰면 살아 있는 미러를 고아로 오판한다.
 */
function safeSessionKey(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function measureDirBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) total += measureDirBytes(fp);
    else {
      try { total += fs.statSync(fp).size; } catch { /* 방금 지워졌을 뿐 */ }
    }
  }
  return total;
}
