/**
 * §5.13 (P) — 앱이 호스트에게 요구하는 것 (도킹 계약).
 *
 * **앱은 Vibisual 코어를 import 하지 않는다.** 앱이 코어를 부르면 두 패키지가 서로를
 * 부르는 고리가 생기고, 그 순간 "따로 떼어 낼 수 있다"는 말이 거짓이 된다. 대신 앱은
 * *필요한 것*을 여기 인터페이스로 적고, 호스트가 붙일 때 그것을 건네준다.
 *
 * 이 파일이 앱과 코어 사이의 **유일한 접촉면**이다. 여기 없는 것을 앱이 쓰기 시작하면
 * 그때부터 독립이 깨진 것이므로, 무엇이 오갔는지가 이 한 파일만 보면 드러난다.
 */

/** 서버 몫이 호스트에게 요구하는 것. */
export interface AppServerHost {
  /**
   * 프로젝트 이름이나 경로를 실제 프로젝트 루트로 바꾼다. 모르는 프로젝트면 null.
   * 앱은 프로젝트가 무엇인지 모르고, 어디에 쓰는지만 안다(§3.5 프로젝트 독립성).
   */
  resolveProjectPath(raw: unknown): string | null;
  /** 원자적 파일 쓰기(§3.2.1). 앱이 직접 fs 로 쓰면 손실 방지 인프라 밖으로 나간다. */
  atomicWriteFile(filePath: string, data: string): void;
  info(message: string): void;
  warn(message: string): void;
}

/** main 프로세스 몫이 호스트에게 요구하는 것. */
export interface AppMainHost {
  /** 렌더러 파일 경로(오프스크린 창이 열 화면). */
  rendererFile: string;
  /** preload 파일 경로. */
  preloadFile: string;
}

/** 창 규격. 코어의 창 관리자가 이 값 그대로 연다. */
export interface AppWindowSpec {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** `app=<id>&mode=<mode>&…` — 렌더러가 어떤 화면을 그릴지. */
  hash: string;
}
