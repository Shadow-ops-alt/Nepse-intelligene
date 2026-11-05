import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last-resort render guard. A malformed response should show a recoverable
 * panel, not a blank window.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console useful for local diagnosis.
    console.error("Render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="empty" role="alert">
        <h3>Something went wrong rendering this page</h3>
        <div className="empty-body">
          <p>{this.state.error.message}</p>
          <p className="muted small">
            Your local data is untouched. Reload the page to recover, or open
            another section.
          </p>
        </div>
        <div className="empty-action">
          <button
            className="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
