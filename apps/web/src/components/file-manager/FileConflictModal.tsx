import React from "react";
import { FileText } from "lucide-react";
import type { FileConflictChoice, FileConflictPrompt } from "../../types/app.js";

export interface FileConflictModalProps {
  prompt: FileConflictPrompt | null;
  onResolve: (choice: FileConflictChoice | null) => void;
}

export function FileConflictModal({ prompt, onResolve }: FileConflictModalProps) {
  if (!prompt) return null;

  return (
    <div
      className="file-conflict-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve(null);
      }}
    >
      <div className="file-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="file-conflict-title">
        <div className="file-conflict-icon">
          <FileText size={22} />
        </div>
        <div className="file-conflict-copy">
          <h3 id="file-conflict-title">已存在同名文件</h3>
          <p>
            当前目录已经有 <strong>{prompt.name}</strong>。
            {prompt.canOverwrite ? "可以覆盖它，也可以保留两份。" : "同名路径不是普通文件，请保留两份。"}
          </p>
          <span>保留两份会保存为 {prompt.suggestedName}</span>
        </div>
        <div className="file-conflict-actions">
          <button className="ghost-button" type="button" onClick={() => onResolve(null)}>
            取消
          </button>
          <button
            className="small-button"
            type="button"
            disabled={!prompt.canOverwrite}
            onClick={() => onResolve("overwrite")}
          >
            覆盖
          </button>
          <button className="primary-button" type="button" onClick={() => onResolve("keep")}>
            保留两份
          </button>
        </div>
      </div>
    </div>
  );
}
