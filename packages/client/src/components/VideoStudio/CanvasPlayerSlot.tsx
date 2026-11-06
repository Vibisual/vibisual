import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

import type { VideoCanvasPlayerProps } from './VideoCanvasPlayer.js';

/**
 * §5.4 #36 (J) ⑦ — 캔버스 재생 판의 자리: 판 부품(스튜디오 렌더러·소리·무대)은 누를 때만 늦게 온다. `React.lazy` 를 쓰지 않는다 —
 * 청크를 못 받거나 판이 그리다 던지면 그 실패가 앱 전체의 오류 경계까지 올라가 캔버스가 통째로 복구 화면이 된다. 여기서 받아 그 노드만
 * 판을 내리고(`onFail`) 조작줄이 "에디터에서 여세요"로 말한다.
 */

type PlayerComponent = ComponentType<VideoCanvasPlayerProps>;

let loaded: PlayerComponent | null = null;
let loading: Promise<PlayerComponent> | null = null;

/** 판 청크를 받는다(한 번 — 실패하면 다음에 다시). 재생 단추에 손이 올라가면 미리 부른다. */
export function loadCanvasPlayer(): Promise<PlayerComponent> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = import('./VideoCanvasPlayer.js')
      .then((m) => { loaded = m.VideoCanvasPlayer; return m.VideoCanvasPlayer; })
      .catch((error: unknown) => { loading = null; throw error; });
  }
  return loading;
}

class PlayerBoundary extends Component<{ readonly onFail: (error: unknown) => void; readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onFail(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function CanvasPlayerSlot(p: VideoCanvasPlayerProps & { readonly onFail: (error: unknown) => void }): React.JSX.Element | null {
  const [Player, setPlayer] = useState<PlayerComponent | null>(() => loaded);
  const { onFail } = p;
  useEffect(() => {
    if (Player) return undefined;
    let alive = true;
    loadCanvasPlayer().then(
      (component) => { if (alive) setPlayer(() => component); },
      (error: unknown) => { if (alive) onFail(error); },
    );
    return () => { alive = false; };
  }, [Player, onFail]);
  if (!Player) return null;
  const { onFail: _onFail, ...props } = p;
  return (
    <PlayerBoundary onFail={onFail}>
      <Player {...props} />
    </PlayerBoundary>
  );
}
