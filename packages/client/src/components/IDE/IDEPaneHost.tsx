import { memo, useMemo } from 'react';
import { useGraphStore, selectRenderedIDEPaneKeys } from '../../stores/graphStore.js';
import { AgentIDEOverlay } from './AgentIDEOverlay.js';
import { IDEPaneProvider } from './idePane.js';

// §5.5 #17-1 (판올림 번호 발급 대기) — 지금 보고 있는 프로젝트의 IDE 창을 **전부** 그린다.
//
// 종전에는 `<AgentIDEOverlay />` 한 개가 캔버스 안에 박혀 있었고 그 하나가 프로젝트의 유일한 IDE 였다.
// 창이 여럿이 되면서 "몇 개를 그릴지"를 정하는 자리가 필요해졌고, 그 자리가 여기다.
// 각 창은 자기 슬롯 키를 컨텍스트로 받아 **자기 상태만** 읽고 고친다.

/** 프로젝트 이름에는 공백이 들어갈 수 있다 — 이름에 절대 못 들어가는 줄바꿈을 구분자로 쓴다. */
const KEY_SEP = '\n';

export const IDEPaneHost = memo(function IDEPaneHost(): React.JSX.Element | null {
  // 키 목록은 **문자열 하나**로 구독한다 — 선택자가 매 호출 새 배열을 돌려주면 zustand v5 는
  //   "캐시되지 않은 스냅샷"으로 보고 무한 리렌더로 간다.
  const keysJoined = useGraphStore((s) => selectRenderedIDEPaneKeys(s).join(KEY_SEP));
  const keys = useMemo(() => (keysJoined ? keysJoined.split(KEY_SEP) : []), [keysJoined]);
  if (keys.length === 0) return null;
  return (
    <>
      {keys.map((paneKey, index) => (
        <IDEPaneProvider key={paneKey} paneKey={paneKey} index={index}>
          <AgentIDEOverlay />
        </IDEPaneProvider>
      ))}
    </>
  );
});
