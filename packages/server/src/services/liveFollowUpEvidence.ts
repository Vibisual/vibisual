import fsp, { type FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { JSONL_SCAN_CHUNK_BYTES } from '@vibisual/shared';
import type { QueuedCommand } from '@vibisual/shared';

/**
 * §5.5 #17-18 ⑬ — 확인 불가로 잠긴 [작업에 반영]을 클로드 대화록과 대조한다. 엔진이 받아 간 증거는 둘이다(CLI 2.1.318 실측):
 * 도구 경계 흡수 = `queue-operation` `remove` · `reason: "absorbed_mid_turn"` · `commandUuid`(우리가 실은 uuid) · `content`,
 * 그리고 같은 uuid 로 적힌 `user` 줄. 증거가 없으면 답하지 않는다 — 넘겨짚어 확정하지 않는다.
 */

export interface LiveFollowUpEvidenceTarget {
  /** 엔진에 실은 메시지 id(`QueuedCommand.liveTarget.messageId`). 없으면(옛 기록) 흡수 기록의 본문으로만 대조한다. */
  messageId?: string;
  /** 보낸 본문 꼴들(정규화) — 첨부를 붙여 보냈으면 그 꼴까지. */
  texts: readonly string[];
  /** 투입 시각(ms). 이보다 이른 기록은 이 입력의 것이 아니다. */
  since: number;
}

/** 대화록 시각은 같은 기계 시계지만 기록 시점이 앞뒤로 조금 어긋날 수 있다 — 그만큼만 봐준다. */
const EVIDENCE_CLOCK_SLACK_MS = 2_000;

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/** 이 기록의 대조 열쇠. 본문 꼴은 실제로 보낸 모양(첨부 경로는 `\n\n` 뒤 줄마다 — `ClaudeLiveFollowUpChannel.send`)을 따른다. */
export function liveFollowUpEvidenceTarget(
  command: Pick<QueuedCommand, 'text' | 'timestamp' | 'attachments' | 'liveTarget'>,
): LiveFollowUpEvidenceTarget {
  const texts = [normalizeText(command.text)];
  if (command.attachments?.length) texts.push(normalizeText(`${command.text}\n\n${command.attachments.join('\n')}`));
  return {
    ...(command.liveTarget?.messageId ? { messageId: command.liveTarget.messageId } : {}),
    texts: texts.filter((text) => text.length > 0),
    since: command.timestamp,
  };
}

/** 대화록 한 줄이 이 입력을 엔진이 받아 간 증거면 그 시각(ms), 아니면 `null`. 큰 줄을 파싱하지 않게 문자열로 먼저 거른다. */
export function liveFollowUpEvidenceAt(line: string, target: LiveFollowUpEvidenceTarget): number | null {
  const mentionsId = !!target.messageId && line.includes(target.messageId);
  if (!mentionsId && !line.includes('"queue-operation"')) return null;
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    record = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
  if (!Number.isFinite(at) || at < target.since - EVIDENCE_CLOCK_SLACK_MS) return null;
  if (record.type === 'queue-operation') {
    // 흡수가 아닌 제거(사용자가 엔진 대기열에서 지운 것 등)는 받은 증거가 아니다.
    if (record.operation !== 'remove' || typeof record.reason !== 'string' || !record.reason.startsWith('absorbed')) return null;
    if (typeof record.commandUuid === 'string' && target.messageId) return record.commandUuid === target.messageId ? at : null;
    return typeof record.content === 'string' && target.texts.includes(normalizeText(record.content)) ? at : null;
  }
  if (record.type === 'user' && mentionsId && record.uuid === target.messageId && record.isMeta !== true) return at;
  return null;
}

interface ScanState {
  file: string;
  /** 다음에 읽을 바이트 자리 — 자란 만큼만 읽는다(매번 처음부터 ❌). */
  offset: number;
  decoder: StringDecoder;
  /** 청크 끝에서 잘린 줄. */
  tail: string;
  reading: boolean;
}

/** 기록마다 대화록을 이어 읽는다. 비동기라 메인 스레드를 막지 않고, 대화록이 안 자랐으면 읽지 않는다. */
export class LiveFollowUpTranscriptWatch {
  private readonly states = new Map<string, ScanState>();

  /** 증거를 찾으면 그 시각, 못 찾았거나 이미 읽는 중이면 `null`. `bytes` = 지금 대화록 크기. */
  async check(commandId: string, file: string, bytes: number, target: LiveFollowUpEvidenceTarget): Promise<number | null> {
    let state = this.states.get(commandId);
    if (!state || state.file !== file || bytes < state.offset) {
      state = { file, offset: 0, decoder: new StringDecoder('utf8'), tail: '', reading: false };
      this.states.set(commandId, state);
    }
    if (state.reading || bytes <= state.offset) return null;
    state.reading = true;
    let handle: FileHandle | undefined;
    try {
      handle = await fsp.open(file, 'r');
      const buffer = Buffer.allocUnsafe(Math.min(JSONL_SCAN_CHUNK_BYTES, bytes - state.offset));
      while (state.offset < bytes) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes - state.offset), state.offset);
        if (bytesRead <= 0) break;
        state.offset += bytesRead;
        const lines = (state.tail + state.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        state.tail = lines.pop() ?? '';
        for (const line of lines) {
          const at = liveFollowUpEvidenceAt(line, target);
          if (at !== null) return at;
        }
      }
      return null;
    } finally {
      state.reading = false;
      await handle?.close().catch(() => undefined);
    }
  }

  forget(commandId: string): void {
    this.states.delete(commandId);
  }

  /** 더는 잠긴 기록이 아닌 것(옮겨졌거나 지워진 것)의 읽기 자리를 버린다 — 맵이 기록 수를 넘어 자라지 않게. */
  retain(commandIds: ReadonlySet<string>): void {
    for (const id of [...this.states.keys()]) if (!commandIds.has(id)) this.states.delete(id);
  }
}
