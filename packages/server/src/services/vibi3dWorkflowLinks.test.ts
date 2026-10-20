import { describe, expect, it } from 'vitest';
import type { CreationLink, CreationValue } from '@vibisual/shared';
import { guardWorkflowLinks } from './vibi3dWorkflowLinks.js';

const object = (id: string, children: CreationValue[] = []): CreationValue => ({ uuid: `uuid-${id}`, userData: { vibi3dId: id }, children });
const scene = (children: CreationValue[]): CreationValue => ({ scene: { object: object('root', children) } });
const link = (target: string, revision: number, id = 'link'): CreationLink => ({ id, sourceId: 'image', sourceRevision: revision, role: 'model-texture', targets: [target] });

describe('hierarchy-aware workflow source pins', () => {
  it('refuses both child and parent edits that advance a pinned source under a new link id', () => {
    const payload = scene([object('group', [object('wall')]), object('other')]);
    expect(() => guardWorkflowLinks([link('group', 1), link('other', 2, 'other')], [link('wall', 2, 'new')], payload)).toThrow('user-decision-required');
    expect(() => guardWorkflowLinks([link('wall', 1)], [link('group', 2, 'new')], payload)).toThrow('user-decision-required');
    expect(() => guardWorkflowLinks([link('group', 1)], [link('wall', 1, 'new')], payload)).not.toThrow();
    expect(() => guardWorkflowLinks([link('group', 1)], [link('other', 2, 'new')], payload)).not.toThrow();
  });
  it('checks the old hierarchy after ungrouping and the incoming hierarchy after regrouping', () => {
    const grouped = scene([object('group', [object('wall')])]);
    const flat = scene([object('wall'), object('group')]);
    expect(() => guardWorkflowLinks([link('group', 1)], [link('wall', 2, 'new')], grouped, flat)).toThrow('user-decision-required');
    expect(() => guardWorkflowLinks([link('wall', 1)], [link('group', 2, 'new')], flat, grouped)).toThrow('user-decision-required');
  });
  it('does not combine different revisions into a fictitious ancestor chain', () => {
    const before = scene([object('a', [object('b')]), object('c')]);
    const after = scene([object('c', [object('a')]), object('b')]);
    expect(() => guardWorkflowLinks([link('b', 1)], [link('c', 2, 'new')], before, after)).not.toThrow();
  });
  it('uses stable ids after order changes and keeps independent slots/sources editable', () => {
    const payload = scene([object('second'), object('group', [object('wall')])]);
    expect(() => guardWorkflowLinks([link('group', 1)], [{ ...link('wall', 2), role: 'model-texture:normalMap' }], payload)).not.toThrow();
    expect(() => guardWorkflowLinks([link('group', 1)], [{ ...link('wall', 2), sourceId: 'other-image' }], payload)).not.toThrow();
    expect(() => guardWorkflowLinks([link('group', 1)], [link('wall', 2, 'new')], payload)).toThrow('user-decision-required');
  });
});
