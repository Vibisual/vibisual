import { afterEach, describe, expect, it } from 'vitest';

import { inspectorPickerAt, registerInspectorPicker, type InspectorPicker } from './inspectorPick.js';

/**
 * §5.4 #15 (C) — 브라우저가 집은 요소를 어느 판의 공급자가 맡나. 캔버스 판은 판 자신만, SVG 판(`subtree`)은 안쪽 도형까지.
 * 판 위의 단추·입력칸은 그대로 DOM 으로 집혀야 한다.
 */

function node(id: string, parent: Element | null = null): Element {
  return { id, parentElement: parent } as unknown as Element;
}

const offs: Array<() => void> = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });

const answer = (label: string): InspectorPicker => () => [{ rect: { x: 0, y: 0, width: 1, height: 1 }, label, text: '', clipboard: label }];

describe('inspectorPickerAt — which drawn surface answers for the picked element', () => {
  it('answers for a surface itself, and leaves elements on top of a plain surface to the DOM', () => {
    const canvas = node('canvas');
    const pin = node('note-pin', canvas);
    const picker = answer('canvas');
    offs.push(registerInspectorPicker(canvas, picker));
    expect(inspectorPickerAt(canvas)).toEqual({ host: canvas, picker });
    expect(inspectorPickerAt(pin)).toBeNull();
    expect(inspectorPickerAt(null)).toBeNull();
  });

  it('answers for shapes deep inside a subtree (SVG) surface with that surface as the host', () => {
    const page = node('page');
    const svg = node('stage-svg', page);
    const layer = node('layer-g', svg);
    const text = node('layer-text', layer);
    const picker = answer('stage');
    offs.push(registerInspectorPicker(svg, picker, { subtree: true }));
    expect(inspectorPickerAt(text)).toEqual({ host: svg, picker });
    expect(inspectorPickerAt(layer)).toEqual({ host: svg, picker });
    expect(inspectorPickerAt(page)).toBeNull();
  });

  it('lets the nearest surface decide', () => {
    const outer = node('outer-svg');
    const inner = node('inner-canvas', outer);
    const onInner = node('button-on-inner', inner);
    offs.push(registerInspectorPicker(outer, answer('outer'), { subtree: true }));
    const innerPicker = answer('inner');
    offs.push(registerInspectorPicker(inner, innerPicker));
    // 가장 가까운 판(캔버스 — 판 자신만)이 정한다: 그 위 단추는 바깥 SVG 판이 가져가지 않는다.
    expect(inspectorPickerAt(onInner)).toBeNull();
    expect(inspectorPickerAt(inner)).toEqual({ host: inner, picker: innerPicker });
  });

  it('stops answering once unregistered, and an older unregister never removes a newer picker', () => {
    const svg = node('svg');
    const shape = node('rect', svg);
    const first = answer('first');
    const offFirst = registerInspectorPicker(svg, first, { subtree: true });
    const second = answer('second');
    offs.push(registerInspectorPicker(svg, second, { subtree: true }));
    offFirst();
    expect(inspectorPickerAt(shape)).toEqual({ host: svg, picker: second });
    offs.splice(0).forEach((off) => off());
    expect(inspectorPickerAt(shape)).toBeNull();
  });
});
