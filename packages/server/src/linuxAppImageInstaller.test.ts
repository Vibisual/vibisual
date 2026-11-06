import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const source = fs.readFileSync(path.join(repo, 'scripts/install.sh'), 'utf8').replace(/\r\n/g, '\n');
const gitBash = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const shell = process.platform === 'win32' ? gitBash : '/bin/sh';
const shellPath = (value: string): string => process.platform === 'win32'
  ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`) : value;
const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const ORIGINAL = '\x7fELF previous working app';
const NEW_APP = '\x7fELF new app';

type Failure = '' | 'partial' | 'not-elf' | 'empty' | 'swap' | 'interrupt';

function install(failure: Failure, existing = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-appimage-install-'));
  fixtures.push(root);
  const prefix = path.join(root, 'prefix');
  const bin = path.join(prefix, 'bin');
  const target = path.join(bin, 'vibisual');
  fs.mkdirSync(path.join(root, 'tmp'));
  if (existing) {
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(target, ORIGINAL, { mode: 0o755 });
  }
  // The release lists only an AppImage, so the real script takes the AppImage branch even on
  // hosts that have dpkg or rpm. Only uname, curl and mv are stubbed; no network access.
  const stubs = `
uname() { if [ "$1" = '-s' ]; then printf 'Linux\\n'; else printf 'x86_64\\n'; fi; }
curl() {
  if [ "$1" = '-fsSL' ]; then
    printf '%s' '{"tag_name":"v1.0.0","assets":[{"browser_download_url":"https://fixture/Vibisual-1.0.0.AppImage"}]}'
    return
  fi
  out=''
  while [ "$#" -gt 0 ]; do if [ "$1" = '-o' ]; then shift; out="$1"; fi; shift; done
  case "$FIXTURE_FAILURE" in
    partial) printf 'PARTIAL DOWNLOAD' > "$out"; return 18 ;;
    not-elf) printf '<html>rate limited</html>' > "$out" ;;
    empty) : > "$out" ;;
    interrupt) printf 'PARTIAL DOWNLOAD' > "$out"; kill -TERM $$ ;;
    *) printf '\\177ELF new app' > "$out" ;;
  esac
}
mv() { if [ "$FIXTURE_FAILURE" = 'swap' ]; then return 1; fi; command mv "$@"; }
`;
  const script = path.join(root, 'install-fixture.sh');
  fs.writeFileSync(script, source.replace('set -eu', `set -eu\n${stubs}`));
  const child = spawnSync(shell, [shellPath(script)], {
    env: { ...process.env, FIXTURE_FAILURE: failure, VIBISUAL_PREFIX: shellPath(prefix),
      TMPDIR: shellPath(path.join(root, 'tmp')) },
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  expect(child.error, child.stdout + child.stderr).toBeUndefined();
  return { child, root, bin, target };
}

describe('Linux AppImage install replaces the app only with a complete download', () => {
  it.each(['partial', 'not-elf', 'empty', 'swap', 'interrupt'] as const)('%s failure keeps the previous AppImage and leaves no staging file', (failure) => {
    const { child, root, bin, target } = install(failure);
    expect(child.status, child.stdout + child.stderr).not.toBe(0);
    expect(fs.readFileSync(target, 'latin1')).toBe(ORIGINAL);
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o111).not.toBe(0);
    expect(fs.readdirSync(bin)).toEqual(['vibisual']);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });

  it.each([true, false])('successful install (existing=%s) leaves only the new executable', (existing) => {
    const { child, root, bin, target } = install('', existing);
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(fs.readFileSync(target, 'latin1')).toBe(NEW_APP);
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(bin)).toEqual(['vibisual']);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
    expect(child.stdout).toContain(`Installed to ${shellPath(target)}`);
  });
});
