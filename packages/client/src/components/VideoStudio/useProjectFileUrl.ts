import { useEffect, useState } from 'react';

import { projectFileBlobUrl } from './studioApi.js';

/**
 * 프로젝트 안 파일(로고·글꼴 미리보기)을 화면에 띄울 blob 주소. 패키지 앱에서는 엘리먼트가 부르는 `/api` 주소가 비므로
 * fetch → blob 으로 받는다(§5.13 (L) 선례). 바뀌거나 사라지면 되돌린다.
 */
export function useProjectFileUrl(project: string, relPath: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!relPath || project === '') { setUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    projectFileBlobUrl(project, relPath)
      .then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [project, relPath]);
  return url;
}
