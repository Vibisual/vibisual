import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// §4 폴더 우클릭으로 프로젝트 열기 — 메인 윈도우 전용. main 이 서버에 등록을 끝낸 프로젝트로 탭을 바꾼다
// ([폴더 열기]와 같은 `activateOpenedProject`). 구독을 먼저 걸고 준비를 알린다 — 그 사이에 온 것을 놓치지 않게.
// window.api.project 가 없으면(web 모드·구버전 preload) no-op.

export function useShellFolderOpen(): void {
  useEffect(() => {
    const project = typeof window !== 'undefined' ? window.api?.project : undefined;
    if (!project) return;
    let alive = true;
    const activate = (name: string): void => {
      if (alive) useGraphStore.getState().activateOpenedProject(name);
    };
    const off = project.onOpenedFromShell(({ name }) => activate(name));
    void project.shellOpenReady()
      .then((pending) => {
        // 켜지는 사이 여러 개가 왔으면 마지막 것이 보이는 탭이다(나머지도 탭으로는 이미 열려 있다).
        const last = pending[pending.length - 1];
        if (last) activate(last);
      })
      .catch(() => { /* main 이 그 채널을 모르는 옛 판 — 우클릭 열기만 없다 */ });
    return () => {
      alive = false;
      off();
    };
  }, []);
}
