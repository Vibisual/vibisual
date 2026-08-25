/**
 * §5.13 (O) v4.48 — Vibistudio 의 main 프로세스 몫.
 *
 * 창 규격과 오프스크린 렌더가 여기 모여 있다. **코어는 이 파일의 존재만 알고 내용은
 * 모른다** — `apps/index.ts` 의 배열에 한 줄로 등록될 뿐이다.
 *
 * 두 번째 앱은 이 파일과 같은 모양의 파일 하나를 옆에 두면 되고, `ipc.ts` 와 `preload`
 * 와 `windowManager` 는 손대지 않는다.
 */
import type { AppMainHost, AppWindowSpec } from '../host.js';
import { captureOffscreenAt, closeOffscreen, openOffscreen, probeOffscreen, setMainHost } from './offscreen.js';

const DEFAULT_W = 1280;
const DEFAULT_H = 860;
const MIN_W = 900;
const MIN_H = 620;

/** 코어의 앱 호스트가 기대하는 모양. 앱은 코어 타입을 import 하지 않는다. */
export interface VideoMainModule {
  id: string;
  attach: (host: AppMainHost) => void;
  window: (params: Record<string, string>) => AppWindowSpec;
  invoke: (action: string, payload: unknown) => Promise<unknown>;
}

export const vibistudioApp: VideoMainModule = {
  id: 'vibistudio',

  attach: setMainHost,

  window: (params) => {
    const projectId = params['projectId'] ?? '';
    const docId = params['docId'];
    const docPart = docId === undefined || docId === '' ? '' : `&docId=${encodeURIComponent(docId)}`;
    // §5.13 (R-2) — 눌러서 연 파일(루트 기준 상대 경로). 창은 이 값을 그대로 셸에 넘긴다.
    const file = params['file'];
    const filePart = file === undefined || file === '' ? '' : `&file=${encodeURIComponent(file)}`;
    const spec: AppWindowSpec = {
      title: 'Vibisual — Vibistudio',
      width: DEFAULT_W,
      height: DEFAULT_H,
      minWidth: MIN_W,
      minHeight: MIN_H,
      hash: `app=vibistudio&projectId=${encodeURIComponent(projectId)}${docPart}${filePart}`,
    };
    return spec;
  },

  /**
   * 이 앱만 아는 기능 — 오프스크린 렌더(§5.13 (F)).
   *
   * 코어는 `action` 문자열의 뜻을 모르고 그대로 넘긴다. 그래서 여기에 무엇을 더 넣어도
   * `ipc.ts` 는 그대로다.
   */
  invoke: async (action, payload) => {
    switch (action) {
      case 'offscreen:probe':
        return probeOffscreen();
      case 'offscreen:open': {
        const p = payload as { width: number; height: number; project: string; docId: string };
        await openOffscreen(p);
        return null;
      }
      case 'offscreen:capture': {
        const p = payload as { t: number };
        const png = await captureOffscreenAt(p.t);
        // Buffer 를 그대로 보내면 구조적 복제에서 Uint8Array 로 바뀐다 — ArrayBuffer 로 통일.
        return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
      }
      case 'offscreen:close':
        await closeOffscreen();
        return null;
      default:
        throw new Error(`vibistudio — 알 수 없는 동작: ${action}`);
    }
  },
};
