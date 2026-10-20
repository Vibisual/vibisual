import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DNode } from '@vibisual/shared';
import { GeometryEditor } from './GeometryEditor.js';
import { defaultRecipe } from './modelRecipeDefaults.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const node = (kind: Parameters<typeof defaultRecipe>[0], extra: Partial<Vibi3DNode> = {}): Vibi3DNode => ({
  id: 'stable-part', name: 'Part', type: 'Mesh', parentId: 'root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], recipe: defaultRecipe(kind), ...extra,
});
const button = (text: string) => renderer.root.findAllByType('button').find(item => item.children.includes(text))!;
function mount(value: Vibi3DNode, disabled = false) {
  const onCommand = vi.fn(); act(() => { renderer = create(createElement(GeometryEditor, { node: value, disabled, onCommand })); }); return onCommand;
}
function commit(label: string, value: string): void {
  const input = () => renderer.root.findByProps({ 'aria-label': label });
  act(() => input().props.onChange({ target: { value } })); act(() => input().props.onBlur());
}

describe('editable geometry controls', () => {
  it('commits a new shape dimension to the same stable id and preserves the recipe', () => {
    const value = node('stairs'), command = mount(value);
    commit('panel.vibi3d.geometry.steps', '7');
    expect(command).toHaveBeenCalledWith({ type: 'geometry', id: 'stable-part', recipe: { ...value.recipe, steps: 7 } });
  });
  it('adds and edits an actual extrusion hole without replacing the outer profile', () => {
    const value = node('extrude'), command = mount(value);
    act(() => button('panel.vibi3d.geometry.addHole').props.onClick());
    const request = command.mock.calls[0]![0]; expect(request.id).toBe('stable-part'); expect(request.recipe.points).toEqual(value.recipe!.points);
    expect(request.recipe.holes).toHaveLength(1); expect(request.recipe.holes[0]).toHaveLength(4);
  });
  it('assigns an opening id and keeps it while editing the jamb depth', () => {
    const value = node('wall'), command = mount(value);
    act(() => button('panel.vibi3d.geometry.addOpening').props.onClick());
    const recipe = command.mock.calls[0]![0].recipe;
    expect(recipe.openings[0].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    act(() => renderer.update(createElement(GeometryEditor, { node: { ...value, recipe }, disabled: false, onCommand: command })));
    commit('panel.vibi3d.geometry.opening 1 panel.vibi3d.geometry.opening_reveal', '0.05');
    expect(command.mock.calls[1]![0].recipe.openings[0]).toEqual({ ...recipe.openings[0], reveal: 0.05 });
  });
  it('rejects a combination that collapses a capsule and explains why the edit was not applied', () => {
    const command = mount(node('capsule')); commit('panel.vibi3d.authoring.radius', '3');
    expect(command).not.toHaveBeenCalled(); expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('panel.vibi3d.geometry.invalidRecipe');
  });
  it('respects protected geometry and exposes profile/path coordinates for a sweep', () => {
    mount(node('sweep', { locked: true }));
    expect(renderer.root.findAllByType('input').every(input => input.props.disabled)).toBe(true);
    expect(renderer.root.findAllByType('button').every(item => item.props.disabled)).toBe(true);
    expect(renderer.root.findAllByProps({ 'aria-label': 'panel.vibi3d.geometry.profile 1 X' })).not.toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'panel.detailPanel.path 1 Z' })).not.toHaveLength(0);
  });
});
