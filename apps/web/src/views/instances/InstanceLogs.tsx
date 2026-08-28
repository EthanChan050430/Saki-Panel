import React from "react";
import type { InstanceLogLine } from "@webops/shared";
import { formatDate } from "../../utils/path.js";
import { renderTerminalLogText } from "../../components/terminal/WebTerminal.js";

export function InstanceLogs({ logs }: { logs: InstanceLogLine[] }) {
  return (
    <div className="log-console">
      {logs.length === 0 ? (
        <div className="log-empty">暂无日志</div>
      ) : (
        logs.map((line) => (
          <div className={`log-line log-${line.stream}`} key={line.id}>
            <span>{formatDate(line.time)}</span>
            <strong>{line.stream}</strong>
            <code>{renderTerminalLogText(line.text)}</code>
          </div>
        ))
      )}
    </div>
  );
}
