import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Crop,
  Download,
  Edit2,
  Edit3,
  FlipHorizontal,
  Image as ImageIcon,
  Minus,
  Plus,
  RotateCw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { SakiInputAttachment } from "@webops/shared";
import { formatBytes } from "../../utils/path.js";

export interface SakiAttachmentModalProps {
  attachment: SakiInputAttachment;
  editable: boolean;
  onClose: () => void;
  onSave?: (updated: SakiInputAttachment) => void;
  onRemove?: () => void;
}

type StudioMode = "view" | "crop" | "annotate";
type AnnotationTool = "pen" | "rect" | "arrow" | "circle" | "text";

interface Point {
  x: number;
  y: number;
}

interface AnnotationItem {
  id: string;
  tool: AnnotationTool;
  color: string;
  lineWidth: number;
  points?: Point[] | undefined; // for pen
  start?: Point | undefined; // for rect, arrow, circle
  end?: Point | undefined;
  text?: string | undefined;
  textPos?: Point | undefined;
}

const COLOR_PALETTE = [
  { label: "粉红", value: "#ff75ac" },
  { label: "亮红", value: "#ef4444" },
  { label: "亮黄", value: "#f59e0b" },
  { label: "鲜绿", value: "#10b981" },
  { label: "湛蓝", value: "#3b82f6" },
  { label: "纯白", value: "#ffffff" },
  { label: "纯黑", value: "#1e293b" }
];

const LINE_WIDTHS = [
  { label: "细", value: 3 },
  { label: "中", value: 6 },
  { label: "粗", value: 12 }
];

export function SakiAttachmentModal({
  attachment,
  editable,
  onClose,
  onSave,
  onRemove
}: SakiAttachmentModalProps) {
  const [currentDataUrl, setCurrentDataUrl] = useState<string>(attachment.dataUrl || "");
  const [history, setHistory] = useState<string[]>([attachment.dataUrl || ""]);
  const [name, setName] = useState(attachment.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<StudioMode>("view");

  // Crop State (relative 0..1)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.1,
    y: 0.1,
    w: 0.8,
    h: 0.8
  });
  const [cropAspect, setCropAspect] = useState<"free" | "1:1" | "4:3" | "16:9">("free");
  const [isDraggingCrop, setIsDraggingCrop] = useState<string | null>(null); // 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'draw'
  const cropStartPos = useRef<{ x: number; y: number; rect: typeof cropRect }>({
    x: 0,
    y: 0,
    rect: { x: 0, y: 0, w: 0, h: 0 }
  });

  // Annotation State
  const [annotTool, setAnnotTool] = useState<AnnotationTool>("pen");
  const [annotColor, setAnnotColor] = useState("#ff75ac");
  const [annotLineWidth, setAnnotLineWidth] = useState(6);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [activeAnnotation, setActiveAnnotation] = useState<AnnotationItem | null>(null);
  const [textInputVal, setTextInputVal] = useState("");
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);

  const [imgDimensions, setImgDimensions] = useState<{ width: number; height: number } | null>(
    attachment.width && attachment.height ? { width: attachment.width, height: attachment.height } : null
  );

  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const annotCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setCurrentDataUrl(attachment.dataUrl || "");
    setHistory([attachment.dataUrl || ""]);
    setName(attachment.name);
    setZoom(1);
    setMode("view");
    setAnnotations([]);
  }, [attachment]);

  // ESC to close or cancel mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode !== "view") {
          setMode("view");
          setAnnotations([]);
          setTextInputPos(null);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, onClose]);

  // Mouse wheel zoom on viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (mode !== "view") return; // disable wheel zoom during crop/annot
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((z) => Math.max(0.2, Math.min(3, Math.round((z + delta) * 100) / 100)));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setImgDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }

  function pushHistory(newDataUrl: string) {
    setCurrentDataUrl(newDataUrl);
    setHistory((prev) => [...prev, newDataUrl]);
  }

  function handleUndo() {
    if (history.length <= 1) return;
    const nextHistory = history.slice(0, -1);
    setHistory(nextHistory);
    setCurrentDataUrl(nextHistory[nextHistory.length - 1] ?? "");
  }

  // Rotate 90 degrees clockwise
  function handleRotate() {
    if (!currentDataUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotated = canvas.toDataURL(attachment.mimeType || "image/png");
      pushHistory(rotated);
      setImgDimensions({ width: canvas.width, height: canvas.height });
    };
    img.src = currentDataUrl;
  }

  // Flip horizontal
  function handleFlipHorizontal() {
    if (!currentDataUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);

      const flipped = canvas.toDataURL(attachment.mimeType || "image/png");
      pushHistory(flipped);
    };
    img.src = currentDataUrl;
  }

  // Copy image to clipboard
  async function handleCopy() {
    if (!currentDataUrl) return;
    try {
      const res = await fetch(currentDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(currentDataUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }

  // Download image
  function handleDownload() {
    if (!currentDataUrl) return;
    const a = document.createElement("a");
    a.href = currentDataUrl;
    a.download = name || "attachment";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ----------------------------------------------------
  // Crop Functions
  // ----------------------------------------------------
  function startCropMode() {
    setZoom(1);
    setCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    setMode("crop");
  }

  function applyCrop() {
    if (!imgDimensions || !currentDataUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const cropPxX = Math.round(cropRect.x * img.naturalWidth);
      const cropPxY = Math.round(cropRect.y * img.naturalHeight);
      const cropPxW = Math.max(10, Math.round(cropRect.w * img.naturalWidth));
      const cropPxH = Math.max(10, Math.round(cropRect.h * img.naturalHeight));

      canvas.width = cropPxW;
      canvas.height = cropPxH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, cropPxX, cropPxY, cropPxW, cropPxH, 0, 0, cropPxW, cropPxH);
      const cropped = canvas.toDataURL(attachment.mimeType || "image/png");
      pushHistory(cropped);
      setImgDimensions({ width: cropPxW, height: cropPxH });
      setMode("view");
    };
    img.src = currentDataUrl;
  }

  function handleCropMouseDown(e: React.MouseEvent, handleType: string) {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingCrop(handleType);
    cropStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      rect: { ...cropRect }
    };
  }

  function handleCropMouseMove(e: React.MouseEvent) {
    if (!isDraggingCrop || !imgRef.current) return;
    const imgBounds = imgRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - cropStartPos.current.x) / imgBounds.width;
    const deltaY = (e.clientY - cropStartPos.current.y) / imgBounds.height;
    const orig = cropStartPos.current.rect;

    let nx = orig.x;
    let ny = orig.y;
    let nw = orig.w;
    let nh = orig.h;

    if (isDraggingCrop === "move") {
      nx = Math.max(0, Math.min(1 - orig.w, orig.x + deltaX));
      ny = Math.max(0, Math.min(1 - orig.h, orig.y + deltaY));
    } else if (isDraggingCrop === "se") {
      nw = Math.max(0.05, Math.min(1 - orig.x, orig.w + deltaX));
      nh = cropAspect === "1:1" ? nw : Math.max(0.05, Math.min(1 - orig.y, orig.h + deltaY));
    } else if (isDraggingCrop === "nw") {
      const maxDx = orig.w - 0.05;
      const maxDy = orig.h - 0.05;
      const dx = Math.max(-orig.x, Math.min(maxDx, deltaX));
      const dy = Math.max(-orig.y, Math.min(maxDy, deltaY));
      nx = orig.x + dx;
      ny = orig.y + dy;
      nw = orig.w - dx;
      nh = orig.h - dy;
    } else if (isDraggingCrop === "ne") {
      const maxDy = orig.h - 0.05;
      const dy = Math.max(-orig.y, Math.min(maxDy, deltaY));
      ny = orig.y + dy;
      nw = Math.max(0.05, Math.min(1 - orig.x, orig.w + deltaX));
      nh = orig.h - dy;
    } else if (isDraggingCrop === "sw") {
      const maxDx = orig.w - 0.05;
      const dx = Math.max(-orig.x, Math.min(maxDx, deltaX));
      nx = orig.x + dx;
      nw = orig.w - dx;
      nh = Math.max(0.05, Math.min(1 - orig.y, orig.h + deltaY));
    }

    setCropRect({ x: nx, y: ny, w: nw, h: nh });
  }

  function handleCropMouseUp() {
    setIsDraggingCrop(null);
  }

  // ----------------------------------------------------
  // Annotation Functions
  // ----------------------------------------------------
  function startAnnotateMode() {
    setZoom(1);
    setAnnotations([]);
    setActiveAnnotation(null);
    setTextInputPos(null);
    setMode("annotate");
  }

  function getCanvasCoords(e: React.MouseEvent): Point {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return {
      x: Math.round(relX * (imgDimensions?.width ?? 800)),
      y: Math.round(relY * (imgDimensions?.height ?? 600))
    };
  }

  function handleAnnotMouseDown(e: React.MouseEvent) {
    if (mode !== "annotate" || !imgDimensions) return;
    const pt = getCanvasCoords(e);

    if (annotTool === "text") {
      setTextInputPos(pt);
      setTextInputVal("");
      return;
    }

    const newAnnot: AnnotationItem = {
      id: String(Date.now()),
      tool: annotTool,
      color: annotColor,
      lineWidth: annotLineWidth,
      points: annotTool === "pen" ? [pt] : undefined,
      start: pt,
      end: pt
    };
    setActiveAnnotation(newAnnot);
  }

  function handleAnnotMouseMove(e: React.MouseEvent) {
    if (!activeAnnotation || mode !== "annotate") return;
    const pt = getCanvasCoords(e);

    if (activeAnnotation.tool === "pen") {
      setActiveAnnotation((prev) =>
        prev ? { ...prev, points: [...(prev.points || []), pt] } : null
      );
    } else {
      setActiveAnnotation((prev) => (prev ? { ...prev, end: pt } : null));
    }
  }

  function handleAnnotMouseUp() {
    if (!activeAnnotation) return;
    setAnnotations((prev) => [...prev, activeAnnotation]);
    setActiveAnnotation(null);
  }

  function handleAddTextAnnotation() {
    if (!textInputPos || !textInputVal.trim()) {
      setTextInputPos(null);
      return;
    }
    setAnnotations((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        tool: "text",
        color: annotColor,
        lineWidth: annotLineWidth,
        text: textInputVal.trim(),
        textPos: textInputPos
      }
    ]);
    setTextInputPos(null);
    setTextInputVal("");
  }

  // Render annotations onto a canvas overlay
  useEffect(() => {
    if (mode !== "annotate" || !annotCanvasRef.current || !imgDimensions) return;
    const canvas = annotCanvasRef.current;
    canvas.width = imgDimensions.width;
    canvas.height = imgDimensions.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const all = [...annotations, ...(activeAnnotation ? [activeAnnotation] : [])];
    for (const a of all) {
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (a.tool === "pen" && a.points && a.points.length > 1 && a.points[0]) {
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        for (let i = 1; i < a.points.length; i++) {
          const pt = a.points[i];
          if (pt) ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      } else if (a.tool === "rect" && a.start && a.end) {
        ctx.beginPath();
        ctx.strokeRect(
          Math.min(a.start.x, a.end.x),
          Math.min(a.start.y, a.end.y),
          Math.abs(a.end.x - a.start.x),
          Math.abs(a.end.y - a.start.y)
        );
      } else if (a.tool === "circle" && a.start && a.end) {
        const cx = (a.start.x + a.end.x) / 2;
        const cy = (a.start.y + a.end.y) / 2;
        const rx = Math.abs(a.end.x - a.start.x) / 2;
        const ry = Math.abs(a.end.y - a.start.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (a.tool === "arrow" && a.start && a.end) {
        const fromX = a.start.x;
        const fromY = a.start.y;
        const toX = a.end.x;
        const toY = a.end.y;
        const headLen = Math.max(14, a.lineWidth * 2.5);
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (a.tool === "text" && a.text && a.textPos) {
        const fontSize = Math.max(18, a.lineWidth * 3.5);
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = a.color;
        // Background banner for readability
        const metrics = ctx.measureText(a.text);
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(a.textPos.x - 4, a.textPos.y - fontSize + 2, metrics.width + 12, fontSize + 8);
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, a.textPos.x + 2, a.textPos.y);
      }
    }
  }, [annotations, activeAnnotation, mode, imgDimensions]);

  // Burn annotations into main canvas and push to history
  function applyAnnotations() {
    if (!imgDimensions || !currentDataUrl || annotations.length === 0) {
      setMode("view");
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw base image
      ctx.drawImage(img, 0, 0);

      // Draw overlay canvas
      if (annotCanvasRef.current) {
        ctx.drawImage(annotCanvasRef.current, 0, 0);
      }

      const merged = canvas.toDataURL(attachment.mimeType || "image/png");
      pushHistory(merged);
      setAnnotations([]);
      setMode("view");
    };
    img.src = currentDataUrl;
  }

  // Save changes to draft
  function handleCommitSave() {
    if (!onSave) return;
    const approxSize = Math.round((currentDataUrl.length * 3) / 4);
    const updated: SakiInputAttachment = {
      ...attachment,
      name: name.trim() || attachment.name,
      dataUrl: currentDataUrl,
      size: approxSize,
      ...(imgDimensions ? { width: imgDimensions.width, height: imgDimensions.height } : {})
    };
    onSave(updated);
  }

  const isImage = attachment.kind === "image" || attachment.kind === "screenshot" || Boolean(currentDataUrl);

  const modalNode = (
    <div className="saki-attachment-lightbox-overlay" onClick={onClose}>
      <div
        className="saki-attachment-lightbox-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="saki-attachment-lightbox-header">
          <div className="saki-attachment-lightbox-meta">
            <div className="saki-attachment-lightbox-badge">
              <ImageIcon size={18} />
            </div>
            <div className="saki-attachment-lightbox-info">
              {isEditingName && editable ? (
                <input
                  type="text"
                  className="saki-attachment-lightbox-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setIsEditingName(false);
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className="saki-attachment-lightbox-title"
                  title={editable ? "点击修改文件名" : undefined}
                  onClick={() => editable && setIsEditingName(true)}
                >
                  <span>{name}</span>
                  {editable ? <Edit2 size={13} className="saki-attachment-edit-pencil" /> : null}
                </div>
              )}
              <div className="saki-attachment-lightbox-tags">
                <span className="saki-tag">
                  {attachment.kind === "screenshot"
                    ? "屏幕快照"
                    : attachment.kind === "image"
                    ? "图像附件"
                    : "文件"}
                </span>
                {imgDimensions ? (
                  <span className="saki-tag">
                    {imgDimensions.width} × {imgDimensions.height}
                  </span>
                ) : null}
                {attachment.size ? <span className="saki-tag">{formatBytes(attachment.size)}</span> : null}
                {mode === "crop" ? (
                  <span className="saki-tag mode-tag">✂️ 裁剪模式中</span>
                ) : mode === "annotate" ? (
                  <span className="saki-tag mode-tag">🖌️ 标注模式中</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="saki-attachment-lightbox-header-right">
            {/* Quick Zoom Slider inside Header */}
            {mode === "view" && isImage ? (
              <div className="saki-lightbox-zoom-bar">
                <ZoomOut
                  size={14}
                  className="zoom-icon-btn"
                  onClick={() => setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 100) / 100))}
                />
                <input
                  type="range"
                  min="0.2"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="saki-lightbox-zoom-slider"
                  title="拉动缩放或使用鼠标滚轮"
                />
                <ZoomIn
                  size={14}
                  className="zoom-icon-btn"
                  onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))}
                />
                <span
                  className="saki-lightbox-zoom-pct"
                  onClick={() => setZoom(1)}
                  title="点击恢复 100%"
                >
                  {Math.round(zoom * 100)}%
                </span>
              </div>
            ) : null}

            <button
              className="saki-attachment-lightbox-close-btn"
              type="button"
              onClick={onClose}
              title="关闭预览 (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Center Viewport */}
        <div
          ref={viewportRef}
          className="saki-attachment-lightbox-viewport"
          onMouseMove={mode === "crop" ? handleCropMouseMove : mode === "annotate" ? handleAnnotMouseMove : undefined}
          onMouseUp={mode === "crop" ? handleCropMouseUp : mode === "annotate" ? handleAnnotMouseUp : undefined}
        >
          {isImage && currentDataUrl ? (
            <div
              className="saki-attachment-lightbox-canvas"
              style={{ transform: `scale(${zoom})` }}
            >
              <div className="saki-attachment-interactive-stage">
                <img
                  ref={imgRef}
                  src={currentDataUrl}
                  alt={name}
                  className="saki-attachment-lightbox-img"
                  onLoad={handleImageLoad}
                  draggable={false}
                />

                {/* Crop Interactive Layer */}
                {mode === "crop" && (
                  <div
                    className="saki-crop-overlay-layer"
                    onMouseDown={(e) => handleCropMouseDown(e, "move")}
                  >
                    {/* Darkened Mask Outside */}
                    <div
                      className="saki-crop-box"
                      style={{
                        left: `${cropRect.x * 100}%`,
                        top: `${cropRect.y * 100}%`,
                        width: `${cropRect.w * 100}%`,
                        height: `${cropRect.h * 100}%`
                      }}
                    >
                      {/* Grid Lines */}
                      <div className="saki-crop-grid-h1" />
                      <div className="saki-crop-grid-h2" />
                      <div className="saki-crop-grid-v1" />
                      <div className="saki-crop-grid-v2" />

                      {/* 4 Corner Resize Handles */}
                      <div
                        className="saki-crop-handle nw"
                        onMouseDown={(e) => handleCropMouseDown(e, "nw")}
                      />
                      <div
                        className="saki-crop-handle ne"
                        onMouseDown={(e) => handleCropMouseDown(e, "ne")}
                      />
                      <div
                        className="saki-crop-handle sw"
                        onMouseDown={(e) => handleCropMouseDown(e, "sw")}
                      />
                      <div
                        className="saki-crop-handle se"
                        onMouseDown={(e) => handleCropMouseDown(e, "se")}
                      />
                    </div>
                  </div>
                )}

                {/* Annotation Overlay Canvas */}
                {mode === "annotate" && (
                  <canvas
                    ref={annotCanvasRef}
                    className="saki-annot-canvas-overlay"
                    onMouseDown={handleAnnotMouseDown}
                  />
                )}

                {/* Inline Text Input Popover */}
                {mode === "annotate" && textInputPos && imgDimensions && (
                  <div
                    className="saki-annot-text-popup"
                    style={{
                      left: `${(textInputPos.x / imgDimensions.width) * 100}%`,
                      top: `${(textInputPos.y / imgDimensions.height) * 100}%`
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      className="saki-annot-text-input"
                      placeholder="输入标注文本..."
                      value={textInputVal}
                      onChange={(e) => setTextInputVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTextAnnotation();
                        if (e.key === "Escape") setTextInputPos(null);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="saki-annot-text-ok-btn"
                      onClick={handleAddTextAnnotation}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="saki-attachment-lightbox-raw-text">
              <pre>{attachment.text || "非图片附件，无直接预览。"}</pre>
            </div>
          )}
        </div>

        {/* Footer Subtoolbar & Action Bar */}
        <div className="saki-attachment-lightbox-footer">
          {mode === "crop" ? (
            /* Crop Mode Subtoolbar */
            <div className="saki-lightbox-mode-toolbar">
              <span className="saki-mode-label">比例预设:</span>
              <button
                type="button"
                className={`saki-mode-chip ${cropAspect === "free" ? "active" : ""}`}
                onClick={() => setCropAspect("free")}
              >
                自由
              </button>
              <button
                type="button"
                className={`saki-mode-chip ${cropAspect === "1:1" ? "active" : ""}`}
                onClick={() => {
                  setCropAspect("1:1");
                  setCropRect((r) => ({ ...r, h: r.w }));
                }}
              >
                1:1 正方
              </button>
              <button
                type="button"
                className={`saki-mode-chip ${cropAspect === "4:3" ? "active" : ""}`}
                onClick={() => {
                  setCropAspect("4:3");
                  setCropRect((r) => ({ ...r, h: (r.w * 3) / 4 }));
                }}
              >
                4:3
              </button>
              <button
                type="button"
                className={`saki-mode-chip ${cropAspect === "16:9" ? "active" : ""}`}
                onClick={() => {
                  setCropAspect("16:9");
                  setCropRect((r) => ({ ...r, h: (r.w * 9) / 16 }));
                }}
              >
                16:9
              </button>

              <div className="saki-mode-actions">
                <button
                  type="button"
                  className="saki-lightbox-tool-btn"
                  onClick={() => setMode("view")}
                >
                  <X size={15} />
                  <span>取消</span>
                </button>
                <button
                  type="button"
                  className="saki-lightbox-primary-btn"
                  onClick={applyCrop}
                >
                  <Check size={15} />
                  <span>确认裁剪</span>
                </button>
              </div>
            </div>
          ) : mode === "annotate" ? (
            /* Annotate Mode Subtoolbar */
            <div className="saki-lightbox-mode-toolbar">
              <div className="saki-annot-tools-group">
                <button
                  type="button"
                  className={`saki-annot-tool-btn ${annotTool === "pen" ? "active" : ""}`}
                  title="自由画笔"
                  onClick={() => setAnnotTool("pen")}
                >
                  <Edit3 size={15} />
                </button>
                <button
                  type="button"
                  className={`saki-annot-tool-btn ${annotTool === "rect" ? "active" : ""}`}
                  title="矩形框"
                  onClick={() => setAnnotTool("rect")}
                >
                  <Square size={15} />
                </button>
                <button
                  type="button"
                  className={`saki-annot-tool-btn ${annotTool === "circle" ? "active" : ""}`}
                  title="圆形"
                  onClick={() => setAnnotTool("circle")}
                >
                  <Circle size={15} />
                </button>
                <button
                  type="button"
                  className={`saki-annot-tool-btn ${annotTool === "arrow" ? "active" : ""}`}
                  title="箭头标注"
                  onClick={() => setAnnotTool("arrow")}
                >
                  <ArrowUpRight size={15} />
                </button>
                <button
                  type="button"
                  className={`saki-annot-tool-btn ${annotTool === "text" ? "active" : ""}`}
                  title="文字标注 (点击图片任意处输入)"
                  onClick={() => setAnnotTool("text")}
                >
                  <Type size={15} />
                </button>
              </div>

              <div className="saki-lightbox-tool-divider" />

              {/* Color Swatches */}
              <div className="saki-annot-colors">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`saki-color-dot ${annotColor === c.value ? "active" : ""}`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                    onClick={() => setAnnotColor(c.value)}
                  />
                ))}
              </div>

              <div className="saki-lightbox-tool-divider" />

              {/* Stroke Widths */}
              <div className="saki-annot-widths">
                {LINE_WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    className={`saki-width-pill ${annotLineWidth === w.value ? "active" : ""}`}
                    onClick={() => setAnnotLineWidth(w.value)}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              {annotations.length > 0 && (
                <button
                  type="button"
                  className="saki-lightbox-tool-btn"
                  title="撤销上个标注"
                  onClick={() => setAnnotations((prev) => prev.slice(0, -1))}
                >
                  <Undo2 size={15} />
                  <span>撤销笔画</span>
                </button>
              )}

              <div className="saki-mode-actions">
                <button
                  type="button"
                  className="saki-lightbox-tool-btn"
                  onClick={() => {
                    setAnnotations([]);
                    setMode("view");
                  }}
                >
                  <X size={15} />
                  <span>取消</span>
                </button>
                <button
                  type="button"
                  className="saki-lightbox-primary-btn"
                  onClick={applyAnnotations}
                >
                  <Check size={15} />
                  <span>应用标注</span>
                </button>
              </div>
            </div>
          ) : (
            /* View Mode Standard Toolbar */
            <>
              <div className="saki-attachment-lightbox-tools">
                {isImage ? (
                  <>
                    <button
                      type="button"
                      className="saki-lightbox-tool-btn"
                      title="裁剪图片"
                      onClick={startCropMode}
                    >
                      <Crop size={16} />
                      <span>裁剪</span>
                    </button>
                    <button
                      type="button"
                      className="saki-lightbox-tool-btn"
                      title="添加画笔、箭头与文字标注"
                      onClick={startAnnotateMode}
                    >
                      <Edit3 size={16} />
                      <span>标注</span>
                    </button>
                    <div className="saki-lightbox-tool-divider" />
                    <button
                      type="button"
                      className="saki-lightbox-tool-btn"
                      title="顺时针旋转 90 度"
                      onClick={handleRotate}
                    >
                      <RotateCw size={16} />
                      <span>旋转</span>
                    </button>
                    <button
                      type="button"
                      className="saki-lightbox-tool-btn"
                      title="水平镜像翻转"
                      onClick={handleFlipHorizontal}
                    >
                      <FlipHorizontal size={16} />
                      <span>翻转</span>
                    </button>
                    {history.length > 1 ? (
                      <button
                        type="button"
                        className="saki-lightbox-tool-btn active"
                        title="撤销上一步修改"
                        onClick={handleUndo}
                      >
                        <Undo2 size={16} />
                        <span>撤销 ({history.length - 1})</span>
                      </button>
                    ) : null}
                    <div className="saki-lightbox-tool-divider" />
                  </>
                ) : null}

                <button
                  type="button"
                  className="saki-lightbox-tool-btn"
                  title="复制图片到剪贴板"
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check size={16} style={{ color: "#10b981" }} /> : <Copy size={16} />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>
                <button
                  type="button"
                  className="saki-lightbox-tool-btn"
                  title="下载保存到本地"
                  onClick={handleDownload}
                >
                  <Download size={16} />
                  <span>下载</span>
                </button>
              </div>

              <div className="saki-attachment-lightbox-actions">
                {editable && onRemove ? (
                  <button
                    type="button"
                    className="saki-lightbox-danger-btn"
                    onClick={onRemove}
                    title="从当前消息草稿中移除此附件"
                  >
                    <Trash2 size={15} />
                    <span>移除附件</span>
                  </button>
                ) : null}
                {editable && onSave ? (
                  <button
                    type="button"
                    className="saki-lightbox-primary-btn"
                    onClick={handleCommitSave}
                    title="应用所有编辑并同步回输入框草稿"
                  >
                    <Save size={15} />
                    <span>保存修改</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="saki-lightbox-primary-btn"
                    onClick={onClose}
                  >
                    完成
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalNode, document.body) : null;
}
