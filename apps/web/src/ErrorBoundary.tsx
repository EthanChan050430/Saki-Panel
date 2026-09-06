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
          minHeight: "220px",
          padding: "32px 24px",
          textAlign: "center",
          color: "#e11d48",
          gap: "10px"
        }}>
          <img
            src="/assets/expression/daemon_offline.webp"
            alt="Error"
            style={{ width: "96px", height: "96px", objectFit: "contain", marginBottom: "4px" }}
            draggable={false}
          />
          <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text-main, #1e293b)" }}>组件出现异常</h3>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #64748b)", maxWidth: "420px", lineHeight: "1.5" }}>
            {this.state.error?.message || "发生未知错误，Saki 正在协助排查"}
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
