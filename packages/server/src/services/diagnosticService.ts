import { randomUUID } from 'node:crypto';
import { DIAGNOSTIC_LOG_MAX, type DiagnosticEntry } from '@vibisual/shared';

// §4 v1.98 — 진단 에러 로그 서비스 (단일 SSOT).
//
// 수집원 3종:
//   - server 코어   : logger.error/warn 탭 (logger.ts)
//   - main 프로세스 : 진입점이 process.on('uncaughtException') 등에서 recordDiagnostic() 호출
//   - renderer      : client_error WS 메시지 → handleClientMessage 가 record()
//
// ring buffer(DIAGNOSTIC_LOG_MAX). GraphSnapshot.diagnosticLog 로 클라에 전달, 영속화 ❌.

interface RecordInput {
  source: DiagnosticEntry['source'];
  level: DiagnosticEntry['level'];
  message: string;
  stack?: string;
}

class DiagnosticService {
  private entries: DiagnosticEntry[] = [];
  private onChange: (() => void) | null = null;
  private changeScheduled = false;

  /** 전송 계층이 "로그 변경 시 broadcast" 를 등록. */
  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  /** 진단 1건 기록. 버스트·재진입(로그 탭이 다시 로그를 부르는 경우)을 microtask 로 코얼레스. */
  record(input: RecordInput): void {
    const entry: DiagnosticEntry = {
      id: randomUUID(),
      ts: Date.now(),
      source: input.source,
      level: input.level,
      message: input.message.slice(0, 4000),
      ...(input.stack ? { stack: input.stack.slice(0, 8000) } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > DIAGNOSTIC_LOG_MAX) {
      this.entries.splice(0, this.entries.length - DIAGNOSTIC_LOG_MAX);
    }
    this.scheduleChange();
  }

  /** 최신이 뒤(append 순). 클라가 표시 시 역순 정렬. */
  getLog(): DiagnosticEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.scheduleChange();
  }

  private scheduleChange(): void {
    if (this.changeScheduled || !this.onChange) return;
    this.changeScheduled = true;
    queueMicrotask(() => {
      this.changeScheduled = false;
      this.onChange?.();
    });
  }
}

export const diagnosticService = new DiagnosticService();

/** 진입점(server standalone / desktop main)이 진단 1건을 기록하는 단축 함수. */
export function recordDiagnostic(
  source: DiagnosticEntry['source'],
  level: DiagnosticEntry['level'],
  message: string,
  stack?: string,
): void {
  diagnosticService.record({ source, level, message, ...(stack ? { stack } : {}) });
}
