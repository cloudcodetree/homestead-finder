import { Component, ReactNode } from 'react';

interface Props {
  /** Optional label to distinguish boundaries in logs (e.g. "Top Picks"). */
  label?: string;
  /** What to render when a child throws. Receives the error + a reset fn. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Simple error boundary for isolating AI-related surfaces so a crash in
 * TopPicks or the AskClaude bar can't take down the whole dashboard. Uses
 * React's documented class-component pattern because hooks don't have an
 * error-boundary equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary:${this.props.label ?? 'unknown'}]`,
      error,
      info.componentStack
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900 mb-1">
            Something broke in{' '}
            <span className="font-mono">{this.props.label ?? 'this section'}</span>
          </p>
          <p className="text-amber-800 mb-2">
            The rest of the dashboard kept working. Check the browser console for
            details.
          </p>
          <button
            onClick={this.reset}
            className="text-amber-900 hover:text-amber-700 font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
