/**
 * §5.1 #2-1 (C) — 글 파일 앞부분(`CONSTELLATION.scanMaxBytes`)을 **비동기로** 읽어 파일 이름 낱말을 기억한다 — 서버가 창의 메인 스레드라(§3.7) 동기로 읽으면 창이 멈춘다.
 * 스냅샷은 기억된 결과만 쓰고, 없거나 낡았으면 읽기를 줄 세운 뒤 앞 결과로 그린다(바뀌면 `onChange`). 도장(절대경로+크기+수정 시각)이 같으면 다시 안 읽는다.
 * 못 읽으면 언급 없음으로 기억한다. 동시 건수·기억 상한(§3.2.4 F′)을 두고, 프로젝트마다 하나다(§3.5).
 */
import fs from 'node:fs';
import { CONSTELLATION, capMapSize, extractFileMentions } from '@vibisual/shared';

/** 파일의 앞 `maxBytes` 를 UTF-8 로 읽는다. 시험에서 갈아 끼울 수 있게 주입받는다. */
export type ReadFileHead = (absPath: string, maxBytes: number) => Promise<string>;

interface Stamp {
  readonly size: number;
  readonly mtimeMs: number;
}

interface Entry extends Stamp {
  readonly tokens: readonly string[];
}

/**
 * 앞부분 읽기 — 핸들을 열어 한 번 읽고 **닫힘을 기다린다**(Windows 는 열린 핸들이 있는 파일의 삭제·이름 바꾸기를
 * 거부한다 — 에이전트가 곧이어 그 파일을 고칠 수 있다).
 */
export const readFileHead: ReadFileHead = async (absPath, maxBytes) => {
  const handle = await fs.promises.open(absPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export class FileMentionScanner {
  private readonly entries = new Map<string, Entry>();
  /** 줄 섰거나 읽는 중인 파일 → 읽어야 할 도장(가장 최근 것). */
  private readonly pending = new Map<string, Stamp>();
  private readonly queue: string[] = [];
  private running = 0;

  constructor(
    private readonly onChange: () => void,
    private readonly readHead: ReadFileHead = readFileHead,
    /** 읽기 한 건이 끝날 때마다(실패도 완료). 위성 상한은 경로·종류로만 가르므로(§5.1 #2-1 (D)) `ProjectGraph` 는 걸지 않는다. */
    private readonly onSettled?: () => void,
  ) {}

  /**
   * 기억된 낱말. 없거나 도장이 다르면 읽기를 줄 세우고 **앞 결과**를 돌려준다(처음이면 `undefined` = 아직 모른다).
   */
  tokensFor(absPath: string, size: number, mtimeMs: number): readonly string[] | undefined {
    const hit = this.entries.get(absPath);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) {
      // 최근에 본 것을 뒤로 — 상한을 넘을 때 오래 안 본 것부터 버린다.
      this.entries.delete(absPath);
      this.entries.set(absPath, hit);
      return hit.tokens;
    }
    this.schedule(absPath, { size, mtimeMs });
    return hit?.tokens;
  }

  /** 줄 서 있거나 읽는 중인 수(시험용). */
  pendingCount(): number {
    return this.pending.size;
  }

  isPending(absPath: string): boolean {
    return this.pending.has(absPath);
  }

  private schedule(absPath: string, stamp: Stamp): void {
    const current = this.pending.get(absPath);
    if (current && current.size === stamp.size && current.mtimeMs === stamp.mtimeMs) return;
    // 읽는 동안 파일이 계속 유입돼도 대기열이 캐시보다 커지지 않는다. 다음 색인 조회가 빠진 파일을 다시 시도한다.
    if (!current && this.pending.size >= CONSTELLATION.scanCacheMax) return;
    const alreadyQueued = current !== undefined;
    this.pending.set(absPath, stamp);
    if (!alreadyQueued) this.queue.push(absPath);
    this.pump();
  }

  private pump(): void {
    while (this.running < CONSTELLATION.scanConcurrency && this.queue.length > 0) {
      const absPath = this.queue.shift();
      if (absPath === undefined) break;
      const stamp = this.pending.get(absPath);
      if (!stamp) continue;
      this.running += 1;
      void this.scan(absPath, stamp).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async scan(absPath: string, stamp: Stamp): Promise<void> {
    let tokens: readonly string[] = [];
    try {
      tokens = extractFileMentions(await this.readHead(absPath, CONSTELLATION.scanMaxBytes));
    } catch {
      tokens = []; // 지워짐·잠김·권한 — 언급 없음으로 기억하고, 도장이 바뀌면 다시 읽는다.
    }
    const latest = this.pending.get(absPath);
    if (latest && latest.size === stamp.size && latest.mtimeMs === stamp.mtimeMs) this.pending.delete(absPath);
    else if (latest) this.queue.push(absPath); // 읽는 사이 다시 바뀌었다 — 새 도장으로 한 번 더.
    const prev = this.entries.get(absPath);
    this.entries.delete(absPath);
    this.entries.set(absPath, { size: stamp.size, mtimeMs: stamp.mtimeMs, tokens });
    capMapSize(this.entries, CONSTELLATION.scanCacheMax);
    if (!sameTokens(prev?.tokens ?? [], tokens)) this.onChange();
    this.onSettled?.();
  }
}
