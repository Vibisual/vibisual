import { describe, expect, it } from 'vitest';
import { beginSelectionScope } from './selectionScope.js';

function holder() {
  const names = new Set<string>();
  return { names, classList: { add: (name: string) => { names.add(name); }, remove: (name: string) => { names.delete(name); } } };
}
const target = (field: boolean, scope: ReturnType<typeof holder> | null) => ({
  closest: (selector: string): unknown => selector.startsWith('input') ? (field ? {} : null) : scope,
});

describe('memo selection scope', () => {
  it('keeps a drag inside the pressed region and restores on release', () => {
    const page = holder(); const scope = holder();
    const release = beginSelectionScope(target(false, scope), page);
    expect([...page.names]).toEqual(['select-none']);
    expect([...scope.names]).toEqual(['select-text']);
    release?.();
    expect(page.names.size).toBe(0);
    expect(scope.names.size).toBe(0);
  });
  it('selects nothing when the drag starts outside every region', () => {
    const page = holder();
    const release = beginSelectionScope(target(false, null), page);
    expect([...page.names]).toEqual(['select-none']);
    release?.();
    expect(page.names.size).toBe(0);
  });
  it('leaves text fields to the browser', () => {
    const page = holder();
    expect(beginSelectionScope(target(true, holder()), page)).toBeNull();
    expect(page.names.size).toBe(0);
  });
});
