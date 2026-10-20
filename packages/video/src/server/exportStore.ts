/**
 * §5.13 (AA) 42-1·42-6 — 내보내기 설정·렌더 대기열 파일(앱 데이터 — `<프로젝트>/.vibisual/video/` 안, (P-2)).
 *
 * - `export-settings.json` — 마지막에 쓴 설정 + 내 프리셋.
 * - `render-queue.json` — 아직 안 끝난 렌더 + 최근 끝난 것의 기록(상태가 바뀔 때마다 · 진행률은 적지 않는다).
 *
 * 쓰기는 호스트의 원자적 쓰기 하나로만 한다(§3.2.1 — 쓰는 도중 꺼져도 반쯤 쓴 파일이 남지 않는다). 읽다 실패하면 빈 값으로
 * 시작하되 **덮어쓰지 않는다** — 깨진 파일은 다음 쓰기 전까지 그대로 남는다(사람이 열어 볼 수 있게).
 */
import fs from 'node:fs';
import path from 'node:path';

import { VIDEO_EXPORT_SETTINGS_FILE, VIDEO_RENDER_QUEUE_FILE } from '../constants.js';
import { normalizeExportSettingsFile, type ExportSettingsFile } from '../exportSettings.js';

export interface ExportStoreHost {
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
}

function fileIn(projectPath: string, rel: string): string {
  return path.join(projectPath, '.vibisual', ...rel.split('/'));
}

export class ExportStore {
  constructor(private readonly host: () => ExportStoreHost) {}

  settingsFile(projectPath: string): string {
    return fileIn(projectPath, VIDEO_EXPORT_SETTINGS_FILE);
  }

  queueFile(projectPath: string): string {
    return fileIn(projectPath, VIDEO_RENDER_QUEUE_FILE);
  }

  readSettings(projectPath: string): ExportSettingsFile {
    const file = this.settingsFile(projectPath);
    try {
      if (!fs.existsSync(file)) return normalizeExportSettingsFile(null);
      return normalizeExportSettingsFile(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      this.host().warn(`[video] 내보내기 설정을 읽지 못했습니다(기본값으로 시작): ${String(err)}`);
      return normalizeExportSettingsFile(null);
    }
  }

  writeSettings(projectPath: string, data: ExportSettingsFile): void {
    const file = this.settingsFile(projectPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.host().atomicWriteFile(file, JSON.stringify(data, null, 2));
  }

  /** 대기열 기록(모양은 `fromQueueRecord` 가 거른다). 없거나 못 읽으면 빈 목록. */
  readQueue(projectPath: string): unknown[] {
    const file = this.queueFile(projectPath);
    try {
      if (!fs.existsSync(file)) return [];
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      const jobs = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['jobs'] : null;
      return Array.isArray(jobs) ? jobs : [];
    } catch (err) {
      this.host().warn(`[video] 렌더 대기열을 읽지 못했습니다: ${String(err)}`);
      return [];
    }
  }

  writeQueue(projectPath: string, records: readonly unknown[]): void {
    const file = this.queueFile(projectPath);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      this.host().atomicWriteFile(file, JSON.stringify({ schemaVersion: 1, jobs: records }, null, 2));
    } catch (err) {
      // 기록 실패가 렌더를 막지는 않는다 — 다음 상태 변화에 다시 적는다.
      this.host().warn(`[video] 렌더 대기열을 적지 못했습니다: ${String(err)}`);
    }
  }
}
