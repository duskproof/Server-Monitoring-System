'use client';

import { AlertOctagon, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback, e.g. the tab or widget name. */
  label?: string;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render-time crashes so one broken widget cannot take down a page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[VPSGuard] Render error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback, label } = this.props;

    if (!error) return children;
    if (fallback) return fallback;

    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-10 text-center">
        <AlertOctagon className="h-7 w-7 text-danger" />
        <div>
          <p className="text-sm font-semibold text-content">
            {label ? `${label} failed to render` : 'Something went wrong'}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted">{error.message}</p>
        </div>
        <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}
