// §4 폴더 우클릭으로 프로젝트 열기 — OS 메뉴로 받은 폴더를 서버에 등록하고, 그 탭 이름을 메인 창 렌더러에 넘긴다.
// 앱이 그 클릭으로 켜지는 중이면 동의·서버 기동이 끝날 때까지, 렌더러가 받을 준비를 할 때까지 줄에 세운다.

export interface ShellFolderOpenerDeps {
  isDirectory(p: string): boolean;
  /** 서버에 프로젝트로 등록하고 그 표시명을 돌려준다. 실패면 null. */
  register(p: string): Promise<string | null>;
  /** 받을 준비가 된 렌더러에 보낸다. 받을 창이 없으면 false — 줄에 남겨 `takePending` 이 돌려준다. */
  send(name: string): boolean;
  log(msg: string): void;
}

export interface ShellFolderOpener {
  request(paths: readonly string[]): void;
  /** 서버가 떴다 — 기다리던 폴더를 차례로 연다. */
  backendReady(): void;
  /** 렌더러가 받을 준비가 됐다 — 못 보낸 이름을 차례대로 돌려준다(마지막 것이 보이는 탭이 된다). */
  takePending(): string[];
}

export function createShellFolderOpener(deps: ShellFolderOpenerDeps): ShellFolderOpener {
  const waiting: string[] = [];
  const undelivered: string[] = [];
  let ready = false;
  // 한 번에 하나씩 — 여러 폴더가 겹쳐 와도 연 순서대로 탭이 바뀐다.
  let chain: Promise<void> = Promise.resolve();

  const open = (p: string): void => {
    chain = chain.then(async () => {
      let name: string | null = null;
      try {
        name = await deps.register(p);
      } catch (err) {
        deps.log(`[shell-open] register failed for ${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!name) return;
      if (deps.send(name)) {
        deps.log(`[shell-open] opened ${p} → tab "${name}"`);
        return;
      }
      const at = undelivered.indexOf(name);
      if (at >= 0) undelivered.splice(at, 1);
      undelivered.push(name);
      deps.log(`[shell-open] opened ${p} → tab "${name}" (switches when the window is ready)`);
    });
  };

  return {
    request(paths) {
      for (const p of paths) {
        // mac 은 Dock 아이콘에 파일을 놓아도 같은 사건(`open-file`)이 온다 — 폴더만 받는다.
        if (!deps.isDirectory(p)) {
          deps.log(`[shell-open] not a folder, ignored: ${p}`);
          continue;
        }
        if (ready) open(p);
        else if (!waiting.includes(p)) {
          waiting.push(p);
          deps.log(`[shell-open] waiting for the app to start: ${p}`);
        }
      }
    },
    backendReady() {
      if (ready) return;
      ready = true;
      for (const p of waiting.splice(0)) open(p);
    },
    takePending() {
      return undelivered.splice(0);
    },
  };
}
