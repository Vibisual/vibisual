/**
 * hooks/session-start-handler.mjs — Layer 1: SessionStart bridge
 *
 * Claude Code invokes this on every session start (CLI, VSCode extension, Desktop).
 * Sends {sessionId, pid, cwd, source} to the Vibisual server so the agent bubble
 * gets registered immediately — no need to wait for the first tool use.
 *
 * stdin: hook event JSON (hook_event_name: "SessionStart", session_id, cwd, ...)
 * stdout: {"continue": true}
 */

import { resolveServerUrl } from './lib/serverUrl.mjs';

const SERVER_URL = `${resolveServerUrl()}/api/session-start`;
const TIMEOUT_MS = 3000;

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  // 먼저 응답 — Claude Code 즉시 진행
  process.stdout.write('{"continue":true}\n');

  try {
    const input = await readStdin();
    if (input.length === 0) return;

    const payload = JSON.parse(input);

    const body = JSON.stringify({
      sessionId: payload.session_id ?? null,
      cwd: payload.cwd ?? process.cwd(),
      pid: process.ppid, // Claude Code 프로세스가 이 훅의 부모
      source: payload.source ?? 'unknown', // 'startup' | 'resume' | 'compact' 등
      timestamp: Date.now(),
    });

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(tid));
  } catch {
    // 전송 실패는 무시 — 서버 꺼져있을 때 훅이 Claude Code 실행을 막으면 안됨
  }
}

main().catch(() => {});
