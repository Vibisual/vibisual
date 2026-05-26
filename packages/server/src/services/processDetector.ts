/**
 * processDetector.ts — Layer 3: OS-agnostic Claude Code process detection
 *
 * Returns the set of PIDs currently running as a Claude Code session (CLI, VSCode extension, Desktop).
 * Used as the last-line fallback when neither SessionStart hook (Layer 1) nor JSONL watcher
 * (Layer 2) can confirm liveness.
 *
 * Detection strategy:
 *   - Windows: tasklist /FI "IMAGENAME eq claude.exe"  +  wmic for node.exe with "claude" in cmdline
 *   - macOS/Linux: pgrep -fl for "claude" (catches both CLI and node wrappers)
 *
 * All external spawns:
 *   - use execFile (no shell) with a 5s timeout
 *   - swallow errors and return empty set (caller treats as "unknown" not "dead")
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

const PROCESS_PROBE_TIMEOUT_MS = 5_000;

/** Probe result: alive PID set + success flag (false = probe failed, don't trust emptiness) */
export interface ProcessProbeResult {
  pids: Set<number>;
  ok: boolean;
}

export async function detectClaudePids(): Promise<ProcessProbeResult> {
  const platform = os.platform();
  try {
    if (platform === 'win32') return await detectWindows();
    if (platform === 'darwin' || platform === 'linux') return await detectUnix();
    return { pids: new Set(), ok: false };
  } catch (err) {
    logger.warn('detectClaudePids failed', err);
    return { pids: new Set(), ok: false };
  }
}

async function detectWindows(): Promise<ProcessProbeResult> {
  const pids = new Set<number>();

  // Pass 1: native claude.exe
  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', 'IMAGENAME eq claude.exe', '/NH', '/FO', 'CSV'],
      { timeout: PROCESS_PROBE_TIMEOUT_MS, windowsHide: true },
    );
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^"claude\.exe","(\d+)"/.exec(line.trim());
      if (m) pids.add(parseInt(m[1]!, 10));
    }
  } catch (err) {
    logger.warn('tasklist claude.exe failed', err);
  }

  // Pass 2: node.exe whose command line contains "claude" (VSCode extension host child)
  try {
    const { stdout } = await execFileAsync(
      'wmic',
      ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine', '/FORMAT:CSV'],
      { timeout: PROCESS_PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    // CSV header: Node,CommandLine,ProcessId  —  but ordering by /FORMAT may vary. Parse all rows.
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 1) {
      const header = lines[0]!.split(',');
      const cmdIdx = header.findIndex((c) => c.trim().toLowerCase() === 'commandline');
      const pidIdx = header.findIndex((c) => c.trim().toLowerCase() === 'processid');
      if (cmdIdx >= 0 && pidIdx >= 0) {
        for (const line of lines.slice(1)) {
          const cols = line.split(',');
          const cmd = cols[cmdIdx] ?? '';
          const pidStr = cols[pidIdx] ?? '';
          if (/claude/i.test(cmd)) {
            const pid = parseInt(pidStr.trim(), 10);
            if (Number.isFinite(pid)) pids.add(pid);
          }
        }
      }
    }
  } catch (err) {
    // wmic may be missing on Win11 24H2+ — not fatal, tasklist pass 1 still valid
    logger.debug?.('wmic node.exe probe failed (non-fatal)', err);
  }

  return { pids, ok: true };
}

async function detectUnix(): Promise<ProcessProbeResult> {
  const pids = new Set<number>();
  try {
    const { stdout } = await execFileAsync(
      'pgrep',
      ['-fl', 'claude'],
      { timeout: PROCESS_PROBE_TIMEOUT_MS },
    );
    for (const line of stdout.split('\n')) {
      const m = /^(\d+)\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      const pid = parseInt(m[1]!, 10);
      const cmd = m[2]!;
      // pgrep -fl matches "claude" anywhere; further filter: cmdline must contain /claude or "claude-code"
      if (/\bclaude(-code|\.js|cli)?\b|\/claude($|\s)/i.test(cmd)) {
        pids.add(pid);
      }
    }
    return { pids, ok: true };
  } catch (err) {
    // pgrep returns exit 1 when no matches — still "ok"
    const code = (err as { code?: number }).code;
    if (code === 1) return { pids, ok: true };
    logger.warn('pgrep claude failed', err);
    return { pids: new Set(), ok: false };
  }
}
