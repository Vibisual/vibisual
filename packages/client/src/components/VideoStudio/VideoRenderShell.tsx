import type { VideoMediaProvider } from './videoMediaProvider.js';
import { useEffect, useRef, useState } from 'react';
import { chapterFrameDoc, resolveTimeline, type VideoDoc } from '@vibisual/video';
import { HtmlSceneStage } from '@vibisual/video/render';

import { readDoc } from './videoApi.js';
import { createStudioMedia } from './studioMedia.js';
import { readHistoryDoc } from './studioApi.js';
import { makeCompositionSrc } from './compositionUrl.js';
// 이 화면에는 훅을 걸 자리가 없다(카메라 앞 무대). 문구만 i18n 인스턴스에서 직접 고른다.
import i18n from '../../i18n/index.js';

/**
 * §5.13 (F) — 오프스크린 렌더 무대(조작 요소 없음). main 이 `__vibiRenderSeek(t)` 를 부른 뒤 찍는다. 준비는 전역 플래그(main 이 물을 길이 그것뿐),
 * 실패 이유는 `__vibiRenderError` — 조용히 느린 백엔드로 내려가지 않게.
 */

declare global {
  interface Window {
    __vibiRenderReady?: boolean;
    __vibiRenderError?: string;
    __vibiRenderSeek?: (t: number) => Promise<void>;
    /** §5.13 (V) 37-9 — 마지막으로 맞춘 시각의 컴포지션 글자 상자(JSON — main 이 `executeJavaScript` 로 받는다). */
    __vibiRenderInspect?: () => Promise<string>;
    /**
     * §5.13 (Y) 40-7 ③ — 쉬던 렌더 창에 **새 일감**을 건넨다(창을 다시 읽지 않는다 — 본체 번들을 다시 해석하지 않게). 받은 값은
     * 해시와 같은 이름(`project`·`docId`·`rev`·`w`·`h`·`fit`·`alpha`·`frame`)이다. 준비되면 `__vibiRenderReady` 가 다시 선다.
     */
    __vibiRenderOpen?: (next: Record<string, string>) => void;
  }
}

import type { AppShellProps } from '../../apps/registry.js';

// 창 판별(`parseVideoRenderHash`)은 `videoRenderHash.ts` 에 따로 있다 — 부팅 경로가
// 이 파일(무대·디코더)을 끌어오면 동적 청크로 나눈 의미가 사라진다.

export function VideoRenderShell({ params: initialParams }: AppShellProps): React.JSX.Element {
  // §5.13 (Y) 40-7 ③ — 풀로 다시 쓰는 창은 해시 대신 main 이 건넨 값으로 무대를 다시 세운다.
  const [params, setParams] = useState<Readonly<Record<string, string>>>(initialParams);
  useEffect(() => {
    window.__vibiRenderOpen = (next: Record<string, string>): void => {
      window.__vibiRenderReady = false;
      delete window.__vibiRenderError;
      setParams({ ...next });
    };
    return () => { delete window.__vibiRenderOpen; };
  }, []);
  const project = params['project'] ?? '';
  const docId = params['docId'] ?? '';
  // §5.13 (V) 37-3 — 판 기록의 한 판을 찍을 때(그 판의 문서와 그 판의 코드).
  const revId = params['rev'] ?? '';
  const width = Number(params['w'] ?? 1920) || 1920;
  const height = Number(params['h'] ?? 1080) || 1080;
  // §5.13 (W) 38-1 — 창을 문서 크기로 못 키운 기기면 main 이 맞춤 배율을 준다(무대를 그만큼 줄여 세운다 — 잘리지 않게).
  const fitRaw = Number(params['fit'] ?? 1);
  const fit = Number.isFinite(fitRaw) && fitRaw > 0 && fitRaw < 1 ? fitRaw : 1;
  // §5.13 (W) 38-3 — 투명 배경 렌더: 이 화면의 바탕을 전부 비운다(그린 것 밖은 알파 0).
  const alpha = params['alpha'] === '1';
  // §5.13 (W) 38-7 — 장면 정지 화면: 그 컴포지션 하나짜리 문서로 무대를 세운다.
  const frameChapter = params['frame'] ?? '';
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // 무대가 창보다 크거나 같을 때 스크롤 막대가 서서 찍히지 않게(배율·반올림 한 픽셀).
    const root = document.documentElement;
    const prevOverflow = [root.style.overflow, document.body.style.overflow];
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const cleared: Array<[HTMLElement, string]> = [];
    if (alpha) {
      // 조상(앱 셸·테마 바탕)까지 비운다 — 하나라도 칠하면 그 색이 영상 바탕이 된다.
      for (let el: HTMLElement | null = hostRef.current; el; el = el.parentElement) {
        cleared.push([el, el.style.background]);
        el.style.background = 'transparent';
      }
    }
    return () => {
      root.style.overflow = prevOverflow[0] ?? '';
      document.body.style.overflow = prevOverflow[1] ?? '';
      for (const [el, bg] of cleared) el.style.background = bg;
    };
  }, [alpha]);

  useEffect(() => {
    let stage: HtmlSceneStage | null = null;
    let media: VideoMediaProvider | null = null;
    let disposed = false;
    // §5.13 (Y) 40-7 ③ — 쉬는 창(빈 값을 건네받았다)은 아무것도 세우지 않는다(무대·디코더를 내려놓고 다음 일감을 기다린다).
    if (project === '' || docId === '') {
      window.__vibiRenderReady = false;
      return undefined;
    }

    void (async () => {
      try {
        const loaded: VideoDoc = revId !== '' ? await readHistoryDoc(project, docId, revId) : (await readDoc(project, docId)).doc;
        if (disposed) return;
        const doc = frameChapter !== '' ? chapterFrameDoc(loaded, frameChapter) : loaded;
        if (!doc) throw new Error(i18n.t('panel.videoStudio.errNoFrame', { id: frameChapter }));

        // §5.13 (Y) 40-3 ⑦ — 숨은 창의 스틸·검수·렌더는 소프트웨어 디코딩으로(하드웨어 칸은 사람이 보는 미리보기가 쓴다).
        media = createStudioMedia(project, doc.assets, { decoderPreference: 'prefer-software' });

        const host = hostRef.current;
        if (!host) throw new Error(i18n.t('panel.videoStudio.errNoStage'));

        stage = new HtmlSceneStage({
          doc,
          timeline: resolveTimeline(doc),
          media,
          container: host,
          // §5.13 (T-3)(T-4) — 코드 컴포지션은 샌드박스 iframe 으로 이 무대 위에 선다. 렌더 무대라 엄격하다 — 한 장이라도
          //   시각을 못 맞추면 그 프레임을 찍지 않고 어느 아이템이 몇 초에서 멈췄는지 실패 사유로 낸다.
          compositionSrc: makeCompositionSrc(project, doc, revId !== '' ? revId : undefined),
          strict: true,
          transparent: alpha,
        });

        // 첫 프레임을 미리 세워 둔다 — main 이 곧바로 찍어도 빈 화면이 나오지 않게.
        await stage.seek(0);

        window.__vibiRenderSeek = async (t: number): Promise<void> => {
          await stage?.seek(t);
          // 레이아웃과 페인트가 실제로 반영된 뒤에 찍혀야 한다.
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        };
        window.__vibiRenderInspect = async (): Promise<string> => JSON.stringify((await stage?.inspectTexts()) ?? []);
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
      delete window.__vibiRenderInspect;
      stage?.dispose();
      media?.dispose();
    };
  }, [project, docId, revId, frameChapter, alpha, width, height]);

  return (
    <div
      ref={hostRef}
      className={alpha ? 'overflow-hidden' : 'overflow-hidden bg-black'}
      style={fit < 1 ? { width, height, transform: `scale(${fit})`, transformOrigin: '0 0' } : { width, height }}
    >
      {error !== '' ? (
        <pre className="p-4 text-xs text-rose-300">{error}</pre>
      ) : null}
    </div>
  );
}
