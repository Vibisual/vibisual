import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUBBLE_SKINS, DEFAULT_AGENT_CONFIG, HEATMAP_RAMP, HEATMAP_ZERO_COLOR, type BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { BubbleNode } from './BubbleNode.js';
import { CanvasControls } from './CanvasControls.js';
import { heatmapFill } from './heatmapPaint.js';

vi.mock('@xyflow/react', () => ({
  Handle: () => null, Position: { Top: 'top' },
  Panel: ({ children }: { children: ReactNode }) => children,
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn() }),
  useStoreApi: () => ({ setState: vi.fn() }),
  useStore: (selector: (state: { nodesDraggable: boolean; nodesConnectable: boolean; elementsSelectable: boolean }) => unknown) => selector({
    nodesDraggable: true, nodesConnectable: true, elementsSelectable: true,
  }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => options ? `${key}:${JSON.stringify(options)}` : key }),
}));
vi.mock('./useCanvasNodeSelection.js', () => ({
  useCanvasNodeSelection: () => ({ replace: () => {}, toggle: () => {} }),
}));
vi.mock('../../hooks/useIsMobile', () => ({ useIsNarrowViewport: () => false }));
vi.mock('./BubbleContextMenu.js', () => ({ BUBBLE_MENU_EVENT: 'bubble-menu' }));
vi.mock('../../plugins/host.js', () => ({ PluginBubbleBadgeSlot: () => null }));
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => undefined,
  appOutputExtensions: () => [],
  workspaceOpenClaims: () => [],
}));
vi.mock('../../apps/appLinkedItems.js', () => ({ thumbnailAppFor: () => null }));
vi.mock('./useFileFaceThumbnail.js', () => ({
  useFileFaceThumbnail: () => ({
    state: { status: 'ready', thumb: { kind: 'picture', url: 'data:image/png;base64,fixture', fit: 'cover' } },
    target: null,
    blocked: null,
  }),
}));

const initialState = useGraphStore.getState();
let renderer: ReactTestRenderer | undefined;

function sample(extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id: 'heat-file', bubbleType: 'file', label: 'heat.ts', path: '/project/heat.ts',
    status: 'idle', activity: 100, readCount: 100, writeCount: 0,
    ...extra,
  };
}

function render(data = sample()): void {
  act(() => { renderer = create(<BubbleNode id={data.id} data={{ ...data }} />); });
}

function body(): ReactTestInstance {
  return renderer!.root.find((node) => node.type === 'div'
    && typeof node.props.className === 'string' && node.props.className.includes('bubble-body'));
}

function background(): string { return String(body().props.style.background); }

function heatBadges(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.type === 'span'
    && typeof node.props.title === 'string' && node.props.title.startsWith('canvas.heatmap.badge'));
}

function setHeat(enabled: boolean): void {
  act(() => useGraphStore.setState({ heatmapMode: enabled }));
}

/** Read top-level gradient stops without splitting nested color functions. */
function gradientStops(css: string): string[] {
  const args = css.slice(css.indexOf('(') + 1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '(') depth++;
    else if (args[i] === ')') depth--;
    else if (args[i] === ',' && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts.slice(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  useGraphStore.setState(initialState, true);
  useGraphStore.setState({
    heatmapMode: false, heatAxis: 'read', heatCurve: 'linear',
    readCountRange: { max: 100 }, writeCountRange: { max: 100 },
    readCountQuantiles: [], writeCountQuantiles: [],
    userDefaults: { updatedAt: 1, appearance: { themeId: 'custom:installed-theme', bubbleSkin: 'outline' } },
    bubbleAppearancePending: null, selectIntentId: null, connectingFrom: null,
  });
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  useGraphStore.setState(initialState, true);
  vi.useRealTimers();
});

describe('BubbleNode heatmap paint', () => {
  it('keeps the same heat material without interior line decorations in every skin and restores the chosen surface when switched off', () => {
    render();
    let sharedHeatFill: string | undefined;
    for (const { id } of BUBBLE_SKINS) {
      act(() => useGraphStore.setState({ bubbleAppearancePending: { bubbleSkin: id } }));
      const normalFill = background();
      setHeat(true);
      expect(body().props['data-bubble-skin']).toBe(id);
      expect(body().props['data-vb-theme-lock']).toBe('dark');
      expect(background()).not.toBe(normalFill);
      expect(background().toLowerCase()).toContain('#dc2626');
      if (sharedHeatFill === undefined) sharedHeatFill = background();
      else expect(background()).toBe(sharedHeatFill);
      expect(heatBadges()[0]?.children).toEqual(['100']);
      expect(body().findAll((node) => node.props['data-bubble-inner-rim'] !== undefined)).toHaveLength(0);
      expect(body().findAll((node) => node.type === 'svg'
        && String(node.props.className).includes('absolute'))).toHaveLength(0);
      expect(body().findAllByType('svg').length).toBeGreaterThan(0); // File glyphs remain visible.
      setHeat(false);
      expect(background()).toBe(normalFill);
      expect(heatBadges()).toHaveLength(0);
      expect(body().findAll((node) => node.props['data-bubble-inner-rim'] !== undefined)).toHaveLength(1);
    }
    expect(useGraphStore.getState().userDefaults?.appearance?.themeId).toBe('custom:installed-theme');
  });

  it('updates fill and count together when switching between read and write, including zero', () => {
    render();
    setHeat(true);
    const readFill = background();
    expect(heatBadges()[0]?.props.title).toContain('badgeRead');
    expect(heatBadges()[0]?.children).toEqual(['100']);
    act(() => useGraphStore.setState({ heatAxis: 'write' }));
    expect(background()).not.toBe(readFill);
    expect(background()).toContain(HEATMAP_ZERO_COLOR);
    expect(heatBadges()[0]?.props.title).toContain('badgeWrite');
    expect(heatBadges()[0]?.children).toEqual(['0']);
    act(() => useGraphStore.setState({ heatAxis: 'read' }));
    expect(background()).toBe(readFill);
  });

  it('keeps untouched halo bubbles neutral instead of giving zero a positive heat glow', () => {
    useGraphStore.setState({ bubbleAppearancePending: { bubbleSkin: 'halo' } });
    render(sample({ readCount: 0 }));
    setHeat(true);
    const shadowColors = String(body().props.style.boxShadow).match(/#[\da-f]{6}/gi);
    expect(shadowColors?.length).toBeGreaterThan(0);
    expect(new Set(shadowColors)).toEqual(new Set([HEATMAP_ZERO_COLOR]));
    expect(background()).toContain(HEATMAP_ZERO_COLOR);
  });

  it('uses the selected curve and project maximum for heat color without changing the actual count', () => {
    useGraphStore.setState({ readCountRange: { max: 10_000 } });
    render(sample({ readCount: 100 }));
    setHeat(true);
    const linearPaint = background();
    act(() => useGraphStore.setState({ heatCurve: 'log' }));
    expect(background()).not.toBe(linearPaint);
    expect(heatBadges()[0]?.children).toEqual(['100']);
    act(() => useGraphStore.setState({ readCountRange: { max: 100 } }));
    expect(background().toLowerCase()).toContain('#dc2626');
    expect(heatBadges()[0]?.children).toEqual(['100']);
  });

  it('shows zero separately and aligns a continuous legend ramp with the node material colors', () => {
    useGraphStore.setState({ heatmapMode: true, readCountRange: { max: 600 } });
    const scene = (readCount: number) => <>
      <BubbleNode id="heat-file" data={{ ...sample({ readCount }) }} />
      <CanvasControls onTidy={vi.fn()} tidyBusy={false} tidyDisabled={false} />
    </>;
    act(() => { renderer = create(scene(0)); });
    const zeroSwatch = renderer!.root.find((node) => node.type === 'span'
      && typeof node.props.style?.background === 'string' && node.parent?.children.includes('0') === true);
    expect(zeroSwatch.props.style.background).toBe(heatmapFill(HEATMAP_ZERO_COLOR));
    expect(background()).toContain(zeroSwatch.props.style.background);
    const bar = renderer!.root.find((node) => node.type === 'div' && node.props['data-heat-legend-bar'] !== undefined);
    expect(bar.props.style.background).toMatch(/^linear-gradient\(to right in srgb,/);
    const stops = gradientStops(bar.props.style.background).map((stop) => stop.toLowerCase());
    // An extra zero stop would shift every positive count away from its tick color.
    expect(stops).toHaveLength(HEATMAP_RAMP.length);
    expect(stops).not.toContain(String(zeroSwatch.props.style.background).toLowerCase());
    for (let i = 0; i < stops.length; i++) {
      // A tiny positive value reaches the cold ramp endpoint; exact zero is its own state.
      act(() => renderer!.update(scene(i === 0 ? 0.0001 : i * 100)));
      expect(stops[i]).toBe(heatmapFill(HEATMAP_RAMP[i]!).toLowerCase());
      expect(background().toLowerCase()).toContain(stops[i]);
    }
    const labels = bar.parent!.findAll((node) => node.type === 'span'
      && typeof node.props.title === 'string' && node.props.title.startsWith('canvas.heatmap.max'));
    expect(labels.map((node) => ({ at: node.props.style.left, text: node.children.join('') }))).toEqual([
      { at: '25%', text: '150' }, { at: '50%', text: '300' }, { at: '75%', text: '450' },
    ]);
  });

  it.each(['internal_folder', 'external_folder', 'domain'] as const)('also fills %s using the displayed count', (bubbleType) => {
    render(sample({ bubbleType, readCount: 0, externalRollupReadCount: 100 }));
    const normalFill = background();
    setHeat(true);
    expect(background()).not.toBe(normalFill);
    expect(background().toLowerCase()).toContain('#dc2626');
    expect(heatBadges()[0]?.children).toEqual(['100']);
  });

  it.each(['image.png', 'video.mp4'])('replaces the %s preview with readable heat contents and restores it afterwards', (label) => {
    render(sample({ label, path: `/project/${label}` }));
    expect(renderer!.root.findAllByType('img')).toHaveLength(1);
    setHeat(true);
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    const labelNode = body().find((node) => node.type === 'span' && node.children.includes(label));
    expect(labelNode.parent!.props.className.split(/\s+/)).toContain('flex');
    expect(labelNode.parent!.props.className.split(/\s+/)).not.toContain('hidden');
    expect(heatBadges()[0]?.children).toEqual(['100']);
    setHeat(false);
    expect(renderer!.root.findAllByType('img')).toHaveLength(1);
    expect(heatBadges()).toHaveLength(0);
  });

  it('preserves custom agent paint and context fill when heatmap mode changes', () => {
    const agent = sample({ id: 'agent', bubbleType: 'agent', customCreated: true, contextUsed: 40, contextMax: 100 });
    useGraphStore.setState({ agentConfigs: { [agent.id]: { ...DEFAULT_AGENT_CONFIG, color: '#10B981' } } });
    render(agent);
    const normalFill = background();
    const waves = () => body().findAll((node) => node.type === 'path' && node.props.fill === '#10B981');
    expect(waves()).toHaveLength(2);
    setHeat(true);
    expect(background()).toBe(normalFill);
    expect(waves()).toHaveLength(2);
    expect(heatBadges()).toHaveLength(0);
  });
});
