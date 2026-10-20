// 판단만 부작용 없는 모듈에서 읽는다(`transport/index.js` 는 전역 전송 패치까지 끌어온다 — 이 모듈은 작아야 한다).
import { isPackagedDesktop } from '../../transport/packaged.js';

/**
 * 소재 파일 주소. 프로젝트 안 경로만 통한다(서버가 막는다). 번역·상태 모듈을 끌어오지 않는 작은 모듈이다.
 *
 * §5.13 (Y) 40-1 — **미디어 모양**(`…/media?…`)이다. 패키지 앱은 `vibproxy://proxy` 절대 주소라 패치된 fetch(IPC — 응답을 통째로
 * 싣고, 끝이 열린 구간을 끊어도 나머지가 다 건너왔다)를 타지 않고, 코어가 파일을 조각으로 흘려 보낸다(구간·끊기 지원). 그 밖
 * (웹·모바일)은 같은 모양을 서버가 `sendFile` 로 낸다.
 */
export function assetUrl(project: string, relPath: string): string {
  const path = `/api/app/vibistudio/media?project=${encodeURIComponent(project)}&path=${encodeURIComponent(relPath)}`;
  return isPackagedDesktop() ? `vibproxy://proxy${path}` : path;
}

/**
 * 이 주소가 끝이 열린 구간을 끊을 수 있는 진짜 스트림인가. 패키지 앱에서 `/api…` 상대 주소는 IPC 로 떨어져 응답을 통째로
 * 싣는다 — 그때 호출부가 구간을 묶어 보내야 한다(`boundedRangeFetch`). 웹·모바일의 상대 주소는 진짜 HTTP 라 끊긴다.
 */
export function isStreamingAssetUrl(url: string): boolean {
  return !isPackagedDesktop() || url.startsWith('vibproxy://');
}
