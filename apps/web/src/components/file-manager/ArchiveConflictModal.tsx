import React from "react";
import { Archive } from "lucide-react";
import type { ExtractConflictPrompt } from "../../types/app.js";
import { formatBytes } from "../../utils/path.js";

export interface ArchiveConflictModalProps {
  prompt: ExtractConflictPrompt | null;
  extractingPath: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onSetAllResolutions: (resolution: "overwrite" | "skip") => void;
  onSetResolution: (path: string, resolution: "overwrite" | "skip") => void;
}

export function ArchiveConflictModal({
  prompt,
  extractingPath,
  onClose,
  onConfirm,
  onSetAllResolutions,
  onSetResolution
}: ArchiveConflictModalProps) {
  if (!prompt) return null;

  return (
    <div
      className="file-conflict-backdrop extract-conflict-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="extract-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="extract-conflict-title">
        <div className="extract-conflict-header">
          <div className="file-conflict-icon">
            <Archive size={22} />
          </div>
          <div className="file-conflict-copy">
            <h3 id="extract-conflict-title">解压冲突</h3>
            <p>
              目标目录 <strong>{prompt.outputPath}</strong> 中已有
              {" "}{prompt.conflicts.length} 个同名项，请选择覆盖或跳过。
            </p>
          </div>
        </div>
        <div className="extract-conflict-bulk">
          <button className="small-button" type="button" onClick={() => onSetAllResolutions("overwrite")}>
            全部覆盖
          </button>
          <button className="small-button" type="button" onClick={() => onSetAllResolutions("skip")}>
            全部跳过
          </button>
        </div>
        <div className="extract-conflict-list" role="list">
          {prompt.conflicts.map((conflict) => {
            const action = prompt.resolutions[conflict.path] ?? "skip";
            return (
              <div key={conflict.path} className="extract-conflict-row" role="listitem">
                <div className="extract-conflict-path-wrap">
                  <span className="extract-conflict-path">{conflict.path}</span>
                  <span className="extract-conflict-meta">
                    {conflict.canOverwrite
                      ? `归档 ${formatBytes(conflict.archiveSize ?? 0)} / 现有 ${formatBytes(conflict.existingSize ?? 0)}`
                      : "目标为目录，只能跳过"}
                  </span>
                </div>
                <div className="extract-conflict-choices">
                  <label className={action === "overwrite" ? "is-active" : ""}>
                    <input
                      type="radio"
                      name={`extract-conflict-${conflict.path}`}
                      checked={action === "overwrite"}
                      disabled={!conflict.canOverwrite}
                      onChange={() => onSetResolution(conflict.path, "overwrite")}
                    />
                    覆盖
                  </label>
                  <label className={action === "skip" ? "is-active" : ""}>
                    <input
                      type="radio"
                      name={`extract-conflict-${conflict.path}`}
                      checked={action === "skip"}
                      onChange={() => onSetResolution(conflict.path, "skip")}
                    />
                    跳过
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="file-conflict-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={extractingPath === prompt.archivePath}
            onClick={onConfirm}
          >
            {extractingPath === prompt.archivePath ? "解压中..." : "确认解压"}
          </button>
        </div>
      </div>
    </div>
  );
}
