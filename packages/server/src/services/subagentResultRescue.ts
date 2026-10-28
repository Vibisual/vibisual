/**
 * §5.5 #17-9 ⑦(b) 확장 — **잃어버린 백그라운드 서브에이전트 결과를 디스크에서 건진다.** 보고 훅(`SubagentStop`·`PostToolUse`)은 자식이 제 발로
 * 끝날 때만 와서, 트리가 끊기면 보고만 잃는다 — 트랜스크립트는 남는다(실측 2026-08-12).
 * 위치: `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl` + `.meta.json` — 그 `toolUseId` 가 대차대조 키와 같다.
 * `%TEMP%` 의 `tasks/<id>.output` 은 수명이 짧아 안 쓴다. **표시 전용 폴백**(판정 ❌) — 실패하면 `undefined`.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { capMapSize, SESSION_KEYED_MAP_MAX } from '@vibisual/shared';
import { SUBAGENT_RESULT_MAX } from './subagentActivity.js';
import { logger } from '../logger.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/** 꼬리에서 읽는 최대 바이트 — 대화는 수 MB 인데 쓰는 건 마지막 말뿐이고, 메인 프로세스가 서버라 전문 동기 읽기는 UI 를 멈춘다(§9). */
const TAIL_READ_BYTES = 256 * 1024;

/** 꼬리에서 거슬러 올라가며 훑는 줄 수 상한 — 마지막 말이 도구 호출들 뒤에 있어도 닿을 만큼만. */
const MAX_SCAN_LINES = 400;

/**
 * 세션 id(UUID)로 `subagents` 폴더를 찾는다 — cwd 에서 슬러그를 역산하면 판마다 흔들리는 규칙을 탄다.
 * **찾은 것만 캐시한다** — 폴더는 첫 스폰 때 생겨, 못 찾음을 캐시하면 구조가 영영 막힌다.
 */
const dirCache = new Map<string, string>();

function findSubagentsDir(sessionId: string): string | null {
  if (!sessionId) return null;
  const cached = dirCache.get(sessionId);
  if (cached !== undefined) return cached;

  try {
    for (const slug of fs.readdirSync(PROJECTS_DIR)) {
      const candidate = path.join(PROJECTS_DIR, slug, sessionId, 'subagents');
      if (fs.existsSync(candidate)) {
        dirCache.set(sessionId, candidate);
        // §3.2.4 F축 — 세션 id 가 키라 켜 둘수록 는다. 경로 캐시라 버려도 다음에 다시 찾는다.
        capMapSize(dirCache, SESSION_KEYED_MAP_MAX);
        return candidate;
      }
    }
  } catch { /* PROJECTS_DIR 없음 — 건질 게 없다 */ }

  return null;
}

/** 파일 꼬리 최대 `TAIL_READ_BYTES` 바이트를 읽어 **완결된 줄만** 돌려준다(앞쪽 잘린 조각은 버린다). */
function readTailLines(file: string): string[] {
  let fd: number | undefined;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return [];
    const start = Math.max(0, size - TAIL_READ_BYTES);
    const length = size - start;
    const buf = Buffer.allocUnsafe(length);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, length, start);
    const lines = buf.toString('utf8').split('\n');
    // 앞에서 잘렸으면 첫 줄은 반쪽짜리라 JSON 으로 안 읽힌다 — 미리 버린다.
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim() !== '');
  } catch {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * 트랜스크립트 한 벌에서 **마지막 assistant 본문**을 꺼낸다.
 * 도구 호출만 든 assistant 줄은 건너뛰고(그건 보고가 아니다), 글자가 있는 첫 줄에서 멈춘다.
 */
export function extractLastAssistantText(lines: readonly string[]): string | undefined {
  const from = Math.max(0, lines.length - MAX_SCAN_LINES);
  for (let i = lines.length - 1; i >= from; i--) {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(lines[i]!) as Record<string, unknown>; } catch { continue; }
    if (obj['type'] !== 'assistant') continue;
    const message = obj['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
        && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text !== '') {
      return text.length <= SUBAGENT_RESULT_MAX ? text : `${text.slice(0, SUBAGENT_RESULT_MAX - 1)}…`;
    }
  }
  return undefined;
}

/** 구조 대상 한 건을 가리키는 열쇠 — 둘 중 하나만 있어도 찾는다. */
export interface RescueKey {
  /** 부모 Task/Agent 도구의 `tool_use_id`(= 대차대조 키). `meta.json` 의 `toolUseId` 와 맞춘다. */
  toolUseId?: string;
  /** 자식 훅이 각인한 `agent_id`. 있으면 파일 이름으로 곧장 간다(스캔 생략). */
  agentId?: string;
}

/**
 * 훅으로 끝내 오지 않은 자식의 최종 보고를 디스크에서 건진다.
 *
 * @param sessionId 그 자식을 띄운 **세션**의 Claude Code sessionId.
 * @returns 건진 본문(최대 `SUBAGENT_RESULT_MAX` 자). 못 찾으면 `undefined`.
 */
export function rescueSubagentResult(sessionId: string, key: RescueKey): string | undefined {
  if (!key.toolUseId && !key.agentId) return undefined;
  const dir = findSubagentsDir(sessionId);
  if (!dir) return undefined;

  try {
    // ① 자식이 스스로 밝힌 agent_id 가 있으면 파일 이름이 곧 답이다.
    if (key.agentId) {
      const direct = path.join(dir, `agent-${key.agentId}.jsonl`);
      if (fs.existsSync(direct)) {
        const text = extractLastAssistantText(readTailLines(direct));
        if (text) return text;
      }
    }

    // ② `meta.json` 의 `toolUseId` 로 역조회 — 우리 장부 키와 같은 값이라 추측이 없다.
    if (key.toolUseId) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.meta.json')) continue;
        let meta: Record<string, unknown>;
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>; }
        catch { continue; }
        if (meta['toolUseId'] !== key.toolUseId) continue;
        const jsonl = path.join(dir, name.replace(/\.meta\.json$/, '.jsonl'));
        if (!fs.existsSync(jsonl)) return undefined;
        return extractLastAssistantText(readTailLines(jsonl));
      }
    }
  } catch (err) {
    logger.warn(`[bg-subagent] result rescue failed session=${sessionId}: ${String(err)}`);
  }
  return undefined;
}
