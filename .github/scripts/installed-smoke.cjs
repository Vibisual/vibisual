// CI-only fixtures and assertions for the installed application. No production bypass.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

function consentRecord(resources) {
  const read = (file) => fs.readFileSync(path.join(resources, file), 'utf8')
    .replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const eula = read('EULA.md');
  const version = /\*\*Version (\d+\.\d+) — effective (\d{4}-\d{2}-\d{2})\*\*/.exec(eula)?.[1];
  if (!version) throw new Error('Bundled EULA has no version');
  const locales = { en: 'en_US', ko: 'ko_KR', ja: 'ja_JP', 'zh-CN': 'zh_CN', de: 'de_DE',
    fr: 'fr_FR', es: 'es_ES', 'pt-BR': 'pt_BR', it: 'it_IT', id: 'id_ID', hi: 'hi_IN' };
  const summaries = Object.fromEntries(Object.entries(locales)
    .map(([locale, suffix]) => [locale, read(`legal/license_${suffix}.txt`)]));
  const privacy = read('PRIVACY.md');
  if (!privacy.trim() || Object.values(summaries).some((text) => !text.trim())) {
    throw new Error('Bundled consent document is empty');
  }
  const appVersion = JSON.parse(read('app/package.json')).version;
  return { schema: 1, accepted: true, version,
    digest: createHash('sha256').update(JSON.stringify([eula, privacy, summaries])).digest('hex'),
    locale: 'en', acceptedAt: new Date().toISOString(), appVersion };
}

function prepare(resources, profile) {
  // A synthetic CI user must never write consent into a developer's real profile.
  const root = process.env.RUNNER_TEMP && path.resolve(process.env.RUNNER_TEMP);
  const target = path.resolve(profile);
  const relative = root && path.relative(root, target);
  if (process.env.GITHUB_ACTIONS !== 'true' || !root || !relative
    || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Smoke profile must be a fresh child of RUNNER_TEMP in GitHub Actions');
  }
  const record = consentRecord(resources);
  fs.mkdirSync(target); // Existing profiles are rejected: old success logs cannot satisfy this run.
  fs.writeFileSync(path.join(target, 'legal-consent.json'), JSON.stringify(record));
}

function assertReady(startupLog, crashLog) {
  // ready/settle-cap both require the renderer's first-screen-ready signal.
  // forced/hard-cap can reveal a failed renderer and must not pass this gate.
  if (!/startup main window revealed \((?:ready|settle-cap),/.test(startupLog)) {
    throw new Error('Backend and renderer did not become ready (consent/error/splash alone is not success)');
  }
  if (/\[(?:main|renderer)\/(?:error|fatal)\]/.test(crashLog)) {
    throw new Error(`Installed application reported a startup failure:\n${crashLog}`);
  }
}

async function native(resources, expectedArch) {
  if (process.arch !== expectedArch) {
    throw new Error(`Wrong executable architecture: expected ${expectedArch}, got ${process.arch}`);
  }
  const appRequire = createRequire(path.join(path.resolve(resources), 'app', 'package.json'));
  appRequire('koffi'); // Loads the actual platform binary, not just its package metadata.
  const pty = appRequire('node-pty');
  await new Promise((resolve, reject) => {
    const marker = 'VIBISUAL_PTY_SMOKE_OK';
    let output = '';
    const terminal = pty.spawn('/bin/sh', ['-c', `printf ${marker}`], {
      name: 'xterm', cols: 80, rows: 24, cwd: process.env.RUNNER_TEMP || '/tmp', env: process.env,
    });
    const timeout = setTimeout(() => {
      try { terminal.kill(); } catch {}
      reject(new Error('Packaged node-pty did not produce output within 10 seconds'));
    }, 10000);
    terminal.onData((text) => { output += text; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode === 0 && output.includes(marker)) resolve();
      else reject(new Error(`Packaged node-pty failed: exit=${exitCode}, output=${output}`));
    });
  });
  console.log(`RESULT-NATIVE: ${process.platform}-${process.arch} koffi loaded and node-pty shell ran`);
}

module.exports = { consentRecord, prepare, assertReady };
if (require.main === module) {
  const [command, first, second] = process.argv.slice(2);
  Promise.resolve().then(async () => {
    if (command === 'prepare') prepare(first, second);
    else if (command === 'native') await native(first, second);
    else if (command === 'check') {
      const read = (name) => {
        try { return fs.readFileSync(path.join(first, 'logs', name), 'utf8'); } catch { return ''; }
      };
      const startup = read('main-stall.log');
      const crash = read('crash.log');
      try { assertReady(startup, crash); } catch (error) {
        console.error(`── main-stall.log ──\n${startup}\n── crash.log ──\n${crash}`);
        throw error;
      }
      console.log('RESULT-READY: installed backend and renderer reached the main screen without startup errors');
    } else throw new Error(`Unknown smoke command: ${command}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
