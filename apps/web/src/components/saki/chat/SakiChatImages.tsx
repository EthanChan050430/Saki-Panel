import React, { useEffect, useMemo, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { isSakiImageAttachment, type SakiAgentAction, type SakiInputAttachment } from "@webops/shared";
import { api } from "../../../api.js";
import type { LocalSakiMessage } from "../../../types/app.js";

const generatedImageSrcCache = new Map<string, string>();

export function collectSakiMessageImages(message: LocalSakiMessage): SakiInputAttachment[] {
  const items: SakiInputAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: SakiInputAttachment | undefined) => {
    if (!attachment || !isSakiImageAttachment(attachment)) return;
    const key = attachment.generatedImageId || attachment.id || attachment.dataUrl || attachment.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(attachment);
  };
  for (const attachment of message.attachments ?? []) push(attachment);
  for (const action of message.actions ?? []) {
    for (const attachment of action.attachments ?? []) push(attachment);
  }
  return items;
}

export function collectSakiActionImages(action: SakiAgentAction): SakiInputAttachment[] {
  return (action.attachments ?? []).filter(isSakiImageAttachment);
}

export function mergeSakiMessageAttachments(
  current: SakiInputAttachment[] | undefined,
  incoming?: SakiInputAttachment[],
  actions?: SakiAgentAction[]
): SakiInputAttachment[] {
  const items: SakiInputAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: SakiInputAttachment | undefined) => {
    if (!attachment) return;
    const key = attachment.generatedImageId || attachment.id || attachment.dataUrl || attachment.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(attachment);
  };
  for (const attachment of current ?? []) push(attachment);
  for (const attachment of incoming ?? []) push(attachment);
  for (const action of actions ?? []) {
    for (const attachment of action.attachments ?? []) push(attachment);
  }
  return items;
}

export function SakiChatImage({
  attachment,
  token,
  compact = false,
  onPreview
}: {
  attachment: SakiInputAttachment;
  token: string;
  compact?: boolean;
  onPreview?: (attachment: SakiInputAttachment) => void;
}) {
  const imageId = attachment.generatedImageId || (attachment.id && !attachment.dataUrl ? attachment.id : "");
  const [src, setSrc] = useState(attachment.dataUrl || (imageId ? generatedImageSrcCache.get(imageId) : "") || "");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!src && Boolean(imageId && token));

  useEffect(() => {
    if (attachment.dataUrl) {
      setSrc(attachment.dataUrl);
      setFailed(false);
      setLoading(false);
      return;
    }
    if (!imageId || !token) {
      setLoading(false);
      if (!src) setFailed(true);
      return;
    }
    const cached = generatedImageSrcCache.get(imageId);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .sakiGeneratedImageBlob(token, imageId)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        generatedImageSrcCache.set(imageId, objectUrl);
        setSrc(objectUrl);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.dataUrl, imageId, token]);

  const previewAttachment = useMemo(
    () => (src ? { ...attachment, dataUrl: src, kind: "image" as const } : attachment),
    [attachment, src]
  );

  if (loading) {
    return (
      <div className={`saki-chat-generated-image is-loading ${compact ? "is-compact" : ""}`}>
        <Loader2 size={18} className="status-spinner" />
        <span>载入图片...</span>
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className={`saki-chat-generated-image is-failed ${compact ? "is-compact" : ""}`}>
        <ImageOff size={16} />
        <span>{attachment.name || "图片加载失败"}</span>
      </div>
    );
  }

  return (
    <figure
      className={`saki-chat-generated-image ${compact ? "is-compact" : ""} ${onPreview ? "is-clickable" : ""}`}
      onClick={onPreview ? () => onPreview(previewAttachment) : undefined}
      onKeyDown={
        onPreview
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPreview(previewAttachment);
              }
            }
          : undefined
      }
      role={onPreview ? "button" : undefined}
      tabIndex={onPreview ? 0 : undefined}
      title={onPreview ? "点击查看大图" : attachment.name}
    >
      <img src={src} alt={attachment.name || "generated"} draggable={false} />
      {attachment.name ? <figcaption>{attachment.name}</figcaption> : null}
    </figure>
  );
}

export function SakiChatGeneratedImages({
  message,
  token,
  compact = false,
  onPreview
}: {
  message: LocalSakiMessage;
  token: string;
  compact?: boolean;
  onPreview?: (attachment: SakiInputAttachment) => void;
}) {
  const images = collectSakiMessageImages(message);
  if (!images.length || !token) return null;
  return (
    <div className={`saki-chat-generated-images ${compact ? "is-compact" : ""}`}>
      {images.map((attachment, index) => (
        <SakiChatImage
          key={attachment.generatedImageId || attachment.id || `${attachment.name}-${index}`}
          attachment={attachment}
          token={token}
          compact={compact}
          {...(onPreview ? { onPreview } : {})}
        />
      ))}
    </div>
  );
}
