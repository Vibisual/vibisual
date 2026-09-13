/**
 * StreamImageThumb.tsx — §5.25 (O) 엔진이 대화에 **내건 그림 한 장**을 그리는 단 하나의 조각.
 *
 * 코덱스는 채팅에서 그림을 만들거나 프로젝트 안의 그림을 꺼내 보여 준다(`ImageView`). 그 줄이
 * 여기로 온다. **Sub 탭(StreamRenderer)과 메인 탭(IDEMainArea)이 같은 조각을 쓴다** — 두 벌로
 * 두면 한쪽만 고쳐지는 날이 오고, 그때 사용자는 "탭을 바꾸면 그림이 사라진다"를 겪는다
 * (검색 판정을 `streamSearch.ts` 한 곳에 모은 것과 같은 이유).
 *
 * **주소는 경로가 아니라 이벤트 id 로 만든다.** 서버가 자기 스트림 기록을 되짚어 파일을 찾으므로,
 * 화면은 그 그림이 디스크 어디에 있는지 알지 못하고 알 필요도 없다. 경로를 화면까지 내려보내면
 * 그 순간 "아무 파일이나 청할 수 있는 주소"가 생긴다.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { loadStreamImage } from './streamImageResource.js';

export function streamImageUrl(agentId: string, subAgentId: string, eventId: string): string {
  return `/api/codex-image/${encodeURIComponent(agentId)}/${encodeURIComponent(subAgentId)}/${encodeURIComponent(eventId)}`;
}

/** 그림이 못 뜰 때의 한 줄. **이름은 남긴다** — 빈자리로 두면 그 턴에 아무 일도 없던 것으로 읽힌다. */
function MissingLine({ name }: { name: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-gray-500">
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      <span className="truncate">{name}</span>
      <span className="flex-shrink-0 text-gray-600">{t('ide.streamRenderer.imageMissing')}</span>
    </span>
  );
}

export function StreamImageThumb({
  agentId, subAgentId, eventId, name,
}: {
  agentId?: string;
  subAgentId?: string;
  eventId: string;
  name: string;
}): React.JSX.Element {
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const endpoint = agentId && subAgentId ? streamImageUrl(agentId, subAgentId, eventId) : '';
  const [resource, setResource] = useState({ endpoint: '', src: '', failed: false });
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadStreamImage(endpoint).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setResource({ endpoint, src: objectUrl, failed: false });
    }).catch(() => {
      if (!cancelled) setResource({ endpoint, src: '', failed: true });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);
  const src = resource.endpoint === endpoint ? resource.src : '';
  const failed = resource.endpoint === endpoint && resource.failed;

  // 세션을 모르면 주소를 못 만든다(옛 스트림·복원 직후). 파일이 지워졌을 때와 같은 자리로 떨어뜨린다.
  if (!endpoint || failed) return <MissingLine name={name} />;
  if (!src) return <span className="block font-mono text-[12px] text-gray-500" aria-busy="true">{name}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => { openImageLightbox(src); }}
        title={name}
        className="block max-w-md overflow-hidden rounded-md border border-gray-700 bg-gray-900 transition-opacity hover:opacity-90 max-md:max-w-full"
      >
        <img
          src={src}
          alt={name}
          onError={() => { setResource({ endpoint, src: '', failed: true }); }}
          className="block h-auto w-full cursor-zoom-in object-contain"
        />
      </button>
      <span className="mt-0.5 block truncate font-mono text-[12px] text-gray-500">{name}</span>
    </>
  );
}
