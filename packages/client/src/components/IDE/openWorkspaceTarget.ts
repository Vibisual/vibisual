/**
 * openWorkspaceTarget.ts — §5.13 (R-7) 파일 하나를 눌렀을 때 **실제로 여는 자리**.
 *
 * 판정(`resolveWorkspaceOpen`, shared)과 실행(여기)을 갈라 둔 이유는 판정이 순수 계산이라
 * 테스트가 지킬 수 있어서다. 여기서는 그 결과를 이미 있는 여섯 레일로 넘기기만 한다 —
 * **새 열기 레일을 만들지 않는다**(⑬ (d) 의 규약을 그대로 잇는다):
 *
 *   editor / image / pdf → 내장 편집창(②)   ·   app → 내부 앱 창(§5.13)
 *   run → 실행 세션(⑬ (h))                   ·   external → OS 연결 프로그램
 *   folder → 시스템 탐색기(⑩)
 *
 * 클릭 지점(스트림 본문 · 탐색기 · 편집한 파일 목록)이 전부 이 함수를 부르므로, 같은 파일은
 * 어디서 눌러도 같은 곳에서 열린다.
 */
import { resolveWorkspaceOpen, type WorkspaceOpenPlan, type WorkspacePathKind } from '@vibisual/shared';

import { workspaceOpenClaims } from '../../apps/registry.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { fetchCachedConversion, useMediaConvert } from '../../stores/mediaConvert.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { runExecutableFile } from './runExecutableFile.js';
import { openFolderByPath } from './useWorkspaceExplorer.js';

export interface WorkspaceOpenTarget {
  /** 프로젝트 루트 기준 상대 경로. */
  readonly relPath: string;
  readonly absPath: string;
  readonly kind: WorkspacePathKind;
  /** 서버가 디스크를 보고 정한 값. 모르면 생략(실행 갈래로 가지 않는다). */
  readonly executable?: boolean;
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
 * 그 파일을 연다. 어디로 갔는지를 돌려주므로 호출부가 결과를 화면에 적을 수 있다.
 *
 * @param rootPath 프로젝트 루트 절대 경로(= 내부 앱이 받는 `projectId`).
 * @param runFailNote 실행이 시작되지 못했을 때 출력 패널에 남길 한 줄(번역은 화면이 한다).
 * @param paneKey 어느 IDE 창에서 열었는지(§5.5 #17-1) — 편집창·실행이 그 창에서 일어나야 한다.
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

    /**
     * §5.13 (R-8) — 우리 엔진이 못 읽는 영상·소리.
     *
     * **이미 변환해 둔 것이 있으면 아무것도 묻지 않는다** — 두 번째부터 팝업 없이 바로 열리는 자리다.
     * 없을 때만 팝업을 띄우고, 무엇을 할지는 사용자가 고른다(변환 · 연결 프로그램).
     */
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
    default:
      useGraphStore.getState().openIDEEditorFile(editorFileFromAbsPath(target.absPath, rootPath), paneKey);
      break;
  }

  return plan;
}

/**
 * OS 연결 프로그램으로 넘긴다(§5.13 (R-6)). 실패해도 화면을 막지 않는다.
 *
 * 편집창의 페이지 미리보기(#17-27 ⑮ (b) [바깥 브라우저])도 이 함수를 부른다 — .html 의 연결
 * 프로그램이 곧 기본 브라우저다(새 레일 ❌). `openFileByPath`(외부 **에디터**)와 헷갈리지 말 것.
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
