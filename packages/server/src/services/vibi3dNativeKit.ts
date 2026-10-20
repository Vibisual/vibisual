import { VIBI3D_LIMITS } from '@vibisual/shared';
/** Node standard library only (MIT runtime); the agent runs this helper, never the application. */
export const VIBI3D_NATIVE_HELPER = String.raw`import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function listenerPath(platform, home, env) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const config = platform === 'win32' ? (env.APPDATA || paths.join(home, 'AppData', 'Roaming'))
    : platform === 'darwin' ? paths.join(home, 'Library', 'Application Support')
    : (env.XDG_CONFIG_HOME || paths.join(home, '.config'));
  return paths.join(config, '@vibisual', 'desktop', 'hook-listener.json');
}
export async function connection(env = process.env, platform = process.platform, home = os.homedir()) {
  let base = env.VIBISUAL_BASE;
  let token = env.VIBISUAL_TOKEN || env.VIBISUAL_HOOK_AUTH;
  if (!base || !token) {
    const listener = JSON.parse(await fs.readFile(listenerPath(platform, home, env), 'utf8'));
    if (!base && Number.isSafeInteger(listener.port) && listener.port > 0 && listener.port <= 65535) base = 'http://127.0.0.1:' + listener.port;
    if (!token && typeof listener.token === 'string') token = listener.token;
  }
  const url = new URL(base || '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !token) throw new Error('authenticated-loopback-required');
  return { base: url.origin, token };
}
export async function request(auth, route, method = 'GET', body, timeoutMs = 30000) {
  if (!route.startsWith('/api/app/vibi3d/')) throw new Error('invalid-route');
  const response = await fetch(auth.base + route, { method, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
    headers: { 'x-vibisual-hook-token': auth.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error('HTTP ' + response.status + ' ' + (result.error || 'request-failed'));
  return result;
}
const MAX_WAIT_MS = ${VIBI3D_LIMITS.commandTimeoutMs + 15000};
export async function reopenDocument(auth, projectId, docId, runId, timeoutMs = 30000) {
  const base = '/api/app/vibi3d/documents/' + encodeURIComponent(docId);
  const deadline = Date.now() + Math.min(30000, Math.max(1, timeoutMs));
  await request(auth, base + '/reopen', 'POST', { projectId, runId }, deadline - Date.now());
  while (Date.now() < deadline) {
    const state = await request(auth, base + '/session?projectId=' + encodeURIComponent(projectId), 'GET', undefined, deadline - Date.now());
    const session = state.session;
    if (session?.online === true && session.snapshot?.document?.id === docId && session.snapshot?.sessionId) {
      return { ok: true, ready: true, sessionId: session.snapshot.sessionId, snapshot: session.snapshot, run: state.run ?? null };
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('viewer-not-ready: reopen was requested but this document has no online renderer; saved stages remain available via runs; no commands were replayed');
}
export function commandWaitMs(result, now = Date.now()) {
  return Number.isFinite(result.expiresAt) ? Math.max(15000, Math.min(MAX_WAIT_MS, result.expiresAt - now + 15000)) : MAX_WAIT_MS;
}
export async function waitForCommand(auth, sessionId, commandId, timeoutMs = MAX_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await request(auth, '/api/app/vibi3d/sessions/' + encodeURIComponent(sessionId) + '/commands/' + encodeURIComponent(commandId));
    if (result.status === 'applied') return result;
    if (result.status === 'rejected') throw new Error(result.error || 'command-rejected');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('wait-timeout: inspect command status before retrying the same commandId');
}
export async function sendFile(auth, sessionId, file) {
  const input = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  const state = await request(auth, '/api/app/vibi3d/sessions/' + encodeURIComponent(sessionId));
  const commands = Array.isArray(input) ? input : input.commands;
  if (!Array.isArray(commands)) throw new Error('command-file-must-contain-array-or-request');
  const command = { commandId: input.commandId || randomUUID(), expectedRevision: input.expectedRevision ?? state.snapshot.revision, commands };
  try {
    const result = await request(auth, '/api/app/vibi3d/sessions/' + encodeURIComponent(sessionId) + '/commands', 'POST', command);
    return result.status === 'applied' ? result : await waitForCommand(auth, sessionId, command.commandId, commandWaitMs(result));
  } catch (error) {
    throw new Error(String(error.message || 'request-failed') + '; sessionId=' + sessionId + '; commandId=' + command.commandId
      + '; outcome may be unconfirmed: inspect this command status before retrying; never replace its ID blindly');
  }
}
export async function main(argv) {
  const action = argv[0]; const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || !argv[index + 1]) throw new Error('invalid-arguments');
    options[argv[index].slice(2)] = argv[index + 1];
  }
  if (action === 'help' || !action) {
    process.stdout.write('node vibi3d_native.mjs state --session ID\nnode vibi3d_native.mjs send --session ID --file commands.json\nnode vibi3d_native.mjs runs --project ROOT --doc ID\nnode vibi3d_native.mjs reopen --project ROOT --doc ID --run ID\n'); return;
  }
  const auth = await connection(); let result;
  if (action === 'send' && options.session && options.file) result = await sendFile(auth, options.session, options.file);
  else if (action === 'state' && options.session) result = await request(auth, '/api/app/vibi3d/sessions/' + encodeURIComponent(options.session));
  else if (action === 'runs' && options.project && options.doc) result = await request(auth, '/api/app/vibi3d/documents/' + encodeURIComponent(options.doc) + '/runs?projectId=' + encodeURIComponent(options.project));
  else if (action === 'reopen' && options.project && options.doc && options.run) result = await reopenDocument(auth, options.project, options.doc, options.run);
  else throw new Error('invalid-arguments: use help');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message || 'native-helper-failed') + '\n'); process.exitCode = 1; });
}
`;

export function nativeAuthoringKit(projectRoot: string): {
  version: number; projectRoot: string; files: Record<string, string>; protocol: string[];
} {
  return { version: 1, projectRoot, files: { 'vibi3d_native.mjs': VIBI3D_NATIVE_HELPER }, protocol: [
    'Write vibi3d_native.mjs under the project .vibisual folder. Run it with Node from your own shell; the app never executes it.',
    'Use send --session ID --file commands.json; the JSON may be a command array or {commandId,expectedRevision,commands}. Stable commandId is required for retrying after a lost response.',
    'Each send waits for the renderer outcome. Capture commands persist PNGs and return result.captures[].path relative to the project. Actually open those files with your image tool.',
    'Use state before editing, runs to inspect checkpoints and reopen for the same document/run only. Reopen waits up to 30 seconds for an online renderer and returns its new sessionId and saved run; it does not resume or replay edits. Inspect humanDirty and choose an explicit saved stage before resume. Do not accept your own proposals.',
    'Authentication comes from environment, then the installed hook-listener file. Tokens stay in memory and headers; never print or persist them.',
  ] };
}
