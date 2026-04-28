import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "200px",
          padding: "32px",
          textAlign: "center",
          color: "#ef4444",
          gap: "12px"
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h3 style={{ margin: 0, fontSize: "16px" }}>组件出现错误</h3>
          <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", maxWidth: "400px" }}>
            {this.state.error?.message || "未知错误"}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: "8px",
              padding: "6px 16px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              background: "#fff",
              cursor: "pointer",
              fontSize: "13px",
              color: "#374151"
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
