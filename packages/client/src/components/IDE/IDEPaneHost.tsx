import { memo, useMemo } from 'react';
import { useGraphStore, selectIDEPaneRenderOrderKeys } from '../../stores/graphStore.js';
import { AgentIDEOverlay } from './AgentIDEOverlay.js';
import { IDEPaneProvider } from './idePane.js';
import { VerifyDemoLayer } from './VerifyDemoLayer.js';

// §5.5 #17-1 — 지금 프로젝트의 IDE 창을 전부 그린다. 각 창은 슬롯 키 컨텍스트로 자기 상태만 읽고 고친다.

/** 프로젝트 이름에는 공백이 들어갈 수 있다 — 이름에 절대 못 들어가는 줄바꿈을 구분자로 쓴다. */
const KEY_SEP = '\n';

export const IDEPaneHost = memo(function IDEPaneHost(): React.JSX.Element | null {
  // 키 목록은 문자열 하나로 구독(새 배열이면 zustand v5 무한 리렌더). 순서는 열린 순번(z 아님) — z 로 정렬하면 앞으로 꺼낼 때
  // DOM 이 재배치돼 scrollTop 이 0 으로 튄다(selectIDEPaneRenderOrderKeys).
  const keysJoined = useGraphStore((s) => selectIDEPaneRenderOrderKeys(s).join(KEY_SEP));
  const keys = useMemo(() => (keysJoined ? keysJoined.split(KEY_SEP) : []), [keysJoined]);
  if (keys.length === 0) return null;
  return (
    <>
      {/* 녹화 상태는 렌더러당 하나다. 창마다 호스트를 세우면 같은 시연을 여러 번 녹화한다.
          활동바·IDE 창을 바꿔도 같은 녹화기와 시연 창이 이어진다. */}
      <VerifyDemoLayer />
      {keys.map((paneKey, index) => (
        <IDEPaneProvider key={paneKey} paneKey={paneKey} index={index}>
          <AgentIDEOverlay />
        </IDEPaneProvider>
      ))}
    </>
  );
});
