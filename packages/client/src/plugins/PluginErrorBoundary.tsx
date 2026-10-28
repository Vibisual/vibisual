/**
 * §5.11 — 카드 한 장의 실패를 그 카드 안에 가둔다(없으면 React 가 루트까지 올라가 앱 전체가 흰 화면).
 * 실제 데이터는 픽스처(`renderAll.test.tsx`)와 달라 `undefined`·비배열이 올 수 있다. 실패하면 아무것도 그리지 않고 콘솔에 한 번만 남긴다.
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
