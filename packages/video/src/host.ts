/**
 * §5.13 (P) 도킹 계약 — 앱은 코어를 import 하지 않는다(서로 부르면 떼어 낼 수 없다). 필요한 것은 여기 인터페이스로 적고 호스트가 건넨다 —
 * 이 파일이 유일한 접촉면이다.
 */

import type { CreationLink } from '@vibisual/shared';

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
  /**
   * 앱 원본의 **참조 관계만** 공통 색인(거울)에 반영한다 — 본문은 싣지 않는다(앱 문서가 본문의 주인). 링크도 거울도 없으면
   * 아무것도 쓰지 않고 null, 제목·링크가 그대로면 쓰지 않는다(§5.13 (R-10)).
   */
  syncCreationSource?(
    projectPath: string,
    source: { key: string; appId: string; title: string; links: CreationLink[] },
  ): Promise<{ id: string; revision: number } | null>;
  /**
   * §5.13 (T-4)(T-11) ① — 서버 몫 → 같은 앱 main 몫 `invoke`(한 프로세스라 새 소켓·IPC 없음, §3.7). 일감이 오면 숨은 일꾼 창을 깨운다.
   * main 이 없는 실행(단위 시험·웹)에선 비어 있다 — 일감은 줄에서 다른 일꾼을 기다린다.
   */
  invokeMain?(action: string, payload?: unknown): Promise<unknown>;
  /**
   * §5.13 (Y) 40-7 ② — 열린 창들에 알린다(문서 판이 올랐다 등). 호스트가 기존 방송 한 줄로 나르고 뜻은 모른다. 없는 실행 형태
   * (단위 시험)면 비어 있다 — 그때 창은 폴링(안전망)으로 알아챈다.
   */
  notify?(event: { project: string; kind: string; key: string; version?: number }): void;
}

/** 앱 main 몫은 `dispose()`(본체 창이 닫힐 때 숨은 창 정리, T-11 ④)도 낼 수 있다. */
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
