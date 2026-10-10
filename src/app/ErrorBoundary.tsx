import { tr } from "../i18n";
import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty" role="alert">
        <h2>{tr("页面暂时无法显示")}</h2>
        <p>{tr("请刷新页面后重试。")}</p>
        <button onClick={() => window.location.reload()}>
          {tr("刷新页面")}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
