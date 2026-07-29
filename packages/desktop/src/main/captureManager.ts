import { desktopCapturer } from 'electron';
import type { CaptureSourceInfo, CaptureSourceKind } from '@vibisual/shared';

// §5.9 화면/프로그램 캡처 — 소스 열거(main 전용).
//
// Electron `desktopCapturer.getSources` 는 main 프로세스에서만 호출 가능하다. 렌더러는
// 이 목록에서 사용자가 고른 소스 id 를 받아 `getUserMedia({video:{mandatory:{chromeMediaSource:
// 'desktop', chromeMediaSourceId: id}}})` 로 라이브 MediaStream 을 붙인다(렌더러 전용, 서버 무관).
//
// 여기서는 NativeImage 썸네일/앱 아이콘을 data URL(PNG)로 직렬화해 IPC 텍스트 와이어로 나른다.

/** picker 썸네일 해상도 — 그리드 카드에 충분하고 IPC 페이로드가 과하지 않은 절충값. */
const THUMBNAIL_SIZE = { width: 320, height: 180 };

function kindOf(id: string): CaptureSourceKind {
  return id.startsWith('screen:') ? 'screen' : 'window';
}

/**
 * 현재 캡처 가능한 화면·창 목록을 반환한다. 실패하면 빈 배열(렌더러가 "소스 없음"으로 처리).
 * 전체 화면(screen)을 먼저, 개별 창(window)을 뒤에 정렬해 picker 상단에 화면이 오게 한다.
 */
export async function listCaptureSources(): Promise<CaptureSourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: THUMBNAIL_SIZE,
    fetchWindowIcons: true,
  });
  const mapped = sources.map((s): CaptureSourceInfo => {
    const info: CaptureSourceInfo = {
      id: s.id,
      name: s.name || (kindOf(s.id) === 'screen' ? 'Screen' : 'Window'),
      kind: kindOf(s.id),
      thumbnailDataUrl: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
    };
    if (s.appIcon && !s.appIcon.isEmpty()) info.appIconDataUrl = s.appIcon.toDataURL();
    return info;
  });
  // screen 먼저, 그 다음 window — 각 그룹 내부는 desktopCapturer 순서 유지.
  return mapped.sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === 'screen' ? -1 : 1;
  });
}
