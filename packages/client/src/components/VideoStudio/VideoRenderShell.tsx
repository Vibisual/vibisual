import { useEffect, useRef, useState } from 'react';
import { resolveTimeline, type VideoDoc } from '@vibisual/video';
import { HtmlSceneStage, MediabunnyMediaProvider } from '@vibisual/video/render';

import { assetUrl, readDoc } from './videoApi.js';

/**
 * §5.13 (F) — 오프스크린 렌더 전용 화면.
 *
 * 보이지 않는 창이 이 화면을 열고, main 프로세스가 `window.__vibiRenderSeek(t)` 를 부른
 * 뒤 창을 찍는다. **사람이 볼 화면이 아니라 카메라 앞에 세우는 무대**라 조작 요소가
 * 하나도 없다.
 *
 * 준비 여부를 전역 플래그로 알리는 이유는 main 이 그것 말고 물어볼 방법이 없기 때문이다.
 * 실패하면 이유를 `__vibiRenderError` 에 남긴다 — 그래야 "왜 이 백엔드를 못 쓰는지"가
 * 사용자에게 그대로 전달된다(조용히 느린 쪽으로 내려가지 않게).
 */

declare global {
  interface Window {
    __vibiRenderReady?: boolean;
    __vibiRenderError?: string;
    __vibiRenderSeek?: (t: number) => Promise<void>;
  }
}

import type { AppShellProps } from '../../apps/registry.js';

// 창 판별(`parseVideoRenderHash`)은 `videoRenderHash.ts` 에 따로 있다 — 부팅 경로가
// 이 파일(무대·디코더)을 끌어오면 동적 청크로 나눈 의미가 사라진다.

export function VideoRenderShell({ params }: AppShellProps): React.JSX.Element {
  const project = params['project'] ?? '';
  const docId = params['docId'] ?? '';
  const width = Number(params['w'] ?? 1920) || 1920;
  const height = Number(params['h'] ?? 1080) || 1080;
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stage: HtmlSceneStage | null = null;
    let media: MediabunnyMediaProvider | null = null;
    let disposed = false;

    void (async () => {
      try {
        const env = await readDoc(project, docId);
        if (disposed) return;
        const doc: VideoDoc = env.doc;

        media = new MediabunnyMediaProvider({
          assets: doc.assets,
          loader: {
            async open(asset) {
              const source = asset.source;
              return assetUrl(project, source.kind === 'file' ? source.path : source.output);
            },
          },
        });

        const host = hostRef.current;
        if (!host) throw new Error('무대를 붙일 자리를 찾지 못했습니다.');

        stage = new HtmlSceneStage({
          doc,
          timeline: resolveTimeline(doc),
          media,
          container: host,
        });

        // 첫 프레임을 미리 세워 둔다 — main 이 곧바로 찍어도 빈 화면이 나오지 않게.
        await stage.seek(0);

        window.__vibiRenderSeek = async (t: number): Promise<void> => {
          await stage?.seek(t);
          // 레이아웃과 페인트가 실제로 반영된 뒤에 찍혀야 한다.
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        };
        window.__vibiRenderReady = true;
      } catch (err) {
        const message = String(err);
        window.__vibiRenderError = message;
        if (!disposed) setError(message);
      }
    })();

    return () => {
      disposed = true;
      window.__vibiRenderReady = false;
      delete window.__vibiRenderSeek;
      stage?.dispose();
      media?.dispose();
    };
  }, [project, docId]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden bg-black"
      style={{ width, height }}
    >
      {error !== '' ? (
        <pre className="p-4 text-xs text-rose-300">{error}</pre>
      ) : null}
    </div>
  );
}
