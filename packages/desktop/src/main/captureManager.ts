import { desktopCapturer } from 'electron';
import type { CaptureSourceInfo, CaptureSourceKind } from '@vibisual/shared';

// §5.9 화면/프로그램 캡처 — 소스 열거(main 전용). `desktopCapturer.getSources` 는 main 에서만 부를 수 있다. 렌더러는 고른 소스 id 로
// `getUserMedia({video:{mandatory:{chromeMediaSource:'desktop', chromeMediaSourceId: id}}})` 를 붙인다(렌더러 전용, 서버 무관).
// NativeImage 썸네일/앱 아이콘은 data URL(PNG)로 직렬화해 IPC 텍스트로 나른다.

/** picker 썸네일 해상도 — 그리드 카드에 충분하고 IPC 페이로드가 과하지 않은 절충값. */
const THUMBNAIL_SIZE = { width: 320, height: 180 };

function kindOf(id: string): CaptureSourceKind {
  return id.startsWith('screen:') ? 'screen' : 'window';
}

/** 캡처 가능한 화면·창 목록. 실패하면 빈 배열(렌더러가 "소스 없음"). 화면(screen)을 먼저, 창(window)을 뒤에 — picker 상단에 화면이 온다. */
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
