/**
 * openWorkspaceTarget.ts — §5.13 (R-7) 파일을 눌렀을 때 실제로 여는 자리(판정은 shared `resolveWorkspaceOpen`) — 결과를 있는 레일로만 넘긴다(새 레일 ❌, ⑬ (d)).
 * 모든 클릭 지점이 이걸 불러 같은 파일은 어디서든 같은 곳에서 열린다.
 */
import { resolveWorkspaceOpen, type WorkspaceOpenPlan, type WorkspacePathKind } from '@vibisual/shared';

import { workspaceOpenClaims } from '../../apps/registry.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { fetchCachedConversion, useMediaConvert } from '../../stores/mediaConvert.js';
import { editorFileFromAbsPath } from './editorModel.js';
import type { EditorLineRange } from './editorLineRange.js';
import { runExecutableFile } from './runExecutableFile.js';
import { openFolderByPath } from './useWorkspaceExplorer.js';

export interface WorkspaceOpenTarget {
  /** 프로젝트 루트 기준 상대 경로. */
  readonly relPath: string;
  readonly absPath: string;
  readonly kind: WorkspacePathKind;
  /** 서버가 디스크를 보고 정한 값. 모르면 생략(실행 갈래로 가지 않는다). */
  readonly executable?: boolean;
  /**
   * §5.5 #17-27 ⑬ (g) — 적혀 온 줄 범위. **텍스트 편집창으로 갈 때만** 쓴다 — 그림·PDF·앱·실행에는
   * 줄이 없으므로 받아도 버린다.
   */
  readonly lines?: EditorLineRange | null;
}

/** 이 파일이 어디로 갈지만 계산한다(아이콘·툴팁이 누르기 전에 말하기 위해 화면도 이걸 쓴다). */
export function planWorkspaceOpen(target: {
  relPath: string;
  kind: WorkspacePathKind;
  executable?: boolean;
}): WorkspaceOpenPlan {
  return resolveWorkspaceOpen({
    relPath: target.relPath,
    kind: target.kind,
    ...(target.executable === undefined ? {} : { executable: target.executable }),
    apps: workspaceOpenClaims(),
  });
}

/**
 * 그 파일을 열고 어디로 갔는지 돌려준다(호출부가 화면에 적는다).
 * @param rootPath 프로젝트 루트 절대 경로(= 내부 앱이 받는 `projectId`).
 * @param runFailNote 실행이 못 시작됐을 때 출력 패널에 남길 한 줄(번역은 화면이 한다).
 * @param paneKey 연 IDE 창(§5.5 #17-1) — 편집창·실행이 그 창에서 일어나야 한다.
 */
export async function openWorkspaceTarget(
  target: WorkspaceOpenTarget,
  rootPath: string,
  runFailNote: string,
  paneKey?: string | null,
): Promise<WorkspaceOpenPlan> {
  const plan = planWorkspaceOpen(target);

  switch (plan.action) {
    case 'folder':
      openFolderByPath(target.absPath, target.relPath);
      break;

    case 'run':
      await runExecutableFile(target.absPath, { failNote: runFailNote, paneKey });
      break;

    case 'app': {
      // §5.13 (S-6) — 버블 더블클릭과 **같은 문**으로 연다(앱 안 창). 밖으로 나가는 것은 그 창을
      //   끌어냈을 때뿐이다 — 같은 파일이 누른 자리에 따라 다른 곳에서 열리면 안 된다.
      const opened = plan.appId !== undefined
        && openAppWindow({ appId: plan.appId, projectId: rootPath, file: target.relPath });
      // 등록되지 않은 앱이면 연결 프로그램으로 떨어진다 — 눌렀는데 아무 일도 안 일어나는 것보다 낫다.
      if (!opened) await openExternally(target.absPath);
      break;
    }

    case 'external':
      await openExternally(target.absPath);
      break;

    /** §5.13 (R-8) — 못 읽는 영상·소리: 변환본이 있으면 묻지 않고 열고, 없을 때만 팝업(변환 · 연결 프로그램). */
    case 'convert': {
      const kind = plan.convertTo ?? 'video';
      const cached = await fetchCachedConversion(rootPath, target.relPath, kind);
      if (cached !== null) {
        const base = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
        await openWorkspaceTarget({ relPath: cached, absPath: `${base}/${cached}`, kind: 'file' }, rootPath, runFailNote, paneKey);
        break;
      }
      useMediaConvert.getState().open({ root: rootPath, relPath: target.relPath, absPath: target.absPath, kind });
      break;
    }

    // editor · image · pdf 는 전부 내장 편집창이 받는다. 텍스트로 그릴지 그림으로 그릴지
    // PDF 뷰어로 그릴지는 **편집창이** 정한다 — 여는 쪽이 그리는 방법까지 알 필요는 없다.
    // ⑬ (g) — 줄 범위는 텍스트 갈래에만 싣는다(그 줄로 스크롤·칠하기는 편집창이 본문을 읽은 뒤 한다).
    default:
      useGraphStore.getState().openIDEEditorFile(
        editorFileFromAbsPath(target.absPath, rootPath),
        paneKey,
        plan.action === 'editor' ? target.lines : null,
      );
      break;
  }

  return plan;
}

/**
 * OS 연결 프로그램으로 넘긴다(§5.13 (R-6), 실패해도 화면을 막지 않는다). 편집창 [바깥 브라우저](#17-27 ⑮ (b))도 이걸 쓴다(.html 연결 프로그램 = 기본 브라우저, 새 레일 ❌).
 * `openFileByPath`(외부 에디터)와 헷갈리지 말 것.
 */
export async function openExternally(absPath: string): Promise<void> {
  try {
    await fetch('/api/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absolutePath: absPath }),
    });
  } catch {
    /* 서버가 잠깐 끊긴 경우 — 조용히 넘어간다(호출부가 다음 행동을 막지 않게) */
  }
}
