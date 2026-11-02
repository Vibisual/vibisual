import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IDEActivityBarPrefs } from '@vibisual/shared';

let fixtureHome = '';
let temporaryRoot = '';

beforeEach(() => {
  temporaryRoot = fs.realpathSync(os.tmpdir());
  fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, 'vibi-activity-prefs-')));
  vi.stubEnv('VIBISUAL_HOME', fixtureHome);
  const folder = path.join(fixtureHome, '.vibisual');
  fs.mkdirSync(folder, { recursive: true });
  // Pre-create the file so a test never imports the user's legacy settings.
  fs.writeFileSync(path.join(folder, 'app-state.json'), JSON.stringify({ openProjects: [], updatedAt: 1 }));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  const resolved = path.resolve(fixtureHome);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('vibi-activity-prefs-')) {
    throw new Error('Unexpected activity preference fixture path');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
});

function readPrefs(): IDEActivityBarPrefs | undefined {
  return (JSON.parse(fs.readFileSync(path.join(fixtureHome, '.vibisual', 'app-state.json'), 'utf8')) as {
    ideActivityBar?: IDEActivityBarPrefs;
  }).ideActivityBar;
}

it('persists an all-visible preference across restart even with no hidden entries', async () => {
  const module = await import('./appState.js');
  const shown = ['goal', 'autoGoal', 'orchestra', 'configTrim', 'loop', 'specReading'];
  expect(module.appStateSetIDEActivityBar({ shown, hidden: [] })).toEqual({ shown });
  expect(readPrefs()).toEqual({ shown });
  vi.resetModules();
  expect((await import('./appState.js')).appStateGetIDEActivityBar()).toEqual({ shown });
});

it('reordering keeps explicit visibility and a later hide removes the conflicting shown choice', async () => {
  const module = await import('./appState.js');
  module.appStateSetIDEActivityBar({ shown: ['goal', 'loop'], hidden: ['hooks'] });
  module.appStateSetIDEActivityBar({ order: ['files', 'goal', 'hooks'] });
  expect(readPrefs()).toEqual({ order: ['files', 'goal', 'hooks'], hidden: ['hooks'], shown: ['goal', 'loop'] });
  module.appStateSetIDEActivityBar({ hidden: ['hooks', 'goal'] });
  expect(readPrefs()).toEqual({ order: ['files', 'goal', 'hooks'], hidden: ['hooks', 'goal'], shown: ['loop'] });
  vi.resetModules();
  expect((await import('./appState.js')).appStateGetIDEActivityBar()).toEqual(readPrefs());
});

it('reset clears explicit visibility and order on disk and after restart', async () => {
  const module = await import('./appState.js');
  module.appStateSetIDEActivityBar({ order: ['goal', 'files'], shown: ['goal'], hidden: ['hooks'] });
  expect(module.appStateResetIDEActivityBar()).toEqual({});
  expect(readPrefs()).toBeUndefined();
  vi.resetModules();
  expect((await import('./appState.js')).appStateGetIDEActivityBar()).toEqual({});
});
