// Puts `claude` / `codex` stand-ins into a bin directory: a POSIX `sh` launcher (chmod 755) and a Windows `.cmd`
// shim, both pinning the node that runs the test. The app must find them through its normal PATH lookup
// (claudeBin PATH+PATHEXT scan, binLocator.resolveBinary for codex) — nothing in the app is told about the fake.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ENGINES = /** @type {const} */ (['claude', 'codex']);

/**
 * @param {{ binDir: string, stateDir: string, scenarioFile: string, node?: string, platform?: NodeJS.Platform }} o
 * @returns {{ binDir: string, files: string[] }}
 */
export function installFakeEngines(o) {
  const platform = o.platform ?? process.platform;
  const node = o.node ?? process.execPath;
  fs.mkdirSync(o.binDir, { recursive: true });
  fs.mkdirSync(o.stateDir, { recursive: true });
  const files = [];
  for (const engine of ENGINES) {
    const script = path.join(HERE, `fake-${engine}.mjs`);
    for (const [name, body] of shimsFor({ engine, node, script, stateDir: o.stateDir, scenarioFile: o.scenarioFile, platform })) {
      const file = path.join(o.binDir, name);
      fs.writeFileSync(file, body);
      if (!name.endsWith('.cmd')) fs.chmodSync(file, 0o755);
      files.push(file);
    }
  }
  return { binDir: o.binDir, files };
}

/**
 * Launcher bodies. Pure so each OS form is unit-tested on every OS.
 * The env is set inside the launcher: the app spawns engines with its own env and must not need to forward ours.
 * @param {{ engine: string, node: string, script: string, stateDir: string, scenarioFile: string, platform: NodeJS.Platform }} o
 * @returns {[string, string][]}
 */
export function shimsFor(o) {
  if (o.platform === 'win32') {
    // `%*` passes the arguments through untouched; `setlocal` keeps the variables out of the caller's console.
    // CRLF — cmd.exe misparses LF-only batch files near label/goto boundaries.
    const cmd = [
      '@echo off',
      'setlocal',
      `set "VIBISUAL_FAKE_ENGINE_STATE=${o.stateDir}"`,
      `set "VIBISUAL_FAKE_ENGINE_SCENARIO=${o.scenarioFile}"`,
      `"${o.node}" "${o.script}" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n');
    return [[`${o.engine}.cmd`, cmd]];
  }
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const sh = [
    '#!/bin/sh',
    `VIBISUAL_FAKE_ENGINE_STATE=${q(o.stateDir)}`,
    `VIBISUAL_FAKE_ENGINE_SCENARIO=${q(o.scenarioFile)}`,
    'export VIBISUAL_FAKE_ENGINE_STATE VIBISUAL_FAKE_ENGINE_SCENARIO',
    `exec ${q(o.node)} ${q(o.script)} "$@"`,
    '',
  ].join('\n');
  return [[o.engine, sh]];
}
