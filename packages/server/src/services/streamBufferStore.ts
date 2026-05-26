/**
 * streamBufferStore.ts — SubAgentStreamEvent 영속화.
 *
 * 각 subagent가 emit하는 스트림 이벤트를 프로젝트 save 디렉토리 하위
 * `sub-streams/<parentAgentId>/<subId>.jsonl` 에 append-only로 기록한다.
 * 부모 에이전트별로 독립된 폴더로 분리 — 커스텀 에이전트가 여러 개여도 섞이지 않음.
 *
 * 경로 규약 (statePersistence.projectDirForInfo 재사용):
 *   일반     : save/<project>/sub-streams/<agentId>/<subId>.jsonl
 *   worktree : save/<parent>/worktrees/<wt>/sub-streams/<agentId>/<subId>.jsonl
 *
 * 이 모듈은 순수 파일시스템 유틸 — ProjectInfo 해석은 호출자(subAgentManager) 담당.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';
import { logger } from '../logger.js';
import { projectDirForInfo } from './statePersistence.js';

function sanitize(segment: string): string {
  // 경로 주입 방지 — 안전 문자만 허용
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 프로젝트 + 부모 에이전트 단위의 sub-streams 디렉토리 경로. */
export function subStreamsDir(info: ProjectInfo, parentAgentId: string): string {
  return path.join(projectDirForInfo(info), 'sub-streams', sanitize(parentAgentId));
}

function subFile(dir: string, subAgentId: string): string {
  return path.join(dir, `${sanitize(subAgentId)}.jsonl`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendEvent(dir: string, event: SubAgentStreamEvent): void {
  try {
    ensureDir(dir);
    fs.appendFileSync(subFile(dir, event.subAgentId), JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    logger.warn(`streamBufferStore append failed (${event.subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 파일에서 마지막 `max`개 이벤트를 복원. 손상된 라인은 스킵. */
export function loadBuffer(dir: string, subAgentId: string, max: number): SubAgentStreamEvent[] {
  try {
    const fp = subFile(dir, subAgentId);
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, 'utf8');
    const lines = raw.split('\n');
    const events: SubAgentStreamEvent[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        const evt = JSON.parse(line) as SubAgentStreamEvent;
        if (evt && typeof evt.id === 'string' && typeof evt.subAgentId === 'string') {
          events.push(evt);
        }
      } catch { /* skip corrupt line */ }
    }
    if (events.length > max) events.splice(0, events.length - max);
    return events;
  } catch (err) {
    logger.warn(`streamBufferStore load failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function deleteBuffer(dir: string, subAgentId: string): void {
  try {
    const fp = subFile(dir, subAgentId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    // 에이전트 폴더가 비었으면 함께 제거
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (err) {
    logger.warn(`streamBufferStore delete failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
