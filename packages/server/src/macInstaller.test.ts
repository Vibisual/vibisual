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

function install(failure: '' | 'copy' | 'swap' | 'backup' | 'invalid' | 'restore' | 'interrupt', existing = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-mac-install-'));
  fixtures.push(root);
  const applications = path.join(root, 'Applications');
  const target = path.join(applications, 'Vibisual.app');
  const mounted = path.join(root, 'Volumes', 'Fixture');
  const appSource = path.join(mounted, 'Vibisual.app');
  fs.mkdirSync(path.join(appSource, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(applications, { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'));
  fs.writeFileSync(path.join(appSource, 'Contents', 'Info.plist'), '<plist/>');
  const exe = path.join(appSource, 'Contents', 'MacOS', 'Vibisual');
  fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(appSource, 'version'), 'new');
  if (failure === 'invalid') fs.unlinkSync(exe);
  if (existing) {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'version'), 'original');
  }
  // Execute the actual public installer, with only its fixed installation paths redirected.
  // All downloads/mounts are shell fixtures; no network, system mount or real /Applications access.
  const redirected = source.replaceAll('/Applications', shellPath(applications))
    .replaceAll('/Volumes/', `${shellPath(root)}/Volumes/`);
  expect(redirected).not.toContain('"/Applications/');
  const stubs = `
uname() { if [ "$1" = '-s' ]; then printf 'Darwin\\n'; else printf 'arm64\\n'; fi; }
curl() {
  if [ "$1" = '-fsSL' ]; then
    printf '%s' '{"tag_name":"v1.0.0","assets":[{"browser_download_url":"https://fixture/Vibisual-1.0.0-arm64.dmg"}]}'
  else
    while [ "$#" -gt 0 ]; do if [ "$1" = '-o' ]; then shift; : > "$1"; return; fi; shift; done
    return 1
  fi
}
hdiutil() { if [ "$1" = 'attach' ]; then printf '%s\\n' "$FIXTURE_MOUNT"; else printf 'detached\\n' >> "$FIXTURE_ROOT/detaches"; fi; }
cp() { if [ "$FIXTURE_FAILURE" = 'copy' ]; then return 28; fi; command cp "$@"; }
ditto() { cp -R "$1" "$2"; }
mv() {
  if [ "$FIXTURE_FAILURE" = 'backup' ] && [ "$1" = "$FIXTURE_TARGET" ]; then return 1; fi
  if [ "$FIXTURE_FAILURE" = 'restore' ] && [ "$2" = "$FIXTURE_TARGET" ]; then return 1; fi
  if [ "$FIXTURE_FAILURE" = 'interrupt' ] && [ "$1" = "$FIXTURE_TARGET" ]; then
    command mv "$@"; kill -TERM $$; return
  fi
  if [ "$FIXTURE_FAILURE" = 'swap' ] && [ "$2" = "$FIXTURE_TARGET" ] && [ ! -e "$FIXTURE_ROOT/swap-failed" ]; then
    : > "$FIXTURE_ROOT/swap-failed"; return 1
  fi
  command mv "$@"
}
`;
  const script = path.join(root, 'install-fixture.sh');
  fs.writeFileSync(script, redirected.replace('set -eu', `set -eu\n${stubs}`));
  const child = spawnSync(shell, [shellPath(script)], {
    env: { ...process.env, FIXTURE_ROOT: shellPath(root), FIXTURE_TARGET: shellPath(target),
      FIXTURE_MOUNT: shellPath(mounted), FIXTURE_FAILURE: failure, TMPDIR: shellPath(path.join(root, 'tmp')) },
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  expect(child.error).toBeUndefined();
  return { child, root, target, applications };
}

describe('macOS public installer preserves a working app when replacement fails', () => {
  it.each(['copy', 'swap', 'backup', 'invalid', 'interrupt'] as const)('%s failure preserves the original bundle and detaches the image', (failure) => {
    const { child, root, target, applications } = install(failure);
    expect(child.status, child.stdout + child.stderr).not.toBe(0);
    expect(fs.existsSync(path.join(target, 'version')), child.stdout + child.stderr).toBe(true);
    expect(fs.readFileSync(path.join(target, 'version'), 'utf8')).toBe('original');
    expect(fs.readFileSync(path.join(root, 'detaches'), 'utf8')).toContain('detached');
    expect(fs.readdirSync(applications)).toEqual(['Vibisual.app']);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });

  it('if rollback also fails, the old bundle stays at the recovery path instead of being deleted', () => {
    const { child, root, target, applications } = install('restore');
    expect(child.status).not.toBe(0);
    expect(fs.existsSync(target)).toBe(false);
    const work = fs.readdirSync(applications).find(name => name.startsWith('.vibisual-install.'));
    expect(work).toBeDefined();
    expect(fs.readFileSync(path.join(applications, work!, 'previous.app', 'version'), 'utf8')).toBe('original');
    expect(child.stderr).toContain('Original app preserved at');
    expect(child.stderr).toContain(work);
    expect(fs.readFileSync(path.join(root, 'detaches'), 'utf8')).toContain('detached');
  });

  it.each([true, false])('successful install (existing=%s) leaves only the complete new bundle', (existing) => {
    const { child, root, target, applications } = install('', existing);
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(fs.readFileSync(path.join(target, 'version'), 'utf8')).toBe('new');
    expect(fs.readdirSync(applications)).toEqual(['Vibisual.app']);
    expect(fs.readFileSync(path.join(root, 'detaches'), 'utf8')).toContain('detached');
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });
});
