/**
 * §5.11 v4.29 — 카드 한 장의 실패를 그 카드 안에 가둔다.
 *
 * 커널은 "플러그인 하나 때문에 앱이 못 뜨는 일은 없어야 한다"를 원칙으로 세워 두고 등록부 검증을
 * 던지지 않게 만들었다. 그런데 **렌더는 보호돼 있지 않았다.** 클라이언트 전체에 에러 바운더리가 하나도
 * 없어서, 111장 중 한 장이 그리다 던지면 React 가 루트까지 올라가 **앱 전체를 내린다**(흰 화면).
 *
 * 검사(`renderAll.test.tsx`)는 픽스처 컨텍스트에서만 안 던진다는 것을 보장한다. 실제 데이터는 픽스처와
 * 다르다 — 없는 줄 알았던 필드가 `undefined` 로 오거나, 배열인 줄 알았던 것이 아닐 수 있다. 그 한 번을
 * 앱 전체로 번지게 두지 않는 것이 이 컴포넌트의 일이다.
 *
 * **실패하면 아무것도 그리지 않는다.** 깨진 자리에 오류 문구를 남기면 111장 중 하나가 고장 났을 때
 * 화면이 오류 딱지로 덮인다. 카드는 조용히 빠지고, 사실은 콘솔에 한 번만 남긴다.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportPluginFailure } from './isolate.js';

interface Props {
  /** 어느 카드인지 — 로그와 초기화 판단에 쓴다. */
  pluginId: string;
  children: ReactNode;
}

interface State {
  failedFor: string | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { failedFor: null };

  static getDerivedStateFromError(): Partial<State> {
    // 어느 카드였는지는 props 를 아는 인스턴스 쪽(componentDidCatch)에서 확정한다.
    return {};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { pluginId } = this.props;
    this.setState({ failedFor: pluginId });
    reportPluginFailure(pluginId, error, info.componentStack ?? undefined);
  }

  componentDidUpdate(prev: Props): void {
    // 다른 카드로 바뀌면 다시 그려 본다 — 한 번 실패한 자리가 영영 비어 있지 않도록.
    if (prev.pluginId !== this.props.pluginId && this.state.failedFor !== null) {
      this.setState({ failedFor: null });
    }
  }

  render(): ReactNode {
    if (this.state.failedFor === this.props.pluginId) return null;
    return this.props.children;
  }
}
