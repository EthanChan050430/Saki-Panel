import React, { useEffect, useState } from "react";
import { AlertTriangle, Eye, X } from "lucide-react";
import { api } from "../../api.js";
import { CodeEditor, languageFromFileName } from "../../CodeEditor.js";

export function FilePreviewModal({
  token,
  instanceId,
  filePath,
  actionName,
  onClose,
  darkMode
}: {
  token: string;
  instanceId: string;
  filePath: string;
  actionName: string;
  onClose: () => void;
  darkMode: boolean;
}) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setContent("");

    api
      .readInstanceFile(token, instanceId, filePath)
      .then((res) => {
        if (!active) return;
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "无法读取文件，可能已被删除或实例已离线。");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, instanceId, filePath]);

  return (
    <div
      className="modal-backdrop file-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="file-preview-modal" role="dialog" aria-modal="true">
        <div className="file-preview-header">
          <div className="file-preview-title">
            <Eye size={18} />
            <h3>快速文件预览</h3>
            <span>{filePath}</span>
          </div>
          <button className="icon-button mini" title="关闭" type="button" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="file-preview-body">
          {loading ? (
            <div className="file-preview-loading">
              <span className="spinner" />
              <span>正在加载文件内容...</span>
            </div>
          ) : error ? (
            <div className="file-preview-error">
              <AlertTriangle size={32} />
              <p>{error}</p>
              <small>操作: {actionName} | 实例 ID: {instanceId}</small>
            </div>
          ) : (
            <div className="file-preview-editor-wrapper">
              <CodeEditor
                value={content}
                language={languageFromFileName(filePath) ?? "plaintext"}
                readOnly={true}
                darkMode={darkMode}
                lineWrapping={true}
                className="file-preview-editor"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
