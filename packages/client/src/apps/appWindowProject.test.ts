import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppWindowVisible, type AppWindowProjectState } from './appWindowProject.js';

function state(overrides: Partial<AppWindowProjectState> = {}): AppWindowProjectState {
  return {
    activeProject: 'alpha', activeIframeId: null,
    projects: { alpha: { name: 'alpha', path: '/projects/alpha' }, beta: { name: 'beta', path: '/projects/beta' } },
    stubProjects: {},
    ...overrides,
  };
}

beforeEach(() => vi.stubGlobal('navigator', { platform: 'Linux' }));
afterEach(() => vi.unstubAllGlobals());

describe('app window project ownership', () => {
  it('matches the active project path and known legacy name, but excludes other projects', () => {
    expect(isAppWindowVisible('/projects/alpha', state())).toBe(true);
    expect(isAppWindowVisible('alpha', state())).toBe(true);
    expect(isAppWindowVisible('/projects/beta', state())).toBe(false);
    expect(isAppWindowVisible('beta', state())).toBe(false);
  });

  it('keeps path ownership after a project display name changes', () => {
    const renamed = state({ activeProject: 'renamed', projects: { renamed: { name: 'renamed', path: '/projects/alpha' } } });
    expect(isAppWindowVisible('/projects/alpha', renamed)).toBe(true);
    expect(isAppWindowVisible('/projects/beta', renamed)).toBe(false);
  });

  it('normalizes Windows separators, trailing slash and path casing', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const windows = state({ projects: { alpha: { name: 'alpha', path: 'C:/Projects/Alpha' } } });
    expect(isAppWindowVisible('c:\\projects\\ALPHA\\', windows)).toBe(true);
    expect(isAppWindowVisible('C:/Projects/Alpha-copy', windows)).toBe(false);
  });

  it('preserves Linux path casing', () => {
    expect(isAppWindowVisible('/projects/Alpha', state())).toBe(false);
    expect(isAppWindowVisible('/projects/alpha/', state())).toBe(true);
  });

  it('shows an explicitly owned worktree on its parent project tab', () => {
    const parent = state();
    parent.projects.worktree = { name: 'worktree', path: '/worktrees/task', parentProjectPath: '/projects/alpha' };
    expect(isAppWindowVisible('/worktrees/task', parent)).toBe(true);
    expect(isAppWindowVisible('worktree', parent)).toBe(true);
    expect(isAppWindowVisible('/worktrees/task', { ...parent, activeProject: 'beta' })).toBe(false);
  });

  it('does not infer ownership for a nested independent project or an unknown subdirectory', () => {
    const parent = state();
    parent.projects.nested = { name: 'nested', path: '/projects/alpha/nested' };
    expect(isAppWindowVisible('/projects/alpha/nested', parent)).toBe(false);
    expect(isAppWindowVisible('/projects/alpha/unknown', parent)).toBe(false);
  });

  it('resolves active and worktree project paths from unloaded project stubs', () => {
    const stubbed = state({ projects: {}, stubProjects: {
      alpha: { project: { name: 'alpha', path: '/projects/alpha' } },
      task: { project: { name: 'task', path: '/worktrees/task', parentProjectPath: '/projects/alpha' } },
    } });
    expect(isAppWindowVisible('/projects/alpha', stubbed)).toBe(true);
    expect(isAppWindowVisible('/worktrees/task', stubbed)).toBe(true);
    expect(isAppWindowVisible('task', stubbed)).toBe(true);
    expect(isAppWindowVisible('/projects/beta', stubbed)).toBe(false);
  });

  it.each([
    { activeProject: null },
    { activeProject: 'unknown' },
    { activeIframeId: 'preview' },
  ])('hides all windows when no project tab is selected: %j', overrides => {
    expect(isAppWindowVisible('/projects/alpha', state(overrides))).toBe(false);
  });
});
