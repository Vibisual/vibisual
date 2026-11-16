import { useTranslation } from 'react-i18next';

import { shortPath } from './codeLinkSource.js';
import { StudioCodeLines } from './StudioCodeLines.js';
import { StudioIcon } from './studioIcons.js';
import { memoLatest } from './studioMemo.js';
import type { CodeLinkAsset, CodeLocateState } from './useStudioCodeLink.js';

/**
 * §5.13 (V) 37-20 — 읽기 전용 코드 칸(레일 '코드'). 가운데 칸 안에 선다 — 넓은 창은 미리보기 왼쪽에 나란히, 1024px 미만 창은 미리보기 아래로
 * 내려간다(미리보기를 덮지 않는다 — 요소와 줄을 함께 봐야 한다). 고치는 길은 없다: 입력 칸이 없고 [에디터로 열기]가 바깥 에디터로 보낸다(37-19).
 */
export interface StudioCodeViewProps {
  readonly assets: readonly CodeLinkAsset[];
  readonly assetId: string | null;
  /** 지금 보는 파일(프로젝트 기준 경로). */
  readonly path: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** 읽은 글(없으면 null) · 그 폴더의 글 파일들 · 줄 수 · 상한에서 잘렸는가. */
  readonly text: string | null;
  readonly files: readonly string[];
  readonly lineCount: number;
  readonly truncated: boolean;
  /** 줄 연결이 있는 파일인가(그 소재의 HTML). */
  readonly linked: boolean;
  readonly focus: { readonly line: number; readonly endLine: number; readonly exact: boolean; readonly origin: 'pick' | 'code'; readonly seq: number } | null;
  readonly locate: { readonly state: CodeLocateState; readonly count: number };
  readonly onSelectAsset: (assetId: string) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onSelectLine: (line: number) => void;
  readonly onOpenEditor: () => void;
  readonly onClose: () => void;
}

const ASSET_PREFIX = 'a:';
const FILE_PREFIX = 'f:';

export const StudioCodeView = memoLatest(function StudioCodeView(p: StudioCodeViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const asset = p.assets.find((a) => a.id === p.assetId) ?? null;
  const folder = asset ? asset.path.slice(0, asset.path.lastIndexOf('/') + 1) : '';
  const others = asset ? p.files.filter((file) => file !== asset.path) : [];
  const value = asset && p.path && p.path !== asset.path ? `${FILE_PREFIX}${p.path}` : `${ASSET_PREFIX}${p.assetId ?? ''}`;
  const focus = p.focus;
  const note = p.status === 'error' ? t('panel.videoStudio.code.error')
    : p.text === null ? t('panel.videoStudio.code.loading')
      : !p.linked ? t('panel.videoStudio.code.noLink')
        : !focus ? t('panel.videoStudio.code.hint')
          : focus.origin === 'pick' ? t(focus.exact ? 'panel.videoStudio.code.picked' : 'panel.videoStudio.code.pickedInside')
            : p.locate.state === 'shown' ? t('panel.videoStudio.code.shown', { count: p.locate.count })
              : p.locate.state === 'hidden' ? t('panel.videoStudio.code.hidden')
                : p.locate.state === 'notElement' ? t('panel.videoStudio.code.notElement')
                  : '';
  const openLabel = focus ? t('panel.videoStudio.code.openEditorAt', { line: focus.line }) : t('panel.videoStudio.code.openEditor');
  return (
    <section aria-label={t('panel.videoStudio.code.label')}
      className="flex min-h-0 w-[clamp(18rem,34%,36rem)] shrink-0 animate-[vs-in-left_160ms_ease-out] flex-col overflow-hidden rounded-lg border border-white/10 bg-vb-card box-wide:w-[clamp(18rem,34%,44rem)] box-compact:order-last box-compact:h-[40%] box-compact:min-h-32 box-compact:w-full box-compact:animate-[vs-in-up_160ms_ease-out]">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-white/10 px-2">
        <StudioIcon name="code" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <select value={value} aria-label={t('panel.videoStudio.code.file')} title={p.path ?? ''}
          onChange={(e) => {
            const next = e.target.value;
            if (next.startsWith(ASSET_PREFIX)) p.onSelectAsset(next.slice(ASSET_PREFIX.length));
            else p.onSelectFile(next.slice(FILE_PREFIX.length));
          }}
          className="h-7 min-w-0 flex-1 truncate rounded-md border border-white/10 bg-vb-sunken px-1.5 text-[12px] text-slate-200 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9">
          {p.assets.map((a) => <option key={a.id} value={`${ASSET_PREFIX}${a.id}`}>{shortPath(a.path)}</option>)}
          {others.map((file) => <option key={file} value={`${FILE_PREFIX}${file}`}>{file.startsWith(folder) ? file.slice(folder.length) : shortPath(file)}</option>)}
        </select>
        <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[12px] text-slate-400 box-narrow:hidden">{t('panel.videoStudio.code.readOnly')}</span>
        <button type="button" disabled={!p.path} onClick={p.onOpenEditor} title={openLabel} aria-label={openLabel}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 text-[12px] text-slate-200 hover:bg-white/10 disabled:opacity-40 pointer-coarse:h-9">
          <StudioIcon name="ide" className="h-3.5 w-3.5" /><span className="box-narrow:hidden">{t('panel.videoStudio.code.openEditor')}</span>
        </button>
        <button type="button" onClick={p.onClose} aria-label={t('common.close', { defaultValue: 'Close' })}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2.5"><StudioIcon name="close" className="h-3.5 w-3.5" /></button>
      </header>
      <p className="flex min-h-7 shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1 text-[12px] text-slate-400" aria-live="polite">
        {focus && p.linked ? <span className="shrink-0 font-semibold tabular-nums text-slate-200">{t('panel.videoStudio.code.lineOf', { line: focus.line, total: p.lineCount })}</span> : null}
        <span className="min-w-0 flex-1 truncate" title={note}>{note}</span>
      </p>
      {p.truncated ? <p className="shrink-0 border-b border-white/10 px-2 py-1 text-[12px] text-amber-200">{t('panel.videoStudio.code.truncated')}</p> : null}
      {p.text !== null && p.path ? (
        <StudioCodeLines text={p.text} path={p.path} focus={p.linked ? focus : null} selectable={p.linked} onSelectLine={p.onSelectLine} label={t('panel.videoStudio.code.lines', { file: shortPath(p.path) })} />
      ) : <div className="min-h-0 flex-1 bg-vb-sunken" />}
    </section>
  );
});
