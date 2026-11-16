import { useTranslation } from 'react-i18next';
import { linkedFileName, type AppBubblePastFile } from '@vibisual/shared';
import type { AppLinkedItem } from '../../apps/registry.js';
import { thumbnailAppFor } from '../../apps/appLinkedItems.js';
import type { AppLinkedSatellitesProps } from './AppLinkedSatellites.js';
import { BeadPicture, KindGlyph, itemTitle, stageStyle } from './linkedBeadParts.js';

interface AppLinkedGlanceTileProps {
  item?: AppLinkedItem;
  past?: AppBubblePastFile;
  owner: AppLinkedSatellitesProps;
  selected?: boolean;
  onSelect?: () => void;
}

export function AppLinkedGlanceTile({ item, past, owner: p, selected, onSelect }: AppLinkedGlanceTileProps): React.JSX.Element {
  const { t } = useTranslation();
  const title = item ? itemTitle(item, t) : `${linkedFileName(past?.file ?? '')}\n${t('canvas.linkedItems.openPastHint')}`;
  const file = item?.file ?? past?.file;
  const pictureApp = past ? p.appId : file ? thumbnailAppFor(file) : null;
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={item?.stageFocus ? selected : undefined}
      className={`relative flex h-11 min-w-0 items-center justify-center rounded border bg-slate-900 text-slate-200 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${past ? 'border-dashed' : ''} ${selected ? 'ring-2 ring-white/75' : ''} ${item?.active ? 'motion-safe:animate-pulse' : ''}`}
      style={item?.group === 'scene' ? stageStyle(item.stage, p.glow) : undefined}
      onClick={onSelect} onDoubleClick={() => { if (past) p.onOpenPast(past.file); else p.onOpenNode(); }}>
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] [&_img]:rounded-none">
        {item?.image ? <img src={item.image} alt="" draggable={false} className="h-full w-full object-cover" />
          : file && pictureApp ? <BeadPicture appId={pictureApp} projectId={p.projectId} file={file} version={past?.at ?? 0} fallback={<KindGlyph kind={item?.kind ?? 'file'} />} />
            : <KindGlyph kind={item?.kind ?? 'file'} />}
      </span>
      {item?.stage === 'building' ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-slate-400/35" /> : null}
      {typeof item?.index === 'number' ? <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/75 px-1 text-[12px] leading-4 text-white">{item.index}</span> : null}
      {item?.changed ? <span aria-label={t('canvas.linkedItems.changed')} className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-slate-950 bg-sky-300" /> : null}
    </button>
  );
}
