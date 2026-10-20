import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readVibi3DAuthoring, type CreationDoc } from '@vibisual/shared';
import { productionParameterRequest, vibi3dProductionPrompt, type ProductionValues } from './vibi3dProduction.js';
import { Vibi3DProductionPanel } from './Vibi3DProductionPanel.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { vibi3dCandidatePrompt } from './vibi3dCandidatePrompt.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: React.ReactNode }) => children }));
const open = vi.hoisted(() => vi.fn());
vi.mock('../IDE/useWorkspaceExplorer.js', () => ({ openWorkspaceFile: open }));

const path = '.vibisual/modeling/product/initial';
function document(): CreationDoc {
  return { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Chair', revision: 4, parameters: {}, links: [], lockedPaths: [],
    createdAt: 1, updatedAt: 2, label: '', author: 'agent', payload: {
      format: 'vibi3d', version: 1, generatorCode: 'def build(ctx): pass',
      authoring: { engine: 'blender', version: 1, runId: 'initial', stage: { id: 'detail', label: 'Chair legs', completedAt: 1234 },
        parameters: { height: { type: 'number', label: 'Height', value: 2, min: 1, max: 3, step: 0.1, partIds: ['leg'] },
          paint: { type: 'color', label: 'Paint', value: '#ffffff' }, visible: { type: 'boolean', label: 'Backrest', value: true } },
        source: { script: `${path}/model.py`, blend: `${path}/model.blend`, manifest: `${path}/manifest.json`, baseline: `${path}/baseline.json` },
        renderPaths: [`${path}/front.png`], checks: { finite: true, objects: 3, triangles: 120, triangleBudget: 10000, visualReview: 'pending' },
      },
    } };
}
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.clearAllMocks(); });

describe('local production parameters', () => {
  it('keeps exact overrides, source files, stable targets and source revision in a review request', () => {
    const request = productionParameterRequest(document(), { height: 2.5, paint: '#8844ff', visible: false });
    expect(request).toMatchObject({ documentId: 'product', revision: 4 });
    expect(request?.text).toContain('"overrides":{"height":2.5,"paint":"#8844ff","visible":false}');
    expect(request?.text).toContain('"partIds":["leg"]');
    expect(request?.text).toContain(`${path}/model.py`);
    expect(request?.text).toContain('Do not accept it yourself');
    expect(readVibi3DAuthoring(document().payload)?.parameters.height?.value).toBe(2);
  });

  it.each<ProductionValues>([{ height: 9 }, { height: Number.NaN }, { height: '' }, { paint: 'red' }, { visible: 'false' }, { unknown: 1 }, { height: 2 }])(
    'does not submit undeclared, invalid, out-of-range or unchanged parameters: %j', (values) => {
      expect(productionParameterRequest(document(), values)).toBeNull();
    },
  );

  it('keeps the native production metadata after opening, manual edits and serialization', async () => {
    const original = document(); const object = new THREE.Group(); const part = new THREE.Mesh(new THREE.BoxGeometry());
    part.userData['vibi3dId'] = 'leg'; object.add(part);
    const payload = serializeModelSource(object, [], original.payload);
    const loaded = await loadModelSource(payload);
    loaded.object.children[0]!.position.x = 3;
    const saved = serializeModelSource(loaded.object, loaded.clips, payload);
    expect(readVibi3DAuthoring(saved)).toEqual(readVibi3DAuthoring(original.payload));
    expect(saved.generatorCode).toBe('def build(ctx): pass');
  });

  it('shows saved evidence and sends draft parameters without mutating the source', () => {
    const doc = document(); const apply = vi.fn().mockResolvedValue(undefined);
    act(() => { renderer = create(<Vibi3DProductionPanel doc={doc} projectRoot="/workspace" disabled={false} dirty={false} onApply={apply} />); });
    const number = renderer!.root.findByProps({ type: 'number' });
    act(() => number.props.onChange({ target: { value: '2.6' } }));
    const button = renderer!.root.findAllByType('button').find((node) => node.children.includes('panel.vibi3d.production.apply'))!;
    expect(button.props.disabled).toBe(false);
    act(() => button.props.onClick());
    expect(apply.mock.calls[0]![0].text).toContain('"height":2.6');
    expect(readVibi3DAuthoring(doc.payload)?.parameters.height?.value).toBe(2);
    const artifact = renderer!.root.findByProps({ title: `${path}/front.png` });
    act(() => artifact.props.onClick());
    expect(open).toHaveBeenCalledWith('/workspace', `${path}/front.png`);
    act(() => renderer!.update(<Vibi3DProductionPanel doc={doc} projectRoot="/workspace" disabled dirty onApply={apply} />));
    expect(button.props.disabled).toBe(true);
    expect(number.props.disabled).toBe(true);
    act(() => renderer!.update(<Vibi3DProductionPanel doc={{ ...doc, revision: 5 }} projectRoot="/workspace" disabled={false} dirty={false} onApply={apply} />));
    expect(number.props.value).toBe(2);
    expect(button.props.disabled).toBe(true);
  });

  it('directs a CLI to a real worker and renders, with a truthful unavailable-tool fallback', () => {
    const prompt = vibi3dProductionPrompt('Space project', 'product');
    expect(prompt).toContain('/authoring/kit?projectId=Space%20project');
    expect(prompt).toContain('--background --factory-startup --python-exit-code 1 --python');
    expect(prompt).toContain('ctx.checkpoint');
    expect(prompt).toContain('intermediate checkpoints stay local');
    expect(prompt).toContain('only its final complete checkpoint as a candidate');
    expect(prompt).toContain('.vibisual/modeling/');
    expect(prompt).toContain('actually inspect');
    expect(prompt).toContain('checks.visualReview stays pending');
    expect(prompt).toContain('If blenderPath is null');
    const candidate = vibi3dCandidatePrompt({ sessionId: 'scene', projectId: 'Space project', revision: 0, fileName: 'chair', nodes: [], selectedId: 'leg' }, document(), 'Widen the seat');
    expect(candidate).toContain(vibi3dProductionPrompt('Space project', 'product', 'candidate'));
    expect(candidate).toContain('Set manifest.mode="candidate"');
    expect(candidate).toContain('Never accept your own candidate');
  });
});
