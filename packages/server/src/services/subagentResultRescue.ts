/**
 * §5.5 #17-9 ⑦(b) 확장 — **잃어버린 백그라운드 서브에이전트 결과를 디스크에서 건진다.**
 *
 * **왜 필요한가.** 자식의 최종 보고는 두 훅 중 하나로만 우리에게 온다 — `SubagentStop` 의
 * `last_assistant_message`, 또는 부모가 받아 든 `PostToolUse(Task|Agent)` 의 `tool_response`.
 * 둘 다 **자식이 제 발로 끝났을 때만** 발화한다. 그래서 프로세스 트리가 끊기면(사용자 [중지] ·
 * 탭 닫기 · 앱 크래시) 훅이 한 장도 안 오고, 그 자식이 실제로 해 놓은 일은 **전달 경로에서만**
 * 사라진다. 실측(P_MPS_GPT 세션 `63ddd0cd…`, 2026-08-12):
 *
 * ```
 * 08:33:52  Agent 도구로 code-lead 백그라운드 스폰 (a2e867f0bd3d6bbcb)
 * 08:54:27  <task-notification> status=killed "was stopped by user"  ← 큐에 들어감
 * 08:54:28  CLI 프로세스(pid 25620) 소멸                              ← 큐째로 증발
 * 09:29:06  재개된 새 프로세스: "No completion record was found …"    ← 결과 영영 못 받음
 * ```
 *
 * 그런데 그 자식의 트랜스크립트는 **디스크에 온전히 남아 있었다**(640KB · 209줄). 마지막 말도
 * 그대로였다 — "상태 확인 완료 — item 1은 `f648758`로 커밋됐고 워킹트리는 깨끗하다."
 * 즉 **일은 끝났는데 보고만 잃은 것**이라, 되찾을 수 있다.
 *
 * **어디서 찾나.** Claude Code 는 세션마다 자식 트랜스크립트를 아래로 떨군다:
 *
 * ```
 * ~/.claude/projects/<projectSlug>/<sessionId>/subagents/
 *     agent-<agentId>.jsonl        ← 그 자식의 전체 대화
 *     agent-<agentId>.meta.json    ← {agentType, description, toolUseId, spawnDepth}
 * ```
 *
 * `meta.json` 의 `toolUseId` 가 **우리 대차대조 키와 같은 값**(부모 Task 도구의 `tool_use_id`)이라
 * 항목 ↔ 파일이 추측 없이 맞물린다. 임시 폴더(`%TEMP%/claude/…/tasks/<id>.output`)는 같은 내용의
 * 하드링크지만 수명이 짧아 쓰지 않는다.
 *
 * **성격.** 표시 전용 폴백이다 — 대차대조 증감·완료 판정에는 관여하지 않고, 훅이 정상으로 온
 * 결과가 있으면 이 모듈은 아예 불리지 않는다. 실패하면 조용히 `undefined`(종전과 동일한 빈 카드).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { capMapSize, SESSION_KEYED_MAP_MAX } from '@vibisual/shared';
import { SUBAGENT_RESULT_MAX } from './subagentActivity.js';
import { logger } from '../logger.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * 트랜스크립트 꼬리에서 읽는 최대 바이트. 자식 대화는 수백 KB~수 MB 까지 자라는데 우리가 쓰는 것은
 * **마지막 말 한 덩이**뿐이다. 메인 프로세스가 곧 서버 코어라 동기 읽기가 그대로 UI 정지가 되므로
 * (§9 성능 원칙) 전문을 읽지 않고 꼬리만 잘라 온다.
 */
const TAIL_READ_BYTES = 256 * 1024;

/** 꼬리에서 거슬러 올라가며 훑는 줄 수 상한 — 마지막 말이 도구 호출들 뒤에 있어도 닿을 만큼만. */
const MAX_SCAN_LINES = 400;

/**
 * `<sessionId>` → 그 세션의 `subagents` 디렉터리. 프로젝트 슬러그를 cwd 에서 역산하지 않고
 * **세션 id 로 직접 찾는다** — sessionId 는 UUID 라 프로젝트 폴더를 훑어도 유일하게 걸리고,
 * 슬러그 규칙(`:` `\` `/` `_` `.` → `-`)이 판본마다 흔들려도 영향을 안 받는다.
 *
 * **찾은 것만 캐시한다** — 못 찾은 결과를 캐시하면 "그 세션이 첫 자식을 띄우기 전에 한 번 조회됐다"는
 * 이유만으로 이후 구조가 영영 막힌다(폴더는 첫 스폰 때 생긴다). 구조는 드물게만 도는 경로라
 * 재탐색 비용이 그 위험보다 싸다.
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
