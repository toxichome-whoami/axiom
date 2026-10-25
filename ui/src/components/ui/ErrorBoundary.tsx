import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      "Uncaught error inside React component tree:",
      error,
      errorInfo,
    );
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0a0a] min-h-[400px] text-center font-sans select-none">
          <div className="w-12 h-12 rounded-[8px] bg-rose-950/30 border border-rose-900/40 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>

          <h3 className="text-[16px] font-semibold text-white mb-2">
            Something went wrong in this view
          </h3>

          <p className="text-[13px] text-[#8c8c8c] max-w-md mb-4 leading-relaxed">
            {this.state.error?.message ||
              "An unexpected rendering error occurred."}
          </p>

          {this.state.errorInfo?.componentStack && (
            <pre className="max-w-xl max-h-36 overflow-auto text-left p-3 rounded-[6px] bg-[#141414] border border-[#222222] text-[11px] text-[#71717a] font-mono mb-5 select-all leading-relaxed">
              {this.state.errorInfo.componentStack}
            </pre>
          )}

          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center gap-2 h-9 px-4 rounded-[6px] bg-blue-600 hover:bg-blue-500 text-white font-medium text-[13px] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
