import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Translation } from 'react-i18next';
import { flushAllPersisted } from '../../utils/persistFlush.js';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

/**
 * A shell render failure must leave a usable recovery control in every window.
 * Retry remounts React only: module stores, persisted drafts and the running
 * server survive. Native renderer-process failures are handled by desktop main.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.reportFailure('[AppErrorBoundary] UI rendering failed', error, info.componentStack);
    this.flushDrafts();
  }

  private reportFailure(message: string, ...details: unknown[]): void {
    try {
      // installRendererDiagnostics forwards this through the existing diagnostic rail.
      console.error(message, ...details);
    } catch {
      // A broken diagnostic sink must not turn the recovery screen into another failure.
    }
  }

  private flushDrafts(): void {
    try {
      flushAllPersisted();
    } catch (error) {
      this.reportFailure('[AppErrorBoundary] Could not flush pending drafts', error);
    }
  }

  private handleRetry = (): void => {
    this.flushDrafts();
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    // No app store selectors or error-object formatting here: the failed state
    // may itself be the cause. Translation remains subscribed to locale changes.
    return (
      <Translation useSuspense={false}>
        {(t): ReactNode => (
          <main className="flex h-full min-h-0 w-full min-w-0 flex-col bg-gray-950 text-gray-100">
            <div className="app-drag flex h-11 shrink-0 items-center px-4">
              <span className="app-drag-label text-[12px] font-semibold">Vibisual</span>
            </div>
            <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
              <h1 className="text-[14px] font-semibold">{t('common.appError.title')}</h1>
              <p className="max-w-md break-words text-[12px] text-gray-300">{t('common.appError.description')}</p>
              <button
                type="button"
                autoFocus
                onClick={this.handleRetry}
                className="app-nodrag shrink-0 rounded-md bg-blue-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {t('common.appError.retry')}
              </button>
            </div>
          </main>
        )}
      </Translation>
    );
  }
}
