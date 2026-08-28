import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  CornerUpLeft,
  Download,
  Edit3,
  Eye,
  FileArchive,
  FilePlus,
  FileSearch,
  FileText,
  FileUp,
  Folder,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  Move,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Settings,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type {
  ExtractArchiveConflict,
  ExtractConflictAction,
  InstanceFileEntry,
  ManagedInstance
} from "@webops/shared";
import type {
  ExtractConflictPrompt,
  FileConflictChoice,
  FileConflictPrompt,
  FileToast,
  FindMatchRange,
  SakiInstanceFileDragPayload,
  SakiInstanceFileDropRequest
} from "../../types/app.js";
import { api, ApiError, type UploadProgressUpdate } from "../../api.js";
import { CodeEditor, type CodeEditorHandle, type FindRange, languageFromFileName } from "../../CodeEditor.js";
import { usePanelT } from "../../i18n/index.js";
import { sakiArtAssets } from "../../constants.js";
import {
  base64ToBlob,
  collectFindMatches,
  defaultArchiveFileName,
  defaultExtractPath,
  editorLanguageFromPath,
  fileExtension,
  filePreviewKindFromPath,
  formatBytes,
  formatDate,
  imageMimeTypeFromPath,
  isArchiveFile,
  isImageFile,
  joinFilePath,
  parentFilePath,
  splitNameForCopy,
  uniqueSiblingName
} from "../../utils/path.js";
import { FilePreview } from "../common/MarkdownContent.js";
import { FileConflictModal } from "./FileConflictModal.js";
import { ArchiveConflictModal } from "./ArchiveConflictModal.js";
import { CodeEditorPanel } from "./CodeEditorPanel.js";
import { MtActionSheet } from "./MtActionSheet.js";


const sakiInstanceFileDragMime = "application/x-webops-instance-file";

export function FileManager({
  token,
  instance,
  onSakiFileDragChange,
  onSakiInstanceFileDrop,
  darkMode,
  onClose
}: {
  token: string;
  instance: ManagedInstance | null;
  onSakiFileDragChange: (active: boolean) => void;
  onSakiInstanceFileDrop?: ((payload: SakiInstanceFileDragPayload) => void) | undefined;
  darkMode: boolean;
  onClose?: () => void;
}) {
  const instanceId = instance?.id ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const codeEditorRef = useRef<CodeEditorHandle | null>(null);
  const conflictResolveRef = useRef<((choice: FileConflictChoice | null) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const directoryLoadRequestRef = useRef(0);
  const fileOpenRequestRef = useRef(0);
  const mobileFileLongPressRef = useRef<{
    pointerId: number;
    entry: InstanceFileEntry;
    payload: SakiInstanceFileDragPayload;
    startX: number;
    startY: number;
    timerId: number;
    active: boolean;
  } | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<InstanceFileEntry[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [findVisible, setFindVisible] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [extractingPath, setExtractingPath] = useState<string | null>(null);
  const [archivingPath, setArchivingPath] = useState<string | null>(null);
  const [openFileActionMenuPath, setOpenFileActionMenuPath] = useState<string | null>(null);
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [fileConflictPrompt, setFileConflictPrompt] = useState<FileConflictPrompt | null>(null);
  const [extractConflictPrompt, setExtractConflictPrompt] = useState<ExtractConflictPrompt | null>(null);
  const [uploadProgress, setUploadProgress] = useState<(UploadProgressUpdate & { fileName: string }) | null>(null);
  const [fileToast, setFileToast] = useState<FileToast | null>(null);
  const [mobileFileDrag, setMobileFileDrag] = useState<{
    name: string;
    path: string;
    x: number;
    y: number;
    overSaki: boolean;
  } | null>(null);
  const [mobileBrowserOpen, setMobileBrowserOpen] = useState(true);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [sortField, setSortField] = useState<"name" | "size" | "modifiedAt">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [clipboard, setClipboard] = useState<{
    action: "copy" | "cut";
    paths: Set<string>;
    instanceId: string;
  } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [treeData, setTreeData] = useState<Record<string, InstanceFileEntry[]>>({});
  const [fileViewMode, setFileViewMode] = useState<"explorer" | "tree">("explorer");
  const [mobileActionEntry, setMobileActionEntry] = useState<InstanceFileEntry | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
  const mobileItemTouchTimerRef = useRef<number | null>(null);

  // MT Manager Dual-Pane State
  const [activePane, setActivePane] = useState<"left" | "right">("left");
  const [leftPath, setLeftPath] = useState("");
  const [leftEntries, setLeftEntries] = useState<InstanceFileEntry[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightPath, setRightPath] = useState("");
  const [rightEntries, setRightEntries] = useState<InstanceFileEntry[]>([]);
  const [rightLoading, setRightLoading] = useState(false);
  const [showMobileCreateMenu, setShowMobileCreateMenu] = useState(false);

  const displayLeftEntries = useMemo(() => {
    if (!mobileSearchQuery.trim()) return leftEntries;
    const q = mobileSearchQuery.trim().toLowerCase();
    return leftEntries.filter((e) => `${e.name} ${e.path}`.toLowerCase().includes(q));
  }, [leftEntries, mobileSearchQuery]);

  const displayRightEntries = useMemo(() => {
    if (!mobileSearchQuery.trim()) return rightEntries;
    const q = mobileSearchQuery.trim().toLowerCase();
    return rightEntries.filter((e) => `${e.name} ${e.path}`.toLowerCase().includes(q));
  }, [rightEntries, mobileSearchQuery]);

  const leftHistoryRef = useRef<string[]>([""]);
  const leftHistoryIndexRef = useRef(0);
  const [leftHistoryState, setLeftHistoryState] = useState({ canBack: false, canForward: false });

  const rightHistoryRef = useRef<string[]>([""]);
  const rightHistoryIndexRef = useRef(0);
  const [rightHistoryState, setRightHistoryState] = useState({ canBack: false, canForward: false });

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [marqueeBox, setMarqueeBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const explorerListRef = useRef<HTMLDivElement | null>(null);
  const isDraggingMarqueeRef = useRef(false);
  const marqueeStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastSelectedPathRef = useRef<string | null>(null);
  const [desktopContextMenu, setDesktopContextMenu] = useState<{
    x: number;
    y: number;
    type: "item" | "blank";
    targetEntry?: InstanceFileEntry;
    selectedEntries: InstanceFileEntry[];
  } | null>(null);

  const [mobileSelectedPaths, setMobileSelectedPaths] = useState<Set<string>>(() => new Set());
  const [isMobileSelectMode, setIsMobileSelectMode] = useState(false);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const touchSwipeTriggeredRef = useRef(false);

  function handleDesktopSelectAll() {
    if (selectedPaths.size === filteredEntries.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredEntries.map(e => e.path)));
    }
  }

  async function handleDesktopBatchDownload() {
    if (!instanceId || selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    try {
      if (paths.length === 1) {
        const entry = entries.find(e => e.path === paths[0]);
        if (entry && entry.type === "file") {
          await api.downloadInstanceFile(token, instanceId, entry.path);
        } else {
          await api.saveInstanceArchiveDownload(token, instanceId, paths, `${entry?.name ?? "archive"}.zip`);
        }
      } else {
        await api.saveInstanceArchiveDownload(token, instanceId, paths, `download_${Date.now()}.zip`);
      }
      showFileToast("下载中", `已触发 ${paths.length} 项下载`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }

  async function handleDesktopBatchArchive() {
    if (!instanceId || selectedPaths.size === 0) return;
    const name = window.prompt("压缩包文件名", `archive_${Date.now()}.tar.gz`)?.trim();
    if (!name) return;
    const outPath = joinFilePath(currentPath, name);
    try {
      await api.archiveInstancePaths(token, instanceId, Array.from(selectedPaths), outPath);
      await loadDirectory(currentPath);
      showFileToast("压缩完成", `已生成压缩包 ${name}`);
      setSelectedPaths(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "压缩失败");
    }
  }

  async function handleDesktopBatchDelete() {
    if (!instanceId || selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    if (!window.confirm(`确定要删除选中的 ${paths.length} 个项目吗？`)) return;

    // Optimistic: immediately remove from UI
    setEntries((prev) => prev.filter((e) => !paths.some((p) => e.path === p || e.path.startsWith(`${p}/`))));
    setTreeData((prev) => {
      const next = { ...prev };
      for (const [dirPath, items] of Object.entries(next)) {
        if (paths.some((p) => dirPath === p || dirPath.startsWith(`${p}/`))) {
          delete next[dirPath];
        } else {
          next[dirPath] = items.filter((item) => !paths.some((p) => item.path === p || item.path.startsWith(`${p}/`)));
        }
      }
      return next;
    });
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        next.delete(p);
        for (const folder of Array.from(next)) {
          if (folder.startsWith(`${p}/`)) next.delete(folder);
        }
      }
      return next;
    });

    // Clear any selected/editor states that match deleted paths
    for (const p of paths) {
      if (selectedPath === p || selectedPath?.startsWith(`${p}/`)) setSelectedPath(null);
      if (editorPath === p || editorPath?.startsWith(`${p}/`)) {
        setEditorPath(null);
        setEditorContent("");
        setEditorMode("edit");
        setMobileEditorOpen(false);
      }
      if (openFileActionMenuPath === p) setOpenFileActionMenuPath(null);
    }
    setSelectedPaths(new Set());
    showFileToast("删除中", `正在删除 ${paths.length} 项...`);

    try {
      for (const p of paths) {
        await api.deleteInstancePath(token, instanceId, p);
      }
      await loadDirectory(currentPath);
      showFileToast("删除成功", `已删除 ${paths.length} 项`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量删除失败");
      await loadDirectory(currentPath);
    }
  }

  function toggleMobileSelection(path: string) {
    setIsMobileSelectMode(true);
    setMobileSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleMobileTouchStart(e: React.TouchEvent, entry: InstanceFileEntry) {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    touchSwipeTriggeredRef.current = false;
    if (!isMobileSelectMode) {
      handleTouchStart(entry);
    }
  }

  function handleMobileTouchMove(e: React.TouchEvent, entry: InstanceFileEntry) {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;

    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      cancelMobileFileLongPress();
    }

    if (dx > 35 && Math.abs(dy) < 25 && !touchSwipeTriggeredRef.current) {
      touchSwipeTriggeredRef.current = true;
      toggleMobileSelection(entry.path);
    }
  }

  function handleMobileTouchEnd() {
    handleTouchEnd();
  }

  function handleMobileRowClick(entry: InstanceFileEntry, pane: "left" | "right") {
    setActivePane(pane);
    if (isMobileSelectMode) {
      toggleMobileSelection(entry.path);
      return;
    }
    if (entry.type === "directory") {
      void loadPaneDirectory(pane, entry.path);
    } else {
      setSelectedPath(entry.path);
      void openEntry(entry);
    }
  }

  function handleMobileSelectAll() {
    const currentList = activePane === "left" ? displayLeftEntries : displayRightEntries;
    if (mobileSelectedPaths.size === currentList.length) {
      setMobileSelectedPaths(new Set());
    } else {
      setMobileSelectedPaths(new Set(currentList.map(e => e.path)));
      setIsMobileSelectMode(true);
    }
  }

  async function handleMobileBatchCopy() {
    if (!instanceId || mobileSelectedPaths.size === 0) return;
    const targetDir = activePane === "left" ? rightPath : leftPath;
    const paths = Array.from(mobileSelectedPaths);
    setError("");
    try {
      for (const p of paths) {
        const entry = (activePane === "left" ? leftEntries : rightEntries).find(e => e.path === p);
        if (!entry) continue;
        const targetPath = joinFilePath(targetDir, entry.name);
        if (entry.type === "file") {
          const fileData = await api.readInstanceFile(token, instanceId, entry.path);
          await api.writeInstanceFile(token, instanceId, targetPath, fileData.content);
        } else {
          const tmpArchive = `${entry.path}.mt_batch_copy.tar.gz`;
          await api.archiveInstancePaths(token, instanceId, [entry.path], tmpArchive);
          await api.extractInstanceArchive(token, instanceId, tmpArchive, { outputPath: targetDir });
          await api.deleteInstancePath(token, instanceId, tmpArchive);
        }
      }
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("复制完成", `已复制 ${paths.length} 项到另一侧`);
      setMobileSelectedPaths(new Set());
      setIsMobileSelectMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量复制失败");
    }
  }

  async function handleMobileBatchMove() {
    if (!instanceId || mobileSelectedPaths.size === 0) return;
    const targetDir = activePane === "left" ? rightPath : leftPath;
    const paths = Array.from(mobileSelectedPaths);
    setError("");
    try {
      for (const p of paths) {
        const entry = (activePane === "left" ? leftEntries : rightEntries).find(e => e.path === p);
        if (!entry) continue;
        const targetPath = joinFilePath(targetDir, entry.name);
        if (entry.path === targetPath) continue;
        if (entry.type === "file") {
          const fileData = await api.readInstanceFile(token, instanceId, entry.path);
          await api.writeInstanceFile(token, instanceId, targetPath, fileData.content);
          await api.deleteInstancePath(token, instanceId, entry.path);
        } else {
          const tmpArchive = `${entry.path}.mt_batch_move.tar.gz`;
          await api.archiveInstancePaths(token, instanceId, [entry.path], tmpArchive);
          await api.extractInstanceArchive(token, instanceId, tmpArchive, { outputPath: targetDir });
          await api.deleteInstancePath(token, instanceId, tmpArchive);
          await api.deleteInstancePath(token, instanceId, entry.path);
        }
      }
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("移动完成", `已移动 ${paths.length} 项到另一侧`);
      setMobileSelectedPaths(new Set());
      setIsMobileSelectMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量移动失败");
    }
  }

  async function handleMobileBatchArchive() {
    if (!instanceId || mobileSelectedPaths.size === 0) return;
    const targetDir = activePane === "left" ? leftPath : rightPath;
    const name = window.prompt("压缩包名称", `archive_${Date.now()}.tar.gz`)?.trim();
    if (!name) return;
    const outPath = joinFilePath(targetDir, name);
    try {
      await api.archiveInstancePaths(token, instanceId, Array.from(mobileSelectedPaths), outPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("压缩完成", `已生成压缩包 ${name}`);
      setMobileSelectedPaths(new Set());
      setIsMobileSelectMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量压缩失败");
    }
  }

  async function handleMobileBatchDownload() {
    if (!instanceId || mobileSelectedPaths.size === 0) return;
    const paths = Array.from(mobileSelectedPaths);
    try {
      if (paths.length === 1) {
        const entry = (activePane === "left" ? leftEntries : rightEntries).find(e => e.path === paths[0]);
        if (entry && entry.type === "file") {
          await api.downloadInstanceFile(token, instanceId, entry.path);
        } else {
          await api.saveInstanceArchiveDownload(token, instanceId, paths, `${entry?.name ?? "archive"}.zip`);
        }
      } else {
        await api.saveInstanceArchiveDownload(token, instanceId, paths, `files_${Date.now()}.zip`);
      }
      showFileToast("下载中", `已触发 ${paths.length} 项下载`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量下载失败");
    }
  }

  async function handleMobileBatchDelete() {
    if (!instanceId || mobileSelectedPaths.size === 0) return;
    const paths = Array.from(mobileSelectedPaths);
    if (!window.confirm(`确定要删除选中的 ${paths.length} 个项目吗？`)) return;

    // Optimistic: immediately remove from both panes' UI
    const isDeletedPath = (p: string) => paths.some((d) => p === d || p.startsWith(`${d}/`));
    setLeftEntries((prev) => prev.filter((e) => !isDeletedPath(e.path)));
    setRightEntries((prev) => prev.filter((e) => !isDeletedPath(e.path)));

    // Clear any editor/action-menu states matching deleted paths
    for (const p of paths) {
      if (selectedPath === p || selectedPath?.startsWith(`${p}/`)) setSelectedPath(null);
      if (editorPath === p || editorPath?.startsWith(`${p}/`)) {
        setEditorPath(null);
        setEditorContent("");
        setEditorMode("edit");
        setMobileEditorOpen(false);
      }
      if (openFileActionMenuPath === p) setOpenFileActionMenuPath(null);
      if (mobileActionEntry?.path === p || mobileActionEntry?.path.startsWith(`${p}/`)) {
        setMobileActionEntry(null);
      }
    }
    setMobileSelectedPaths(new Set());
    setIsMobileSelectMode(false);
    showFileToast("删除中", `正在删除 ${paths.length} 项...`);

    try {
      for (const p of paths) {
        await api.deleteInstancePath(token, instanceId, p);
      }
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("删除成功", `已删除 ${paths.length} 项`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量删除失败");
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
    }
  }

  function handleTouchStart(entry: InstanceFileEntry) {
    if (mobileItemTouchTimerRef.current !== null) {
      window.clearTimeout(mobileItemTouchTimerRef.current);
    }
    mobileItemTouchTimerRef.current = window.setTimeout(() => {
      setMobileActionEntry(entry);
    }, 450);
  }

  function handleTouchEnd() {
    if (mobileItemTouchTimerRef.current !== null) {
      window.clearTimeout(mobileItemTouchTimerRef.current);
      mobileItemTouchTimerRef.current = null;
    }
  }

  const loadPaneDirectory = useCallback(
    async (pane: "left" | "right", pathToLoad: string, pushHistory = true) => {
      if (!instanceId) return;
      if (pane === "left") setLeftLoading(true);
      else setRightLoading(true);
      try {
        const response = await api.listInstanceFiles(token, instanceId, pathToLoad);
        if (pane === "left") {
          setLeftPath(response.path);
          setLeftEntries(response.entries);
          setLeftLoading(false);
          if (pushHistory) {
            const hist = leftHistoryRef.current.slice(0, leftHistoryIndexRef.current + 1);
            if (hist[hist.length - 1] !== response.path) {
              hist.push(response.path);
              leftHistoryRef.current = hist;
              leftHistoryIndexRef.current = hist.length - 1;
            }
          }
          setLeftHistoryState({
            canBack: leftHistoryIndexRef.current > 0,
            canForward: leftHistoryIndexRef.current < leftHistoryRef.current.length - 1
          });
        } else {
          setRightPath(response.path);
          setRightEntries(response.entries);
          setRightLoading(false);
          if (pushHistory) {
            const hist = rightHistoryRef.current.slice(0, rightHistoryIndexRef.current + 1);
            if (hist[hist.length - 1] !== response.path) {
              hist.push(response.path);
              rightHistoryRef.current = hist;
              rightHistoryIndexRef.current = hist.length - 1;
            }
          }
          setRightHistoryState({
            canBack: rightHistoryIndexRef.current > 0,
            canForward: rightHistoryIndexRef.current < rightHistoryRef.current.length - 1
          });
        }
      } catch (err) {
        if (pane === "left") setLeftLoading(false);
        else setRightLoading(false);
      }
    },
    [instanceId, token]
  );

  function handleNavBack() {
    if (activePane === "left") {
      if (leftHistoryIndexRef.current <= 0) return;
      leftHistoryIndexRef.current -= 1;
      const targetPath = leftHistoryRef.current[leftHistoryIndexRef.current] ?? "";
      void loadPaneDirectory("left", targetPath, false);
      setLeftHistoryState({
        canBack: leftHistoryIndexRef.current > 0,
        canForward: leftHistoryIndexRef.current < leftHistoryRef.current.length - 1
      });
    } else {
      if (rightHistoryIndexRef.current <= 0) return;
      rightHistoryIndexRef.current -= 1;
      const targetPath = rightHistoryRef.current[rightHistoryIndexRef.current] ?? "";
      void loadPaneDirectory("right", targetPath, false);
      setRightHistoryState({
        canBack: rightHistoryIndexRef.current > 0,
        canForward: rightHistoryIndexRef.current < rightHistoryRef.current.length - 1
      });
    }
  }

  function handleNavForward() {
    if (activePane === "left") {
      if (leftHistoryIndexRef.current >= leftHistoryRef.current.length - 1) return;
      leftHistoryIndexRef.current += 1;
      const targetPath = leftHistoryRef.current[leftHistoryIndexRef.current] ?? "";
      void loadPaneDirectory("left", targetPath, false);
      setLeftHistoryState({
        canBack: leftHistoryIndexRef.current > 0,
        canForward: leftHistoryIndexRef.current < leftHistoryRef.current.length - 1
      });
    } else {
      if (rightHistoryIndexRef.current >= rightHistoryRef.current.length - 1) return;
      rightHistoryIndexRef.current += 1;
      const targetPath = rightHistoryRef.current[rightHistoryIndexRef.current] ?? "";
      void loadPaneDirectory("right", targetPath, false);
      setRightHistoryState({
        canBack: rightHistoryIndexRef.current > 0,
        canForward: rightHistoryIndexRef.current < rightHistoryRef.current.length - 1
      });
    }
  }

  function handleNavUp() {
    if (activePane === "left") {
      if (!leftPath) return;
      void loadPaneDirectory("left", parentFilePath(leftPath));
    } else {
      if (!rightPath) return;
      void loadPaneDirectory("right", parentFilePath(rightPath));
    }
  }

  const [editingPane, setEditingPane] = useState<"left" | "right" | null>(null);
  const [editingPathText, setEditingPathText] = useState("");

  async function handlePathJump(pane: "left" | "right") {
    setEditingPane(null);
    let target = editingPathText.trim();
    while (target.startsWith("/")) {
      target = target.substring(1);
    }
    while (target.endsWith("/")) {
      target = target.substring(0, target.length - 1);
    }
    target = target.trim();
    const current = pane === "left" ? leftPath : rightPath;
    if (target === current) return;
    try {
      await loadPaneDirectory(pane, target);
    } catch {
      
    }
  }

  const [desktopEditingPath, setDesktopEditingPath] = useState(false);
  const [desktopPathText, setDesktopPathText] = useState("");

  async function handleDesktopPathJump() {
    setDesktopEditingPath(false);
    let target = desktopPathText.trim();
    while (target.startsWith("/")) {
      target = target.substring(1);
    }
    while (target.endsWith("/")) {
      target = target.substring(0, target.length - 1);
    }
    target = target.trim();
    if (target === currentPath) return;
    try {
      await loadDirectory(target);
      const parent = parentFilePath(target);
      if (parent) {
        await loadTreeDirectory(parent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "目录加载失败");
    }
  }

  async function copyToOppositePane(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const targetDir = activePane === "left" ? rightPath : leftPath;
    const targetPath = joinFilePath(targetDir, entry.name);
    setError("");
    try {
      if (entry.type === "file") {
        const fileData = await api.readInstanceFile(token, instanceId, entry.path);
        await api.writeInstanceFile(token, instanceId, targetPath, fileData.content);
      } else {
        const tmpArchive = `${entry.path}.mt_copy.tar.gz`;
        await api.archiveInstancePaths(token, instanceId, [entry.path], tmpArchive);
        await api.extractInstanceArchive(token, instanceId, tmpArchive, { outputPath: targetDir });
        await api.deleteInstancePath(token, instanceId, tmpArchive);
      }
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("复制完成", `已复制 ${entry.name} 到另一侧 (${targetDir || "根目录"})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制到另一侧失败");
    }
  }

  async function moveToOppositePane(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const targetDir = activePane === "left" ? rightPath : leftPath;
    const targetPath = joinFilePath(targetDir, entry.name);
    if (entry.path === targetPath) return;
    setError("");
    try {
      await api.renameInstancePath(token, instanceId, entry.path, targetPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("移动完成", `已移动 ${entry.name} 到另一侧 (${targetDir || "根目录"})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移动到另一侧失败");
    }
  }

  async function extractToOppositePane(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const targetDir = activePane === "left" ? rightPath : leftPath;
    setError("");
    try {
      await api.extractInstanceArchive(token, instanceId, entry.path, { outputPath: targetDir });
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      showFileToast("解压完成", `已解压到另一侧 (${targetDir || "根目录"})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解压失败");
    }
  }

  function syncPanes() {
    if (activePane === "left") {
      void loadPaneDirectory("right", leftPath);
      showFileToast("已同步", "右侧已同步至左侧路径");
    } else {
      void loadPaneDirectory("left", rightPath);
      showFileToast("已同步", "左侧已同步至右侧路径");
    }
  }

  const breadcrumbSegments = useMemo(() => {
    if (!currentPath) return [{ label: "根目录", path: "" }];
    const parts = currentPath.split("/").filter(Boolean);
    const segs = [{ label: "根目录", path: "" }];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      segs.push({ label: part, path: acc });
    }
    return segs;
  }, [currentPath]);

  const filteredEntries = useMemo(() => {
    const query = fileSearchQuery.trim().toLowerCase();
    let result = [...entries];
    if (query) {
      result = result.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(query));
    }

    result.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;

      let aValue: any;
      let bValue: any;

      if (sortField === "name") {
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
      } else if (sortField === "size") {
        aValue = a.type === "file" ? a.size : 0;
        bValue = b.type === "file" ? b.size : 0;
      } else {
        aValue = new Date(a.modifiedAt).getTime();
        bValue = new Date(b.modifiedAt).getTime();
      }

      if (aValue < bValue) return sortOrder === "asc" ? -1 : 1;
      if (aValue > bValue) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [entries, fileSearchQuery, sortField, sortOrder]);
  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? null;
  const editorLanguage = useMemo(() => editorLanguageFromPath(editorPath), [editorPath]);
  const editorPreviewKind = useMemo(() => filePreviewKindFromPath(editorPath), [editorPath]);
  const editorIsImage = editorPreviewKind === "image";
  const editorCanEdit = Boolean(editorPath && !editorIsImage);
  const editorCanTogglePreview = editorPreviewKind === "html" || editorPreviewKind === "markdown";
  const findMatches = useMemo(
    () => (editorCanEdit ? collectFindMatches(editorContent, findQuery) : []),
    [editorCanEdit, editorContent, findQuery]
  );
  const activeFindIndex = findMatches.length > 0 ? Math.min(findActiveIndex, findMatches.length - 1) : -1;
  const findResultLabel = !findQuery
    ? "输入关键词"
    : findMatches.length > 0
      ? `${activeFindIndex + 1}/${findMatches.length}`
      : "无结果";
  const findRanges = useMemo<FindRange[]>(
    () => findMatches.map((match, index) => ({ start: match.start, end: match.end, active: index === activeFindIndex })),
    [findMatches, activeFindIndex]
  );

  const loadDirectory = useCallback(
    async (pathToLoad: string) => {
      if (!instanceId) return;
      const requestId = directoryLoadRequestRef.current + 1;
      directoryLoadRequestRef.current = requestId;
      setLoading(true);
      setError("");
      try {
        const response = await api.listInstanceFiles(token, instanceId, pathToLoad);
        if (requestId !== directoryLoadRequestRef.current) return;
        setCurrentPath(response.path);
        setEntries(response.entries);
        setFileSearchQuery("");
        setSelectedPath(null);
        setOpenFileActionMenuPath(null);

        // Update treeData for this directory path
        setTreeData(prev => ({
          ...prev,
          [response.path]: response.entries
        }));
      } catch (err) {
        if (requestId !== directoryLoadRequestRef.current) return;
        setError(err instanceof Error ? err.message : "文件列表读取失败");
      } finally {
        if (requestId === directoryLoadRequestRef.current) {
          setLoading(false);
        }
      }
    },
    [instanceId, token]
  );

  const loadTreeDirectory = useCallback(async (pathToLoad: string) => {
    if (!instanceId) return;
    try {
      const response = await api.listInstanceFiles(token, instanceId, pathToLoad);
      setTreeData(prev => ({
        ...prev,
        [response.path]: response.entries
      }));
    } catch (err) {
      console.error("Failed to load tree directory:", err);
    }
  }, [instanceId, token]);

  const toggleFolder = async (path: string) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) {
      next.delete(path);
      setExpandedFolders(next);
    } else {
      next.add(path);
      setExpandedFolders(next);
      if (!treeData[path]) {
        await loadTreeDirectory(path);
      }
    }
  };

  const handleTreeFolderClick = (path: string) => {
    void loadDirectory(path);
  };

  async function moveFileToFolder(srcPath: string, destFolder: string) {
    if (!instanceId) return;
    const fileName = srcPath.split("/").pop() || srcPath;
    const destPath = destFolder ? `${destFolder}/${fileName}` : fileName;
    if (srcPath === destPath) return;
    setError("");
    try {
      await api.renameInstancePath(token, instanceId, srcPath, destPath);
      await loadDirectory(currentPath);
      await loadTreeDirectory(destFolder);
      const srcParent = srcPath.split("/").slice(0, -1).join("/");
      await loadTreeDirectory(srcParent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移动文件失败");
    }
  }

  function handleClipboardAction(action: "copy" | "cut", path?: string | string[] | Set<string>) {
    if (!instanceId) return;
    const paths = new Set<string>();
    if (path) {
      if (typeof path === "string") {
        paths.add(path);
      } else {
        path.forEach((p) => paths.add(p));
      }
    } else if (selectedPaths.size > 0) {
      selectedPaths.forEach((p) => paths.add(p));
    } else if (selectedPath) {
      paths.add(selectedPath);
    }

    if (paths.size === 0) return;

    setClipboard({
      action,
      paths,
      instanceId
    });

    showFileToast(
      action === "copy" ? "已复制到剪贴板" : "已剪切到剪贴板",
      `已选择 ${paths.size} 个项目，可在目标目录粘贴。`
    );
  }

  async function handleClipboardPaste() {
    if (!instanceId || !clipboard) return;
    setError("");
    const pathsToPaste = Array.from(clipboard.paths);
    const actionName = clipboard.action === "copy" ? "复制" : "移动";

    try {
      for (const srcPath of pathsToPaste) {
        const fileName = srcPath.split("/").pop() || srcPath;
        const destPath = currentPath ? `${currentPath}/${fileName}` : fileName;

        if (srcPath === destPath) {
          throw new Error("源路径与目标路径相同");
        }

        if (clipboard.action === "copy") {
          await api.copyInstancePath(token, instanceId, srcPath, destPath);
        } else {
          await api.renameInstancePath(token, instanceId, srcPath, destPath);
        }
      }

      showFileToast(`${actionName}完成`, `成功${actionName}了 ${pathsToPaste.length} 个项目`);

      if (clipboard.action === "cut") {
        setClipboard(null);
      }

      await loadDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionName}失败`);
    }
  }

  function handleSortClick(field: "name" | "size" | "modifiedAt") {
    if (sortField === field) {
      setSortOrder(current => current === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.closest(".cm-editor") ||
          activeEl.getAttribute("contenteditable") === "true")
      ) {
        return;
      }

      if (!instanceId || editorPath) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filteredEntries.length === 0) return;
        const index = filteredEntries.findIndex(e => e.path === selectedPath);
        const nextIndex = index < filteredEntries.length - 1 ? index + 1 : 0;
        const entry = filteredEntries[nextIndex];
        if (entry) setSelectedPath(entry.path);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filteredEntries.length === 0) return;
        const index = filteredEntries.findIndex(e => e.path === selectedPath);
        const prevIndex = index > 0 ? index - 1 : filteredEntries.length - 1;
        const entry = filteredEntries[prevIndex];
        if (entry) setSelectedPath(entry.path);
      } else if (event.key === "Enter") {
        if (!selectedPath) return;
        const entry = filteredEntries.find(e => e.path === selectedPath);
        if (entry) {
          event.preventDefault();
          void openEntry(entry);
        }
      } else if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
        if (!editorPath && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
          event.preventDefault();
          handleDesktopSelectAll();
        }
      } else if (event.key === "Delete") {
        if (selectedPaths.size > 1) {
          event.preventDefault();
          void handleDesktopBatchDelete();
        } else if (selectedPath || selectedPaths.size === 1) {
          const pathToDelete = selectedPath || Array.from(selectedPaths)[0];
          const entry = filteredEntries.find(e => e.path === pathToDelete);
          if (entry) {
            event.preventDefault();
            void deleteEntry(entry);
          }
        }
      } else if (event.key === "F2") {
        const pathToRename = selectedPath || (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
        if (pathToRename) {
          const entry = filteredEntries.find(e => e.path === pathToRename);
          if (entry) {
            event.preventDefault();
            void renameEntry(entry);
          }
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSelectedPath(null);
        setSelectedPaths(new Set());
        setDesktopContextMenu(null);
        lastSelectedPathRef.current = null;
      } else if (event.key === "c" && (event.ctrlKey || event.metaKey)) {
        if (selectedPaths.size > 0 || selectedPath) {
          event.preventDefault();
          handleClipboardAction("copy", selectedPaths.size > 0 ? selectedPaths : selectedPath!);
        }
      } else if (event.key === "x" && (event.ctrlKey || event.metaKey)) {
        if (selectedPaths.size > 0 || selectedPath) {
          event.preventDefault();
          handleClipboardAction("cut", selectedPaths.size > 0 ? selectedPaths : selectedPath!);
        }
      } else if (event.key === "v" && (event.ctrlKey || event.metaKey)) {
        if (clipboard) {
          event.preventDefault();
          void handleClipboardPaste();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [instanceId, editorPath, filteredEntries, selectedPath, selectedPaths, clipboard]);

  useEffect(() => {
    directoryLoadRequestRef.current += 1;
    fileOpenRequestRef.current += 1;
    setCurrentPath("");
    setEntries([]);
    setLeftPath("");
    setLeftEntries([]);
    setRightPath("");
    setRightEntries([]);
    setActivePane("left");
    setFileSearchQuery("");
    setSelectedPath(null);
    setSelectedPaths(new Set());
    setDesktopContextMenu(null);
    lastSelectedPathRef.current = null;
    setEditorPath(null);
    setEditorContent("");
    setEditorMode("edit");
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
    setExtractingPath(null);
    setArchivingPath(null);
    setOpenFileActionMenuPath(null);
    setDraggingFilePath(null);
    setFileConflictPrompt(null);
    setUploadProgress(null);
    setFileToast(null);
    setMobileBrowserOpen(true);
    setMobileEditorOpen(false);
    setMobileSearchOpen(false);
    setMobileSearchQuery("");
    setDesktopEditingPath(false);
    setDesktopPathText("");
    setTreeData({});
    setExpandedFolders(new Set());
    if (instanceId) {
      void loadDirectory("");
      void loadTreeDirectory("");
      void loadPaneDirectory("left", "");
      void loadPaneDirectory("right", "");
    }
  }, [instanceId, loadDirectory, loadTreeDirectory, loadPaneDirectory]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (mobileFileLongPressRef.current) {
        window.clearTimeout(mobileFileLongPressRef.current.timerId);
      }
    };
  }, []);

  useEffect(() => {
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }, [editorPath]);

  useEffect(() => {
    if (editorIsImage && editorMode !== "preview") {
      setEditorMode("preview");
      return;
    }
    if (!editorPreviewKind && editorMode !== "edit") {
      setEditorMode("edit");
    }
    if (editorMode === "preview") {
      setFindVisible(false);
    }
  }, [editorIsImage, editorMode, editorPreviewKind]);

  useEffect(() => {
    setFindActiveIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!mobileBrowserOpen && !mobileEditorOpen) return;
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileBrowserOpen, mobileEditorOpen]);

  useEffect(() => {
    if (!mobileBrowserOpen && !mobileEditorOpen && !findVisible) return;
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || fileConflictPrompt || extractConflictPrompt) return;
      if (findVisible) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeEditorFind();
        return;
      }
      if (mobileEditorOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeMobileEditorModal();
        return;
      }
      if (mobileBrowserOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeMobileBrowserModal();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [extractConflictPrompt, fileConflictPrompt, findVisible, mobileBrowserOpen, mobileEditorOpen]);

  useEffect(() => {
    if (!findVisible) return;
    const frame = window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [findVisible]);

  useEffect(() => {
    if (findMatches.length === 0) {
      if (findActiveIndex !== 0) setFindActiveIndex(0);
      return;
    }
    if (findActiveIndex >= findMatches.length) {
      setFindActiveIndex(findMatches.length - 1);
    }
  }, [findActiveIndex, findMatches.length]);

  useEffect(() => {
    if (!openFileActionMenuPath) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".file-action-menu-wrap")) return;
      setOpenFileActionMenuPath(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openFileActionMenuPath]);

  useEffect(() => {
    if (!desktopContextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".win-context-menu")) return;
      setDesktopContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [desktopContextMenu]);

  function revealFindMatch(match: FindMatchRange, focusEditor: boolean) {
    codeEditorRef.current?.scrollToPosition(match.start);
    if (focusEditor) {
      codeEditorRef.current?.getView()?.focus();
    }
  }

  function isMobileFileLayout() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  }

  function resetEditorSearchState() {
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }

  function cancelPendingFileOpen() {
    fileOpenRequestRef.current += 1;
  }

  function closeMobileBrowserModal() {
    cancelPendingFileOpen();
    cancelMobileFileLongPress();
    setMobileEditorOpen(false);
    setMobileBrowserOpen(false);
    resetEditorSearchState();
    onClose?.();
  }

  function closeMobileEditorModal() {
    cancelPendingFileOpen();
    setMobileEditorOpen(false);
    resetEditorSearchState();
  }

  function openEditorFind() {
    if (!editorCanEdit) return;
    setFindVisible(true);
    if (findQuery.trim() && findMatches.length > 0) {
      const match = activeFindIndex >= 0 ? findMatches[activeFindIndex] : findMatches[0];
      if (match) revealFindMatch(match, false);
    }
  }

  function closeEditorFind() {
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }

  function handleFindQueryChange(newQuery: string) {
    setFindQuery(newQuery);
    setFindActiveIndex(0);
    if (newQuery.trim()) {
      const matches = editorCanEdit ? collectFindMatches(editorContent, newQuery) : [];
      const firstMatch = matches[0];
      if (firstMatch) {
        revealFindMatch(firstMatch, false);
      }
    }
  }

  function moveFindMatch(step: number, focusEditor: boolean) {
    if (findMatches.length === 0) return;
    const nextIndex =
      activeFindIndex >= 0 ? (activeFindIndex + step + findMatches.length) % findMatches.length : 0;
    setFindActiveIndex(nextIndex);
    const match = findMatches[nextIndex];
    if (match) {
      window.requestAnimationFrame(() => revealFindMatch(match, focusEditor));
    }
  }

  function handleFileManagerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (findVisible) {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        closeEditorFind();
        return;
      }
      if (mobileEditorOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        closeMobileEditorModal();
        return;
      }
      if (mobileBrowserOpen) {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        closeMobileBrowserModal();
        return;
      }
    }
    if (!editorCanEdit || editorMode !== "edit") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveEditor();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openEditorFind();
      return;
    }
    if (event.key === "F3") {
      event.preventDefault();
      if (!findVisible) {
        openEditorFind();
      } else {
        moveFindMatch(event.shiftKey ? -1 : 1, true);
      }
      return;
    }
    if (event.key === "Escape" && findVisible) {
      event.preventDefault();
      closeEditorFind();
    }
  }

  function sakiPayloadForEntry(entry: InstanceFileEntry): SakiInstanceFileDragPayload | null {
    if (!instanceId || entry.type !== "file") return null;
    return {
      source: "webops-instance-file",
      instanceId,
      instanceName: instance?.name ?? "",
      path: entry.path,
      name: entry.name,
      size: entry.size,
      modifiedAt: entry.modifiedAt
    };
  }

  function handleEntryDragStart(event: React.DragEvent<HTMLElement>, entry: InstanceFileEntry) {
    const payload = sakiPayloadForEntry(entry);
    if (!payload) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(sakiInstanceFileDragMime, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", entry.path);
    setDraggingFilePath(entry.path);
    onSakiFileDragChange(true);
  }

  function handleEntryDragEnd() {
    setDraggingFilePath(null);
    onSakiFileDragChange(false);
  }

  function isSakiDropTargetAt(clientX: number, clientY: number): boolean {
    const element = document.elementFromPoint(clientX, clientY);
    return Boolean(element?.closest(".saki-launcher, .saki-panel"));
  }

  function cancelMobileFileLongPress() {
    const drag = mobileFileLongPressRef.current;
    if (drag) {
      window.clearTimeout(drag.timerId);
    }
    mobileFileLongPressRef.current = null;
    setMobileFileDrag(null);
    setDraggingFilePath(null);
    onSakiFileDragChange(false);
  }

  function availableArchiveName(fileName: string): string {
    return existingEntryByName(fileName) ? uniqueSiblingName(fileName, entries) : fileName;
  }

  function saveBase64Download(contentBase64: string, fileName: string) {
    const url = URL.createObjectURL(base64ToBlob(contentBase64));
    const link = document.createElement("a");
    link.style.display = "none";
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      try {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {}
    }, 1000);
  }

  function showFileToast(title: string, detail: string) {
    const id = Date.now();
    setFileToast({ id, title, detail });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setFileToast((current) => (current?.id === id ? null : current));
    }, 3600);
  }

  function askFileConflict(prompt: FileConflictPrompt): Promise<FileConflictChoice | null> {
    return new Promise((resolve) => {
      conflictResolveRef.current = resolve;
      setFileConflictPrompt(prompt);
    });
  }

  function resolveFileConflict(choice: FileConflictChoice | null) {
    conflictResolveRef.current?.(choice);
    conflictResolveRef.current = null;
    setFileConflictPrompt(null);
  }

  function getActiveTargetDir() {
    return isMobileFileLayout() ? (activePane === "left" ? leftPath : rightPath) : currentPath;
  }

  function existingEntryByName(name: string, targetDir?: string): InstanceFileEntry | null {
    const normalized = name.toLocaleLowerCase();
    const targetEntries = isMobileFileLayout()
      ? (activePane === "left" ? leftEntries : rightEntries)
      : entries;
    return targetEntries.find((entry) => entry.name.toLocaleLowerCase() === normalized) ?? null;
  }

  async function chooseTargetName(action: FileConflictPrompt["action"], name: string, baseDir?: string) {
    const targetDir = baseDir !== undefined ? baseDir : getActiveTargetDir();
    const existing = existingEntryByName(name, targetDir);
    const targetEntries = isMobileFileLayout()
      ? (activePane === "left" ? leftEntries : rightEntries)
      : entries;
    if (!existing) {
      return { name, path: joinFilePath(targetDir, name), overwrite: false };
    }

    const suggestedName = uniqueSiblingName(name, targetEntries);
    const choice = await askFileConflict({
      action,
      name,
      suggestedName,
      canOverwrite: existing.type === "file"
    });
    if (!choice) return null;
    if (choice === "overwrite" && existing.type === "file") {
      return { name, path: joinFilePath(targetDir, name), overwrite: true };
    }
    return {
      name: suggestedName,
      path: joinFilePath(targetDir, suggestedName),
      overwrite: false
    };
  }

  async function openEntry(entry: InstanceFileEntry) {
    const requestId = fileOpenRequestRef.current + 1;
    fileOpenRequestRef.current = requestId;
    setSelectedPath(entry.path);
    setError("");
    if (entry.type === "directory") {
      setEditorPath(null);
      setEditorContent("");
      setEditorMode("edit");
      setMobileEditorOpen(false);
      resetEditorSearchState();
      await loadDirectory(entry.path);
      return;
    }

    if (!instanceId || entry.type !== "file") return;
    try {
      if (isImageFile(entry.path)) {
        const response = await api.downloadInstanceFile(token, instanceId, entry.path, { base64: true });
        if (requestId !== fileOpenRequestRef.current) return;
        const mimeType = imageMimeTypeFromPath(response.path) ?? imageMimeTypeFromPath(entry.path) ?? "image/png";
        setEditorPath(response.path);
        setEditorContent(`data:${mimeType};base64,${response.contentBase64}`);
        setEditorMode("preview");
        if (isMobileFileLayout()) {
          setMobileEditorOpen(true);
        }
        return;
      }

      const response = await api.readInstanceFile(token, instanceId, entry.path);
      if (requestId !== fileOpenRequestRef.current) return;
      setEditorPath(response.path);
      setEditorContent(response.content);
      setEditorMode(filePreviewKindFromPath(response.path) ? "preview" : "edit");
      if (isMobileFileLayout()) {
        setMobileEditorOpen(true);
      }
    } catch (err) {
      if (requestId !== fileOpenRequestRef.current) return;
      setError(err instanceof Error ? err.message : "文件读取失败");
    }
  }

  async function saveEditor() {
    if (!instanceId || !editorPath || !editorCanEdit) return;
    setSaving(true);
    setError("");
    try {
      const contentToSave = codeEditorRef.current?.getValue() ?? editorContent;
      await api.writeInstanceFile(token, instanceId, editorPath, contentToSave);
      setEditorContent(contentToSave);
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      setSelectedPath(editorPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createFile() {
    if (!instanceId) return;
    const name = window.prompt("文件名")?.trim();
    if (!name) return;
    const targetDir = getActiveTargetDir();
    const target = await chooseTargetName("create", name, targetDir);
    if (!target) return;
    setError("");
    try {
      await api.writeInstanceFile(token, instanceId, target.path, "");
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      const parent = parentFilePath(target.path);
      if (parent !== currentPath) {
        await loadTreeDirectory(parent);
      }
      const response = await api.readInstanceFile(token, instanceId, target.path);
      setSelectedPath(response.path);
      setEditorPath(response.path);
      setEditorContent(response.content);
      setEditorMode("edit");
      if (isMobileFileLayout()) {
        setMobileEditorOpen(true);
      }
      showFileToast(target.overwrite ? "文件已覆盖" : "文件已创建", `已保存为 ${target.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件创建失败");
    }
  }

  async function createDirectory() {
    if (!instanceId) return;
    const name = window.prompt("目录名")?.trim();
    if (!name) return;
    const targetDir = getActiveTargetDir();
    setError("");
    try {
      const newDirPath = joinFilePath(targetDir, name);
      await api.makeInstanceDirectory(token, instanceId, newDirPath);
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      const parent = parentFilePath(newDirPath);
      if (parent !== currentPath) {
        await loadTreeDirectory(parent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "目录创建失败");
    }
  }

  async function renameEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const nextName = window.prompt("新名称", entry.name)?.trim();
    if (!nextName || nextName === entry.name) return;
    const nextPath = joinFilePath(parentFilePath(entry.path), nextName);
    setError("");
    try {
      const response = await api.renameInstancePath(token, instanceId, entry.path, nextPath);
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      const srcParent = parentFilePath(entry.path);
      const destParent = parentFilePath(nextPath);
      if (srcParent !== currentPath) await loadTreeDirectory(srcParent);
      if (destParent !== currentPath && destParent !== srcParent) await loadTreeDirectory(destParent);
      if (editorPath === entry.path) {
        await openEntry(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }

  async function deleteEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    if (!window.confirm(`删除 ${entry.name}？`)) return;
    setError("");

    const deletedPath = entry.path;
    const parentPath = parentFilePath(deletedPath);
    setEntries((prev) => prev.filter((e) => e.path !== deletedPath && !e.path.startsWith(`${deletedPath}/`)));
    setTreeData((prev) => {
      const next = { ...prev };
      for (const [dirPath, items] of Object.entries(next)) {
        if (dirPath === deletedPath || dirPath.startsWith(`${deletedPath}/`)) {
          delete next[dirPath];
        } else {
          next[dirPath] = items.filter((item) => item.path !== deletedPath && !item.path.startsWith(`${deletedPath}/`));
        }
      }
      return next;
    });
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.delete(deletedPath);
      for (const folder of Array.from(next)) {
        if (folder.startsWith(`${deletedPath}/`)) next.delete(folder);
      }
      return next;
    });

    if (selectedPath === deletedPath || (selectedPath?.startsWith(`${deletedPath}/`) ?? false)) {
      setSelectedPath(null);
    }
    if (editorPath === deletedPath || (editorPath?.startsWith(`${deletedPath}/`) ?? false)) {
      setEditorPath(null);
      setEditorContent("");
      setEditorMode("edit");
      setMobileEditorOpen(false);
    }
    if (openFileActionMenuPath === deletedPath) {
      setOpenFileActionMenuPath(null);
    }

    try {
      await api.deleteInstancePath(token, instanceId, deletedPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      if (currentPath === deletedPath || currentPath.startsWith(`${deletedPath}/`)) {
        await loadDirectory(parentPath);
      } else {
        await loadDirectory(currentPath);
      }
      if (parentPath !== currentPath) {
        await loadTreeDirectory(parentPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      if (parentPath !== currentPath) {
        await loadTreeDirectory(parentPath);
      }
    }
  }

  async function uploadFile(
    file: File,
    options: { clearInput?: boolean; batchIndex?: number; batchTotal?: number } = {}
  ) {
    if (!instanceId) return;
    const clearInput = options.clearInput ?? true;
    const targetDir = getActiveTargetDir();
    const target = await chooseTargetName("upload", file.name, targetDir);
    if (!target) {
      if (clearInput && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    const progressFileName =
      options.batchTotal && options.batchTotal > 1
        ? `${target.name} (${options.batchIndex ?? 1}/${options.batchTotal})`
        : target.name;
    setError("");
    setUploadProgress({ fileName: progressFileName, percent: 1, label: "读取文件" });
    try {
      const response = await api.uploadInstanceFileWithProgress(
        token,
        instanceId,
        target.path,
        file,
        target.overwrite,
        (progress) => setUploadProgress({ ...progress, fileName: progressFileName })
      );
      await loadDirectory(currentPath);
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      const parent = parentFilePath(target.path);
      if (parent !== currentPath) {
        await loadTreeDirectory(parent);
      }
      setSelectedPath(response.path);
      if (editorPath === response.path) {
        setEditorPath(null);
        setEditorContent("");
        setEditorMode("edit");
      }
      showFileToast("上传成功", `已保存为 ${target.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      window.setTimeout(() => {
        setUploadProgress((current) => (current?.fileName === progressFileName ? null : current));
      }, 700);
      if (clearInput && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    if (files.length === 1) {
      await uploadFile(files[0]!);
      return;
    }

    for (let index = 0; index < files.length; index += 1) {
      await uploadFile(files[index]!, {
        clearInput: false,
        batchIndex: index + 1,
        batchTotal: files.length
      });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    showFileToast("批量上传完成", `已处理 ${files.length} 个文件`);
  }

  async function downloadEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    setError("");
    try {
      if (entry.type === "file") {
        await api.saveInstanceFileDownload(token, instanceId, entry.path);
      } else {
        await api.saveInstanceArchiveDownload(token, instanceId, [entry.path], defaultArchiveFileName(entry.path));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }

  async function archiveEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const outputName = availableArchiveName(defaultArchiveFileName(entry.path));
    const outputPath = joinFilePath(parentFilePath(entry.path), outputName);
    setError("");
    setArchivingPath(entry.path);
    try {
      const response = await api.archiveInstancePaths(token, instanceId, [entry.path], outputPath);
      await loadDirectory(parentFilePath(response.outputPath));
      await loadPaneDirectory("left", leftPath);
      await loadPaneDirectory("right", rightPath);
      setSelectedPath(response.outputPath);
      showFileToast("压缩完成", `已创建 ${response.entry.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "压缩失败");
    } finally {
      setArchivingPath(null);
    }
  }

  async function finishExtract(
    entryPath: string,
    outputPath: string,
    options: {
      conflictPolicy?: ExtractConflictAction;
      conflictResolutions?: Record<string, ExtractConflictAction>;
    } = {}
  ) {
    if (!instanceId) return;
    const response = await api.extractInstanceArchive(token, instanceId, entryPath, {
      outputPath,
      ...options
    });
    setEditorPath(null);
    setEditorContent("");
    setEditorMode("edit");
    await loadDirectory(parentFilePath(response.outputPath));
    await loadPaneDirectory("left", leftPath);
    await loadPaneDirectory("right", rightPath);
    setSelectedPath(response.outputPath);
    const detail =
      response.skippedCount > 0 || response.overwrittenCount > 0
        ? `解压 ${response.extractedCount} 个，覆盖 ${response.overwrittenCount} 个，跳过 ${response.skippedCount} 个`
        : `已解压到 ${response.outputPath}`;
    showFileToast("解压完成", detail);
  }

  function setExtractConflictResolution(relativePath: string, action: ExtractConflictAction) {
    setExtractConflictPrompt((current) => {
      if (!current) return current;
      return {
        ...current,
        resolutions: {
          ...current.resolutions,
          [relativePath]: action
        }
      };
    });
  }

  function setAllExtractConflictResolutions(action: ExtractConflictAction) {
    setExtractConflictPrompt((current) => {
      if (!current) return current;
      const resolutions: Record<string, ExtractConflictAction> = {};
      for (const conflict of current.conflicts) {
        resolutions[conflict.path] = action === "overwrite" && !conflict.canOverwrite ? "skip" : action;
      }
      return { ...current, resolutions };
    });
  }

  async function confirmExtractConflicts() {
    if (!extractConflictPrompt) return;
    const { archivePath, outputPath, resolutions } = extractConflictPrompt;
    setError("");
    setExtractingPath(archivePath);
    try {
      await finishExtract(archivePath, outputPath, { conflictResolutions: resolutions });
      setExtractConflictPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解压失败");
    } finally {
      setExtractingPath(null);
    }
  }

  async function extractArchive(entry: InstanceFileEntry) {
    if (!instanceId || entry.type !== "file" || !isArchiveFile(entry.path)) return;
    const suggestedPath = defaultExtractPath(entry.path);
    const rawOutputPath = window.prompt("解压到目录", suggestedPath);
    if (rawOutputPath === null) return;
    const outputPath = rawOutputPath.trim() || suggestedPath;
    setError("");
    setExtractingPath(entry.path);
    try {
      const preview = await api.extractInstanceArchive(token, instanceId, entry.path, {
        outputPath,
        preview: true
      });
      const conflicts = preview.conflicts ?? [];
      if (conflicts.length === 0) {
        await finishExtract(entry.path, outputPath);
        return;
      }
      setExtractConflictPrompt({
        archivePath: entry.path,
        outputPath,
        conflicts,
        resolutions: Object.fromEntries(conflicts.map((conflict) => [conflict.path, "skip" as const]))
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "解压失败");
    } finally {
      setExtractingPath(null);
    }
  }

  function renderExplorerView() {
    if (loading && entries.length === 0) {
      return <div className="tree-empty-state">载入中...</div>;
    }
    if (filteredEntries.length === 0) {
      return (
        <div className="explorer-list-view" role="list" ref={explorerListRef}>
          {currentPath ? (
            <div
              className="explorer-item-row is-directory is-parent-dir"
              onClick={() => void loadDirectory(parentFilePath(currentPath))}
              title="返回上一级目录"
            >
              <div className="explorer-item-main">
                <div className="explorer-item-icon dir-icon">
                  <Folder size={17} />
                </div>
                <div className="explorer-item-info">
                  <span className="explorer-item-name" style={{ fontWeight: 700 }}>..</span>
                </div>
              </div>
            </div>
          ) : null}
          <div className="explorer-empty-state">
            <FolderOpen size={36} className="empty-icon" />
            <span>{fileSearchQuery ? "未搜索到匹配项" : "此文件夹为空"}</span>
            {!fileSearchQuery ? (
              <div className="empty-quick-actions">
                <button className="small-button" type="button" onClick={() => void createFile()}>
                  <FilePlus size={14} /> 新建文件
                </button>
                <button className="small-button" type="button" onClick={() => void createDirectory()}>
                  <FolderPlus size={14} /> 新建目录
                </button>
                <button className="small-button" type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> 上传文件
                </button>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    function handleExplorerMouseDown(e: React.MouseEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, a, .explorer-item-actions, .win-context-menu")) {
        return;
      }
      setDesktopContextMenu(null);

      const container = explorerListRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startX = e.clientX - rect.left + container.scrollLeft;
      const startY = e.clientY - rect.top + container.scrollTop;

      const initialSelected = new Set(e.ctrlKey || e.metaKey ? selectedPaths : []);
      let hasDragged = false;

      function handleMouseMove(ev: MouseEvent) {
        if (!explorerListRef.current) return;
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (!hasDragged && Math.hypot(dx, dy) < 5) return;

        if (!hasDragged) {
          hasDragged = true;
          isDraggingMarqueeRef.current = true;
          marqueeStartPosRef.current = { x: startX, y: startY };
        }

        const currentRect = explorerListRef.current.getBoundingClientRect();
        const currentX = ev.clientX - currentRect.left + explorerListRef.current.scrollLeft;
        const currentY = ev.clientY - currentRect.top + explorerListRef.current.scrollTop;

        const x1 = marqueeStartPosRef.current.x;
        const y1 = marqueeStartPosRef.current.y;
        const x2 = currentX;
        const y2 = currentY;

        setMarqueeBox({ x1, y1, x2, y2 });

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        const items = explorerListRef.current.querySelectorAll<HTMLElement>(".explorer-item-row[data-path]");
        const newSelected = new Set(initialSelected);

        items.forEach((item) => {
          const itemTop = item.offsetTop;
          const itemLeft = item.offsetLeft;
          const itemBottom = itemTop + item.offsetHeight;
          const itemRight = itemLeft + item.offsetWidth;

          if (
            itemRight >= minX &&
            itemLeft <= maxX &&
            itemBottom >= minY &&
            itemTop <= maxY
          ) {
            const path = item.getAttribute("data-path");
            if (path) newSelected.add(path);
          }
        });

        setSelectedPaths(newSelected);
      }

      function handleMouseUp(ev: MouseEvent) {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        if (hasDragged) {
          setTimeout(() => {
            isDraggingMarqueeRef.current = false;
          }, 50);
          setMarqueeBox(null);
        } else {
          const itemRow = (ev.target as HTMLElement)?.closest?.(".explorer-item-row");
          if (!itemRow && !(ev.target as HTMLElement)?.closest?.("button, input, a, .win-context-menu")) {
            setSelectedPaths(new Set());
            setSelectedPath(null);
            lastSelectedPathRef.current = null;
          }
        }
      }

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return (
      <div
        className="explorer-list-view"
        role="list"
        ref={explorerListRef}
        onMouseDown={handleExplorerMouseDown}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".explorer-item-row, button, input, a, .win-context-menu")) {
            return;
          }
          e.preventDefault();
          setDesktopContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: "blank",
            selectedEntries: []
          });
        }}
      >
        {marqueeBox && (
          <div
            className="selection-marquee"
            style={{
              left: `${Math.min(marqueeBox.x1, marqueeBox.x2)}px`,
              top: `${Math.min(marqueeBox.y1, marqueeBox.y2)}px`,
              width: `${Math.abs(marqueeBox.x2 - marqueeBox.x1)}px`,
              height: `${Math.abs(marqueeBox.y2 - marqueeBox.y1)}px`,
            }}
          />
        )}
        {currentPath ? (
          <div
            className="explorer-item-row is-directory is-parent-dir"
            onClick={() => void loadDirectory(parentFilePath(currentPath))}
            title="返回上一级目录"
          >
            <div className="explorer-item-main">
              <div className="explorer-item-icon dir-icon">
                <Folder size={17} />
              </div>
              <div className="explorer-item-info">
                <span className="explorer-item-name" style={{ fontWeight: 700 }}>..</span>
              </div>
            </div>
          </div>
        ) : null}
        {filteredEntries.map((entry) => {
          const isDir = entry.type === "directory";
          const isSelected = selectedPaths.has(entry.path) || selectedPath === entry.path || editorPath === entry.path;
          return (
            <div
              key={entry.path}
              data-path={entry.path}
              className={`explorer-item-row ${isDir ? "is-directory" : "is-file"} ${isSelected ? "selected" : ""} ${draggingFilePath === entry.path ? "dragging" : ""}`}
              draggable
              onDragStart={(e) => {
                setDraggingFilePath(entry.path);
                e.dataTransfer.setData("text/plain", entry.path);
              }}
              onDragEnd={() => setDraggingFilePath(null)}
              onClick={(e) => {
                if (isDraggingMarqueeRef.current) return;
                setDesktopContextMenu(null);

                if (e.shiftKey && lastSelectedPathRef.current) {
                  const anchorIdx = filteredEntries.findIndex((item) => item.path === lastSelectedPathRef.current);
                  const currentIdx = filteredEntries.findIndex((item) => item.path === entry.path);
                  if (anchorIdx !== -1 && currentIdx !== -1) {
                    const min = Math.min(anchorIdx, currentIdx);
                    const max = Math.max(anchorIdx, currentIdx);
                    const rangeSet = new Set(filteredEntries.slice(min, max + 1).map((item) => item.path));
                    setSelectedPaths(rangeSet);
                    setSelectedPath(entry.path);
                    return;
                  }
                }

                if (e.ctrlKey || e.metaKey) {
                  setSelectedPaths((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                  setSelectedPath(entry.path);
                  lastSelectedPathRef.current = entry.path;
                  return;
                }

                if (entry.type === "directory") {
                  setSelectedPaths(new Set());
                  lastSelectedPathRef.current = null;
                  void loadDirectory(entry.path);
                  return;
                }

                setSelectedPaths(new Set([entry.path]));
                setSelectedPath(entry.path);
                lastSelectedPathRef.current = entry.path;
                void openEntry(entry);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                let nextSelected = new Set(selectedPaths);
                if (!selectedPaths.has(entry.path)) {
                  nextSelected = new Set([entry.path]);
                  setSelectedPaths(nextSelected);
                  setSelectedPath(entry.path);
                  lastSelectedPathRef.current = entry.path;
                }
                const selectedList = filteredEntries.filter((item) => nextSelected.has(item.path));
                setDesktopContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  type: "item",
                  targetEntry: entry,
                  selectedEntries: selectedList.length > 0 ? selectedList : [entry]
                });
              }}
              onDragOver={isDir ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.add("drag-over");
              } : undefined}
              onDragLeave={isDir ? (e) => {
                e.currentTarget.classList.remove("drag-over");
              } : undefined}
              onDrop={isDir ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove("drag-over");
                const dragDataStr = e.dataTransfer.getData("text/plain");
                if (dragDataStr && dragDataStr !== entry.path) {
                  void moveFileToFolder(dragDataStr, entry.path);
                }
              } : undefined}
            >
              <div className="explorer-item-main">
                <div className={`explorer-item-icon ${isDir ? "dir-icon" : "file-icon"}`}>
                  {isDir ? (
                    <Folder size={17} />
                  ) : isImageFile(entry.path) ? (
                    <ImageIcon size={16} />
                  ) : isArchiveFile(entry.path) ? (
                    <FileArchive size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                </div>
                <div className="explorer-item-name" title={entry.name}>
                  <span>{entry.name}</span>
                </div>
              </div>

              <div className="explorer-item-meta">
                <span className="explorer-item-size">
                  {isDir ? "文件夹" : formatBytes(entry.size)}
                </span>
                <span className="explorer-item-date">
                  {formatDate(entry.modifiedAt)}
                </span>
              </div>

              <div className="explorer-item-actions">
                {!isDir ? (
                  <button
                    className="tree-node-action-btn"
                    title="下载"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadEntry(entry);
                    }}
                  >
                    <Download size={13} />
                  </button>
                ) : null}

                <div className="file-action-menu-wrap">
                  <button
                    className="tree-node-action-btn"
                    title="更多操作"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenFileActionMenuPath((current) => (current === entry.path ? null : entry.path));
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                  {openFileActionMenuPath === entry.path ? (
                    <div className="file-action-menu tree-action-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      {entry.type === "file" && isArchiveFile(entry.path) ? (
                        <button type="button" role="menuitem" disabled={extractingPath === entry.path}
                          onClick={() => { setOpenFileActionMenuPath(null); void extractArchive(entry); }}>
                          {extractingPath === entry.path ? <RotateCw size={14} /> : <Archive size={14} />}
                          <span>解压</span>
                        </button>
                      ) : (
                        <button type="button" role="menuitem"
                          disabled={(entry.type !== "file" && entry.type !== "directory") || archivingPath === entry.path}
                          onClick={() => { setOpenFileActionMenuPath(null); void archiveEntry(entry); }}>
                          {archivingPath === entry.path ? <RotateCw size={14} /> : <Archive size={14} />}
                          <span>压缩</span>
                        </button>
                      )}
                      <button type="button" role="menuitem"
                        onClick={() => { setOpenFileActionMenuPath(null); handleClipboardAction("copy", entry.path); }}>
                        <ClipboardList size={14} />
                        <span>复制</span>
                      </button>
                      <button type="button" role="menuitem"
                        onClick={() => { setOpenFileActionMenuPath(null); handleClipboardAction("cut", entry.path); }}>
                        <Layers size={14} />
                        <span>剪切</span>
                      </button>
                      <button type="button" role="menuitem"
                        onClick={() => { setOpenFileActionMenuPath(null); void renameEntry(entry); }}>
                        <FileText size={14} />
                        <span>重命名</span>
                      </button>
                      {entry.type === "file" ? (
                        <button type="button" role="menuitem"
                          onClick={() => { setOpenFileActionMenuPath(null); void downloadEntry(entry); }}>
                          <Download size={14} />
                          <span>下载</span>
                        </button>
                      ) : null}
                      <button className="danger-action" type="button" role="menuitem"
                        onClick={() => { setOpenFileActionMenuPath(null); void deleteEntry(entry); }}>
                        <Trash2 size={14} />
                        <span>删除</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {desktopContextMenu && (
          <div
            className="win-context-menu"
            style={{
              left: `${Math.max(8, Math.min(desktopContextMenu.x, window.innerWidth - 230))}px`,
              top: `${Math.max(8, Math.min(desktopContextMenu.y, window.innerHeight - 320))}px`
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {desktopContextMenu.type === "item" ? (
              <>
                {desktopContextMenu.selectedEntries.length > 1 ? (
                  <>
                    <div className="win-menu-header">
                      <CheckSquare size={13} />
                      <span>已选择 {desktopContextMenu.selectedEntries.length} 个项目</span>
                    </div>
                    <button
                      className="win-menu-item"
                      type="button"
                      onClick={() => {
                        const paths = desktopContextMenu.selectedEntries.map((e) => e.path);
                        handleClipboardAction("copy", paths);
                        setDesktopContextMenu(null);
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><Copy size={14} /></span>
                        <span className="win-menu-item-text">复制</span>
                      </div>
                      <span className="win-menu-item-shortcut">Ctrl+C</span>
                    </button>
                    <button
                      className="win-menu-item"
                      type="button"
                      onClick={() => {
                        const paths = desktopContextMenu.selectedEntries.map((e) => e.path);
                        handleClipboardAction("cut", paths);
                        setDesktopContextMenu(null);
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><Scissors size={14} /></span>
                        <span className="win-menu-item-text">剪切</span>
                      </div>
                      <span className="win-menu-item-shortcut">Ctrl+X</span>
                    </button>
                    <div className="win-menu-separator" />
                    <button
                      className="win-menu-item"
                      type="button"
                      onClick={() => {
                        setDesktopContextMenu(null);
                        void handleDesktopBatchArchive();
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><FileArchive size={14} /></span>
                        <span className="win-menu-item-text">压缩为归档...</span>
                      </div>
                    </button>
                    <button
                      className="win-menu-item"
                      type="button"
                      onClick={() => {
                        setDesktopContextMenu(null);
                        void handleDesktopBatchDownload();
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><Download size={14} /></span>
                        <span className="win-menu-item-text">批量打包下载</span>
                      </div>
                    </button>
                    <div className="win-menu-separator" />
                    <button
                      className="win-menu-item danger-action"
                      type="button"
                      onClick={() => {
                        setDesktopContextMenu(null);
                        void handleDesktopBatchDelete();
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><Trash2 size={14} /></span>
                        <span className="win-menu-item-text">删除选中的项目</span>
                      </div>
                      <span className="win-menu-item-shortcut">Delete</span>
                    </button>
                    <button
                      className="win-menu-item"
                      type="button"
                      onClick={() => {
                        setSelectedPaths(new Set());
                        setDesktopContextMenu(null);
                      }}
                    >
                      <div className="win-menu-item-left">
                        <span className="win-menu-item-icon"><X size={14} /></span>
                        <span className="win-menu-item-text">取消选择</span>
                      </div>
                      <span className="win-menu-item-shortcut">Esc</span>
                    </button>
                  </>
                ) : (
                  (() => {
                    const entry = desktopContextMenu.targetEntry || desktopContextMenu.selectedEntries[0];
                    if (!entry) return null;
                    const isDir = entry.type === "directory";
                    const isArchive = entry.type === "file" && isArchiveFile(entry.path);
                    return (
                      <>
                        <button
                          className="win-menu-item"
                          type="button"
                          onClick={() => {
                            setDesktopContextMenu(null);
                            if (isDir) {
                              void loadDirectory(entry.path);
                            } else {
                              void openEntry(entry);
                            }
                          }}
                        >
                          <div className="win-menu-item-left">
                            <span className="win-menu-item-icon">
                              {isDir ? <FolderOpen size={14} /> : <FileText size={14} />}
                            </span>
                            <span className="win-menu-item-text">{isDir ? "打开文件夹" : "打开 / 编辑"}</span>
                          </div>
                          <span className="win-menu-item-shortcut">Enter</span>
                        </button>
                        <div className="win-menu-separator" />
                        <button
                          className="win-menu-item"
                          type="button"
                          onClick={() => {
                            handleClipboardAction("copy", entry.path);
                            setDesktopContextMenu(null);
                          }}
                        >
                          <div className="win-menu-item-left">
                            <span className="win-menu-item-icon"><Copy size={14} /></span>
                            <span className="win-menu-item-text">复制</span>
                          </div>
                          <span className="win-menu-item-shortcut">Ctrl+C</span>
                        </button>
                        <button
                          className="win-menu-item"
                          type="button"
                          onClick={() => {
                            handleClipboardAction("cut", entry.path);
                            setDesktopContextMenu(null);
                          }}
                        >
                          <div className="win-menu-item-left">
                            <span className="win-menu-item-icon"><Scissors size={14} /></span>
                            <span className="win-menu-item-text">剪切</span>
                          </div>
                          <span className="win-menu-item-shortcut">Ctrl+X</span>
                        </button>
                        <button
                          className="win-menu-item"
                          type="button"
                          onClick={() => {
                            setDesktopContextMenu(null);
                            void renameEntry(entry);
                          }}
                        >
                          <div className="win-menu-item-left">
                            <span className="win-menu-item-icon"><Edit3 size={14} /></span>
                            <span className="win-menu-item-text">重命名</span>
                          </div>
                          <span className="win-menu-item-shortcut">F2</span>
                        </button>
                        <div className="win-menu-separator" />
                        {isArchive ? (
                          <button
                            className="win-menu-item"
                            type="button"
                            disabled={extractingPath === entry.path}
                            onClick={() => {
                              setDesktopContextMenu(null);
                              void extractArchive(entry);
                            }}
                          >
                            <div className="win-menu-item-left">
                              <span className="win-menu-item-icon">
                                {extractingPath === entry.path ? <RotateCw size={14} className="status-spinner" /> : <Archive size={14} />}
                              </span>
                              <span className="win-menu-item-text">解压到当前目录...</span>
                            </div>
                          </button>
                        ) : (
                          <button
                            className="win-menu-item"
                            type="button"
                            disabled={archivingPath === entry.path}
                            onClick={() => {
                              setDesktopContextMenu(null);
                              void archiveEntry(entry);
                            }}
                          >
                            <div className="win-menu-item-left">
                              <span className="win-menu-item-icon">
                                {archivingPath === entry.path ? <RotateCw size={14} className="status-spinner" /> : <FileArchive size={14} />}
                              </span>
                              <span className="win-menu-item-text">压缩为文件...</span>
                            </div>
                          </button>
                        )}
                        {!isDir ? (
                          <button
                            className="win-menu-item"
                            type="button"
                            onClick={() => {
                              setDesktopContextMenu(null);
                              void downloadEntry(entry);
                            }}
                          >
                            <div className="win-menu-item-left">
                              <span className="win-menu-item-icon"><Download size={14} /></span>
                              <span className="win-menu-item-text">下载文件</span>
                            </div>
                          </button>
                        ) : null}
                        <div className="win-menu-separator" />
                        <button
                          className="win-menu-item danger-action"
                          type="button"
                          onClick={() => {
                            setDesktopContextMenu(null);
                            void deleteEntry(entry);
                          }}
                        >
                          <div className="win-menu-item-left">
                            <span className="win-menu-item-icon"><Trash2 size={14} /></span>
                            <span className="win-menu-item-text">删除</span>
                          </div>
                          <span className="win-menu-item-shortcut">Delete</span>
                        </button>
                      </>
                    );
                  })()
                )}
              </>
            ) : (
              <>
                <button
                  className="win-menu-item"
                  type="button"
                  onClick={() => {
                    setDesktopContextMenu(null);
                    void loadDirectory(currentPath);
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><RotateCw size={14} /></span>
                    <span className="win-menu-item-text">刷新</span>
                  </div>
                  <span className="win-menu-item-shortcut">F5</span>
                </button>
                <div className="win-menu-separator" />
                <button
                  className="win-menu-item"
                  type="button"
                  onClick={() => {
                    setDesktopContextMenu(null);
                    void createDirectory();
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><FolderPlus size={14} /></span>
                    <span className="win-menu-item-text">新建文件夹</span>
                  </div>
                </button>
                <button
                  className="win-menu-item"
                  type="button"
                  onClick={() => {
                    setDesktopContextMenu(null);
                    void createFile();
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><FilePlus size={14} /></span>
                    <span className="win-menu-item-text">新建文件</span>
                  </div>
                </button>
                <button
                  className="win-menu-item"
                  type="button"
                  onClick={() => {
                    setDesktopContextMenu(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><Upload size={14} /></span>
                    <span className="win-menu-item-text">上传文件</span>
                  </div>
                </button>
                <div className="win-menu-separator" />
                <button
                  className="win-menu-item"
                  type="button"
                  disabled={!clipboard || clipboard.paths.size === 0}
                  onClick={() => {
                    setDesktopContextMenu(null);
                    void handleClipboardPaste();
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><ClipboardList size={14} /></span>
                    <span className="win-menu-item-text">粘贴</span>
                  </div>
                  <span className="win-menu-item-shortcut">Ctrl+V</span>
                </button>
                <div className="win-menu-separator" />
                <button
                  className="win-menu-item"
                  type="button"
                  onClick={() => {
                    setDesktopContextMenu(null);
                    handleDesktopSelectAll();
                  }}
                >
                  <div className="win-menu-item-left">
                    <span className="win-menu-item-icon"><CheckSquare size={14} /></span>
                    <span className="win-menu-item-text">全选</span>
                  </div>
                  <span className="win-menu-item-shortcut">Ctrl+A</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderTreeNodes(parentPath: string, depth: number) {
    const folders = treeData[parentPath] || [];
    return (
      <div className="tree-node-children" style={{ marginLeft: depth > 0 ? "12px" : "0" }}>
        {folders.map((folder) => {
          const isExpanded = expandedFolders.has(folder.path);
          const isCurrent = folder.type === "directory" ? currentPath === folder.path : editorPath === folder.path;
          return (
            <div key={folder.path} className="tree-node-wrapper">
              <div
                className={`tree-node-item ${isCurrent ? "current" : ""} ${draggingFilePath === folder.path ? "dragging" : ""}`}
                style={{ paddingLeft: `${depth * 8 + 6}px` }}
                onClick={() => {
                  if (folder.type === "directory") {
                    handleTreeFolderClick(folder.path);
                  } else {
                    void openEntry(folder);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setOpenFileActionMenuPath((current) => (current === folder.path ? null : folder.path));
                }}
                onDragOver={folder.type === "directory" ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.add("drag-over");
                } : undefined}
                onDragLeave={folder.type === "directory" ? (e) => {
                  e.currentTarget.classList.remove("drag-over");
                } : undefined}
                onDrop={folder.type === "directory" ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.remove("drag-over");
                  const dragDataStr = e.dataTransfer.getData("text/plain");
                  if (dragDataStr && dragDataStr !== folder.path) {
                    void moveFileToFolder(dragDataStr, folder.path);
                  }
                } : undefined}
              >
                {folder.type === "directory" ? (
                  <button
                    type="button"
                    className="tree-node-toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFolder(folder.path);
                    }}
                  >
                    <ChevronDown
                      size={14}
                      style={{
                        transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 0.15s ease"
                      }}
                    />
                  </button>
                ) : (
                  <div style={{ width: "20px", height: "20px", flexShrink: 0 }} />
                )}
                {folder.type === "directory" ? (
                  <Folder size={14} className="tree-node-icon" />
                ) : isImageFile(folder.path) ? (
                  <ImageIcon size={14} className="tree-node-icon" />
                ) : isArchiveFile(folder.path) ? (
                  <FileArchive size={14} className="tree-node-icon" />
                ) : (
                  <FileText size={14} className="tree-node-icon" />
                )}
                <span className="tree-node-label">{folder.name}</span>
                {folder.type === "file" && (
                  <span className="tree-node-size">{formatBytes(folder.size)}</span>
                )}
                <div className="tree-node-actions">
                  {folder.type === "file" ? (
                    <button
                      className="tree-node-action-btn"
                      title="下载"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadEntry(folder);
                      }}
                    >
                      <Download size={13} />
                    </button>
                  ) : null}
                  <div className="file-action-menu-wrap">
                    <button
                      className="tree-node-action-btn"
                      title="更多操作"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenFileActionMenuPath((current) => (current === folder.path ? null : folder.path));
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {openFileActionMenuPath === folder.path ? (
                      <div className="file-action-menu tree-action-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        {folder.type === "file" && isArchiveFile(folder.path) ? (
                          <button type="button" role="menuitem" disabled={extractingPath === folder.path}
                            onClick={() => { setOpenFileActionMenuPath(null); void extractArchive(folder); }}>
                            {extractingPath === folder.path ? <RotateCw size={14} /> : <Archive size={14} />}
                            <span>解压</span>
                          </button>
                        ) : (
                          <button type="button" role="menuitem"
                            disabled={(folder.type !== "file" && folder.type !== "directory") || archivingPath === folder.path}
                            onClick={() => { setOpenFileActionMenuPath(null); void archiveEntry(folder); }}>
                            {archivingPath === folder.path ? <RotateCw size={14} /> : <Archive size={14} />}
                            <span>压缩</span>
                          </button>
                        )}
                        <button type="button" role="menuitem"
                          onClick={() => { setOpenFileActionMenuPath(null); handleClipboardAction("copy", folder.path); }}>
                          <ClipboardList size={14} />
                          <span>复制</span>
                        </button>
                        <button type="button" role="menuitem"
                          onClick={() => { setOpenFileActionMenuPath(null); handleClipboardAction("cut", folder.path); }}>
                          <Layers size={14} />
                          <span>剪切</span>
                        </button>
                        <button type="button" role="menuitem"
                          onClick={() => { setOpenFileActionMenuPath(null); void renameEntry(folder); }}>
                          <FileText size={14} />
                          <span>重命名</span>
                        </button>
                        {folder.type === "file" ? (
                          <button type="button" role="menuitem"
                            onClick={() => { setOpenFileActionMenuPath(null); void downloadEntry(folder); }}>
                            <Download size={14} />
                            <span>下载</span>
                          </button>
                        ) : null}
                        <button className="danger-action" type="button" role="menuitem"
                          onClick={() => { setOpenFileActionMenuPath(null); void deleteEntry(folder); }}>
                          <Trash2 size={14} />
                          <span>删除</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              {folder.type === "directory" && isExpanded && renderTreeNodes(folder.path, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  function renderEditorPanel() {
    return (
      <CodeEditorPanel
        editorPath={editorPath}
        selectedEntryName={selectedEntry?.name}
        editorContent={editorContent}
        editorLanguage={editorLanguage}
        editorMode={editorMode}
        editorCanTogglePreview={editorCanTogglePreview}
        editorCanEdit={editorCanEdit}
        editorPreviewKind={editorPreviewKind}
        saving={saving}
        mobileEditorOpen={mobileEditorOpen}
        darkMode={darkMode}
        findVisible={findVisible}
        findQuery={findQuery}
        findMatchesCount={findMatches.length}
        findResultLabel={findResultLabel}
        findRanges={findRanges}
        codeEditorRef={codeEditorRef}
        findInputRef={findInputRef}
        onCloseMobileEditor={closeMobileEditorModal}
        onSetEditorMode={setEditorMode}
        onOpenFind={openEditorFind}
        onCloseFind={closeEditorFind}
        onFindQueryChange={handleFindQueryChange}
        onMoveFindMatch={moveFindMatch}
        onContentChange={(newValue) => setEditorContent(newValue)}
        onSave={() => void saveEditor()}
      />
    );
  }

  if (!instance) {
    return <div className="empty-state">请选择实例</div>;
  }

  return (
    <div
      className={[
        "file-manager",
        editorPath ? "editor-open" : "",
        isMobileFileLayout() && mobileBrowserOpen ? "mobile-browser-open" : "",
        isMobileFileLayout() && mobileEditorOpen ? "mobile-editor-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handleFileManagerKeyDown}
    >
      {isMobileFileLayout() && mobileBrowserOpen ? (
        <div className="mobile-file-browser-scrim" role="presentation" onPointerDown={closeMobileBrowserModal} />
      ) : null}
      {mobileFileDrag ? (
        <div
          className={`mobile-file-drag-ghost ${mobileFileDrag.overSaki ? "over-saki" : ""}`}
          style={{ left: `${mobileFileDrag.x}px`, top: `${mobileFileDrag.y}px` }}
          aria-hidden="true"
        >
          <FileText size={16} />
          <span>{mobileFileDrag.name}</span>
        </div>
      ) : null}
      <div className="file-manager-modal-chrome">
        {/* Mobile Fullscreen Editor Modal (Mobile only) */}
        {isMobileFileLayout() && mobileEditorOpen && editorPath ? renderEditorPanel() : null}

        {/* MT Manager Action Bottom Sheet */}
        {mobileActionEntry ? (
          <div
            className="mt-action-sheet-backdrop"
            role="presentation"
            onClick={() => setMobileActionEntry(null)}
          >
            <div
              className="mt-action-sheet-drawer"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mt-sheet-header">
                <div className="mt-sheet-icon">
                  {mobileActionEntry.type === "directory" ? (
                    <Folder size={24} className="mt-folder-icon" />
                  ) : isImageFile(mobileActionEntry.path) ? (
                    <ImageIcon size={22} className="mt-img-icon" />
                  ) : isArchiveFile(mobileActionEntry.path) ? (
                    <FileArchive size={22} className="mt-zip-icon" />
                  ) : (
                    <FileText size={22} className="mt-txt-icon" />
                  )}
                </div>
                <div className="mt-sheet-meta">
                  <strong className="mt-sheet-title">{mobileActionEntry.name}</strong>
                  <span className="mt-sheet-subtitle">
                    {mobileActionEntry.type === "directory"
                      ? `文件夹 · ${formatDate(mobileActionEntry.modifiedAt)}`
                      : `${formatBytes(mobileActionEntry.size)} · ${formatDate(mobileActionEntry.modifiedAt)}`}
                  </span>
                  <span className="mt-sheet-path">{mobileActionEntry.path || "/"}</span>
                </div>
                <button
                  className="icon-button mini"
                  type="button"
                  onClick={() => setMobileActionEntry(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-sheet-actions-grid">
                {/* MT Core Feature 1: 复制到另一侧窗口 */}
                <button
                  className="mt-action-grid-btn highlight"
                  type="button"
                  onClick={() => {
                    const entry = mobileActionEntry;
                    setMobileActionEntry(null);
                    void copyToOppositePane(entry);
                  }}
                >
                  <Copy size={20} className="action-icon copy" />
                  <span>复制到{activePane === "left" ? "右侧" : "左侧"}</span>
                </button>

                {/* MT Core Feature 2: 移动到另一侧窗口 */}
                <button
                  className="mt-action-grid-btn highlight"
                  type="button"
                  onClick={() => {
                    const entry = mobileActionEntry;
                    setMobileActionEntry(null);
                    void moveToOppositePane(entry);
                  }}
                >
                  <Layers size={20} className="action-icon cut" />
                  <span>移动到{activePane === "left" ? "右侧" : "左侧"}</span>
                </button>

                {mobileActionEntry.type === "file" && isArchiveFile(mobileActionEntry.path) ? (
                  <button
                    className="mt-action-grid-btn highlight"
                    type="button"
                    onClick={() => {
                      const entry = mobileActionEntry;
                      setMobileActionEntry(null);
                      void extractToOppositePane(entry);
                    }}
                  >
                    <RotateCw size={20} className="action-icon extract" />
                    <span>解压到{activePane === "left" ? "右侧" : "左侧"}</span>
                  </button>
                ) : null}

                {mobileActionEntry.type === "file" ? (
                  <button
                    className="mt-action-grid-btn"
                    type="button"
                    onClick={() => {
                      const entry = mobileActionEntry;
                      setMobileActionEntry(null);
                      setSelectedPath(entry.path);
                      void openEntry(entry);
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
                    const entry = mobileActionEntry;
                    setMobileActionEntry(null);
                    void renameEntry(entry);
                  }}
                >
                  <Edit3 size={20} className="action-icon rename" />
                  <span>重命名</span>
                </button>

                {mobileActionEntry.type !== "file" || !isArchiveFile(mobileActionEntry.path) ? (
                  <button
                    className="mt-action-grid-btn"
                    type="button"
                    disabled={archivingPath === mobileActionEntry.path}
                    onClick={() => {
                      const entry = mobileActionEntry;
                      setMobileActionEntry(null);
                      void archiveEntry(entry);
                    }}
                  >
                    <FileArchive size={20} className="action-icon zip" />
                    <span>压缩为 ZIP</span>
                  </button>
                ) : null}

                {mobileActionEntry.type === "file" ? (
                  <button
                    className="mt-action-grid-btn"
                    type="button"
                    onClick={() => {
                      const entry = mobileActionEntry;
                      setMobileActionEntry(null);
                      void downloadEntry(entry);
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
                    const entry = mobileActionEntry;
                    setMobileActionEntry(null);
                    void deleteEntry(entry);
                  }}
                >
                  <Trash2 size={20} className="action-icon delete" />
                  <span>删除</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* MT Manager True Dual-Pane (左右双窗口) View */}
        <div className="mt-manager-shell">
          {/* MT Top Dual Window Bar */}
          <div className="mt-dual-header">
            {/* Left Pane Tab */}
            <div
              className={`mt-dual-tab left-tab ${activePane === "left" ? "active" : ""} ${editingPane === "left" ? "is-editing" : ""}`}
              onClick={() => {
                if (activePane !== "left") {
                  setActivePane("left");
                  setEditingPane(null);
                } else if (editingPane !== "left") {
                  setEditingPane("left");
                  setEditingPathText(leftPath ? `/${leftPath}` : "/");
                }
              }}
            >
              <div className="mt-tab-indicator">L</div>
              {editingPane === "left" ? (
                <form
                  className="mt-tab-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handlePathJump("left");
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    className="mt-tab-edit-input"
                    value={editingPathText}
                    onChange={(e) => setEditingPathText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingPane(null);
                      }
                    }}
                    onBlur={() => void handlePathJump("left")}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    placeholder="/"
                  />
                </form>
              ) : (
                <div className="mt-tab-info">
                  <span className="mt-tab-path">/{leftPath || ""}</span>
                  <span className="mt-tab-count">{leftEntries.length} 项</span>
                </div>
              )}
            </div>

            {/* Multi-Select Button */}
            <button
              className={`mt-sync-icon-btn ${isMobileSelectMode ? "active" : ""}`}
              type="button"
              title="多选模式（右滑文件也可进入）"
              onClick={() => {
                setIsMobileSelectMode((v) => {
                  if (v) {
                    setMobileSelectedPaths(new Set());
                  }
                  return !v;
                });
              }}
            >
              <CheckSquare size={15} />
            </button>

            {/* Right Pane Tab */}
            <div
              className={`mt-dual-tab right-tab ${activePane === "right" ? "active" : ""} ${editingPane === "right" ? "is-editing" : ""}`}
              onClick={() => {
                if (activePane !== "right") {
                  setActivePane("right");
                  setEditingPane(null);
                } else if (editingPane !== "right") {
                  setEditingPane("right");
                  setEditingPathText(rightPath ? `/${rightPath}` : "/");
                }
              }}
            >
              <div className="mt-tab-indicator">R</div>
              {editingPane === "right" ? (
                <form
                  className="mt-tab-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handlePathJump("right");
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    className="mt-tab-edit-input"
                    value={editingPathText}
                    onChange={(e) => setEditingPathText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingPane(null);
                      }
                    }}
                    onBlur={() => void handlePathJump("right")}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    placeholder="/"
                  />
                </form>
              ) : (
                <div className="mt-tab-info">
                  <span className="mt-tab-path">/{rightPath || ""}</span>
                  <span className="mt-tab-count">{rightEntries.length} 项</span>
                </div>
              )}
            </div>

            <button
              className="mt-icon-btn close-btn"
              type="button"
              title="关闭"
              onClick={closeMobileBrowserModal}
            >
              <X size={18} />
            </button>
          </div>

          {/* Mobile Search Bar */}
          {mobileSearchOpen && (
            <div className="mt-search-bar-wrap">
              <div className="mt-search-bar-inner glass-panel">
                <Search size={14} className="mt-search-icon" />
                <input
                  className="mt-search-input"
                  value={mobileSearchQuery}
                  onChange={(e) => setMobileSearchQuery(e.target.value)}
                  placeholder={`搜索文件...`}
                  autoFocus
                />
                {mobileSearchQuery ? (
                  <button
                    type="button"
                    className="icon-button mini"
                    onClick={() => setMobileSearchQuery("")}
                    title="清空"
                  >
                    <X size={12} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mt-search-close-btn"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setMobileSearchQuery("");
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
          )}

          {/* MT Dual Viewport (Side-by-Side Split) */}
          <div className="mt-dual-viewport">
            {/* Left Window */}
            <div
              className={`mt-pane left-pane ${activePane === "left" ? "active" : ""}`}
              onClick={() => setActivePane("left")}
            >
              <div className="mt-pane-crumb-bar">
                <span className="mt-pane-crumb-label">/{leftPath || ""}</span>
                <button
                  className="mt-pane-up-btn"
                  type="button"
                  title="返回上一级"
                  disabled={!leftPath}
                  onClick={(e) => {
                    e.stopPropagation();
                    void loadPaneDirectory("left", parentFilePath(leftPath));
                  }}
                >
                  <CornerUpLeft size={13} />
                </button>
              </div>

              <div className="mt-pane-list-body">
                {leftLoading && leftEntries.length === 0 ? (
                  <div className="mt-pane-empty">
                    <Loader2 size={24} className="spinner" />
                  </div>
                ) : displayLeftEntries.length === 0 && !leftPath ? (
                  <div className="mt-pane-empty">
                    <FolderOpen size={30} className="mt-empty-icon" />
                    <span>{mobileSearchQuery ? "未匹配到文件" : "空目录"}</span>
                  </div>
                ) : (
                  <div className="mt-pane-file-list">
                    {leftPath ? (
                      <div
                        className="mt-dual-file-row is-dir is-parent-dir"
                        onClick={() => {
                          setActivePane("left");
                          void loadPaneDirectory("left", parentFilePath(leftPath));
                        }}
                        title="返回上一级"
                      >
                        <div className="mt-dual-item-icon dir">
                          <Folder size={17} />
                        </div>
                        <div className="mt-dual-item-text">
                          <span className="mt-dual-name" style={{ fontWeight: 700 }}>..</span>
                          <span className="mt-dual-size">返回上一级</span>
                        </div>
                      </div>
                    ) : null}
                    {displayLeftEntries.length === 0 ? (
                      <div className="mt-pane-empty-sub">
                        <span>{mobileSearchQuery ? "未匹配到文件" : "当前文件夹为空"}</span>
                      </div>
                    ) : (
                      displayLeftEntries.map((entry) => {
                        const isDir = entry.type === "directory";
                        const isSelected = mobileSelectedPaths.has(entry.path);
                        return (
                          <div
                            key={entry.path}
                            className={`mt-dual-file-row ${isDir ? "is-dir" : "is-file"} ${isSelected ? "selected" : ""}`}
                            onTouchStart={(e) => handleMobileTouchStart(e, entry)}
                            onTouchMove={(e) => handleMobileTouchMove(e, entry)}
                            onTouchEnd={handleTouchEnd}
                            onTouchCancel={handleTouchEnd}
                            onClick={() => handleMobileRowClick(entry, "left")}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setActivePane("left");
                              if (!isMobileSelectMode) {
                                setMobileActionEntry(entry);
                              }
                            }}
                          >
                            <div className={`mt-dual-item-icon ${isDir ? "dir" : "file"}`}>
                              {isSelected ? (
                                <Check size={16} className="mt-selected-icon" />
                              ) : isDir ? (
                                <Folder size={17} />
                              ) : isImageFile(entry.path) ? (
                                <ImageIcon size={15} />
                              ) : isArchiveFile(entry.path) ? (
                                <FileArchive size={15} />
                              ) : (
                                <FileText size={15} />
                              )}
                            </div>
                            <div className="mt-dual-item-text">
                              <span className="mt-dual-name">{entry.name}</span>
                              <span className="mt-dual-size">
                                {isDir ? "文件夹" : formatBytes(entry.size)}
                              </span>
                            </div>
                            {isMobileSelectMode ? (
                              <div className={`mt-check-badge ${isSelected ? "checked" : ""}`}>
                                {isSelected ? <Check size={12} /> : null}
                              </div>
                            ) : (
                              <button
                                className="mt-dual-more-btn"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePane("left");
                                  setMobileActionEntry(entry);
                                }}
                              >
                                <MoreVertical size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Split Divider */}
            <div className="mt-pane-split-divider" />

            {/* Right Window */}
            <div
              className={`mt-pane right-pane ${activePane === "right" ? "active" : ""}`}
              onClick={() => setActivePane("right")}
            >
              <div className="mt-pane-crumb-bar">
                <span className="mt-pane-crumb-label">/{rightPath || ""}</span>
                <button
                  className="mt-pane-up-btn"
                  type="button"
                  title="返回上一级"
                  disabled={!rightPath}
                  onClick={(e) => {
                    e.stopPropagation();
                    void loadPaneDirectory("right", parentFilePath(rightPath));
                  }}
                >
                  <CornerUpLeft size={13} />
                </button>
              </div>

              <div className="mt-pane-list-body">
                {rightLoading && rightEntries.length === 0 ? (
                  <div className="mt-pane-empty">
                    <Loader2 size={24} className="spinner" />
                  </div>
                ) : displayRightEntries.length === 0 && !rightPath ? (
                  <div className="mt-pane-empty">
                    <FolderOpen size={30} className="mt-empty-icon" />
                    <span>{mobileSearchQuery ? "未匹配到文件" : "空目录"}</span>
                  </div>
                ) : (
                  <div className="mt-pane-file-list">
                    {rightPath ? (
                      <div
                        className="mt-dual-file-row is-dir is-parent-dir"
                        onClick={() => {
                          setActivePane("right");
                          void loadPaneDirectory("right", parentFilePath(rightPath));
                        }}
                        title="返回上一级"
                      >
                        <div className="mt-dual-item-icon dir">
                          <Folder size={17} />
                        </div>
                        <div className="mt-dual-item-text">
                          <span className="mt-dual-name" style={{ fontWeight: 700 }}>..</span>
                          <span className="mt-dual-size">返回上一级</span>
                        </div>
                      </div>
                    ) : null}
                    {displayRightEntries.length === 0 ? (
                      <div className="mt-pane-empty-sub">
                        <span>{mobileSearchQuery ? "未匹配到文件" : "当前文件夹为空"}</span>
                      </div>
                    ) : (
                      displayRightEntries.map((entry) => {
                        const isDir = entry.type === "directory";
                        const isSelected = mobileSelectedPaths.has(entry.path);
                        return (
                          <div
                            key={entry.path}
                            className={`mt-dual-file-row ${isDir ? "is-dir" : "is-file"} ${isSelected ? "selected" : ""}`}
                            onTouchStart={(e) => handleMobileTouchStart(e, entry)}
                            onTouchMove={(e) => handleMobileTouchMove(e, entry)}
                            onTouchEnd={handleTouchEnd}
                            onTouchCancel={handleTouchEnd}
                            onClick={() => handleMobileRowClick(entry, "right")}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setActivePane("right");
                              if (!isMobileSelectMode) {
                                setMobileActionEntry(entry);
                              }
                            }}
                          >
                            <div className={`mt-dual-item-icon ${isDir ? "dir" : "file"}`}>
                              {isSelected ? (
                                <Check size={16} className="mt-selected-icon" />
                              ) : isDir ? (
                                <Folder size={17} />
                              ) : isImageFile(entry.path) ? (
                                <ImageIcon size={15} />
                              ) : isArchiveFile(entry.path) ? (
                                <FileArchive size={15} />
                              ) : (
                                <FileText size={15} />
                              )}
                            </div>
                            <div className="mt-dual-item-text">
                              <span className="mt-dual-name">{entry.name}</span>
                              <span className="mt-dual-size">
                                {isDir ? "文件夹" : formatBytes(entry.size)}
                              </span>
                            </div>
                            {isMobileSelectMode ? (
                              <div className={`mt-check-badge ${isSelected ? "checked" : ""}`}>
                                {isSelected ? <Check size={12} /> : null}
                              </div>
                            ) : (
                              <button
                                className="mt-dual-more-btn"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePane("right");
                                  setMobileActionEntry(entry);
                                }}
                              >
                                <MoreVertical size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MT Bottom Fast Dock */}
          {isMobileSelectMode ? (
            <div className="mt-bottom-dock is-select-mode">
              <button
                className="mt-dock-btn"
                type="button"
                onClick={handleMobileSelectAll}
                title="全选/反选"
              >
                <CheckSquare size={16} />
                <span>{mobileSelectedPaths.size === (activePane === "left" ? displayLeftEntries.length : displayRightEntries.length) ? "全不选" : "全选"}</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={mobileSelectedPaths.size === 0}
                onClick={() => void handleMobileBatchCopy()}
                title="复制到另一侧"
              >
                <Copy size={16} />
                <span>复制</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={mobileSelectedPaths.size === 0}
                onClick={() => void handleMobileBatchMove()}
                title="移动到另一侧"
              >
                <Move size={16} />
                <span>移动</span>
              </button>
              <button
                className="mt-dock-btn cancel-btn"
                type="button"
                onClick={() => {
                  setIsMobileSelectMode(false);
                  setMobileSelectedPaths(new Set());
                }}
                title="取消多选"
              >
                <X size={18} />
                <span>取消</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={mobileSelectedPaths.size === 0}
                onClick={() => void handleMobileBatchArchive()}
                title="压缩选中项"
              >
                <FileArchive size={16} />
                <span>压缩</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={mobileSelectedPaths.size === 0}
                onClick={() => void handleMobileBatchDownload()}
                title="下载选中项"
              >
                <Download size={16} />
                <span>下载</span>
              </button>
              <button
                className="mt-dock-btn danger"
                type="button"
                disabled={mobileSelectedPaths.size === 0}
                onClick={() => void handleMobileBatchDelete()}
                title="删除选中项"
              >
                <Trash2 size={16} />
                <span>删除</span>
              </button>
            </div>
          ) : (
            <div className="mt-bottom-dock">
              <button
                className="mt-dock-btn"
                type="button"
                disabled={!(activePane === "left" ? leftHistoryState.canBack : rightHistoryState.canBack)}
                onClick={handleNavBack}
                title="后退"
              >
                <ArrowLeft size={16} />
                <span>后退</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={!(activePane === "left" ? leftHistoryState.canForward : rightHistoryState.canForward)}
                onClick={handleNavForward}
                title="前进"
              >
                <ArrowRight size={16} />
                <span>前进</span>
              </button>
              <button
                className="mt-dock-btn"
                type="button"
                disabled={!(activePane === "left" ? leftPath : rightPath)}
                onClick={handleNavUp}
                title="上一级"
              >
                <ArrowUp size={16} />
                <span>上一级</span>
              </button>
              <button
                className={`mt-dock-btn ${showMobileCreateMenu ? "active" : ""}`}
                type="button"
                onClick={() => setShowMobileCreateMenu((v) => !v)}
                title="新建文件/目录"
              >
                <Plus size={16} />
                <span>新建</span>
              </button>
              <button
                className={`mt-dock-btn ${mobileSearchOpen ? "active" : ""}`}
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                title="搜索文件"
              >
                <Search size={16} />
                <span>搜索</span>
              </button>
              <button
                className={`mt-dock-btn ${isMobileSelectMode ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setIsMobileSelectMode((v) => {
                    if (v) {
                      setMobileSelectedPaths(new Set());
                    }
                    return !v;
                  });
                }}
                title="多选模式（右滑文件也可进入）"
              >
                <CheckSquare size={16} />
                <span>多选</span>
              </button>
              <button
                className="mt-dock-btn primary"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="上传文件"
              >
                <Upload size={16} />
                <span>上传</span>
              </button>
            </div>
          )}

          {/* Merged Mobile Create Popover */}
          {showMobileCreateMenu && (
            <>
              <div className="mt-create-menu-backdrop" onClick={() => setShowMobileCreateMenu(false)} />
              <div className="mt-create-popover glass-panel">
                <div className="mt-create-popover-title">新建项目</div>
                <button
                  type="button"
                  className="mt-create-popover-item"
                  onClick={() => {
                    setShowMobileCreateMenu(false);
                    void createFile();
                  }}
                >
                  <div className="mt-create-popover-icon file">
                    <FilePlus size={18} />
                  </div>
                  <div className="mt-create-popover-info">
                    <span className="title">新建文件</span>
                    <span className="desc">在当前目录创建文本/代码文件</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="mt-create-popover-item"
                  onClick={() => {
                    setShowMobileCreateMenu(false);
                    void createDirectory();
                  }}
                >
                  <div className="mt-create-popover-icon dir">
                    <FolderPlus size={18} />
                  </div>
                  <div className="mt-create-popover-info">
                    <span className="title">新建文件夹</span>
                    <span className="desc">在当前目录创建新文件夹</span>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mobile-file-modal-header">
          <div>
            <strong>文件管理</strong>
            <span>{instance.name}</span>
          </div>
          <button className="icon-button mini" title="关闭文件管理" aria-label="关闭文件管理" type="button" onClick={closeMobileBrowserModal}>
            <X size={15} />
          </button>
        </div>
        {isMobileFileLayout() && mobileEditorOpen ? (
          <div className="mobile-file-editor-scrim" role="presentation" onPointerDown={closeMobileEditorModal} />
        ) : null}
        {uploadProgress ? (
          <div className="file-upload-progress" role="status" aria-live="polite">
            <div className="file-upload-progress-meta">
              <span>{uploadProgress.label}</span>
              <strong>{uploadProgress.fileName}</strong>
              <em>{uploadProgress.percent}%</em>
            </div>
            <div className="file-upload-progress-track">
              <span style={{ width: `${uploadProgress.percent}%` }} />
            </div>
          </div>
        ) : null}
        <div className="file-workspace">
          <div className="file-tree-sidebar">
            <div className="file-tree-sidebar-header">
              {desktopEditingPath ? (
                <form
                  className="file-breadcrumb-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleDesktopPathJump();
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Folder size={13} className="root-icon" />
                  <input
                    className="file-breadcrumb-edit-input"
                    value={desktopPathText}
                    onChange={(e) => setDesktopPathText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setDesktopEditingPath(false);
                      }
                    }}
                    onBlur={() => void handleDesktopPathJump()}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    placeholder="/"
                  />
                </form>
              ) : (
                <div
                  className="file-breadcrumb-trail"
                  onClick={() => {
                    setDesktopEditingPath(true);
                    setDesktopPathText(currentPath ? `/${currentPath}` : "/");
                  }}
                  title="点击直接输入路径跳转"
                >
                  {breadcrumbSegments.map((seg, index) => {
                    const isLast = index === breadcrumbSegments.length - 1;
                    return (
                      <div key={seg.path} className="file-breadcrumb-item">
                        <button
                          className={`file-breadcrumb-crumb ${isLast ? "active" : ""}`}
                          type="button"
                          onClick={(e) => {
                            if (isLast) {
                              e.stopPropagation();
                              setDesktopEditingPath(true);
                              setDesktopPathText(currentPath ? `/${currentPath}` : "/");
                            } else {
                              e.stopPropagation();
                              void loadDirectory(seg.path);
                            }
                          }}
                          title={isLast ? "点击编辑路径" : `前往 ${seg.label}`}
                        >
                          {index === 0 ? <Folder size={13} className="root-icon" /> : null}
                          <span>{seg.label}</span>
                        </button>
                        {!isLast ? <span className="breadcrumb-separator">/</span> : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="file-view-mode-toggle" role="group" aria-label="视图模式">
                <button
                  className={`icon-button mini ${fileViewMode === "explorer" ? "active" : ""}`}
                  type="button"
                  title="资源管理器模式（点击进入目录）"
                  onClick={() => setFileViewMode("explorer")}
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  className={`icon-button mini ${fileViewMode === "tree" ? "active" : ""}`}
                  type="button"
                  title="树状层级模式"
                  onClick={() => setFileViewMode("tree")}
                >
                  <FolderTree size={14} />
                </button>
              </div>
            </div>
            <div className="file-tree-toolbar">
              <button
                className="icon-button mini"
                type="button"
                title="返回上一级目录"
                aria-label="返回上一级目录"
                disabled={!currentPath}
                onClick={() => void loadDirectory(parentFilePath(currentPath))}
              >
                <CornerUpLeft size={14} />
              </button>
              <button className="icon-button mini" title="刷新" disabled={loading} onClick={() => void loadDirectory(currentPath)}>
                <RefreshCw size={14} />
              </button>
              <button className="icon-button mini" title="新建文件" onClick={() => void createFile()}>
                <FilePlus size={14} />
              </button>
              <button className="icon-button mini" title="新建目录" onClick={() => void createDirectory()}>
                <FolderPlus size={14} />
              </button>
              <button className="icon-button mini" title="上传" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} />
              </button>
              <input
                ref={fileInputRef}
                className="hidden-file-input"
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) void uploadFiles(files);
                }}
              />
              <label className="tree-search-box">
                <Search size={13} />
                <input
                  value={fileSearchQuery}
                  onChange={(event) => setFileSearchQuery(event.target.value)}
                  placeholder="搜索"
                  aria-label="搜索文件"
                />
                {fileSearchQuery ? (
                  <button className="icon-button mini" type="button" title="清空" onClick={() => setFileSearchQuery("")}>
                    <X size={12} />
                  </button>
                ) : null}
              </label>
            </div>
            {clipboard && clipboard.paths.size > 0 ? (
              <div className="tree-clipboard-bar">
                <span>已{clipboard.action === "copy" ? "复制" : "剪切"} {clipboard.paths.size} 项</span>
                <button className="icon-button mini" type="button" title="粘贴" aria-label="粘贴" onClick={() => void handleClipboardPaste()}>
                  <ClipboardList size={13} />
                </button>
                <button className="icon-button mini" type="button" title="取消" onClick={() => setClipboard(null)}>
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {error ? <div className="tree-error-bar">{error}</div> : null}
            <div className="file-tree-sidebar-body">
              {fileViewMode === "explorer"
                ? renderExplorerView()
                : (!treeData[""] || treeData[""].length === 0)
                  ? <div className="tree-empty-state">{loading ? "载入中..." : "目录为空"}</div>
                  : renderTreeNodes("", 0)}
            </div>
          </div>
          {renderEditorPanel()}
        </div>
      </div>
      {fileConflictPrompt ? (
        <FileConflictModal prompt={fileConflictPrompt} onResolve={resolveFileConflict} />
      ) : null}
      {extractConflictPrompt ? (
        <ArchiveConflictModal
          prompt={extractConflictPrompt}
          extractingPath={extractingPath}
          onClose={() => setExtractConflictPrompt(null)}
          onConfirm={() => void confirmExtractConflicts()}
          onSetAllResolutions={setAllExtractConflictResolutions}
          onSetResolution={setExtractConflictResolution}
        />
      ) : null}
      {fileToast ? (
        <div className="file-toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <div>
            <strong>{fileToast.title}</strong>
            <span>{fileToast.detail}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

