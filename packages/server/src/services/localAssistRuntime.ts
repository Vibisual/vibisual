/**
 * localAssistRuntime.ts — §5.19 (J) 끝까지 돕기의 디스크·엔진 곁일(원문 보관 · 계획 먼저 쓰기 막기 · KV 저장/복원 · 이 PC 의 사실).
 * 판정은 shared `localAssist.ts`, 여기는 파일과 엔진을 실제로 만지는 쪽만. 실패는 던지지 않고 "안 됐다"로 돌려준다(곁일이 턴을 죽이면 안 된다).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  LOCAL_KV_KEEP_MAX,
  LOCAL_KV_SLOT_TIMEOUT_MS,
  LOCAL_OUTPUT_KEEP_MAX,
  samePath,
  type LocalHostFacts,
  type PlatformName,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { resolveInRoot } from './localTools.js';

/** 세션 id 를 파일·폴더 이름으로. */
export function safeSessionName(subAgentId: string): string {
  return subAgentId.replace(/[^\w.-]/g, '_');
}

/** 원문 보관 폴더(프로젝트 상대). 로컬 Grep/Glob 이 `.vibisual` 을 걷지 않아 검색을 더럽히지 않는다. */
export function localOutputsRel(subAgentId: string): string {
  return `.vibisual/local-outputs/${safeSessionName(subAgentId)}`;
}

/** 계획 파일(프로젝트 상대). */
export function localPlanRel(subAgentId: string): string {
  return `.vibisual/relay/${safeSessionName(subAgentId)}.md`;
}

/** 폴더 안 파일을 최근 것 `keep` 개만 남긴다. */
async function pruneOldest(dir: string, keep: number): Promise<void> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  if (names.length <= keep) return;
  const stats = await Promise.all(names.map(async (name) => {
    const full = path.join(dir, name);
    const st = await fsp.stat(full).catch(() => null);
    return st?.isFile() ? { full, mtime: st.mtimeMs } : null;
  }));
  const files = stats.filter((s): s is { full: string; mtime: number } => s !== null).sort((a, b) => b.mtime - a.mtime);
  await Promise.all(files.slice(keep).map((f) => fsp.rm(f.full, { force: true }).catch(() => undefined)));
}

/** 잘린 도구 결과의 원문을 두고 프로젝트 상대 경로를 돌려준다. 못 쓰면 `null`(결과는 잘린 채로 간다). */
export async function saveFullToolOutput(root: string, subAgentId: string, content: string): Promise<string | null> {
  try {
    const relDir = localOutputsRel(subAgentId);
    const dir = path.join(root, relDir);
    await fsp.mkdir(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.txt`;
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
    await pruneOldest(dir, LOCAL_OUTPUT_KEEP_MAX);
    return `${relDir}/${name}`;
  } catch (err) {
    logger.warn(`[localAssist] could not keep the full tool output for ${subAgentId}`, err);
    return null;
  }
}

/** `/clear` — 그 세션의 원문 보관 폴더를 지운다(이력이 비면 가리킬 곳도 없다). */
export async function clearFullToolOutputs(root: string, subAgentId: string): Promise<void> {
  await fsp.rm(path.join(root, localOutputsRel(subAgentId)), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * §5.19 (J) ② 계획 먼저 — 승인 전 쓰기·셸을 막는다. 막으면 모델에게 돌려줄 한 줄, 통과면 `null`.
 * 계획 파일 자체는 연다 — 그 파일에 쓰는 것이 이 모드에서 모델이 할 일이다.
 */
export function planGateRefusal(
  toolName: string,
  input: Record<string, unknown>,
  root: string,
  planRel: string,
  platform: PlatformName = process.platform,
): string | null {
  if (toolName === 'Bash') {
    return `plan-first mode: shell commands wait until the user approves the plan. Write the checklist to ${planRel} first, then stop.`;
  }
  if (toolName !== 'Write' && toolName !== 'Edit') return null;
  const requested = typeof input['path'] === 'string' ? input['path'] : '';
  const target = resolveInRoot(root, requested, platform);
  const plan = resolveInRoot(root, planRel, platform);
  if (target && plan && samePath(target, plan, platform)) return null;
  return `plan-first mode: only ${planRel} can be written before the user approves the plan.`;
}

// ─── KV 저장/복원 (`--slot-save-path`) ───

export function localKvDir(): string {
  return path.join(os.homedir(), '.vibisual', 'local-kv');
}

/** 같은 모델·창·엔진 프로필·세션이어야 되살릴 수 있다 — 하나라도 다르면 다른 파일이다. */
export function kvFileName(modelPath: string, contextSize: number, profile: string, subAgentId: string): string {
  const key = createHash('sha1').update(`${modelPath}|${String(contextSize)}|${profile}`).digest('hex').slice(0, 16);
  return `${key}-${safeSessionName(subAgentId)}.bin`;
}

async function postSlot(port: number, action: 'save' | 'restore', fileName: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/slots/0?action=${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: fileName }),
      signal: AbortSignal.timeout(LOCAL_KV_SLOT_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** 유휴 해제 직전 — 마지막 세션의 KV 를 디스크에 남긴다. 최근 `LOCAL_KV_KEEP_MAX` 개만 남긴다. */
export async function saveKvSlot(port: number, fileName: string): Promise<boolean> {
  await fsp.mkdir(localKvDir(), { recursive: true }).catch(() => undefined);
  const ok = await postSlot(port, 'save', fileName);
  if (ok) await pruneOldest(localKvDir(), LOCAL_KV_KEEP_MAX);
  return ok;
}

/** 새로 띄운 엔진에 그 세션의 KV 를 되살린다. 파일이 없거나 엔진이 거절하면 `false`(처음부터 읽으면 된다). */
export async function restoreKvSlot(port: number, fileName: string): Promise<boolean> {
  if (!fs.existsSync(path.join(localKvDir(), fileName))) return false;
  return postSlot(port, 'restore', fileName);
}

/** `/clear` — 그 세션의 KV 파일을 지운다(지운 대화를 되살리면 안 된다). */
export async function clearKvFiles(subAgentId: string): Promise<void> {
  const tail = `-${safeSessionName(subAgentId)}.bin`;
  const names = await fsp.readdir(localKvDir()).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n.endsWith(tail)).map((n) => fsp.rm(path.join(localKvDir(), n), { force: true }).catch(() => undefined)));
}

/** 이 PC 의 사실 — 엔진 묶음(`localAssistEngineArgs`)이 쓴다. */
export function localHostFacts(): LocalHostFacts {
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return { totalRamBytes: os.totalmem(), logicalCpus: Math.max(1, cpus) };
}
