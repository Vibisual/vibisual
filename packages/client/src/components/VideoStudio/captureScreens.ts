/**
 * §5.13 (V) 37-2·37-10 — '이 앱 소개' 레시피의 **실제 화면 소재**((T-14) 3단계 앞당김).
 *
 * 이 프로젝트의 ① 캡처 버블(라이브 스트림에서 한 장 — 기존 데스크톱 캡처 경로, OS 권한은 §5.9 그대로)과 ② iframe 프리뷰
 * (이 프로젝트가 띄운 dev 서버 — loopback 주소만, 앱 main 몫의 숨은 창 `page:capture` 가 한 장 찍는다)를 PNG 로 받아 문서
 * 소재로 들인다. 하나도 못 찍어도 보내기는 막지 않는다 — 에이전트는 프로젝트 코드를 읽는다.
 *
 * 프로젝트로 가른다(§3.5): 캡처 버블은 `projectName`, iframe 탭은 연 프로젝트 경로(`clientPathKey`), 서버는 그 프로젝트
 * 에이전트의 것만.
 */
import type { VideoAsset } from '@vibisual/video';

import { useGraphStore } from '../../stores/graphStore.js';
import { clientPathKey } from '../../utils/platform.js';
import { importVideoAsset } from './videoApi.js';

/** 이 앱의 id — main 몫 `invoke` 의 주인. */
const APP_ID = 'vibistudio';
/** 한 번에 들이는 화면 수 상한 — 소개 영상에 쓸 만큼만. */
const SCREENS_MAX = 4;
/** 캡처 버블 한 장을 기다리는 상한(ms). */
const CAPTURE_FRAME_TIMEOUT_MS = 6_000;

export interface ProjectScreenSource {
  readonly kind: 'capture' | 'preview';
  readonly id: string;
  readonly label: string;
  /** 캡처 버블이면 desktopCapturer 소스 id, 프리뷰면 주소. */
  readonly target: string;
}

const LOOPBACK = /^https?:\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?(?:\/|$)/i;

/** 이 프로젝트의 화면 출처 — 캡처 버블과 loopback 프리뷰. 같은 주소는 한 번만. */
export function projectScreenSources(projectName: string, projectRoot: string): ProjectScreenSource[] {
  const st = useGraphStore.getState();
  const out: ProjectScreenSource[] = [];
  for (const c of st.captureBubbles ?? []) {
    if (c.projectName !== projectName || !c.sourceId) continue;
    out.push({ kind: 'capture', id: c.id, label: c.sourceName || c.id, target: c.sourceId });
  }
  const urls = new Set<string>();
  const rootKey = projectRoot ? clientPathKey(projectRoot) : '';
  for (const tab of st.iframeTabs ?? []) {
    if (!LOOPBACK.test(tab.url)) continue;
    if (tab.projectPath && rootKey && clientPathKey(tab.projectPath) !== rootKey) continue;
    if (urls.has(tab.url)) continue;
    urls.add(tab.url);
    out.push({ kind: 'preview', id: tab.id, label: tab.label || tab.url, target: tab.url });
  }
  for (const [agentId, servers] of Object.entries(st.runningServers ?? {})) {
    if (st.agentProjects?.[agentId] !== projectName) continue;
    for (const server of servers) {
      if (!server.alive || !server.port) continue;
      // Windows 의 Vite 는 ::1 에만 붙는 일이 있다 — 이름(localhost)으로 묻는다.
      const url = `http://localhost:${server.port}/`;
      if (urls.has(url)) continue;
      urls.add(url);
      out.push({ kind: 'preview', id: server.id, label: url, target: url });
    }
  }
  return out.slice(0, SCREENS_MAX);
}

interface DesktopConstraints {
  audio: false;
  video: { mandatory: { chromeMediaSource: 'desktop'; chromeMediaSourceId: string; maxWidth: number; maxHeight: number; maxFrameRate: number } };
}

/** 캡처 버블의 소스에서 한 장(PNG). */
async function grabCaptureFrame(sourceId: string): Promise<Blob> {
  const constraints: DesktopConstraints = {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 5 } },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('capture frame timed out')), CAPTURE_FRAME_TIMEOUT_MS);
      video.onloadeddata = () => { clearTimeout(timer); resolve(); };
      void video.play().catch(() => undefined);
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!(w > 0 && h > 0)) throw new Error('empty capture frame');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png encode failed'))), 'image/png'));
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/** loopback 프리뷰 한 장(PNG) — 앱 main 몫이 숨은 창으로 찍는다. 다리가 없으면(웹 접속) 던진다. */
async function grabPreview(url: string): Promise<Blob> {
  const invoke = window.api?.app?.invoke;
  if (!invoke) throw new Error('page capture is unavailable here');
  const bytes = await invoke(APP_ID, 'page:capture', { url });
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('page capture returned nothing');
  return new Blob([bytes as ArrayBuffer], { type: 'image/png' });
}

function safeName(label: string, index: number): string {
  const base = label.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
  return `${base}-${index + 1}.png`;
}

/**
 * 화면을 찍어 소재로 들인다(문서에는 아직 놓지 않는다 — 배치는 AI 가). 실패한 출처는 건너뛰고 들인 것만 돌려준다.
 */
export async function importProjectScreens(projectName: string, projectRoot: string): Promise<VideoAsset[]> {
  const assets: VideoAsset[] = [];
  const sources = projectScreenSources(projectName, projectRoot);
  for (const [i, source] of sources.entries()) {
    try {
      const blob = source.kind === 'capture' ? await grabCaptureFrame(source.target) : await grabPreview(source.target);
      const file = new File([blob], safeName(source.label, i), { type: 'image/png' });
      assets.push(await importVideoAsset(projectName, file));
    } catch {
      // 그 화면은 못 찍었다(창이 닫혔다·서버가 멈췄다) — 나머지로 간다.
    }
  }
  return assets;
}
