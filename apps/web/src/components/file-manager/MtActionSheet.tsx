import React from "react";
import {
  Code2,
  Copy,
  Download,
  Edit3,
  FileArchive,
  Folder,
  Image as ImageIcon,
  Layers,
  RotateCw,
  Trash2
} from "lucide-react";
import type { InstanceFileEntry } from "@webops/shared";
import { fileExtension, formatBytes, isArchiveFile, isImageFile } from "../../utils/path.js";

export interface MtActionSheetProps {
  entry: InstanceFileEntry | null;
  activePane: "left" | "right";
  archivingPath: string | null;
  onClose: () => void;
  onCopyToOppositePane: (entry: InstanceFileEntry) => void;
  onMoveToOppositePane: (entry: InstanceFileEntry) => void;
  onExtractToOppositePane: (entry: InstanceFileEntry) => void;
  onOpenEntry: (entry: InstanceFileEntry) => void;
  onRenameEntry: (entry: InstanceFileEntry) => void;
  onArchiveEntry: (entry: InstanceFileEntry) => void;
  onDownloadEntry: (entry: InstanceFileEntry) => void;
  onDeleteEntry: (entry: InstanceFileEntry) => void;
}

export function MtActionSheet({
  entry,
  activePane,
  archivingPath,
  onClose,
  onCopyToOppositePane,
  onMoveToOppositePane,
  onExtractToOppositePane,
  onOpenEntry,
  onRenameEntry,
  onArchiveEntry,
  onDownloadEntry,
  onDeleteEntry
}: MtActionSheetProps) {
  if (!entry) return null;

  return (
    <div className="mt-action-sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="mt-action-sheet-drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="mt-sheet-header">
          <div className="mt-sheet-icon">
            {entry.type === "directory" ? (
              <Folder size={24} className="mt-folder-icon" />
            ) : isImageFile(entry.path) ? (
              <ImageIcon size={22} className="mt-img-icon" />
            ) : isArchiveFile(entry.path) ? (
              <FileArchive size={22} className="mt-zip-icon" />
            ) : (
              <Code2 size={22} className="mt-file-icon" />
            )}
          </div>
          <div className="mt-sheet-meta">
            <div className="mt-sheet-name" title={entry.name}>
              {entry.name}
            </div>
            <div className="mt-sheet-sub">
              {entry.type === "directory"
                ? "文件夹"
                : `${formatBytes(entry.size)} · ${fileExtension(entry.path) || "文件"}`}
            </div>
          </div>
        </div>

        <div className="mt-sheet-actions-grid">
          <button
            className="mt-action-grid-btn highlight"
            type="button"
            onClick={() => {
              onClose();
              onCopyToOppositePane(entry);
            }}
          >
            <Copy size={20} className="action-icon copy" />
            <span>复制到{activePane === "left" ? "右侧" : "左侧"}</span>
          </button>

          <button
            className="mt-action-grid-btn highlight"
            type="button"
            onClick={() => {
              onClose();
              onMoveToOppositePane(entry);
            }}
          >
            <Layers size={20} className="action-icon cut" />
            <span>移动到{activePane === "left" ? "右侧" : "左侧"}</span>
          </button>

          {entry.type === "file" && isArchiveFile(entry.path) ? (
            <button
              className="mt-action-grid-btn highlight"
              type="button"
              onClick={() => {
                onClose();
                onExtractToOppositePane(entry);
              }}
            >
              <RotateCw size={20} className="action-icon extract" />
              <span>解压到{activePane === "left" ? "右侧" : "左侧"}</span>
            </button>
          ) : null}

          {entry.type === "file" ? (
            <button
              className="mt-action-grid-btn"
              type="button"
              onClick={() => {
                onClose();
                onOpenEntry(entry);
              }}
            >
              <Code2 size={20} className="action-icon text" />
              <span>编辑查看</span>
            </button>
          ) : null}

          <button
            className="mt-action-grid-btn"
            type="button"
            onClick={() => {
              onClose();
              onRenameEntry(entry);
            }}
          >
            <Edit3 size={20} className="action-icon rename" />
            <span>重命名</span>
          </button>

          {entry.type !== "file" || !isArchiveFile(entry.path) ? (
            <button
              className="mt-action-grid-btn"
              type="button"
              disabled={archivingPath === entry.path}
              onClick={() => {
                onClose();
                onArchiveEntry(entry);
              }}
            >
              <FileArchive size={20} className="action-icon zip" />
              <span>压缩为 ZIP</span>
            </button>
          ) : null}

          {entry.type === "file" ? (
            <button
              className="mt-action-grid-btn"
              type="button"
              onClick={() => {
                onClose();
                onDownloadEntry(entry);
              }}
            >
              <Download size={20} className="action-icon download" />
              <span>下载到手机</span>
            </button>
          ) : null}

          <button
            className="mt-action-grid-btn danger"
            type="button"
            onClick={() => {
              onClose();
              onDeleteEntry(entry);
            }}
          >
            <Trash2 size={20} className="action-icon delete" />
            <span>删除</span>
          </button>
        </div>
      </div>
    </div>
  );
}
