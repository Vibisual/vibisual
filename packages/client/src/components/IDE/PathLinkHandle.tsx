import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceOpenPlan } from '@vibisual/shared';
import type { MenuText } from './editorContextMenu.js';
import { formatLineRef, type EditorLineRange } from './editorLineRange.js';
import type { PathLinkRails } from './usePathLinkRails.js';
import { getInternalApp } from '../../apps/registry.js';

/** §5.5 #17-27 ⑬ 경로 손잡이의 화면 한 벌 — 인라인 코드·링크·카드 글자가 같이 쓴다((l)). */

/** ⑬ (f) — 손잡이 앞 글리프: 어디서 열리는지를 그림 하나로. `plan === null` 은 루트 밖(⑬ (d)). */
export const PathLinkGlyph = memo(function PathLinkGlyph({ plan }: { plan: WorkspaceOpenPlan | null }): React.JSX.Element {
  const app = plan?.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;

  if (plan === null) {
    // 루트 밖은 갈래가 하나라 아이콘도 하나 — 폴더에서 나가는 화살표(우리 창이 아니라 탐색기에서 열린다)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v2" />
        <path d="M5 19a2 2 0 0 1-2-2V7" />
        <path d="M14 19h7v-7" />
        <path d="M21 12l-7 7" />
      </svg>
    );
  }
  if (plan.action === 'run') {
    // run — 재생 삼각형(누르면 열리는 것이 아니라 **돈다**는 뜻)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4l14 8-14 8z" />
      </svg>
    );
  }
  if (plan.action === 'app' && app) {
    // 내부 앱 — **그 앱의 아이콘**을 그대로 쓴다(코어가 앱마다 그림을 들지 않는다, §5.13 (P)).
    //   앱 아이콘은 목록용 치수(h-4)라 인라인 글자 옆에서는 크다 — 이 자리에서만 줄인다.
    return (
      <span className="mr-[3px] inline-flex align-[-0.15em] opacity-80 [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
        <app.icon />
      </span>
    );
  }
  if (plan.action === 'external') {
    // external — 상자 밖으로 나가는 화살표(우리 창이 아니라 바깥에서 열린다)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
    );
  }
  if (plan.action === 'folder') {
    // folder
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  // file — 모서리 접힌 문서(편집창·그림·PDF 는 전부 우리 창에서 열린다)
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
});

/** ⑬ (f) — 툴팁은 "전체 경로 + 벌어질 일"(여는 곳이 갈리면 말도 갈린다). ⑬ (g) — 줄 범위가 있으면 경로 뒤에 `:806-807` 까지 적는다. */
function pathLinkTitle(plan: WorkspaceOpenPlan, absPath: string, t: MenuText, lines: EditorLineRange | null): string {
  const app = plan.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;
  switch (plan.action) {
    case 'run':
      return t('ide.streamRenderer.pathLink.runProgram', { path: absPath });
    case 'app':
      return t('ide.streamRenderer.pathLink.openApp', { app: app?.name ?? plan.appId, path: absPath });
    case 'external':
      return t('ide.streamRenderer.pathLink.openExternal', { path: absPath });
    case 'folder':
      return t('ide.streamRenderer.pathLink.openFolder', { path: absPath });
    default:
      // 줄은 텍스트 편집창에서만 뜻이 있다(그림·PDF 는 줄을 버린다 — `openWorkspaceTarget` 과 같은 판정).
      return t('ide.streamRenderer.pathLink.openFile', { path: plan.action === 'editor' ? formatLineRef(absPath, lines) : absPath });
  }
}

/** ⑬ (f) — 루트 **밖** 툴팁. 파일이면 그 파일이 **든 폴더**가 열린다는 것까지 누르기 전에 말한다 —
 *  문서가 열릴 것으로 기대하고 눌렀다가 탐색기가 뜨면 그건 고장으로 읽힌다. */
function outsidePathLinkTitle(kind: string, absPath: string, t: MenuText): string {
  return kind === 'directory'
    ? t('ide.streamRenderer.pathLink.revealOutsideFolder', { path: absPath })
    : t('ide.streamRenderer.pathLink.revealOutsideFile', { path: absPath });
}

/** 디스크가 있다고 답해 손잡이로 그려도 되는가(⑬ (b)). 아직 모르거나 없으면 거짓 — 부르는 쪽이 평문으로 둔다. */
export function isPathLinkLive(rails: PathLinkRails): boolean {
  return rails.linkedOutside !== null || (rails.linked !== null && rails.plan !== null);
}

/** 눌리는 버튼 + 우클릭 메뉴. 손잡이가 아니면 아무것도 그리지 않는다(`isPathLinkLive` 로 먼저 가른다). */
export function PathLinkHandle({ rails, lines, className, children }: {
  rails: PathLinkRails;
  lines: EditorLineRange | null;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const cls = className === undefined ? 'ide-path-link' : `ide-path-link ${className}`;

  if (rails.linkedOutside) {
    const title = outsidePathLinkTitle(rails.linkedOutside.kind, rails.linkedOutside.absPath, t);
    return (
      <>
        <button type="button" onClick={rails.onReveal} onContextMenu={rails.onContextMenu} title={title} aria-label={title} className={cls}>
          <PathLinkGlyph plan={null} />
          {children}
        </button>
        {rails.menu}
      </>
    );
  }

  if (!rails.linked || !rails.plan) return null;

  const title = pathLinkTitle(rails.plan, rails.linked.absPath, t, lines);
  return (
    <>
      <button type="button" onClick={rails.onOpen} onContextMenu={rails.onContextMenu} title={title} aria-label={title} className={cls}>
        <PathLinkGlyph plan={rails.plan} />
        {children}
      </button>
      {rails.menu}
    </>
  );
}
