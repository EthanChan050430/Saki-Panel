import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Loader2,
  Save,
  Search,
  X
} from "lucide-react";
import { CodeEditor, type CodeEditorHandle, type FindRange } from "../../CodeEditor.js";
import { FilePreview } from "../common/MarkdownContent.js";
import { isArchiveFile, isImageFile } from "../../utils/path.js";

export interface CodeEditorPanelProps {
  editorPath: string | null;
  selectedEntryName?: string | undefined;
  editorContent: string;
  editorLanguage: string;
  editorMode: "edit" | "preview";
  editorCanTogglePreview: boolean;
  editorCanEdit: boolean;
  editorPreviewKind: "html" | "markdown" | "image" | null;
  saving: boolean;
  mobileEditorOpen: boolean;
  darkMode?: boolean;
  findVisible: boolean;
  findQuery: string;
  findMatchesCount: number;
  findResultLabel: string;
  findRanges: FindRange[];
  codeEditorRef: React.RefObject<CodeEditorHandle | null>;
  findInputRef: React.RefObject<HTMLInputElement | null>;
  onCloseMobileEditor: () => void;
  onSetEditorMode: (mode: "edit" | "preview") => void;
  onOpenFind: () => void;
  onCloseFind: () => void;
  onFindQueryChange: (query: string) => void;
  onMoveFindMatch: (direction: number, focusEditor: boolean) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
}

export function CodeEditorPanel({
  editorPath,
  selectedEntryName,
  editorContent,
  editorLanguage,
  editorMode,
  editorCanTogglePreview,
  editorCanEdit,
  editorPreviewKind,
  saving,
  mobileEditorOpen,
  darkMode,
  findVisible,
  findQuery,
  findMatchesCount,
  findResultLabel,
  findRanges,
  codeEditorRef,
  findInputRef,
  onCloseMobileEditor,
  onSetEditorMode,
  onOpenFind,
  onCloseFind,
  onFindQueryChange,
  onMoveFindMatch,
  onContentChange,
  onSave
}: CodeEditorPanelProps) {
  const activeFileName = editorPath?.split("/").pop() ?? selectedEntryName ?? "未选择文件";
  const activeDirName = editorPath && editorPath.includes("/") ? editorPath.substring(0, editorPath.lastIndexOf("/")) : "";

  return (
    <div className="file-editor" role={mobileEditorOpen ? "dialog" : undefined} aria-modal={mobileEditorOpen ? true : undefined}>
      <div className="file-editor-heading">
        <div className="file-editor-title-row">
          <div className="file-editor-icon-badge">
            {isImageFile(editorPath || "") ? (
              <ImageIcon size={15} />
            ) : isArchiveFile(editorPath || "") ? (
              <FileArchive size={15} />
            ) : (
              <FileText size={15} />
            )}
          </div>
          <div className="file-editor-title-copy">
            <span className="file-editor-filename" title={editorPath ?? selectedEntryName ?? ""}>
              {activeFileName}
            </span>
            {activeDirName ? (
              <span className="file-editor-filepath" title={editorPath ?? ""}>
                /{activeDirName}
              </span>
            ) : null}
          </div>
          <button
            className="icon-button mini mobile-editor-close"
            title="关闭编辑器"
            aria-label="关闭编辑器"
            type="button"
            onClick={onCloseMobileEditor}
          >
            <X size={15} />
          </button>
        </div>
        <div className="file-editor-actions">
          {editorCanTogglePreview ? (
            <div className="editor-view-toggle" aria-label="文件视图">
              <button
                className={editorMode === "edit" ? "active" : ""}
                type="button"
                title="源码"
                onClick={() => onSetEditorMode("edit")}
              >
                <Code2 size={13} />
                <span>源码</span>
              </button>
              <button
                className={editorMode === "preview" ? "active" : ""}
                type="button"
                title="预览"
                onClick={() => onSetEditorMode("preview")}
              >
                <Eye size={13} />
                <span>预览</span>
              </button>
            </div>
          ) : null}
          {editorPath ? <span className="file-language-pill">{editorLanguage}</span> : null}
          <button
            className="icon-button mini editor-action-btn"
            title="查找 (Ctrl+F)"
            disabled={!editorCanEdit || editorMode !== "edit"}
            onClick={onOpenFind}
          >
            <Search size={15} />
          </button>
          <button
            className="primary-button save-file-button"
            disabled={!editorCanEdit || saving}
            onClick={onSave}
            title="保存文件 (Ctrl+S)"
          >
            {saving ? <Loader2 size={14} className="spinner" /> : <Save size={14} />}
            <span className="save-file-label">{saving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </div>
      {editorPath ? (
        editorMode === "preview" && editorPreviewKind ? (
          <FilePreview content={editorContent} kind={editorPreviewKind} />
        ) : (
          <div className={`code-editor-stack ${findVisible ? "find-open" : ""}`}>
            {findVisible ? (
              <div className="editor-find-bar">
                <Search size={15} />
                <input
                  ref={findInputRef}
                  value={findQuery}
                  placeholder="查找当前文件"
                  onChange={(event) => onFindQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onMoveFindMatch(event.shiftKey ? -1 : 1, true);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCloseFind();
                    }
                  }}
                />
                <span className={`find-result-count ${findQuery && findMatchesCount === 0 ? "empty" : ""}`}>
                  {findResultLabel}
                </span>
                <button
                  className="icon-button mini"
                  title="上一个"
                  type="button"
                  disabled={findMatchesCount === 0}
                  onClick={() => onMoveFindMatch(-1, true)}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  className="icon-button mini"
                  title="下一个"
                  type="button"
                  disabled={findMatchesCount === 0}
                  onClick={() => onMoveFindMatch(1, true)}
                >
                  <ChevronRight size={15} />
                </button>
                <button className="icon-button mini" title="关闭查找" type="button" onClick={onCloseFind}>
                  <X size={15} />
                </button>
              </div>
            ) : null}
            <div className="code-editor-shell">
              <CodeEditor
                ref={codeEditorRef}
                value={editorContent}
                language={editorLanguage}
                onChange={onContentChange}
                onSave={onSave}
                lineWrapping={mobileEditorOpen}
                className="code-editor-surface"
                findRanges={findRanges}
                darkMode={Boolean(darkMode)}
              />
            </div>
          </div>
        )
      ) : (
        <div className="empty-state">选择文件查看或编辑</div>
      )}
    </div>
  );
}
