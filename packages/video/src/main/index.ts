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
import {
  captureOffscreenAt,
  closeAllOffscreen,
  closeOffscreen,
  inspectOffscreen,
  openOffscreen,
  probeOffscreen,
  setMainHost,
} from './offscreen.js';
import { closeWorker, ensureWorker } from './worker.js';
import { capturePageImage } from './pageCapture.js';
import { downloadLibrary } from './libsDownload.js';
import { disposeExportHost, exportDone, openExport, openExportFolder, pickExportFolder, revealExport, setKeepAwake } from './exportHost.js';

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
  /** §5.13 (T-11) ④ — 본체 창이 닫힐 때 이 앱이 띄운 숨은 창(일꾼·오프스크린)을 정리한다. */
  dispose: () => void;
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
    // §5.13 (L) — 이 창을 연 캔버스 노드. 밖에서 다른 문서를 골라도 노드가 그 문서를 기억한다.
    const bubble = params['appBubbleId'];
    const bubblePart = bubble === undefined || bubble === '' ? '' : `&appBubbleId=${encodeURIComponent(bubble)}`;
    const spec: AppWindowSpec = {
      title: 'Vibisual — Vibistudio',
      width: DEFAULT_W,
      height: DEFAULT_H,
      minWidth: MIN_W,
      minHeight: MIN_H,
      hash: `app=vibistudio&projectId=${encodeURIComponent(projectId)}${docPart}${filePart}${bubblePart}`,
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
        // §5.13 (W) 38-1·38-3·38-7 — 맞춤 배율을 돌려주고, 투명 배경·장면 정지 화면을 렌더 화면에 넘긴다.
        const p = payload as { width: number; height: number; project: string; docId: string; session?: string; rev?: string; alpha?: boolean; frame?: string };
        return openOffscreen(p);
      }
      case 'offscreen:capture': {
        const p = payload as { t: number; session?: string; format?: 'raw' | 'png' };
        const shot = await captureOffscreenAt(p.t, p.session, p.format);
        // §5.13 (W) 38-1 — 날 비트맵은 그대로(이미 ArrayBuffer). PNG 는 Buffer 를 ArrayBuffer 로(구조적 복제에서 모양을 지키게).
        if (!Buffer.isBuffer(shot)) return shot;
        return shot.buffer.slice(shot.byteOffset, shot.byteOffset + shot.byteLength) as ArrayBuffer;
      }
      // §5.13 (V) 37-9 — 프레임 검수: 마지막으로 찍은 시각의 컴포지션 글자 상자(읽기 전용).
      case 'offscreen:inspect': {
        const p = (payload ?? {}) as { session?: string };
        return inspectOffscreen(p.session);
      }
      case 'offscreen:close': {
        // §5.13 (Y) 40-7 ③ — `keep` 이면 창을 쉬게 둔다(다음 일감이 다시 쓴다). 렌더러의 기기 예산이 정한다.
        const p = (payload ?? {}) as { session?: string; keep?: boolean };
        await closeOffscreen(p.session, p.keep === true);
        return null;
      }
      // §5.13 (T-4) — 서버 몫이 일감을 받으면 깨운다(이미 떠 있으면 그대로). 일꾼 창이 일감이 끊겼다며 닫아 달라고 한다.
      case 'worker:ensure':
        return ensureWorker();
      case 'worker:idle':
        closeWorker();
        return null;
      // §5.13 (T-6)(V) 37-11 — 사용자가 [받기]를 누른 파일 하나(https 만 · 크기 상한 · 시스템 프록시를 따르는 main 네트워크).
      case 'libs:download':
        return downloadLibrary(payload);
      // §5.13 (V) 37-2 — '이 앱 소개' 의 실제 화면: loopback 프리뷰 한 장(숨은 창 — 찍고 닫는다).
      case 'page:capture': {
        const png = await capturePageImage((payload ?? {}) as { url: unknown; width?: unknown; height?: unknown });
        return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
      }
      // §5.13 (AA) 42-2·42-7 — 내보내기의 OS 기능(폴더 창·폴더에서 보기·열기·끝난 뒤 알림·절전 막기).
      case 'export:pickFolder':
        return pickExportFolder(payload);
      case 'export:reveal':
        return revealExport(payload);
      case 'export:open':
        return openExport(payload);
      case 'export:openFolder':
        return openExportFolder(payload);
      case 'export:done':
        return exportDone(payload);
      case 'power:keepAwake':
        return setKeepAwake(payload);
      default:
        throw new Error(`vibistudio — 알 수 없는 동작: ${action}`);
    }
  },

  dispose: () => {
    closeWorker();
    closeAllOffscreen();
    disposeExportHost();
  },
};
