import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelSection } from './editorControls.js';
import { EditorIcon, type EditorIconName } from './editorIcons.js';
import { imageLabelKey } from './imageLabels.js';

type DockPanel = 'properties' | 'layers' | 'sources';

interface ImageEditorDockProps {
  narrow: boolean;
  properties: ReactNode;
  layers: ReactNode;
  /** 연결 원본(원본 고르기·연결 목록) — 저장한 원본이 없으면 null. */
  sources: ReactNode | null;
  layerCount: number;
  linkCount: number;
}

const TABS: readonly { id: DockPanel; icon: EditorIconName; label: string }[] = [
  { id: 'properties', icon: 'sliders', label: 'propertiesPanel' },
  { id: 'layers', icon: 'layers', label: 'layers' },
  { id: 'sources', icon: 'sourceLink', label: 'sourcesPanel' },
];

/**
 * §5.13 (R-9) 레이어 편집기 ① — 오른쪽 패널 셋(속성·레이어·연결 원본). 넓은 창은 머리를 눌러 접는 세로 묶음,
 * 폰 폭은 무대 아래 탭 — 같은 세 패널이고 입구는 지우지 않는다. 연결 원본은 링크가 있을 때만 처음부터 펼친다.
 */
export function ImageEditorDock({ narrow, properties, layers, sources, layerCount, linkCount }: ImageEditorDockProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const [open, setOpen] = useState<Record<DockPanel, boolean>>({ properties: true, layers: true, sources: linkCount > 0 });
  const [tab, setTab] = useState<DockPanel>('properties');
  const toggle = (panel: DockPanel): void => setOpen((value) => ({ ...value, [panel]: !value[panel] }));
  const count = (panel: DockPanel): string => panel === 'layers' ? String(layerCount) : panel === 'sources' && linkCount ? String(linkCount) : '';
  const shell = 'flex min-h-0 shrink-0 flex-col border-l border-gray-800 bg-gray-900 w-72 box-wide:w-80 box-compact:w-60';
  if (narrow) {
    const body = tab === 'properties' ? properties : tab === 'layers' ? layers : sources;
    return <aside className="flex h-[45%] min-h-40 shrink-0 flex-col border-t border-gray-800 bg-gray-900">
      <div role="tablist" aria-label={key('panels')} className="flex shrink-0 border-b border-gray-800">
        {TABS.filter((item) => item.id !== 'sources' || sources).map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
          onClick={() => setTab(item.id)}
          className={`flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 text-xs ${tab === item.id ? 'border-blue-500 text-gray-100' : 'border-transparent text-gray-400'}`}>
          <EditorIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{key(item.label)}</span>
          {count(item.id) && <span className="shrink-0 tabular-nums text-gray-500">{count(item.id)}</span>}
        </button>)}
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">{body}</div>
    </aside>;
  }
  return <aside aria-label={key('panels')} className={shell}>
    <PanelSection title={key('propertiesPanel')} open={open.properties} onToggle={() => toggle('properties')}
      className={open.properties ? 'flex-[3_1_0%]' : ''}>{properties}</PanelSection>
    <PanelSection title={`${key('layers')} · ${layerCount}`} open={open.layers} onToggle={() => toggle('layers')}
      className={open.layers ? 'flex-[2_1_0%]' : ''}>{layers}</PanelSection>
    {sources && <PanelSection title={linkCount ? `${key('sourcesPanel')} · ${linkCount}` : key('sourcesPanel')} open={open.sources}
      onToggle={() => toggle('sources')} className={open.sources ? 'max-h-[45%] flex-[2_1_0%]' : ''}>{sources}</PanelSection>}
  </aside>;
}
